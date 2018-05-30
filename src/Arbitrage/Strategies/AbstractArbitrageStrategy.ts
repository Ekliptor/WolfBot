import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {TradeConfig} from "../../Trade/TradeConfig";
import {Candle, Currency, Trade, Order, Ticker, MarketOrder} from "@ekliptor/bit-models";
import {AbstractStrategy, StrategyAction, TradeAction} from "../../Strategies/AbstractStrategy";
import {ExchangeCandleMap, ExchangeCandles} from "../ExchangeCandles";
import {TradeInfo} from "../../Trade/AbstractTrader";
import {MarginPosition} from "../../structs/MarginPosition";
import {GenericStrategyState, StrategyInfo} from "../../Strategies/AbstractGenericStrategy";

// TODO arbitrage via Correlation Coefficient: https://www.tradingview.com/chart/2OGdiqM3/ https://www.tradingview.com/wiki/Correlation_Coefficient_(CC)


export type ArbitrageExchangePair = [Currency.Exchange, Currency.Exchange]; // [buy, sell]
export type ArbitrageRate = [number, number]; // [buy, sell]
export type ArbitrageTrade = Trade.TradeType.BUY | Trade.TradeType.SELL;
export type ArbitrageState = "open" | "halfOpen" | "none";

export type ExchangeFeeType = "maker" | "taker";
export interface TradingFee {
    maker: number;
    taker: number;
}
//export interface TradingFeeMap extends Map<string, TradingFee> { // (exchange name, fees)
export interface TradingFeeMap { // simpler config changes without overriding config changed function as object
    [name: string]: TradingFee;
}

export interface ArbitrageStrategyAction extends StrategyAction {
    tradingFees: TradingFeeMap;
    // TODO implement exchange APIs to get current fees for user (depends on his trading volume)
    tradingFeeDefault: number; // default 0.1%. fee used when the exchange is not listed in "tradingFees"
}

/**
 * An arbitrage strategy is a special kind of trading strategy. Here we create
 * candle ticks for all exchanges together (to compare prices and do arbitrage).
 */
export abstract class AbstractArbitrageStrategy extends AbstractStrategy {
    // TODO parent class members such as "candleHistory" contain data of both exchanges. create additional ones to separate them?
    // TODO triangle arbitrage support within 1 exchange: for example ETH_USD <-> BTC_USD <-> BTC_ETH
    protected action: ArbitrageStrategyAction;
    protected exchanges: Currency.Exchange[] = [];
    protected exchangeNames: string[] = [];
    protected arbitrageExchangePair: ArbitrageExchangePair = null;
    protected arbitrageRate: ArbitrageRate = null;
    protected arbitrageState: ArbitrageState = "none";

    protected exchangeCandles: ExchangeCandles[] = []; // history starting at pos 0 with most recent candle
    protected exchangeCandleMap = new ExchangeCandleMap(); // map where we collect current candles

    constructor(options) {
        super(options)
        if (!this.action.tradingFeeDefault)
            this.action.tradingFeeDefault = 0.1;
    }

    /**
     * Set exchange labels and names. The arrays must have the same length order.
     * @param {Currency.Exchange[]} exchanges
     * @param {string[]} exchangeNames
     */
    public setExchanges(exchanges: Currency.Exchange[], exchangeNames: string[]) {
        this.exchanges = exchanges;
        this.exchangeNames = exchangeNames;
        if (this.exchanges.length !== this.exchangeNames.length)
            logger.error("Exchange labels and names must have the same length. labels %s, names %s", this.exchanges.length, this.exchangeNames.length)
    }

    public getCurrentArbitrageExchangePair(): ArbitrageExchangePair {
        return this.arbitrageExchangePair;
    }

    /*
    public getRate(): number {
        //logger.error("getRate() function must be implemented in arbitrage strategies (otherwise it's not arbitrage, but trading)");
        //return super.getRate();
        return this.rate;
    }
    */
    public getArbitrageRate(arbitrageTrade: ArbitrageTrade): number {
        if (Array.isArray(this.arbitrageRate) === false || this.arbitrageRate.length !== 2) {
            logger.error("'arbitrageRate' must be set in in %s before calling buy/sell", this.className)
            return this.avgMarketPrice;
        }
        if (arbitrageTrade === Trade.TradeType.BUY)
            return this.arbitrageRate[0];
        return this.arbitrageRate[1]; // SELL
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        //const isSameClass = info.strategy.getClassName() === this.className || info.strategy.getInitiatorClassName() === this.className;
        // TODO check if the trade came from this class?
        if (action !== "close") {
            if (this.entryPrice === -1) // doesn't really apply here, but we have to set it for parent class
                this.entryPrice = this.avgMarketPrice;
            if (this.strategyPosition === "none")
                this.strategyPosition = "long"; // TODO add own state?
            switch (this.arbitrageState)
            {
                case "none":
                    this.arbitrageState = "halfOpen";
                    break;
                case "halfOpen":
                    this.arbitrageState = "open";
                    break;
            }
            //this.arbitrageState = info.exchange.getExchangeLabel()
        }
        else {
            this.arbitrageExchangePair = null;
            this.arbitrageState = "none"; // TODO state halfClosed? but we close together (or only trade on 1 exchange)
        }
    }

    public onSyncPortfolio(coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange) {
        super.onSyncPortfolio(coins, position, exchangeLabel);
        if (this.strategyPosition === "none") {
            this.arbitrageState = "none";
            return;
        }
        if (Array.isArray(this.arbitrageExchangePair) === false)
            this.arbitrageExchangePair = [Currency.Exchange.ALL, Currency.Exchange.ALL];
        if (this.strategyPosition === "long")
            this.arbitrageExchangePair[0] = exchangeLabel;
        else
            this.arbitrageExchangePair[1] = exchangeLabel;
        switch (this.arbitrageState)
        {
            case "none":
                this.arbitrageState = "halfOpen";
                break;
            case "halfOpen":
                this.arbitrageState = "open";
                break;
            case "open":
                //this.arbitrageState = "open";
                break;
        }
    }

    public serialize() {
        let state = super.serialize();
        state.exchanges = this.exchanges;
        state.arbitrageExchangePair = this.arbitrageExchangePair;
        state.arbitrageRate = this.arbitrageRate;
        state.arbitrageState = this.arbitrageState;
        state.exchangeCandles = [];
        for (let i = 0; i < this.exchangeCandles.length; i++)
            state.exchangeCandles.push(this.exchangeCandles[i].serialize());
        state.exchangeCandleMap = this.exchangeCandleMap.toToupleArray<ExchangeCandles>();
        return state;
    }

    public unserialize(state: GenericStrategyState) {
        super.unserialize(state);
        this.exchanges = state.exchanges;
        this.arbitrageExchangePair = state.arbitrageExchangePair;
        this.arbitrageRate = state.arbitrageRate;
        this.arbitrageState = state.arbitrageState;
        this.exchangeCandles = []; // start with empty array
        for (let i = 0; i < state.exchangeCandles.length; i++)
        {
            let candle = new ExchangeCandles();
            candle.unserialize(state.exchangeCandles[i]);
            this.exchangeCandles.push(candle);
        }
        this.exchangeCandleMap = new ExchangeCandleMap(state.exchangeCandleMap);
    }

    public getInfo(): StrategyInfo {
        let info = super.getInfo();
        info.arbitrageState = this.arbitrageState;
        if (Array.isArray(this.arbitrageRate) === true) {
            info.arbitrageRateBuy = this.arbitrageRate[0];
            info.arbitrageRateSell = this.arbitrageRate[1];
        }
        else {
            info.arbitrageRateBuy = 0.0;
            info.arbitrageRateSell = 0.0;
        }
        return info;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            resolve()
        })
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.groupExchangeCandles(candle);
            resolve()
        })
    }

    protected abstract exchangeCandleTick(candles: ExchangeCandles): Promise<void>;

    protected groupExchangeCandles(candle: Candle.Candle) {
        const day = candle.start.getUTCDate();
        const hour = candle.start.getUTCHours();
        const minute = candle.start.getUTCMinutes();
        const key = utils.sprintf("%s-%s-%s", day, hour, minute);
        let existingCandles = this.exchangeCandleMap.get(key);
        if (!existingCandles) {
            existingCandles = new ExchangeCandles();
            this.exchangeCandleMap.set(key, existingCandles);
        }
        existingCandles.addCandle(candle);
        if (existingCandles.candles.length === this.exchanges.length) {
            this.exchangeCandleTick(existingCandles).catch((err) => {
                logger.error("Error in %s exchange candle tick", this.className, err);
            })
        }

        const maxCandles: number = nconf.get("serverConfig:keepCandlesArbitrageGroup");
        if (this.exchangeCandleMap.size <= maxCandles)
            return;
        // map preserves the order, so we can delete first = old keys
        for (let cand of this.exchangeCandleMap)
        {
            this.exchangeCandleMap.delete(cand[0]);
            if (this.exchangeCandleMap.size <= maxCandles)
                break;
        }
    }

    protected performArbitrage(exchangeBuy: Currency.Exchange, exchangeSell: Currency.Exchange, rateBuy: number, rateSell: number) {
        this.arbitrageExchangePair = [exchangeBuy, exchangeSell]
        //this.rate = rate;
        this.arbitrageRate = [rateBuy, rateSell];
        this.emitBuy(this.defaultWeight, "arbitrage BUY opportunity", this.className, exchangeBuy);
        this.emitSell(this.defaultWeight, "arbitrage SELL opporunity", this.className, exchangeSell);
    }

    protected closeArbitragePositions() {
        if (Array.isArray(this.arbitrageExchangePair) === false) { // shouldn't happen
            this.emitClose(this.defaultWeight, "closing all arbitrage positions", this.className, Currency.Exchange.ALL);
            return;
        }
        this.emitClose(this.defaultWeight, "closing LONG arbitrage position", this.className, this.arbitrageExchangePair[0]);
        this.emitClose(this.defaultWeight, "closing SHORT arbitrage position", this.className, this.arbitrageExchangePair[1]);
    }

    protected getExchangeFee(exchange: Currency.Exchange, type: ExchangeFeeType): number {
        let i = this.exchanges.indexOf(exchange);
        if (i === -1)
            return this.action.tradingFeeDefault;
        const exchangeName = this.exchangeNames[i];
        //let fees = this.action.tradingFees.get(exchangeName)
        let fees = this.action.tradingFees[exchangeName];
        if (fees === undefined) {
            logger.warn("Trading fees for exchange %s not set in strategy config. Using default fee %s", exchangeName, this.action.tradingFeeDefault)
            return this.action.tradingFeeDefault;
        }
        return fees[type];
    }

    protected getExchangeCandles(exchange: Currency.Exchange): Candle.Candle[] {
        return this.candleHistory.filter(c => c.exchange === exchange);
    }

    protected resetValues(): void {
        super.resetValues();
    }
}

// force loading dynamic imports for TypeScript
import "./Spread";