import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Candle, Currency, Trade, Order, Funding} from "@ekliptor/bit-models";
import {
    AbstractGenericStrategy,
    GenericStrategyState,
    StrategyEvent,
    StrategyInfo
} from "../../Strategies/AbstractGenericStrategy";
import {LendingConfig} from "../LendingConfig";
import {LendingTradeInfo} from "../AbstractLendingTrader";
import * as crypto from "crypto";
import {CandleBatcher} from "../../Trade/Candles/CandleBatcher";
import {OrderBook} from "../../Trade/OrderBook";
import {TradeAction} from "../../Strategies/AbstractStrategy";


export type LendingTradeAction = "place" | "cancel" | /*"taken" |*/ "takenAll";
export type LendingStrategyOrder = "place";
//export type StrategyEmitOrder = "buy" | "sell" | "hold" | "close" | "buyClose" | "sellClose";
//export type StrategyPosition = "long" | "short" | "none";

export interface LendingStrategyAction {
    percentDecrease: number; // decrease the min interest rate every hour by this amount if not all funds have been taken
    currency: Currency.Currency;
    candleSize: number; // candle size in minutes (only applies if this strategy implements candleTick() function)
    enableLog: boolean; // use this to debug a certain strategy. call this.log()
}

/**
 * The base class for lending strategies.
 * Lending strategies don't emit buy/sell orders. Instead they emit a minimum interest rate
 * on every (candle) tick. Then our AbstractLendingTrader implementation can place loans >= rate.
 */
export abstract class AbstractLendingStrategy extends AbstractGenericStrategy {
    protected action: LendingStrategyAction;
    protected config: LendingConfig = null;
    protected minInterestRate: number = 0;
    protected lendingOrderbookReady = false;
    protected lendingOrderBook = new OrderBook<Funding.FundingOrder>();
    protected lastTakenAllFunds: Date = null;

    constructor(options) {
        super(options)
        if (!this.action.percentDecrease)
            this.action.percentDecrease = 0.0;
        if (typeof options.pair === "string")
            this.action.currency = LendingConfig.getCurrency(options.currency);
    }

    public setConfig(config: LendingConfig) {
        if (this.config !== null) {
            logger.error("Config can only be set once in %s", this.className);
            return;
        }
        this.config = config;
    }

    public sendTick(trades: Funding.FundingTrade[]) {
        this.tickQueue = this.tickQueue.then(() => {
            this.updateMarket(trades[trades.length - 1]);
            this.lastAvgMarketPrice = this.avgMarketPrice;
            let sum = 0, vol = 0;
            for (let i = 0; i < trades.length; i++)
            {
                sum += trades[i].rate * trades[i].amount;
                vol += trades[i].amount;
            }
            if (sum > 0 && vol > 0)
                this.avgMarketPrice = sum / vol; // volume weighted average price
            else {
                // happenes during backtesting with cached 0 volume candles
                logger.warn("Error calculating avg market price: sum %s, volume %s, trades", sum, vol, trades.length)
                if (trades.length === 1)
                    this.avgMarketPrice = trades[0].rate;
            }
            // TODO add "microCandle" as a candle with the last 10 trades (or better 1/3 the number of trades of last minute)

            this.emit("startTick", this); // sync call to events
            this.tradeTick += trades.length;
            return this.tick(trades)
        }).then(() => {
            this.emit("doneTick", this);
            this.emit("info", this.getInfo());
        }).catch((err) => {
            logger.error("Error in tick of %s", this.className, err)
        })
    }

    public sendCandleTick(candle: Candle.Candle) {
        this.tickQueue = this.tickQueue.then(() => {
            this.candle = candle;
            this.candleTrend = candle.trend;
            this.candleTicks++;
            this.addCandleInternal(candle);
            this.plotData.sync(candle, this.avgMarketPrice)
            this.updateIndicatorCandles();
            this.emit("startCandleTick", this); // sync call to events
            return this.candleTick(candle)
        }).then(() => {
            this.emit("doneCandleTick", this);
        }).catch((err) => {
            logger.error("Error in candle tick of %s", this.className, err)
        })
    }

    public send1minCandleTick(candle: Candle.Candle) {
        this.tickQueue = this.tickQueue.then(() => {
            candle = Object.assign(new Candle.Candle(candle.currencyPair), candle);
            if (candle.tradeData !== undefined)
                delete candle.tradeData;
            this.candles1min.unshift(candle);
            if (this.candles1min.length > nconf.get("serverConfig:keepCandles1min"))
                this.candles1min.pop();
        }).catch((err) => {
            logger.error("Error in 1min candle tick of %s", this.className, err)
        })
    }

    public setLendingOrderBook(book: OrderBook<Funding.FundingOrder>) {
        if (this.lendingOrderbookReady)
            return logger.warn("Multiple lending Exchanges/Orderbooks per strategy are currently not supported") // and probably never will? we run on single exchanges
        this.lendingOrderBook = book;
        this.lendingOrderbookReady = true;
    }

    public getLendingOrderBook() {
        return this.lendingOrderBook;
    }

    public isLendingOrderBookReady() {
        return this.lendingOrderbookReady;
    }

    public serialize() {
        let state = super.serialize();
        state.minInterestRate = this.minInterestRate;
        state.lastTakenAllFunds = this.lastTakenAllFunds;
        return state;
    }

    public unserialize(state: GenericStrategyState) {
        super.unserialize(state);
        this.minInterestRate = state.minInterestRate;
        this.lastTakenAllFunds = state.lastTakenAllFunds;
        setTimeout(() => {
            this.emitPlaceOffer("unserialized strategy data")
        }, 100)
    }

    public getAction() {
        return this.action; // has to be present for TS because action has another type in parent class
    }

    public getCurrencyStr() {
        return Currency.Currency[this.action.currency];
    }

    public onTrade(action: LendingTradeAction, order: Funding.FundingOrder, trades: Funding.FundingTrade[], info: LendingTradeInfo) {
        // overwrite this function in your strategy to get feedback of the trades done by our AbstractLendingTrader implementation
        if (action === "takenAll")
            this.lastTakenAllFunds = this.marketTime;
    }

    /**
     * Return all current information about this strategy (used for GUI)
     * @returns {{name: string, avgMarketPrice: string, pair: string, candleSize: string}}
     */
    public getInfo(): StrategyInfo {
        let info: any = {
            name: this.className,
            avgMarketPrice: this.avgMarketPrice.toFixed(8) + " " + this.getCurrencyStr(),
            pair: this.getCurrencyStr(),
            minLendingRate: this.getRate(),
            lastTakenAllFunds: this.lastTakenAllFunds
        }
        if (this.action.candleSize) {
            info.candleSize = this.action.candleSize;
            info.candleTrend = this.candleTrend;
            info.lastCandleTick = this.candle ? this.candle.start : null;
        }
        this.infoProperties.forEach((prop) => {
            info[prop.label] = this[prop.property]; // should we check the type?
        })
        this.infoFunctions.forEach((fn) => {
            info[fn.label] = fn.propertyFn();
        })
        // remove unwanted lending properties in here ("short"...). currently better done in strategy implementation
        return info;
    }

    public getRate(): number {
        if (this.lastTakenAllFunds && this.marketTime) {
            const msDiff = this.marketTime.getTime() - this.lastTakenAllFunds.getTime();
            const hoursDiff = Math.floor(msDiff / utils.constants.HOUR_IN_SECONDS / 1000);
            if (hoursDiff > 0) {
                const decreaseRateStep = this.minInterestRate / 100 * this.action.percentDecrease;
                return this.minInterestRate - decreaseRateStep*hoursDiff;
            }
        }
        return this.minInterestRate;
    }

    public getSaveState() {
        return this.saveState/* || this.mainStrategy*/; // always save main strategy data
    }

    public emit(event: LendingTradeAction | StrategyEvent, ...args: any[]) {
        return super.emit(event, ...args);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected emitPlaceOffer(reason = "") {
        this.emit("place", reason);
    }

    protected emitHoldCoins(reason = "") {
        this.log("Holding coins:", reason);
        // dummy function not actually emitting anything (until we allow multiple lending strategies) // TODO remove?
    }

    protected getCandleBatcher(candleSize: number) {
        const pair = new Currency.CurrencyPair(this.action.currency, this.action.currency);
        return new CandleBatcher<Funding.FundingTrade>(candleSize, pair);
    }

    protected resetValues(): void {
        super.resetValues();
    }

    protected updateMarket(lastTrade: Funding.FundingTrade) {
        //this.lastMarketPrice = this.marketPrice;
        //this.marketPrice = lastTrade.rate;
        this.marketTime = lastTrade.date;
        if (!this.strategyStart)
            this.strategyStart = this.marketTime;
        if (!this.lastTakenAllFunds) // this currency has just been added. start with max interest and decrease
            this.lastTakenAllFunds = this.marketTime;
    }

    /*
    protected getOrderBookWallPrice(wallAmount: number) {
        let ask = this.lendingOrderBook.getAsk();
        //return this.lendingOrderBook.getAskAmount()
        return this.lendingOrderBook.getOrderAmount(0.00082);
       // return this.lendingOrderBook.getRaiseAmount(nconf.get("serverConfig:orderBookRaisePercentWallDetect"));
    }
    */
}

// force loading dynamic imports for TypeScript
import "./DEMA";