import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as EventEmitter from 'events';
import {TradeConfig} from "../Trade/TradeConfig";
import {Candle, Currency, Trade, Order, Ticker, MarketOrder} from "@ekliptor/bit-models";
import {TrendDirection} from "../Indicators/AbstractIndicator";
import {CandleBatcher} from "../Trade/Candles/CandleBatcher";
import {DataPlotCollector, PlotMarkValues, PlotMark} from "../Indicators/DataPlotCollector";
import * as _ from "lodash";
import {OrderBook} from "../Trade/OrderBook";
import {TradeInfo} from "../Trade/AbstractTrader";
import {StrategyGroup} from "../Trade/StrategyGroup";
import {MarginPosition} from "../structs/MarginPosition";
import {AbstractGenericStrategy, GenericStrategyState, StrategyInfo} from "./AbstractGenericStrategy";
import * as helper from "../utils/helper";
import {TradePosition} from "../structs/TradePosition";

export type TradeAction = "buy" | "sell" | "close";
export type StrategyOrder = "buy" | "sell" | "closeLong" | "closeShort";
export type StrategyEmitOrder = "buy" | "sell" | "hold" | "close" | "buyClose" | "sellClose";
export type StrategyPosition = "long" | "short" | "none";

export class ScheduledTrade {
    action: TradeAction;
    weight: number;
    reason: string;
    fromClass: string; // the emitting strategy
    exchange: Currency.Exchange; // the exchange to trade on

    // cached values from the emitting strategy
    getOrderAmount: (tradeTotalBtc: number, leverage: number) => number;
    getRate: () => number;
    forceMakeOnly: () => boolean;
    isIgnoreTradeStrategy: () => boolean;
    isMainStrategy: () => boolean;
    canOpenOppositePositions: () => boolean;

    constructor(action: TradeAction, weight: number, reason: string = "", fromClass = "", exchange: Currency.Exchange = Currency.Exchange.ALL) {
        this.action = action;
        this.weight = weight;
        this.reason = reason;
        this.fromClass = fromClass;
        this.exchange = exchange;
    }

    public bindEmittingStrategyFunctions(strategy: AbstractStrategy) {
        this.getOrderAmount = strategy.getOrderAmount.bind(strategy);
        this.getRate = strategy.getRate.bind(strategy);
        this.forceMakeOnly = strategy.forceMakeOnly.bind(strategy);
        this.isIgnoreTradeStrategy = strategy.isIgnoreTradeStrategy.bind(strategy);
        this.isMainStrategy = strategy.isMainStrategy.bind(strategy);
        this.canOpenOppositePositions = strategy.canOpenOppositePositions.bind(strategy);
    }

    public toString() {
        let from = "";
        if (this.fromClass)
            from = " (from " + this.fromClass + ")";
        return utils.sprintf("%s: %s%s", this.action.toUpperCase(), this.reason, from);
    }
}

export interface StrategyAction {
    // undefined for dynamic strategies. might be changed after trade by AbstractStopStrategy
    order: StrategyOrder;
    // removed, use global value
    //amount: number; // the amount (in specific coin) to trade // get all tradable from exchange and implement option for "all"
    pair: Currency.CurrencyPair;
    candleSize: number; // candle size in minutes (only applies if this strategy implements candleTick() function)
    tradeStrategy: string; // optional, default none. the strategy to execute buy/sell orders. useful to only buy/sell based on 2nd strategy data (RSI...)
    orderStrategy: string; // optional, default none. more advanced than tradeStrategy because TriggerOrderCommand objects must be passed along (doesn't react to buy/sell signals)
    fallback: boolean; // optional, default false. only buy/sell if position is open. close is completely disabled
    enableLog: boolean; // use this to debug a certain strategy. call this.log()
}

/**
 * The parent class of the trading strategies we implement.
 * Strategies just emit buy/sell/hold/close signals (and startTick/doneTick and startCandleTick/doneCandleTick after each run).
 * They have minimal logic and little internal state.
 * They are ENCOURAGED to emit multiple buy/sell signals in an arbitrary order.
 * AbstractTrader keeps the actual state including our assets and decides whether to act on signals from this class.
 */
export abstract class AbstractStrategy extends AbstractGenericStrategy {
    // TODO count winTrades and lossTrades for some strategies (such as BladeRunner) -> new subclass?
    // TODO include exchange name in notifications. just like in TradeNotifier. strategy doesn't know exchange + config
    protected action: StrategyAction;
    protected defaultWeight: number = 100;
    protected strategyPosition: StrategyPosition = "none";
    protected holdingCoins = 0.0;
    protected entryPrice: number = -1; // the price we bought/sold - currently only set in child classes
    protected lastSync: Date = null;
    protected _done = false; // for orders that only trigger once
    protected runOnce = false; // don't reset "done" state
    protected lastRun = new Date(0); // run again with runOnce == true after a certain amount of time
    protected lastTrade: TradeAction = null; // used in subclasses
    protected lastTradeTimeClass: Date = null;
    protected lastTradeTimePair: Date = null;
    protected positionOpenTicks = -1;
    private lastTradeAction: TradeAction = null; // used & cached in this class
    protected tradeOnce = false; // set to true so that this strategy can not emit multiple buy/sell events
    protected disabled = false;
    private wasMainStrategy = false; // cache it for re-enabling ot

    // start with dummy objects to avoid null pointer exceptions during startup
    // will get replaced below
    protected orderBook: OrderBook<MarketOrder.MarketOrder> = new OrderBook<MarketOrder.MarketOrder>();
    protected ticker: Ticker.Ticker = new Ticker.Ticker(Currency.Exchange.ALL);
    protected orderbookReady = false;
    protected tickerReady = false;

    protected rate = -1; // return a rate > 0 if this strategy forces AbstractTrader to buy/sell at a specific price
    protected closedPositions = false; // our strategy is already running for a while and closed (not just started). needed for sync
    protected orderAmountPercent = 0.0;
    protected mainStrategy = false;
    protected openOppositePositions = false;
    protected tradePosition: TradePosition = null; // for non-margin trading
    protected position: MarginPosition = null;

    protected strategyGroup: StrategyGroup = null;
    protected pendingOrder: ScheduledTrade = null; // used if strategy A sends an order to strategy B
    protected lastTradeFromClass: string = ""; // the class emitting the last trade (can be another strategy, see AbstractOrderer)
    protected lastTradeState: GenericStrategyState = null; // the state when the last trade signal was emitted

    constructor(options) {
        super(options)
        if (typeof options.pair === "string")
            this.action.pair = TradeConfig.getCurrencyPair(options.pair);
        if (!options.tradeStrategy)
            options.tradeStrategy = "";
    }

    public sendTick(trades: Trade.Trade[]) {
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
             if (this.strategyPosition !== "none")
                this.positionOpenTicks++;
             this.addCandleInternal(candle);
             this.plotData.sync(candle)
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
            const maxCandles: number = nconf.get("serverConfig:keepCandles1min");
            while (this.candles1min.length > maxCandles)
                this.candles1min.pop();
        }).catch((err) => {
            logger.error("Error in 1min candle tick of %s", this.className, err)
        })
    }

    public getAction() {
        return this.action; // has to be present for TS because action has another type in parent class
    }

    public getCurrencyStr() {
        return this.action.pair.toString();
    }

    public getStrategyPosition() {
        return this.strategyPosition;
    }

    /**
     * Returns the long/short amount of our margin or trading position.
     * @returns {number}
     */
    public getPositionAmount(): number {
        if (this.position && this.position.isEmpty() === false)
            return this.position.amount;
        return this.holdingCoins;
    }

    public getProfitLoss(): number {
        if (this.position && this.position.isEmpty() === false)
            return this.position.pl;
        if (this.tradePosition && this.tradePosition.isEmpty() === false)
            return this.tradePosition.getProfitLoss(this.avgMarketPrice);
        if (this.strategyPosition !== "none" && this.lastSync && this.lastTradeTimePair && this.lastSync.getTime() > this.lastTradeTimePair.getTime())
            logger.error("No trading and margin position found to compute profit/loss for %s", this.action.pair.toString());
        return 0.0;
    }

    public getProfitLossPercent(): number {
        if (this.position && this.position.isEmpty() === false)
            return this.position.getProfitLossPercent(this.avgMarketPrice);
        if (this.tradePosition && this.tradePosition.isEmpty() === false)
            return this.tradePosition.getProfitLossPercent(this.avgMarketPrice);
        if (this.strategyPosition !== "none" && this.lastSync && this.lastTradeTimePair && this.lastSync.getTime() > this.lastTradeTimePair.getTime())
            logger.error("No trading and margin position found to compute profit/loss percent for %s", this.action.pair.toString());
        return 0.0;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        // overwrite this function in your strategy to get feedback of the trades done by our AbstractTrader implementation
        if (info.strategy.isIgnoreTradeStrategy() === true)
            return;
        const isSameClass = info.strategy.getClassName() === this.className || info.strategy.getInitiatorClassName() === this.className;
        if (isSameClass) {
            this.lastTrade = action; // do this here and not when emitting the signal because our signal might be ignored
            this.lastTradeTimeClass = this.marketTime;
        }
        this.log(action, "received - resetting strategy values");
        this.resetValues();
        this.lastTradeTimePair = this.marketTime;

        if (isSameClass)
            this.done = true; // just to be sure
        else if (action === "close") {
            this.done = false;
            this.positionOpenTicks = -1;
        }
        //if (this.isMainStrategy()) { // simple handling of strategy position (in case subclass doesn't take care of it)
        if (action === "close") {
            this.holdingCoins = 0.0;
            this.strategyPosition = "none";
            this.entryPrice = -1;
            this.tradePosition = null;
            //this.closedPositions = true; // only close again in the strategy that emitted the close
        }
        else {
            if (this.entryPrice === -1)
                this.entryPrice = order.rate;
            if (this.tradePosition === null)
                this.tradePosition = new TradePosition();
            if (action === "buy") {
                this.holdingCoins += order.amount;
                this.tradePosition.addTrade(order.amount, order.rate); // ensure we pass a negative amount
            }
            else {
                this.holdingCoins -= Math.abs(order.amount);
                this.tradePosition.addTrade(-1*Math.abs(order.amount), order.rate); // ensure we pass a negative amount
            }
            this.strategyPosition = this.holdingCoins > 0 ? "long" : "short";
            this.closedPositions = false;
        }

        if (action === "close")
            return;
    }

    public onSyncPortfolio(coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange) {
        // coins can be 0 and position be an empty position (0 amount) if there is no open position
        // overwrite this function to sync coin balances/strategy position etc... and ensure positions are closed with more advanced logic
        // TODO how to sync non-margin positions? we don't know if the user had these coins before (and wants to keep them)
        this.position = position;
        this.holdingCoins = Math.abs(position.amount); // should already always be positive
        if (position.isEmpty())
            this.holdingCoins = coins; // will be >= 0 -> position long or none
        if (position.type === "short")
            this.holdingCoins *= -1;
        this.positionSyncPrice = this.avgMarketPrice;
        const lastStrategyPosition = this.strategyPosition;
        this.strategyPosition = this.holdingCoins > 0 ? "long" : (this.holdingCoins < 0 ? "short" : "none");
        if (this.strategyPosition === "none") {
            this.entryPrice = -1;
            this.lastTrade = "close";
            this.positionOpenTicks = -1;
        }
        else if (this.entryPrice === -1)
            this.entryPrice = this.avgMarketPrice; // assume we just opened our position
        else if (this.strategyPosition !== lastStrategyPosition) {
            this.log(utils.sprintf("Strategy position changed from %s to %s. Resetting entry price", lastStrategyPosition, this.strategyPosition));
            this.entryPrice = this.avgMarketPrice;
        }
        // TODO volume-weighted entryPrice. useful for TakeProfit if we increase our position size after opening

        this.lastSync = this.getMarketTime();
        if (this.closedPositions && this.strategyPosition !== "none") {
            // most likely a close http request to the exchange failed
            // this repetition will happen in the strategy that issued the close command (StopLossTurn, TakeProfit,...)
            this.emitClose(Number.MAX_VALUE, "strategy position out of sync");
        }
        else if (this.strategyPosition === "none") {
            this.closedPositions = false; // reset it so that we don't close a new position again
            if (this.isMainStrategy()) // only true for main strategy? StopLoss has it's own sync() implementation either way
                this.done = false;
        }
        // TODO reset values if last position != position? useful to update stops (or do it in subclass?) see onConfigChanged() + set position back
        this.adjustStaticOrder();
    }

    public getRate(): number {
        // return a rate > 0 if this strategy forces AbstractTrader to buy/sell at a specific price (limit order)
        // otherwise the trader will place a limit order at the last trade price
        // special values:
        // -1: limit order at the last price
        // -2: market order (if supported by exchange), otherwise identical to -1
        return this.rate;
    }

    public forceMakeOnly(): boolean {
        // use this together with getRate() to force only placing orders (not paying taker fee)
        // if this function returns true AbstractTrader will constantly cancel/adjust the order by calling getRate()
        // until it is taken
        // getRate() MUST return a rate below/above the market price for buy/sell orders or -1 to let the trader choose the rate based
        // on the order book
        return false;
    }

    /**
     * Overwrite this to trade with a different amount than tradeTotalBtc from config.
     * Useful for iceberg orders or other ways to split orders into smaller pieces.
     * @param {tradeTotalBtc} The full amount the trader wants to trade in base currency (BTC, USD,...)
     * @param {leverage} The leverage factor (1 for "no leverage", > 1 = margin trading)
     * @returns {number} the amount of coins to trade. can be more than the initial amount (more than 100%) if we
     * want to change our strategy direction (long to short)
     */
    public getOrderAmount(tradeTotalBtc: number, leverage: number = 1): number {
        let amount = tradeTotalBtc * leverage;
         if (!this.orderAmountPercent || this.orderAmountPercent === 100)
             return amount;
         return amount / 100 * this.orderAmountPercent;
    }

    /**
     * Return true so that OTHER strategies ignore trade events (buy, sell, close) from this strategy.
     * This means strategy values won't be reset. Useful if this strategy just follows the direction of the main strategy.
     * @returns {boolean}
     */
    public isIgnoreTradeStrategy() {
        return false;
    }

    /**
     * Set this strategy to be the main strategy. Usually the first strategy in the config is the main one.
     * A main strategy is able to determine the current trend we trade on (so it is able to send conflicting buy/sell signals)
     * @param mainStrategy
     */
    public setMainStrategy(mainStrategy: boolean) {
        this.mainStrategy = mainStrategy;
    }

    public isMainStrategy() {
        return this.mainStrategy;
    }

    public canOpenOppositePositions() {
        return this.mainStrategy || this.openOppositePositions;
    }

    public getSaveState() {
        return this.saveState || this.mainStrategy; // always save main strategy data
    }

    /**
     * Overwrite this in the subclass to disable the strategy temporarily (for example on low volatility).
     * @returns {boolean} true if active
     */
    public isActiveStrategy(): boolean {
        return true;
    }

    public isDisabled() {
        return this.disabled;
    }

    public setDisabled(disabled: boolean) {
        this.disabled = disabled;
        if (disabled) {
            this.wasMainStrategy = this.isMainStrategy();
            this.mainStrategy = false; // some strategies are set to be main. but not when we use them as indicators for another one
        }
        else
            this.mainStrategy = this.isMainStrategy() || this.wasMainStrategy; // reset it to main
    }

    public getLastTradeAction() {
        return this.lastTradeAction;
    }

    public getPlotData() {
        return this.plotData;
    }

    public setStrategyGroup(group: StrategyGroup) {
        this.strategyGroup = group;
    }

    public getStrategyGroup() {
        return this.strategyGroup;
    }

    public addOrder(scheduledTrade: ScheduledTrade) {
        // implement this using "pendingOrder" in strategies which can accept orders from other strategies. see RSIOrderer for an example
        if (!this.isMainStrategy())
            logger.error("addOrder() can only be called for main strategies. Called for %s", this.className)
        logger.error("addOrder() is not implemented in %s", this.className)
    }

    public getLastTradeFromClass() {
        return this.lastTradeFromClass;
    }

    public getLastTradeState() {
        return this.lastTradeState;
    }

    /**
     * Check if the strategy is allowed to trade. Useful if we have 2 strategies: 1 with a long candleSize and another with
     * a very short one to enter the market on spikes.
     */
    public canTrade() {
        return this.isMainStrategy() || this.strategyPosition === "none";
    }

    public setOrderBook(book: OrderBook<MarketOrder.MarketOrder>) {
        if (this.orderbookReady)
            return logger.warn("Multiple Exchanges/Orderbooks per strategy are currently not supported") // and probably never will? we run on single exchanges
        this.orderBook = book;
        this.orderbookReady = true;
    }

    public isOrderBookReady() {
        return this.orderbookReady;
    }

    public setTicker(ticker: Ticker.Ticker) {
        if (this.tickerReady)
            return logger.warn("Multiple Exchanges/Tickers per strategy are currently not supported") // and probably never will? we run on single exchanges
        this.ticker = ticker;
        this.tickerReady = true;
    }

    public getTicker() {
        return this.ticker;
    }

    public isTickerReady() {
        return this.tickerReady;
    }

    /**
     * Returns the order book.
     * NOT available during backtesting (because exchanges don't have an API for order book history data).
     * @returns {OrderBook}
     */
    public getOrderBook() {
        return this.orderBook;
    }

    public closePosition() {
        if (!this.isMainStrategy())
            logger.warn("closePosition() should only be called in main strategy. called in %s. Use emitClose() instead", this.className);
        this.emitClose(Number.MAX_VALUE, "manually closing position", this.className)
    }

    public getPublicConfig() {
        return null; // TODO add required plugins (telegram,...)
    }

    /**
     * Returns the first active main strategy. Also see StrategyGroup.getActiveMainStrategies()
     * @param {AbstractStrategy[]} strategies
     * @param {boolean} allowDisabled
     * @returns {AbstractStrategy}
     */
    public static getMainStrategy(strategies: AbstractStrategy[], allowDisabled = false): AbstractStrategy {
        if (Array.isArray(strategies) === false || strategies.length === 0)
            return null;
        let disabled = null;
        for (let i = 0; i < strategies.length; i++)
        {
            if (strategies[i].isMainStrategy() === true) {
                if (strategies[i].isActiveStrategy() === true)
                    return strategies[i];
                else if (allowDisabled === true && disabled === null)
                    disabled = strategies[i];
            }
        }
        if (disabled !== null)
            return disabled;
        logger.error("No active main strategy available for pair %s in %s strategies", strategies[0].getAction().pair.toString(), strategies.length)
        return null;
    }

    /**
     * Return all current information about this strategy (used for GUI)
     * @returns {{name: string, avgMarketPrice: string, pair: string, candleSize: string}}
     */
    public getInfo(): StrategyInfo {
        const baseCurrency = Currency.Currency[this.action.pair.from];
        let info: any = {
            name: this.className,
            avgMarketPrice: this.avgMarketPrice.toFixed(8) + " " + baseCurrency,
            pair: this.getCurrencyStr()
        }
        if (this.action.order)
            info.order = this.action.order;
        if (this.action.candleSize) {
            info.candleSize = this.action.candleSize;
            info.candleTrend = this.candleTrend;
            info.lastCandleTick = this.candle ? this.candle.start : null;
        }
        if (this.pendingOrder)
            info.pendingOrder = this.pendingOrder.toString();
        if (this.mainStrategy) {
            info.strategyPosition = this.strategyPosition;
            info.active = this.isActiveStrategy();
            info.lastSync = this.lastSync;
            if (this.orderBook) {
                info.orderBookAskBase = this.orderBook.getAskAmountBase();
                info.orderBookAskCoin = this.orderBook.getAskAmount();
                info.orderBookBidBase = this.orderBook.getBidAmountBase();
                info.orderBookBidCoin = this.orderBook.getBidAmount();
                info.ask = this.orderBook.getAsk();
                info.bid = this.orderBook.getBid();
            }
            // moved up to show in all strategies
            //info.candleTred = this.candle ? this.candle.trend : null;
            //info.lastCandleTick = this.candle ? this.candle.start : null;
        }
        this.infoProperties.forEach((prop) => {
            info[prop.label] = this[prop.property]; // should we check the type?
        })
        this.infoFunctions.forEach((fn) => {
            info[fn.label] = fn.propertyFn();
        })
        return info;
    }

    public serialize() {
        let state = super.serialize();
        state.entryPrice = this.entryPrice;
        state.strategyOrder = this.action.order;
        state.strategyPosition = this.strategyPosition;
        state.done = this.done;
        state.lastRun = this.lastRun;
        state.lastTrade = this.lastTrade;
        state.lastTradeTimeClass = this.lastTradeTimeClass;
        state.lastTradeTimePair = this.lastTradeTimePair;
        state.positionOpenTicks = this.positionOpenTicks;
        state.holdingCoins = this.holdingCoins;
        state.position = this.position;
        state.pendingOrder = this.pendingOrder;
        return state;
    }

    public unserialize(state: GenericStrategyState) {
        super.unserialize(state);
        this.entryPrice = state.entryPrice;
        this.action.order = state.strategyOrder;
        this.strategyPosition = state.strategyPosition;
        this.positionOpenTicks = state.positionOpenTicks;
        this.done = state.done;
        this.lastRun = state.lastRun;
        this.lastTrade = state.lastTrade;
        this.lastTradeTimeClass = state.lastTradeTimeClass;
        this.lastTradeTimePair = state.lastTradeTimePair;
        if (typeof state.holdingCoins === "number")
            this.holdingCoins = state.holdingCoins;
        if (typeof state.position === "object" && state.position) // null is also an object
            this.position = Object.assign(new MarginPosition(state.position.leverage), state.position);
        if (state.pendingOrder) {
            let prev = state.pendingOrder;
            this.pendingOrder = new ScheduledTrade(prev.action, prev.weight, prev.reason, prev.fromClass, prev.exchange);
            // TODO unserialize functions too: https://github.com/yahoo/serialize-javascript
            // but doesn't work that easy because of bound context... maybe better store class properties instead of functions
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected emitBuy(weight: number, reason = "", fromClass = "", exchange: Currency.Exchange = Currency.Exchange.ALL): void {
        // TODO add 3rd parameter for fast trading strategies, orderAdjustBeforeTimeoutFactor
        this.lastTradeAction = "buy"; // always set it. even if we don't actually trade
        if (this.isDisabled())
            return this.log("Skipping BUY signal because strategy is disabled");
        if (this.action.fallback === true && this.strategyPosition !== "none")
            return this.log("Skipping BUY signal because strategy is fallback only");
        if (this.tradeOnce === true && this.lastTrade === "buy")
            return this.log("Skipping BUY signal because strategy is set to only trade once");
        if (this.isMainStrategy()) {
            this.closedPositions = false; // otherwise it gets reset in onTrade()
            if (this.passToTradeStrategy(new ScheduledTrade("buy", weight, reason, this.className)))
                return;
        }
        this.lastTradeFromClass = fromClass;
        this.lastTradeState = this.createTradeState();
        this.emit("buy", weight, reason, exchange);
    }

    protected emitSell(weight: number, reason = "", fromClass = "", exchange: Currency.Exchange = Currency.Exchange.ALL): void {
        this.lastTradeAction = "sell";
        if (this.isDisabled())
            return this.log("Skipping SELL signal because strategy is disabled");
        if (this.action.fallback === true && this.strategyPosition !== "none")
            return this.log("Skipping SELL signal because strategy is fallback only");
        if (this.tradeOnce === true && this.lastTrade === "sell")
            return this.log("Skipping SELL signal because strategy is set to only trade once");
        if (this.isMainStrategy()) {
            this.closedPositions = false; // otherwise it gets reset in onTrade()
            if (this.passToTradeStrategy(new ScheduledTrade("sell", weight, reason, this.className)))
                return;
        }
        this.lastTradeFromClass = fromClass;
        this.lastTradeState = this.createTradeState();
        this.emit("sell", weight, reason, exchange);
    }

    protected emitHold(weight: number, reason = "", fromClass = "", exchange: Currency.Exchange = Currency.Exchange.ALL): void { // TODO currently not used, remove?
        logger.warn("emitHold() might be removed in the future");
        this.lastTradeFromClass = fromClass;
        this.lastTradeState = this.createTradeState();
        this.emit("hold", weight, reason, exchange);
    }

    protected emitClose(weight: number, reason = "", fromClass = "", exchange: Currency.Exchange = Currency.Exchange.ALL): void {
        this.lastTradeAction = "close";
        if (this.isDisabled()) {
            this.log("Skipping CLOSE signal because strategy is disabled");
            return;
        }
        if (this.action.fallback === true)
            return this.log("Skipping CLOSE signal because strategy is fallback only");
        this.closedPositions = true;
        // TODO option for 2nd strategy on close too? see passToTradeStrategy()
        this.lastTradeFromClass = fromClass;
        this.lastTradeState = this.createTradeState();
        this.emit("close", weight, reason, exchange);
    }

    protected emitBuyClose(weight: number, reason = "") {
        if (!this.action.order) {
            logger.error("Order action must be defined to call emitBuyClose in %s", this.className);
            return;
        }
        if (this.action.order.indexOf("close") === -1)
            this.emitBuy(weight, reason);
        else
            this.emitClose(weight, reason);
    }

    protected emitSellClose(weight: number, reason = "") {
        if (!this.action.order) {
            logger.error("Order action must be defined to call emitSellClose in %s", this.className);
            return;
        }
        //if (this.action.order === "sell") // BladeRunner has opposite meanings than StopLoss
        if (this.action.order.indexOf("close") === -1)
            this.emitSell(weight, reason);
        else
            this.emitClose(weight, reason);
    }

    protected executeTrade(scheduledTrade: ScheduledTrade) {
        switch (scheduledTrade.action)
        {
            case "buy":
                this.emitBuy(scheduledTrade.weight, scheduledTrade.reason, scheduledTrade.fromClass, scheduledTrade.exchange);
                return;
            case "sell":
                this.emitSell(scheduledTrade.weight, scheduledTrade.reason, scheduledTrade.fromClass, scheduledTrade.exchange);
                return;
            case "close":
                this.emitClose(scheduledTrade.weight, scheduledTrade.reason, scheduledTrade.fromClass, scheduledTrade.exchange);
                return;
        }
        //return utils.test.assertUnreachableCode(scheduledTrade.action)
        logger.error("Can not execute scheduled %s trade", scheduledTrade.action)
    }

    protected passToTradeStrategy(scheduledTrade: ScheduledTrade, tradeStrategy: string = "") {
        if (!tradeStrategy)
            tradeStrategy = this.action.tradeStrategy;
        if (tradeStrategy) {
            let strategy = this.strategyGroup.getStrategyByName(tradeStrategy);
            if (strategy) {
                scheduledTrade.bindEmittingStrategyFunctions(this);
                strategy.addOrder(scheduledTrade);
                return true;
            }
        }
        return false;
    }

    protected updateMarket(lastTrade: Trade.Trade) {
        this.lastMarketPrice = this.marketPrice;
        this.marketPrice = lastTrade.rate;
        this.marketTime = lastTrade.date;
        if (!this.strategyStart)
            this.strategyStart = this.marketTime;
        if (this.runOnce && this.done && this.lastRun.getTime() + nconf.get("serverConfig:strategyRunOnceIntervalH")*utils.constants.HOUR_IN_SECONDS*1000 < this.marketTime.getTime())
            this.done = false;
    }

    protected get done() {
        return this._done;
    }

    protected set done(isDone: boolean) {
        this._done = isDone;
        if (this._done && this.runOnce) {
            if (this.marketTime)
                this.lastRun = this.marketTime;
            else
                logger.error("Can not set last run of %s because market time is not set", this.className)
        }
    }

    protected computeTrend(trades: Trade.Trade[]): TrendDirection {
        if (trades.length < 2)
            return "none";
        const first = _.first(trades);
        const last = _.last(trades);
        const percentChange = ((last.rate - first.rate) / first.rate) * 100; // ((y2 - y1) / y1)*100 - positive % if price is rising
        if (Math.abs(percentChange) <= nconf.get('serverConfig:candleEqualPercent'))
            return "none";

        // look at the 2nd first/last to be more sure and eliminate spikes
        if (trades.length >= 4) {
            const first2 = trades[1];
            const last2 = trades[trades.length-2];
            const percentChange2 = ((last2.rate - first2.rate) / first2.rate) * 100;
            if (Math.abs(percentChange2) <= nconf.get('serverConfig:candleEqualPercent'))
                return "none";
        }
        return percentChange > 0 ? "up" : "down";
    }

    protected candleTrendMatches(trend: TrendDirection, candles: Candle.Candle[]) {
        for (let i = 0; i < candles.length; i++)
        {
            let candle = candles[i];
            if (!candle || candle.trend !== trend)
                return false;
        }
        return true;
    }

    protected historyTrendMatches(trend: TrendDirection, candleCount: number) {
        if (this.candleHistory.length < candleCount)
            return false;
        for (let i = 0; i < candleCount; i++)
        {
            let candle = this.getCandleAt(i);
            if (!candle || candle.trend !== trend)
                return false;
        }
        return true;
    }

    protected candleTrendMatchesPosition(candle: Candle.Candle = null) {
        if (!candle)
            candle = this.candle;
        if (!candle)
            return false; // before first tick
        if (this.strategyPosition === "long")
            return candle.trend === "up";
        if (this.strategyPosition === "short")
            return candle.trend === "down";
        return false;
    }

    protected trendMatchesTrade(candle: Candle.Candle) {
        if (!this.pendingOrder)
            return false;
        if (this.pendingOrder.action === "buy" && candle.trend === "up")
            return true;
        if (this.pendingOrder.action === "sell" && candle.trend === "down")
            return true;
        return false;
    }

    protected getCandleAvg(candles: Candle.Candle[]) {
        let sum = 0, vol = 0, simplePrice = 0;
        for (let i = 0; i < candles.length; i++)
        {
            sum += candles[i].close * candles[i].volume;
            vol += candles[i].volume;
            simplePrice += candles[i].close;
        }
        return {
            volume: vol / candles.length,
            price: sum / vol, // volume weighted average price
            simplePrice: simplePrice / candles.length
        }
    }

    protected getMaxCandle(candles: Candle.Candle[] = null): Candle.Candle {
        if (!candles)
            candles = this.candleHistory;
        let maxVal = 0;
        let maxI = -1;
        for (let i = 0; i < candles.length; i++)
        {
            if (candles[i].high > maxVal) {
                maxVal = candles[i].high;
                maxI = i;
            }
        }
        if (maxI === -1)
            return null;
        return candles[maxI];
    }

    protected getMinCandle(candles: Candle.Candle[] = null): Candle.Candle {
        if (!candles)
            candles = this.candleHistory;
        let minVal = Number.MAX_VALUE;
        let minI = -1;
        for (let i = 0; i < candles.length; i++)
        {
            if (candles[i].low < minVal) {
                minVal = candles[i].low;
                minI = i;
            }
        }
        if (minI === -1)
            return null;
        return candles[minI];
    }

    protected getDailyChange(): number {
        if (nconf.get("trader") === "Backtester") { // no ticker available
            if (this.candles1min.length < 1440)
                return 0.0;
            let dailyCandle = this.getCandles(1440, 1) // last 24h candle
            return Math.round(dailyCandle[0].getPercentChange() * 100) / 100.0;
        }
        if (!this.ticker) {
            logger.error("No ticker available to get daily %s change", this.action.pair.toString())
            return 0.0;
        }
        return Math.round(this.ticker.percentChange * 100) / 100.0; // 2 decimals is enough for display
    }

    protected hasProfit(entryPrice: number, minPercent = 0.1) {
        if (entryPrice < 0) // -1 at init, shouldn't happen
            return false;
        // we might have manually bought more coins at a different price. check the position from exchange if available
        if (this.position && nconf.get("trader") !== "Backtester") {
            if (this.position.pl < 0.0)
                return false;
            if (minPercent == 0)
                return true;
            const positionSizeBase = Math.abs(this.position.amount) * this.ticker.last;
            if (positionSizeBase > 0.0) { // otherwise no ticker data or sth else went wrong
                const profitPercent = this.position.pl / positionSizeBase * 100.0;
                return profitPercent >= minPercent;
            }
        }
        if (this.strategyPosition === "long") {
            if (this.avgMarketPrice > entryPrice)
                return minPercent == 0.0 ? true : helper.getDiffPercent(this.avgMarketPrice, entryPrice) >= minPercent;
            return false;
        }
        else if (this.strategyPosition === "short") {
            if (this.avgMarketPrice < entryPrice)
                return minPercent == 0.0 ? true : helper.getDiffPercent(this.avgMarketPrice, entryPrice) <= minPercent*-1;
            return false;
        }
        return false;
    }

    protected hasProfitReal(minPercent = 0.1) {
        if (nconf.get("trader") === "Backtester") // TODO update margin positions in backtesting, also above
            return this.hasProfit(this.entryPrice, minPercent);

        if (!this.position) {
            logger.warn("Unable to check for real profit. This is only available during margin trading (and possibly not on all exchanges).")
            return false;
        }
        if (this.position.pl < 0.0)
            return false;
        if (minPercent == 0)
            return true;
        const positionSizeBase = Math.abs(this.position.amount) * this.ticker.last;
        if (positionSizeBase > 0.0) { // otherwise no ticker data or sth else went wrong
            const profitPercent = this.position.pl / positionSizeBase * 100.0;
            return profitPercent >= minPercent;
        }
        return false;
    }

    protected toTradeAction(action: StrategyOrder): TradeAction {
        return action === "closeLong" || action === "closeShort" ? "close" : action;
    }

    protected openFirstPosition() {
        if (this.strategyPosition !== "none" && this.strategyGroup.getActiveMainStrategies().length > 1) { // important if we have multiple main strategies
            this.log(utils.sprintf("Open %s position already exists (%s coins). Skipping market entry", this.strategyPosition, this.holdingCoins.toFixed(8)))
            return false;
        }
        return true;
    }

    protected getCandleBatcher(candleSize: number) {
       return new CandleBatcher<Trade.Trade>(candleSize, this.action.pair);
    }

    protected resetValues(): void {
        // TODO issue warning if this gets called more often than 2*candleSize? possible bug
        // overwrite this function in the child and make sure to call super.resetValues();

        //this.defaultWeight = 100; // not reset it. though strategy shouldn't change it
        if (!this.runOnce)
            this.done = false;
        //this.lastTrade = null; // value should be kept and not reset here
        this.rate = -1; // the rate this strategy wants to sell can be reset
        //this.strategyPosition = "none"; // gets reset in onSync(). causes endless loop for stop strategies if we reset it here

        //this.marketTime = null; // don't reset time. causes problems when backtesting (functions called too fast)
        //this.strategyStart = null;

        super.resetValues();
    }

    protected adjustStaticOrder() {
        // ensure our stop order is correct
        if (this.action.order) {
            if (this.strategyPosition === "long") {
                if (this.action.order.indexOf("close") === -1)
                    this.action.order = "sell";
                else
                    this.action.order = "closeLong";
            }
            else if (this.strategyPosition === "short") {
                if (this.action.order.indexOf("close") === -1)
                    this.action.order = "buy";
                else
                    this.action.order = "closeShort";
            }
        }
    }
}

// force loading dynamic imports for TypeScript
/*
import "./AbstractCrawlerStrategy"; // not needed if we have an implementation of it
import "./AroonTristar";
import "./BladeRunner";
import "./BollingerBands";
import "./BollingerBreakouts";
import "./BreakoutDetector";
import "./ChannelBreakout";
import "./DayTrader";
import "./DEMA";
import "./DEMALeverage";
import "./DirectionFollower";
import "./EarlyStopLoss";
import "./Extrapolation";
import "./FishingNet";
import "./HoneyBadger";
import "./InterestIndicator";
import "./MACD";
import "./MACDLeverage";
import "./MakerFeeOrder";
import "./MarginCallBuyer";
import "./MassOrderJumper";
import "./MFI";
import "./MomentumTurn";
import "./OneTimeOrder";
import "./OrderBookPressure";
import "./OrderBookPressureLeverage";
import "./PatternDetector";
import "./PatternRepeater";
import "./PercentDEMA";
import "./PriceRangeTrader";
import "./PriceSpikeDetector";
import "./PriceSpikeDetectorLeverage";
import "./ResistanceBuyer";
import "./RSI";
import "./RSIOrderer";
import "./RSIStarter";
import "./RSIStarterLeverage";
import "./SARStop";
import "./Scalper";
import "./SimpleAndShort";
import "./SpikeDetector";
import "./StopLossTime";
import "./StopLossTurn";
import "./SwingTrader";
import "./TakeProfit";
import "./TakeProfitPartial";
import "./TimeOrder";
import "./Trendatron";
import "./TurnReorder";
import "./VolumeSpikeDetector";
import "./WallDetector";
import "./WaveOpener";
import "./WaveOpenerLeverage";
import "./WaveStopper";
import "./WaveSurfer";
import "./WaveSurferLeverage";
import "./WhaleWatcher";
*/