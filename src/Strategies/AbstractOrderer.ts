import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, ScheduledTrade, StrategyAction, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import {AbstractTakeProfitStrategy} from "./AbstractTakeProfitStrategy";
import {AbstractStopStrategy} from "./AbstractStopStrategy";

export  interface AbstractOrdererAction extends TechnicalStrategyAction {
    expiry: number; // default = 5 candles. execute the order after x candles if the threshold isn't reached. 0 = disabled
    deleteExpired: boolean; // default true. true = delete expired orders instead of executing them
    deleteOppositeOrders: boolean; // default false. delete opposite buy/sell orders if immediate thresholds are reached
}

/**
 * Secondary Strategy that executes buy/sell based on the RSI indicator after overbought/oversold periods.
 * Should be used with a smaller candleSize than the main strategy.
 * // TODO RSICloser strategy subclass for StopLossTurn to close at the optimal moment
 */
export abstract class AbstractOrderer extends TechnicalStrategy {
    public action: AbstractOrdererAction;
    protected lastRSI: number = -1; // identical ro RSI because it's updated on every candle tick
    protected secondLastRSI: number = -1;
    protected waitingBounceBack = false;
    protected expiryCount = 0;
    protected lastPendingOrder: ScheduledTrade = null;
    protected initiatorClassName: string = null;

    constructor(options) {
        super(options)
        this.initiatorClassName = this.className;
        if (!this.action.interval)
            this.action.interval = 6;
        if (!this.action.expiry)
            this.action.expiry = 5;
        if (typeof this.action.deleteExpired !== "boolean")
            this.action.deleteExpired = true;
        if (typeof this.action.deleteOppositeOrders !== "boolean")
            this.action.deleteOppositeOrders = false;

        this.addInfo("waitingBounceBack", "waitingBounceBack");
        this.addInfo("expiryCount", "expiryCount");
        this.addInfoFunction("pendingOrder", () => {
            return this.pendingOrder ? this.pendingOrder.action : false;
        });

        this.saveState = true;
        if (this.isMainStrategy())
            logger.error("%s can't be used as main strategy because it doesn't initiate orders", this.className)
    }

    public getInitiatorClassName() {
        return this.initiatorClassName;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close")
            this.expiryCount = 0;
    }

    public getOrderAmount(tradeTotalBtc: number, leverage: number = 1): number {
        if (this.lastPendingOrder && this.lastPendingOrder.getOrderAmount) // if we use TakeProfitPartial we have to call bound the function of that strategy
            return this.lastPendingOrder.getOrderAmount(tradeTotalBtc, leverage);
        let amount = tradeTotalBtc * leverage;
        // TODO better support to specify amount in coins for futures, see getOrderAmount() of IndexStrategy
        if (nconf.get("trader") !== "Backtester") { // backtester uses BTC as unit, live mode USD
            if (leverage >= 10 && this.isPossibleFuturesPair(this.action.pair) === true)
                amount = tradeTotalBtc * leverage * /*this.ticker.last*/this.avgMarketPrice;
        }

        if (!this.orderAmountPercent || this.orderAmountPercent === 100)
            return amount;
        return amount / 100 * this.orderAmountPercent;
    }

    public getRate() {
        if (this.lastPendingOrder && this.lastPendingOrder.getRate)
            return this.lastPendingOrder.getRate();
        return super.getRate();
    }

    public forceMakeOnly() {
        if (this.lastPendingOrder && this.lastPendingOrder.forceMakeOnly)
            return this.lastPendingOrder.forceMakeOnly();
        return super.forceMakeOnly();
    }

    public isIgnoreTradeStrategy() {
        if (this.lastPendingOrder && this.lastPendingOrder.isIgnoreTradeStrategy)
            return this.lastPendingOrder.isIgnoreTradeStrategy();
        return super.isIgnoreTradeStrategy();
    }

    public isMainStrategy() {
        if (this.lastPendingOrder && this.lastPendingOrder.isMainStrategy) // called on startup too
            return this.lastPendingOrder.isMainStrategy();
        return super.isMainStrategy();
    }

    public canOpenOppositePositions() {
        if (this.lastPendingOrder && this.lastPendingOrder.canOpenOppositePositions)
            return this.lastPendingOrder.canOpenOppositePositions();
        return super.canOpenOppositePositions();
    }

    public addOrder(scheduledTrade: ScheduledTrade) {
        if (this.pendingOrder != null) {
            if (this.pendingOrder.action === scheduledTrade.action && this.pendingOrder.fromClass === scheduledTrade.fromClass)
                return; // just ignore it, it should be the same order // TODO reset expiry immediately? or wait until it expires and added again
            logger.warn("Pending order is already set to %s: %s - overwriting with %s: %s", this.pendingOrder.action.toUpperCase(), this.pendingOrder.reason,
                scheduledTrade.action.toUpperCase(), scheduledTrade.reason)
        }
        this.pendingOrder = scheduledTrade;
        this.lastPendingOrder = this.pendingOrder; // cache it for getOrderAmount()
        this.waitingBounceBack = false;
        this.expiryCount = this.action.expiry;
        this.initiatorClassName = this.pendingOrder.fromClass;
        this.log(utils.sprintf("Received pending order from %s: %s: %s", this.pendingOrder.fromClass, this.pendingOrder.action.toUpperCase(), this.pendingOrder.reason))
    }

    public isStopOrTakeProfitOrder() {
        return this.isTakeProfitOrder() === true || this.isStopOrder() === true;
    }

    public isStopOrder() {
        let fromClass: string;
        if (!this.pendingOrder || !this.pendingOrder.fromClass) {
            if (!this.lastTradeState || !this.lastTradeState.pendingOrder)
                return false;
            fromClass = this.lastTradeState.pendingOrder.fromClass;
        }
        else
            fromClass = this.pendingOrder.fromClass;
        let strategy = this.strategyGroup.getStrategyByName(fromClass);
        if (!strategy)
            return false; // shouldn't happen
        return strategy instanceof AbstractStopStrategy;
    }

    public isTakeProfitOrder() {
        let fromClass: string;
        if (!this.pendingOrder || !this.pendingOrder.fromClass) {
            // TODO pending order is already set to null when called from trader. add internal unique order IDs and cache all strategy state?
            if (!this.lastTradeState || !this.lastTradeState.pendingOrder)
                return false;
            fromClass = this.lastTradeState.pendingOrder.fromClass;
        }
        else
            fromClass = this.pendingOrder.fromClass;
        let strategy = this.strategyGroup.getStrategyByName(fromClass);
        if (!strategy)
            return false; // shouldn't happen
        return strategy instanceof AbstractTakeProfitStrategy;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected resetValues() {
        this.waitingBounceBack = false;
        //this.lastRSI = -1; // don't reset lastRSI
        //this.expiryCount = 0; // only on close
        super.resetValues();
    }

    protected log(...args) {
        if (this.pendingOrder) {
            args.unshift(this.pendingOrder.action.toUpperCase() + ":");
            super.log(...args);
        }
        else
            super.log(...args);
    }

    protected warn(...args) {
        if (this.pendingOrder) {
            args.unshift(this.pendingOrder.action.toUpperCase() + ":");
            super.warn(...args);
        }
        else
            super.warn(...args);
    }
}