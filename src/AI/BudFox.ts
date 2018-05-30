import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractSubController} from "../AbstractSubController";
import * as EventEmitter from 'events';
import {OrderModification} from "../structs/OrderResult";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeConfig} from "../Trade/TradeConfig";
import * as db from "../database";
import {AbstractExchange, ExchangeMap} from "../Exchanges/AbstractExchange";
import {default as HistoryDataExchange, HistoryExchangeMap, HistoryDataExchangeOptions} from "../Exchanges/HistoryDataExchange";
import {BrainConfig} from "./BrainConfig";
import {CandleMaker} from "../Trade/Candles/CandleMaker";
import {CandleBatcher} from "../Trade/Candles/CandleBatcher";
import {CandleMakerMap} from "../TradeAdvisor";

export interface CombinedCurrencyData {
    [pair: string]: Candle.Candle; // currency pair -> candle
}

export class CandleBatcherMap extends Map<string, CandleBatcher<Trade.Trade>> { // 1 candle batcher per currency pair
    constructor() {
        super()
    }
}
export class PendingCandleMap extends Map<string, Candle.Candle[]> { // (currency pair, candles)
    constructor() {
        super()
    }

    public addCandle(candle: Candle.Candle) {
        let candles = this.get(candle.currencyPair.toString());
        if (!candles)
            candles = [];
        candles.push(candle)
        this.set(candle.currencyPair.toString(), candles)
    }

    public removeFirst() {
        for (let cand of this)
        {
            if (cand[1].length >= 1)
                cand[1].shift();
        }
    }
}

/**
 * Inspired the the movie "Wall Street", this is our "Bud Fox" - the guy fetching market data for our Brain.
 * So we should rename our Brain to Gekko ;)
 * It is implemented as an EventEmitter emitting CombinedCurrencyData.
 * Events: on("data", (data: CombinedCurrencyData))
 */
export class BudFox extends EventEmitter {
    protected className: string;
    protected config: BrainConfig;
    protected exchanges: ExchangeMap; // (exchange name, instance)
    protected candleMakers = new CandleMakerMap();
    protected candleBatchers = new CandleBatcherMap();
    protected pendingCandles = new PendingCandleMap();

    protected minPrice: number = Number.POSITIVE_INFINITY;
    protected maxPrice: number = Number.NEGATIVE_INFINITY;

    constructor(config: BrainConfig, exchanges: ExchangeMap) {
        super()
        this.className = this.constructor.name;
        this.config = config;
        this.exchanges = exchanges

        this.pipeGlobalMarketStreams();
        this.connectCandles();
        this.subscribeToExchangeData();
    }

    public getCandleNetworkData(candles: Candle.Candle[], normalize = false) {
        let closePoints = candles.map(x => x.close)
        if (normalize === true) {
            // TODO what if min/max changes afterwards? can't happen during training
            // but new all-time highs are likely afterwards. so we have to retrain the model then
            // for best training results the value of each input variable should be 0 on average over the whole training data
            // therefore increasing maxPrice by an offset might cause worse results
            if (this.minPrice === Number.POSITIVE_INFINITY || this.maxPrice === Number.NEGATIVE_INFINITY)
                throw new Error("Price Minima/Maxima not initialized")
            for (let i = 0; i < closePoints.length; i++)
                closePoints[i] = this.normalizePrice(closePoints[i]);
        }
        return closePoints;
    }

    public normalizePrice(price: number) {
        // for neural network training with multiple currency pairs we have to normalize the input data to fit on the following range
        // [-1, 1]: IndexNormalized(x) = (Index(x) - Min(Index)) / (Max(Index) - Min(Index))
        // otherwise the weights won't adjust properly
        return (price - this.minPrice) / (this.maxPrice - this.minPrice);
    }

    public getRealPrice(normalizedPrice: number) {
        // Index(x) = IndexNormalized(x) * (Max(Index) - Min(Index)) + Min(Index)
        if (this.minPrice === Number.POSITIVE_INFINITY || this.maxPrice === Number.NEGATIVE_INFINITY)
            throw new Error("Price Minima/Maxima not initialized")
        return normalizedPrice * (this.maxPrice - this.minPrice) + this.minPrice;
    }

    public getMinPrice() {
        return this.minPrice;
    }

    public setMinPrice(price: number) {
        this.minPrice = price;
    }

    public getMaxPrice() {
        return this.maxPrice;
    }

    public setMaxPrice(price: number) {
        this.maxPrice = price;
    }

    public updateMinMax(min: number, max: number) {
        if (this.minPrice > min)
            this.minPrice = min;
        if (this.maxPrice > max)
            this.maxPrice = max;
    }

    public validateMinMax() {
        if (this.getMinPrice() === null || this.getMaxPrice() === null) { // how did this happen?
            logger.error("Min/Max price is null. Predictions will not work because of normalization error.")
            return false;
        }
        return true;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected pipeGlobalMarketStreams() {
        for (let ex of this.exchanges)
        {
            if (this.config.exchanges.indexOf(ex[0]) === -1) {
                logger.verbose("Removing not used exchange %s", ex[0])
                this.exchanges.delete(ex[0])
                continue
            }
            ex[1].getMarketStream().on("trades", (currencyPair: Currency.CurrencyPair, trades: Trade.Trade[]) => {
                if (nconf.get("serverConfig:storeTrades") && nconf.get('trader') !== "Backtester" && (ex[1] instanceof HistoryDataExchange) === false) { // speeds up backtesting a lot
                    Trade.storeTrades(db.get(), trades, (err) => {
                        if (err)
                            logger.error("Error storing trades", err)
                    })
                }
                this.candleMakers.get(currencyPair.toString()).addTrades(trades);
            })
            ex[1].getMarketStream().on("orders", (currencyPair: Currency.CurrencyPair, orders: OrderModification[]) => {
                // we probably won't make any predictions based on orders?
            })
        }
    }

    protected connectCandles() {
        let batchers = []
        this.config.markets.forEach((pair) => {
            const pairStr = pair.toString();
            // here we only have 1 candle maker and 1 batcher per currency pair (because we only allow to train with 1 candleSize)
            let maker = new CandleMaker<Trade.Trade>(pair);
            let batcher = new CandleBatcher<Trade.Trade>(this.config.candleSize, pair);
            maker.on("candles", (candles: Candle.Candle[]) => {
                batcher.addCandles(candles)
            })
            batcher.on("candles", (candles: Candle.Candle[]) => {
                this.addData(candles)
            })
            this.candleMakers.set(pairStr, maker);
            this.candleBatchers.set(pairStr, batcher)
            batchers.push(batcher.getCurrencyPair().toString() + ": " + batcher.getInterval() + " min")
        })
        logger.info("Active BudFox candle batchers:", batchers);
    }

    protected subscribeToExchangeData() {
        for (let ex of this.exchanges)
        {
            if ((ex[1] instanceof HistoryDataExchange) === false)
                ex[1].subscribeToMarkets(this.config.markets)
        }
        if (this.exchanges.size === 1) {
            for (let ex of this.exchanges)
            {
                for (let maker of this.candleMakers)
                    maker[1].setExchange(ex[1].getExchangeLabel())
            }
        }
    }

    /**
     * Add candles of a currency pair and check if we have at least 1 candle of every subscribed currency pair.
     * If yes, then CombinedCurrencyData will be emitted.
     * @param candles
     */
    protected addData(candles: Candle.Candle[]) {
        let minMaxChanged = false;
        candles.forEach((candle) => {
            if (candle.tradeData)
                delete candle.tradeData; // save memory (especially during training)
            if (typeof candle.close !== "number") { // sanity check. how did this happen?
                logger.error("Ignoring invalid candle:", candle)
                return;
            }

            // find minima and maxima across all currency pairs
            if (this.minPrice > candle.close) {
                this.minPrice = candle.close;
                minMaxChanged = true;
            }
            if (this.maxPrice < candle.close) {
                this.maxPrice = candle.close;
                minMaxChanged = true;
            }
            this.pendingCandles.addCandle(candle)
        })
        if (minMaxChanged && nconf.get('trader') !== "Backtester")
            logger.warn("Min/Max values changed. You should consider retraining your model with the latest data.")
        this.checkEmitData();
    }

    protected checkEmitData() {
        let data: CombinedCurrencyData = {}
        for (let cand of this.pendingCandles)
        {
            if (cand[1].length < 1)
                return false; // not yet enough data of this currency pair
            data[cand[0]] = cand[1][0];
        }
        if (Object.keys(data).length !== this.config.markets.length) { // can happen with first candles
            //logger.warn("BudFox delayed emitting market data with missing currency pairs. Available:", Object.keys(data))
            return false;
        }
        this.pendingCandles.removeFirst();
        this.emit("data", data)
        return true;
    }
}