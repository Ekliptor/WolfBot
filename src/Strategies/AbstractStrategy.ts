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
import {AbstractTrader, TradeInfo} from "../Trade/AbstractTrader";
import {StrategyGroup} from "../Trade/StrategyGroup";
import {MarginPosition} from "../structs/MarginPosition";
import {AbstractGenericStrategy, GenericStrategyState, StrategyEvent, StrategyInfo} from "./AbstractGenericStrategy";
import * as helper from "../utils/helper";
import {TradePosition} from "../structs/TradePosition";
import {PendingOrder} from "../Trade/AbstractOrderTracker";
import {SimpleOrder} from "../structs/MarketMakerOrders";
import {OpenOrders, OpenOrdersMap} from "../Exchanges/AbstractExchange";

export type BuySellAction = "buy" | "sell";
export type TradeAction = "buy" | "sell" | "close" // actions that go out from the strategy and the Trader instances executes and sends back the event to the strategy
    | "cancelOrder"/* | "order"*/ // this action only goes out from the strategy
    | "cancelAllOrders"
    | "updatePortfolio"
    // other non-trade action events
    | "hold";
export type StrategyOrder = "buy" | "sell" | "closeLong" | "closeShort";
export type StrategyEmitOrder = "buy" | "sell" | "hold" | "close" | "buyClose" | "sellClose";
export type StrategyPosition = "long" | "short" | "none";

export class ScheduledTrade {
    public action: TradeAction;
    public weight: number;
    public reason: string;
    public fromClass: string; // the emitting strategy
    public exchange: Currency.Exchange; // the exchange to trade on
    public created: Date;

    // cached values from the emitting strategy
    getOrderAmount: (tradeTotalBtc: number, leverage: number) => number;
    getRate: (action: BuySellAction) => number;
    getMoveOpenOrderSec: (pendingOrder: PendingOrder) => number;
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
        this.created = new Date(); // only fallback value, better manually set marketTime
    }

    /**
     * Copies all scheduled trade properties WITHOUT any bound order functions for strategies.
     * @return ScheduledTrade
     */
    public copy(): ScheduledTrade {
        let copy = new ScheduledTrade(this.action, this.weight, this.reason, this.fromClass, this.exchange);
        copy.created = this.created;
        return copy;
    }

    public bindEmittingStrategyFunctions(strategy: AbstractStrategy) {
        this.getOrderAmount = strategy.getOrderAmount.bind(strategy);
        this.getRate = strategy.getRate.bind(strategy); // action will be passed on call
        this.getMoveOpenOrderSec = strategy.getMoveOpenOrderSec.bind(strategy);
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

export class ScheduledCancelOrder {
    public pendingOrder: PendingOrder;
    public reason: string;
    public created: Date;

    constructor(pendingOrder: PendingOrder, reason: string = "") {
        this.pendingOrder = pendingOrder;
        this.reason = reason;
        this.created = new Date(); // only fallback value, better manually set marketTime
    }
}

export interface CoinBalance {
    holdingCoins: number;
    position: MarginPosition;
}

export interface StrategyAction {
    // undefined for dynamic strategies. might be changed after trade by AbstractStopStrategy
    order: StrategyOrder;
    priceTolerancePercent: number; // optional, default 0.0 (use last trade price) - The max percent higher/lower the limit price shall be compared to the last trade price. This gives you the advantage of a market order - getting your order filled immediately the best available price - with the safety of a maximum price in case the orderbook is very thin.
    // removed, use global value
    //amount: number; // the amount (in specific coin) to trade // get all tradable from exchange and implement option for "all"
    pair: Currency.CurrencyPair; // The currency pair this strategy trades on. (The exchange is defined in the root of the config 1 level above the strategies.)
    candleSize: number; // candle size in minutes (only applies if this strategy implements candleTick() or checkIndicators() function)
    tradeStrategy: string; // optional, default none. the strategy to execute buy/sell orders. useful to only buy/sell based on 2nd strategy data (RSI...)
    orderStrategy: string; // optional, default none. more advanced than tradeStrategy because TriggerOrderCommand objects must be passed along (doesn't react to buy/sell signals)
    fallback: boolean; // optional, default false. only buy/sell if position is open. close is completely disabled
    enableLog: boolean; // Enables logging for this strategy. Use this to debug a certain strategy (enabling for all is too much output). call this.log() or this.warn()
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
    protected config: TradeConfig = null;
    protected defaultWeight: number = 100;
    protected strategyPosition: StrategyPosition = "none";
    protected holdingCoins = 0.0;
    protected entryPrice: number = -1; // the price we bought/sold - currently only set in child classes
    protected lastSync: Date = null;
    protected previousBalance: CoinBalance = null; // balance on previous sync (a few minutes ago)
    protected _done = false; // for orders that only trigger once
    protected runOnce = false; // don't reset "done" state
    protected lastRun = new Date(0); // run again with runOnce == true after a certain amount of time
    protected lastTrade: TradeAction = null; // used in subclasses
    protected lastTradeTimeClass: Date = null;
    protected lastTradeTimePair: Date = null;
    protected positionOpenTicks = -1; // the number of candle ticks the position has been open. starts at 1 on the first candle tick the position is open
    private lastTradeAction: TradeAction = null; // used & cached in this class
    protected tradeOnce = false; // set to true so that this strategy can not emit multiple buy/sell events
    protected disabled = false;
    private wasMainStrategy = false; // cache it for re-enabling ot
    protected positionOpened: Date = null; // market time the position was opened, null if no position is open

    // start with dummy objects to avoid null pointer exceptions during startup
    // will get replaced below
    protected orderBook: OrderBook<MarketOrder.MarketOrder> = new OrderBook<MarketOrder.MarketOrder>();
    protected ticker: Ticker.Ticker = new Ticker.Ticker(Currency.Exchange.ALL);
    protected orderbookReady = false;
    protected tickerReady = false;
    protected orderBook2: OrderBook<MarketOrder.MarketOrder> = new OrderBook<MarketOrder.MarketOrder>(); // for arbitrage we have 2 orderbooks
    protected orderbook2Ready = false;

    protected rate = -1; // return a rate > 0 if this strategy forces AbstractTrader to buy/sell at a specific price
    protected closedPositions = false; // our strategy is already running for a while and closed (not just started). needed for sync
    protected orderAmountPercent = 0.0;
    protected openOppositePositions = false;
    protected tradePosition: TradePosition = null; // for non-margin trading
    protected position: MarginPosition = null;

    protected strategyGroup: StrategyGroup = null;
    protected pendingOrder: ScheduledTrade = null; // used if strategy A sends an order to strategy B
    protected lastTradeFromClass: string = ""; // the class emitting the last trade (can be another strategy, see AbstractOrderer)
    protected lastTradeState: GenericStrategyState = null; // the state when the last trade signal was emitted
    protected lastCancelledOrder: PendingOrder = null;
    protected openOrders: OpenOrders = null; // all open orders for this currency pair on the exchange
    protected openOrdersMap = new OpenOrdersMap(); // a map with open orders with the exchange as key (needed for arbitrage with multiple exchanges)

    constructor(options) {
        super(options)
        if (typeof options.pair === "string")
            this.action.pair = TradeConfig.getCurrencyPair(options.pair);
        if (!options.tradeStrategy)
            options.tradeStrategy = "";
        this.initRestartCheck();
    }

    public sendTick(trades: Trade.Trade[]) {
        this.tickQueue = this.tickQueue.then(() => {
            this.updateMarket(trades[trades.length - 1]);
            this.lastAvgMarketPrice = this.avgMarketPrice;
            let sum = 0, vol = 0;
            for (let i = 0; i < trades.length; i++) {
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
            if (trades.length !== 0)
                this.lastTradePrice = trades[trades.length-1].rate;
            // TODO add "microCandle" as a candle with the last 10 trades (or better 1/3 the number of trades of last minute)

            this.emit("startTick", this); // sync call to events
            this.tradeTick += trades.length;
            return this.tick(trades)
        }).then(() => {
            this.emit("doneTick", this);
            this.emit("info", this.getInfo());
        }).then(() => {
            return this.waitCandlesInSync();
        }).catch((err) => {
            logger.error("Error in tick of %s", this.className, err)
        })
    }

    public sendCandleTick(candle: Candle.Candle) {
        this.tickQueueCandles = this.tickQueueCandles.then(() => {
            this.candle = candle;
            this.candleTrend = candle.trend;
            this.candleTicks++;
            if (this.strategyPosition !== "none")
                this.positionOpenTicks++;
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
        this.tickQueueCandles1Min = this.tickQueueCandles1Min.then(() => {
            candle = Object.assign(new Candle.Candle(candle.currencyPair), candle);
            if (candle.tradeData !== undefined)
                delete candle.tradeData;
            this.candles1min.unshift(candle);
            const maxCandles: number = nconf.get("serverConfig:keepCandles1min");
            while (this.candles1min.length > maxCandles)
                this.candles1min.pop();
            this.removeTradesFromCandles(this.candles1min, nconf.get("serverConfig:keepTradesOnCandles1min"));
            return this.candleTick1min(candle);
        }).then(() => {

        }).catch((err) => {
            logger.error("Error in 1min candle tick of %s", this.className, err)
        })
    }

    public setConfig(config: TradeConfig) {
        if (this.config !== null) {
            logger.error("Config can only be set once in %s", this.className);
            return;
        }
        this.config = config;
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
        if (this.position && this.position.isEmpty() === false && typeof this.position.amount === "number")
            return this.position.amount;
        return this.holdingCoins;
    }

    /**
     * Return the profit/loss in base currency (USD, BTC,...) of the current open position.
     * @param silent true will log a warning if there is no open position
     */
    public getProfitLoss(silent = false): number {
        if (this.position && this.position.isEmpty() === false && typeof this.position.pl === "number")
            return this.position.pl;
        if (this.tradePosition && this.tradePosition.isEmpty() === false)
            return this.tradePosition.getProfitLoss(this.avgMarketPrice);
        if (silent === false && this.strategyPosition !== "none" && this.lastSync && this.lastTradeTimePair && this.lastSync.getTime() > this.lastTradeTimePair.getTime())
            logger.warn("No trading and margin position found to compute profit/loss for %s in %s", this.action.pair.toString(), this.className);
        return 0.0;
    }

    /**
     * Return the profit/loss percentage of the current open margin position or 0% if there is no open position.
     * @param silent true will log a warning if there is no open position
     */
    public getProfitLossPercent(silent = false): number {
        if (this.position && this.position.isEmpty() === false)
            return this.position.getProfitLossPercent(this.avgMarketPrice);
        if (this.tradePosition && this.tradePosition.isEmpty() === false)
            return this.tradePosition.getProfitLossPercent(this.avgMarketPrice);
        if (silent === false && this.strategyPosition !== "none" && this.lastSync && this.lastTradeTimePair && this.lastSync.getTime() > this.lastTradeTimePair.getTime())
            logger.warn("No trading and margin position found to compute profit/loss percent for %s in %s", this.action.pair.toString(), this.className);
        return 0.0;
    }

    /**
     * This is called on every trade. That includes trades from other strategies running on the same currency pair.
     * @param {TradeAction} action what type of trade just happened
     * @param {Order} order the order that started this trade
     * @param {Trade[]} trades the trades that got executed from this order. Will only be set for market orders (orders that execute
     *          immediately). For limit orders (orders placed to the order book) trades will be an empty array.
     * @param {TradeInfo} info Meta info for this trade such as:
     *          - the strategy that started it
     *          - the reason for it (used for notifications and logging)
     *          - the profit/loss of this trade (if it was a "close" action)
     *          - the exchange on which this trade happened
     */
    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo): void {
        // overwrite this function in your strategy to get feedback of the trades done by our AbstractTrader implementation
        if (info.strategy.isIgnoreTradeStrategy() === true)
            return;
        const previousPosition = this.strategyPosition;
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
            this.positionOpened = null;
            //this.closedPositions = true; // only close again in the strategy that emitted the close
        } else {
            if (this.entryPrice === -1)
                this.entryPrice = order.rate;
            if (action === "buy") {
                this.holdingCoins += order.amount; // tradePosition is updated once the order is filled. should holdingCoins be updated then too? order gets moved
            } else {
                this.holdingCoins -= Math.abs(order.amount);
            }
            this.strategyPosition = this.holdingCoins > 0 ? "long" : "short";
            this.closedPositions = false;
        }

        if (action === "close")
            return;
        else if (/*action !== "close" && */previousPosition !== this.strategyPosition)
            this.positionOpened = this.marketTime; // mark is as opened now
    }

    /**
     * This is called every time an order submitted to an exchange has been filled completely.
     * Notice that depending on the update frequency in AbstractOrderTracker this might be delayed a few seconds.
     * To receive a callback immediately when an order is placed, use onTrade().
     * @param pendingOrder
     */
    public onOrderFilled(pendingOrder: PendingOrder): void {
        // remove the order if still present
        if (this.openOrders)
            this.openOrders.removeOrder(pendingOrder.order.orderID);
        let existingOrder = this.openOrdersMap.get(pendingOrder.exchange.getClassName());
        if (existingOrder !== undefined)
            existingOrder.removeOrder(pendingOrder.order.orderID);

        if (this.tradePosition === null)
            this.tradePosition = new TradePosition();
        const order = pendingOrder.order;
        if (order.type === Trade.TradeType.BUY) {
            this.tradePosition.addTrade(order.amount, order.rate); // ensure we pass a negative amount
        }
        else if (order.type === Trade.TradeType.SELL) {
            this.tradePosition.addTrade(-1 * Math.abs(order.amount), order.rate); // ensure we pass a negative amount
        }
        // on close the tradePosition gets removed
    }

    /**
     * This is called every time our list of open orders (to be filled) on the exchange is synced.
     * @param orders
     */
    public onSyncOpenOrders(orders: OpenOrders): void {
        this.openOrders = orders;
        this.openOrdersMap.set(orders.exchangeName, orders); // arbitrage with more than 1 exchange
    }

    /**
     * This is called every time an order has been submitted to an exchange.
     * The order might have already been executed at the time this function is called (with market orders).
     * If the order is still pending it can be cancelled with emitCancelOrder().
     * Also see onTrade()
     * @param pendingOrder
     */

    /* // not needed because onTrade() returns the order after submission too
    public onOrder(pendingOrder: PendingOrder): void {
        // implement this to keep track of submitted orders. call super.onOrder() at the end to stay compatible in case we add more functionality later
    }
    */

    /**
     * Your balance with the exchange has just been synced. This happens every 2-5 minutes (see updateMarginPositionsSec and
     * updatePortfolioSec). This does NOT mean your balance has changed (it might be the same).
     * Normally you only need this function to allow for manual deposits (or trading) while the strategy is running.
     * @param {number} coins the coins you hold on the exchange (for non-margin trading in config)
     * @param {MarginPosition} position the current margin position (for margin trading enabled in config)
     * @param {Exchange} exchangeLabel the exchange that has been synced
     */
    public onSyncPortfolio(coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange): void {
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
            this.positionOpened = null;
        } else if (this.entryPrice === -1)
            this.entryPrice = this.avgMarketPrice; // assume we just opened our position
        else if (this.strategyPosition !== lastStrategyPosition) {
            this.log(utils.sprintf("Strategy position changed from %s to %s. Resetting entry price", lastStrategyPosition, this.strategyPosition));
            this.entryPrice = this.avgMarketPrice;
        }
        // TODO volume-weighted entryPrice. useful for TakeProfit if we increase our position size after opening
        this.previousBalance = this.getBalance();

        this.lastSync = this.getMarketTime();
        if (this.closedPositions && this.strategyPosition !== "none") {
            // most likely a close http request to the exchange failed
            // this repetition will happen in the strategy that issued the close command (StopLossTurn, TakeProfit,...)
            this.emitClose(Number.MAX_VALUE, "strategy position out of sync");
        } else if (this.strategyPosition === "none") {
            this.closedPositions = false; // reset it so that we don't close a new position again
            if (this.isMainStrategy()) // only true for main strategy? StopLoss has it's own sync() implementation either way
                this.done = false;
        }
        if (this.strategyPosition !== "none" && this.positionOpened == null)
            this.positionOpened = this.marketTime; // assume now

        // TODO reset values if last position != position? useful to update stops (or do it in subclass?) see onConfigChanged() + set position back
        this.adjustStaticOrder();
    }

    public getRate(action: BuySellAction): number {
        // return a rate > 0 if this strategy forces AbstractTrader to buy/sell at a specific price (limit order)
        // otherwise the trader will place a limit order at the last trade price
        // special values:
        // -1: limit order at the last price
        // -2: market order (if supported by exchange), otherwise identical to -1
        let rate = 0.0;
        if (this.action.priceTolerancePercent > 0.0 && this.avgMarketPrice !== -1) {
            // we can not use this for close because the close() API call of most exchanges doesn't accept a price
            if (action === "buy")
                rate = this.avgMarketPrice + this.avgMarketPrice / 100.0 * this.action.priceTolerancePercent; // limit order buy is greater than avgMarketPrice
            else
                rate = this.avgMarketPrice - this.avgMarketPrice / 100.0 * this.action.priceTolerancePercent; // sell
        }
        else
            rate = this.rate;

        const strategyAction: any = this.action;
        if (typeof strategyAction.makerMode === "boolean" && strategyAction.makerMode === true)
            rate = AbstractTrader.getBookRateToPlace(rate, action, this);
        return rate;
    }

    public forceMakeOnly(): boolean {
        // use this together with getRate() to force only placing orders (not paying taker fee)
        // if this function returns true AbstractTrader will constantly cancel/adjust the order by calling getRate()
        // until it is taken
        // getRate() MUST return a rate below/above the market price for buy/sell orders or -1 to let the trader choose the rate based
        // on the order book

        const strategyAction: any = this.action;
        if (typeof strategyAction.forceMaker === "boolean") // allow adding this to every strategy
            return strategyAction.forceMaker === true;
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
     * Overwrite this to set a custom time in seconds after which an open order on the exchange shall be moved closer to
     * the latest trade price.
     * You can return:
     * 0 = use the global default
     * -1 = don't move the order, keep it at the same price indefinitely
     * > 0 = the time in seconds after which the remaining amount of the order shall be moved
     * @param pendingOrder The order to be moved.
     */
    public getMoveOpenOrderSec(pendingOrder: PendingOrder): number {
        return 0;
    }

    /**
     * Return true so that OTHER strategies ignore trade events (buy, sell, close) from this strategy.
     * This means strategy values won't be reset. Useful if this strategy just follows the direction of the main strategy.
     * @returns {boolean}
     */
    public isIgnoreTradeStrategy() {
        return false;
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
        } else
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

    public getLastCancelledOrder() {
        return this.lastCancelledOrder;
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

    public setOrderBook2(book: OrderBook<MarketOrder.MarketOrder>) {
        if (this.orderbook2Ready)
            return logger.warn("More than 2 Exchanges/Orderbooks per strategy are currently not supported") // and probably never will? we run on single exchanges
        this.orderBook2 = book;
        this.orderbook2Ready = true;
    }

    public isOrderBook2Ready() {
        return this.orderbook2Ready;
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

    public isValidOrder(order: StrategyOrder) {
        switch (order) {
            case "buy":
            case "sell":
            case "closeLong":
            case "closeShort":
                return true;
            default:
                return false;
        }
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
        for (let i = 0; i < strategies.length; i++) {
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
        // TODO add a cache if called from outside (HTTP API,...)
        const baseCurrency = Currency.Currency[this.action.pair.from];
        let info: any = {
            name: this.className,
            avgMarketPrice: this.avgMarketPrice.toFixed(8) + " " + baseCurrency,
            pair: this.getCurrencyStr(),
            stateMessage: this.stateMessage
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
            if (this[prop.property] && typeof this[prop.property] === "object" && typeof this[prop.property].toString === "function")
                info[prop.label] = this[prop.property].toString(); // toString() should always be defined, yet sometimes with [object]
            else
                info[prop.label] = this[prop.property];
        })
        this.infoFunctions.forEach((fn) => {
            info[fn.label] = fn.propertyFn();
        });
        // TODO add tradeState: string per strategy and show messages here such as "skipped going long because indicator X is below Y"
        return info;
    }

    /**
     * Save the strategy state before the bot closes.
     * @returns {GenericStrategyState}
     */
    public serialize() {
        let state = super.serialize();
        state.entryPrice = this.entryPrice;
        state.strategyOrder = this.action.order;
        state.strategyPosition = this.strategyPosition;
        state.done = this.done;
        state.lastRun = this.lastRun;
        state.lastTrade = this.lastTrade;
        state.closedPositions = this.closedPositions;
        state.lastTradeTimeClass = this.lastTradeTimeClass;
        state.lastTradeTimePair = this.lastTradeTimePair;
        state.positionOpenTicks = this.positionOpenTicks;
        state.holdingCoins = this.holdingCoins;
        state.position = this.position;
        state.previousBalance = this.previousBalance;
        state.pendingOrder = this.pendingOrder;
        state.openOrders = this.openOrders;
        state.positionOpened = this.positionOpened;
        return state;
    }

    /**
     * Restore the strategy state after the bot has restarted.
     * @param state
     */
    public unserialize(state: GenericStrategyState) {
        super.unserialize(state);
        if (this.candles1min.length === 0)
            this.scheduleRestore1minCandlesFromMainStrategy();
        if (state.entryPrice > 0.0)
            this.entryPrice = state.entryPrice;
        if (state.strategyOrder)
            this.action.order = state.strategyOrder;
        if (state.strategyPosition)
            this.strategyPosition = state.strategyPosition;
        if (typeof state.positionOpenTicks === "number" && state.positionOpenTicks >= 0)
            this.positionOpenTicks = state.positionOpenTicks;
        this.done = state.done;
        this.lastRun = state.lastRun;
        this.lastTrade = state.lastTrade;
        //this.closedPositions = state.closedPositions === true; // better don't repeat close after restart. config might have changed
        this.lastTradeTimeClass = state.lastTradeTimeClass;
        this.lastTradeTimePair = state.lastTradeTimePair;
        if (typeof state.holdingCoins === "number")
            this.holdingCoins = state.holdingCoins;
        if (typeof state.position === "object" && state.position) // null is also an object
            this.position = Object.assign(new MarginPosition(state.position.leverage), state.position);
        if (typeof state.previousBalance === "object" && state.previousBalance) {
            this.previousBalance = {
                holdingCoins: state.previousBalance.holdingCoins,
                position: Object.assign(new MarginPosition(state.previousBalance.position.leverage), state.previousBalance.position)
            }
        }
        if (state.pendingOrder) {
            let prev = state.pendingOrder;
            this.pendingOrder = new ScheduledTrade(prev.action, prev.weight, prev.reason, prev.fromClass, prev.exchange);
            // TODO unserialize functions too: https://github.com/yahoo/serialize-javascript
            // but doesn't work that easy because of bound context... maybe better store class properties instead of functions
        }
        if (state.openOrders) {
            this.openOrders = new OpenOrders(state.openOrders.currencyPair, state.openOrders.exchangeName);
            state.openOrders.orders.forEach((order) => {
                this.openOrders.addOrder(order);
            });
        }
        if (state.positionOpened)
            this.positionOpened = state.positionOpened;
    }

    public emit(event: TradeAction | StrategyEvent, ...args: any[]) {
        return super.emit(event, ...args);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected scheduleRestore1minCandlesFromMainStrategy() {
        setTimeout(() => { // do this after all strategies are loaded
            let mainStrategies = this.strategyGroup.getMainStrategies();
            if (mainStrategies.length === 0) {
                logger.warn("No main strategy found in %s %s to unserialize 1min candle history", this.action.pair.toString(), this.className);
                let allStrategies = this.strategyGroup.getAllStrategies(); // use the 1st other strategy with candles as fallback
                let found = false;
                for (let i = 0; i < allStrategies.length; i++)
                {
                    this.candles1min = allStrategies[i].getCandles1Min();
                    if (this.candles1min.length !== 0) {
                        found = true;
                        break;
                    }
                    if (found === false)
                        logger.warn("No strategy found in %s %s to unserialize 1min candle history", this.action.pair.toString(), this.className);
                }
                return;
            }
            this.candles1min = mainStrategies[0].getCandles1Min(); // don't copy them to save memory
        }, 0);
    }

    /**
     * Emit a buy call from this strategy.
     * @param {number} The weight The weight of the call. If you emit this from within a candle tick (candleTick() or checkIndicators() function)
     *          and there are multiple (possibly conflicting) orders during that candle tick, then only the order with the highest weight will be forwarded.
     *          Usually you can just use this.defaultWeight or Number.MAX_VALUE for important stops.
     * @param {string} reason The reason of this trade for logging and smartphone notifications.
     * @param {string} fromClass The name of the strategy this order is originally coming from. Only applicable if the 'orderStrategy'
     *          setting is used. Automatically added when using 'tradeStrategy' (see StrategyAction).
     *          Can be empty if your strategy doesn't forward orders.
     * @param {Exchange} exchange The exchange on which this trade shall be executed. Only meaningful in arbitrage mode.
     *          Ignore it for trading.
     */
    protected emitBuy(weight: number, reason: string, fromClass = "", exchange: Currency.Exchange = Currency.Exchange.ALL): void {
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
        this.lastTradeFromClass = fromClass ? fromClass : this.className;
        this.lastTradeState = this.createTradeState();
        this.emit("buy", weight, reason, this.adjustToSingleExchange(exchange));
    }

    /**
     * Emit a sell call from this strategy.
     * @param {number} The weight The weight of the call. If you emit this from within a candle tick (candleTick() or checkIndicators() function)
     *          and there are multiple (possibly conflicting) orders during that candle tick, then only the order with the highest weight will be forwarded.
     *          Usually you can just use this.defaultWeight or Number.MAX_VALUE for important stops.
     * @param {string} reason The reason of this trade for logging and smartphone notifications.
     * @param {string} fromClass The name of the strategy this order is originally coming from. Only applicable if the 'orderStrategy'
     *          setting is used. Automatically added when using 'tradeStrategy' (see StrategyAction).
     *          Can be empty if your strategy doesn't forward orders.
     * @param {Exchange} exchange The exchange on which this trade shall be executed. Only meaningful in arbitrage mode.
     *          Ignore it for trading.
     */
    protected emitSell(weight: number, reason: string, fromClass = "", exchange: Currency.Exchange = Currency.Exchange.ALL): void {
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
        this.lastTradeFromClass = fromClass ? fromClass : this.className;
        this.lastTradeState = this.createTradeState();
        this.emit("sell", weight, reason, this.adjustToSingleExchange(exchange));
    }

    /**
     * @deprecated
     * @param {number} weight
     * @param {string} reason
     * @param {string} fromClass
     * @param {Exchange} exchange
     */
    protected emitHold(weight: number, reason: string, fromClass = "", exchange: Currency.Exchange = Currency.Exchange.ALL): void { // TODO currently not used, remove?
        logger.warn("emitHold() might be removed in the future");
        this.lastTradeFromClass = fromClass ? fromClass : this.className;
        this.lastTradeState = this.createTradeState();
        this.emit("hold", weight, reason, this.adjustToSingleExchange(exchange));
    }

    /**
     * Emit a close call from this strategy.
     * @param {number} The weight The weight of the call. If you emit this from within a candle tick (candleTick() or checkIndicators() function)
     *          and there are multiple (possibly conflicting) orders during that candle tick, then only the order with the highest weight will be forwarded.
     *          Usually you can just use this.defaultWeight or Number.MAX_VALUE for important stops.
     * @param {string} reason The reason of this trade for logging and smartphone notifications.
     * @param {string} fromClass The name of the strategy this order is originally coming from. Only applicable if the 'orderStrategy'
     *          setting is used. Automatically added when using 'tradeStrategy' (see StrategyAction).
     *          Can be empty if your strategy doesn't forward orders.
     * @param {Exchange} exchange The exchange on which this trade shall be executed. Only meaningful in arbitrage mode.
     *          Ignore it for trading.
     */
    protected emitClose(weight: number, reason: string, fromClass = "", exchange: Currency.Exchange = Currency.Exchange.ALL): void {
        this.lastTradeAction = "close";
        if (this.isDisabled()) {
            this.log("Skipping CLOSE signal because strategy is disabled");
            return;
        }
        if (this.action.fallback === true)
            return this.log("Skipping CLOSE signal because strategy is fallback only");
        this.closedPositions = true;
        // TODO option for 2nd strategy on close too? see passToTradeStrategy()
        this.lastTradeFromClass = fromClass ? fromClass : this.className;
        this.lastTradeState = this.createTradeState();
        this.emit("close", weight, reason, this.adjustToSingleExchange(exchange));
    }

    /**
     * Emit a buy or close event depending on the 'order' setting of this strategy.
     * Useful to call within stop strategies or other strategies where the order changes depending on your position type (long/short).
     * See emitClose() for parameters.
     * @param {number} weight
     * @param {string} reason
     */
    protected emitBuyClose(weight: number, reason: string, fromClass = "", exchange: Currency.Exchange = Currency.Exchange.ALL) {
        if (!this.action.order) {
            logger.error("Order action must be defined to call emitBuyClose in %s", this.className);
            return;
        }
        if (this.action.order.indexOf("close") === -1)
            this.emitBuy(weight, reason, fromClass, exchange);
        else
            this.emitClose(weight, reason, fromClass, exchange);
    }

    /**
     * Emit a sell or close event depending on the 'order' setting of this strategy.
     * Useful to call within stop strategies or other strategies where the order changes depending on your position type (long/short).
     * See emitClose() for parameters.
     * @param {number} weight
     * @param {string} reason
     */
    protected emitSellClose(weight: number, reason: string, fromClass = "", exchange: Currency.Exchange = Currency.Exchange.ALL) {
        if (!this.action.order) {
            logger.error("Order action must be defined to call emitSellClose in %s", this.className);
            return;
        }
        //if (this.action.order === "sell") // BladeRunner has opposite meanings than StopLoss
        if (this.action.order.indexOf("close") === -1)
            this.emitSell(weight, reason, fromClass, exchange);
        else
            this.emitClose(weight, reason, fromClass, exchange);
    }

    /**
     * Emit an event to cancel an order placed on an exchange. If the order hasn't ben filled yet it will be cancelled.
     * @param pendingOrder
     * @param reason
     * @param exchange
     */
    protected emitCancelOrder(pendingOrder: PendingOrder, reason: string, exchange: Currency.Exchange = Currency.Exchange.ALL) {
        this.lastCancelledOrder = pendingOrder;
        if (exchange === Currency.Exchange.ALL && pendingOrder.exchange && pendingOrder.exchange.getExchangeLabel() !== exchange)
            exchange = pendingOrder.exchange.getExchangeLabel(); // overwrite it if we still have the original order object and it was on another exchange
        this.emit("cancelOrder", pendingOrder, reason, exchange);
    }

    /**
     * Emit an event to cancel all currently open orders.
     * It is faster to keep track of order IDs in your strategy and cancel them directly (no API call to fetch needed) for fast trading.
     * @param reason
     * @param exchange
     */
    protected cancelAllOrders(reason: string, exchange: Currency.Exchange = Currency.Exchange.ALL) {
        this.emit("cancelAllOrders", reason, this.adjustToSingleExchange(exchange));
    }

    /**
     * Request an immediate update of your open positions on the exchange.
     * Portfolio updates are done automatically, but for fast trading styles you can do call this function to update
     * more frequently.
     * @param reason
     * @param exchange
     */
    protected requestPortfolioUpdate(reason: string, exchange: Currency.Exchange = Currency.Exchange.ALL) {
        this.emit("updatePortfolio", reason, this.adjustToSingleExchange(exchange));
    }

    /**
     * Shorthand function to call emitBuy/emitSell/emitClose with a ScheduledTrade object as parameter.
     * @param {ScheduledTrade} scheduledTrade
     */
    protected executeTrade(scheduledTrade: ScheduledTrade) {
        switch (scheduledTrade.action) {
            case "buy":
                this.emitBuy(scheduledTrade.weight, scheduledTrade.reason, scheduledTrade.fromClass, scheduledTrade.exchange);
                return;
            case "sell":
                this.emitSell(scheduledTrade.weight, scheduledTrade.reason, scheduledTrade.fromClass, scheduledTrade.exchange);
                return;
            case "close":
                this.emitClose(scheduledTrade.weight, scheduledTrade.reason, scheduledTrade.fromClass, scheduledTrade.exchange);
                return;
            case "cancelOrder":
            case "cancelAllOrders":
                return; // not used for cancelling orders because it needs a PendingOrder object
            case "updatePortfolio":
                return;
            case "hold":
                return; // shouldn't happen, hold is deprecated
            default:
                utils.test.assertUnreachableCode(scheduledTrade.action);
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

    /**
     * Return the currently selected exchange in config (if there is only 1, default for trading) if
     * Currency.Exchange.ALL is passed in.
     * @param exchange
     */
    protected adjustToSingleExchange(exchange: Currency.Exchange): Currency.Exchange {
        if (exchange === Currency.Exchange.ALL) {
            if (!this.config) {
                logger.warn("%s: Trading config not available. Can't verify exchange before trade", this.className);
                return exchange;
            }
            if (this.config.exchanges.length === 1)
                return Currency.ExchangeName.get(this.config.exchanges[0]);
        }
        return exchange;
    }

    protected updateMarket(lastTrade: Trade.Trade) {
        this.lastMarketPrice = this.marketPrice;
        this.marketPrice = lastTrade.rate;
        this.setMarketTime(lastTrade.date);
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
                return 0.0; // faster
            let dailyCandle = this.getCandles(1440, 1) // last 24h candle
            if (dailyCandle && dailyCandle.length !== 0) // check if we have data for less than a full day (we use the correct offset)
                return Math.round(dailyCandle[0].getPercentChange() * 100) / 100.0;
            return 0.0;
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
        if (this.position/* && nconf.get("trader") !== "Backtester"*/) {
            if (this.position.pl < 0.0)
                return false;
            if (minPercent == 0)
                return true;
            const positionSizeBase = Math.abs(this.position.amount) * this.getLastPrice();
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

    protected hasProfitReal(minPercent = 0.01) {
        //if (nconf.get("trader") === "Backtester") // margin position profit is now available during backtesting
            //return this.hasProfit(this.entryPrice, minPercent);

        if (!this.position) {
            logger.warn("Unable to check for real profit. This is only available during margin trading (and possibly not on all exchanges).")
            return false;
        }
        if (this.position.pl < 0.0)
            return false;
        if (minPercent == 0)
            return true;
        if (this.position.leverage >= 10.0)
            return true; // always assume enough % profit on highly leveraged exchanges
        const positionSizeBase = Math.abs(this.position.amount) * this.getLastPrice();
        // TODO get average entry price from exchange API and use it here (where available)
        if (positionSizeBase > 0.0) { // otherwise no ticker data or sth else went wrong
            const profitPercent = this.position.pl / positionSizeBase * 100.0;
            return profitPercent >= minPercent;
        }
        return false;
    }

    protected balanceChanged(previous: CoinBalance = null) {
        if (previous === null)
            previous = this.previousBalance;
        if (this.position && previous.position) {
            if (this.position.equals(previous) === false)
                return true;
        }
        else if ((!this.position && previous.position) ||(this.position && !previous.position))
            return true;
        return this.holdingCoins !== previous.holdingCoins;
    }

    protected getBalance(): CoinBalance {
        return {
            position: this.position,
            holdingCoins: this.holdingCoins
        }
    }

    protected getLastPrice() {
        if (this.ticker && this.ticker.last > 0.0) // ticker is not available during backtesting
            return this.ticker.last;
        return this.avgMarketPrice;
    }

    public getAvailableBalance(): number {
        if (this.position === null)
            return -1;
        return this.position.coins;
    }

    protected getCurrentRate(): number {
        if (this.avgMarketPrice > 0.0)
            return this.avgMarketPrice;
        if (this.ticker && this.ticker.last > 0.0)
            return this.ticker.last;
        throw new Error(utils.sprintf("%s: Unable to get current market rate for %s because neither trade feed nor ticker of exchange is updating", this.className, this.action.pair.toString()));
    }

    protected isPositionOpenTicks(minTicks: number): boolean {
        if (this.positionOpenTicks < 0)
            return false; // no open position
        else if (minTicks <= 0) // invalid ?
            return true;
        return this.positionOpenTicks >= minTicks;
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

    protected isCloseLongPending() {
        // more reliable to look at position
        // TODO remove "order" from config or add another parameter to enforce it
        //return this.action.order === "sell" || this.action.order === "closeLong";
        return this.strategyPosition === "long";
    }

    protected isCloseShortPending() {
        //return this.action.order === "buy" || this.action.order === "closeShort";
        return this.strategyPosition === "short";
    }

    protected createSimpleOrder(order: Order.Order, info: TradeInfo) {
        let simpleOrder = new SimpleOrder(order.rate, order.amount);
        if (info && info.pendingOrder)
            simpleOrder.pendingOrder = info.pendingOrder;
        return simpleOrder;
    }

    protected isPossibleFuturesPair(pair: Currency.CurrencyPair) {
        const futurePairs: string[] = nconf.get("serverConfig:futureCoinPairs");
        return futurePairs.indexOf(pair.toString()) !== -1;
    }

    protected initRestartCheck() {
        // be safe and allow 2*candleSize. important because after restarts the last candle tick might already be candleSize ago
        const maxTickMin = Math.max(nconf.get("serverConfig:restartLastCandleTickMin"), this.action.candleSize ? 2*this.action.candleSize : 2);
        if (maxTickMin <= 0 || nconf.get("trader") === "Backtester")
            return;
        setTimeout(() => { // wait til it's decided if main strategy (usually in constructor)
            if (this.isMainStrategy() === false)
                return;
            setInterval(async () => {
                const latest1MinCandle = this.candles1min.length !== 0 ? this.candles1min[0] : null;
                if (!this.candle || !this.candle.start || !latest1MinCandle || !latest1MinCandle.start)
                    logger.error("No candle data available after %s minutes. Please check your API key permissions and the bot connection.", maxTickMin);
                else if (/*!this.candle.start || */this.candle.start.getTime() + maxTickMin*utils.constants.MINUTE_IN_SECONDS*1000 < Date.now() &&
                    latest1MinCandle.start.getTime() + nconf.get("serverConfig:restart1MinCandleTimePassedMin")*utils.constants.MINUTE_IN_SECONDS*1000 < Date.now()) {
                    // TODO also ensure we are > running the bot at least n minutes (from AbstractAdvisor)
                    const msg = utils.sprintf("Last candle tick was longer than %s minutes ago. Scheduling restart", maxTickMin);
                    logger.error(msg);
                    this.sendNotification("Restarting bot", msg, false, true);
                    const controller = await import("../Controller");
                    controller.controller.restart();
                }
            }, nconf.get("serverConfig:checkRestartIntervalMin")*utils.constants.MINUTE_IN_SECONDS*1000);
        }, 5000 + utils.getRandomInt(0, 15000)); // add some randomness to avoid multiple strategies firing at the same time
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
