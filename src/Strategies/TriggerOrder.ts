import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, StrategyOrder, StrategyPosition, TradeAction} from "./AbstractStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import * as helper from "../utils/helper";
import {AbstractTriggerOrder, TriggerOrderCommand} from "./AbstractTriggerOrder";

export interface TriggerOrderAction extends StrategyAction {
    // only keep 1 order at a time and overwrite it. this ensures we don't have contradicting orders
    // updates (e.g. higher stops) happen by overwriting it on the next candle tick
    //orders: TriggerOrderCommand; // moved to AbstractTriggerOrder

    // values from AbstractOrderer. NOT implemented here
    expiry: number;
    deleteExpired: boolean;
    deleteOppositeOrders: boolean;
}

/**
 * Strategy that receives a order from another strategy (such as StopLoss or TakeProfit) and executes it
 * once the threshold triggers. This strategy works with a small candle size (1min) while the strategy giving the order
 * can have a larger candle size. This strategy doesn't have its own config, but instead uses some parameters from the pending
 * order to be executed by it.
 */
export default class TriggerOrder extends AbstractTriggerOrder {
    public action: TriggerOrderAction;
    protected plannedOrder: TriggerOrderCommand = null;
    protected countdownOrder: TriggerOrderCommand = null;
    protected countdownStart: Date = null;

    /**
     * TODO modify getClassName() to get the real strategy name in RealTimeTrader?
     * 2017-12-31 10:10:07 - info: TakeProfitStochRSI USD_IOTA: UP max trend detected, value 100
     2017-12-31 10:10:07 - info: TakeProfitStochRSI USD_IOTA: Forwarding CLOSELONG order to TriggerOrder with reason: RSI value: 100
     2017-12-31 10:10:07 - info: TriggerOrder USD_IOTA: Received pending order from TakeProfitStochRSI: CLOSE: RSI value: 100
     * 2017-12-31 10:11:00 - info: NOTIFICATION Bitfinex: CLOSE Signal TakeProfitStochRSI triggered for USD_IOTA
     triggered close@3.4909999999999997: RSI value: 100
     Market Price: 3.48790000
     p/l: 11.54752360
     2017-12-31 10:11:02 - info: RealTimeTrader margin CLOSE trade with USD_IOTA from TriggerOrder: triggered close@3.4909999999999997: RSI value: 100
     2017-12-31 10:11:02 - info: amount 380, rate 3.4848, profit/loss 11.5475236
     2017-12-31 10:11:02 - info: {"success":true,"message":"","orderNumber":6709114004,"resultingTrades":{}}
     2017-12-31 10:11:02 - info: PlanRunner USD_IOTA: close received - resetting strategy values
     */

    constructor(options) {
        super(options)

        this.addInfoFunction("untilExecutionSec", () => {
            return this.getTimeUntilExecutionSec();
        });
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close")
            this.plannedOrder = null; // only on close ok?
    }

    public serialize() {
        let state = super.serialize();
        if (this.countdownOrder && typeof this.countdownOrder.verifyCloseFn === "function")
            this.log("Skipped serializing order for restart because verifyClose function can't be serialized"); // TODO serialize with toString() only works without context
        else {
            state.plannedOrder = this.plannedOrder;
            state.countdownOrder = this.countdownOrder;
            state.countdownStart = this.countdownStart;
        }
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        /* // always don't unserialize it because of close function and delayed position sync on startup
        this.plannedOrder = state.plannedOrder ? state.plannedOrder : null;
        if (state.countdownOrder)
            this.countdownOrder = state.countdownOrder;
        this.countdownStart = state.countdownStart ? state.countdownStart : null;
         */
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            //this.checkOrders(this.avgMarketPrice, false);
            this.checkOrderCountdown();
            resolve()
        })
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.checkOrder(candle.close, true);
            resolve()
        })
    }

    protected checkOrder(rate: number, tick: boolean) {
        if (!this.candle || !this.pendingTriggerOrder || !this.pendingOrder)
            return; // wait for at least 1 candle
        else if (this.countdownOrder)
            return; // countdown is already running

        // no need to check for expiration ranges because the order just got submitted and is valid until execution - or bot restart // TODO save?
        if (this.pendingTriggerOrder.comp === ">") {
            if (rate >= this.pendingTriggerOrder.rate) {
                if (this.checkEmitOrder(this.pendingTriggerOrder) === true)
                    this.removePlannedOrder();
            }
        }
        else if (this.pendingTriggerOrder.comp === "<") {
            if (rate <= this.pendingTriggerOrder.rate) {
                if (this.checkEmitOrder(this.pendingTriggerOrder) === true)
                    this.removePlannedOrder();
            }
        }
        else
            logger.error("Unknown order comparator %s/%s in %s", this.pendingTriggerOrder.action, this.pendingTriggerOrder.comp, this.className)
    }

    protected checkEmitOrder(order: TriggerOrderCommand, forceExecute = false) {
        if (!forceExecute && order.time > 0) { //
            this.countdownOrder = order;
            this.countdownStart = this.marketTime;
            return false; // don't reset order
        }
        switch (order.action)
        {
            case "buy":
                this.emitBuy(this.defaultWeight, utils.sprintf("triggered buy@%s from %s: %s", order.rate.toFixed(8), this.pendingOrder.fromClass, order.reason), this.pendingOrder.fromClass, this.pendingOrder.exchange);
                break;
            case "sell":
                this.emitSell(this.defaultWeight, utils.sprintf("triggered sell@%s from %s: %s", order.rate.toFixed(8), this.pendingOrder.fromClass, order.reason), this.pendingOrder.fromClass, this.pendingOrder.exchange);
                break;
            case "closeLong":
            case "closeShort":
                this.emitClose(this.defaultWeight, utils.sprintf("triggered close@%s from %s: %s", order.rate.toFixed(8), this.pendingOrder.fromClass, order.reason), this.pendingOrder.fromClass, this.pendingOrder.exchange);
                break;
            default:
                return false;
        }
        return true;
    }

    protected checkOrderCountdown() {
        if (!this.countdownOrder || !this.countdownStart ||  !this.pendingTriggerOrder || !this.pendingOrder)
            return;
        if ((this.countdownOrder.comp === "<" && this.avgMarketPrice >= this.countdownOrder.rate) || (this.countdownOrder.comp === ">" && this.avgMarketPrice <= this.countdownOrder.rate)) {
            this.countdownOrder = null; // stops the counter
            this.countdownStart = null;
            return;
        }
        if (this.countdownOrder.closeOnly === true && this.strategyPosition === "none") {
            this.log("Removed pending close-only order because there is no open position.");
            this.removePlannedOrder();
            return;
        }
        if (this.countdownOrder.keepTrendOpen) {
            // not that useful with small candle sizes
            if ((this.strategyPosition === "long" && this.candleTrend === "up") || (this.strategyPosition === "short" && this.candleTrend === "down")) {
                this.logOnce(utils.sprintf("skipping trigger %s from %s because candle trend is %s: %s", this.countdownOrder.action.toUpperCase(), this.pendingOrder.fromClass, this.candleTrend, this.candle.getPercentChange()));
                return;
            }
        }
        if (this.countdownStart.getTime() + this.countdownOrder.time * 1000 > this.marketTime.getTime())
            return;
        if (this.countdownOrder.verifyCloseFn) {
            if (this.countdownOrder.verifyCloseFn() == false) {
                this.logOnce(utils.sprintf("skipping trigger %s from %s because verification function prevented it", this.countdownOrder.action.toUpperCase(), this.pendingOrder.fromClass));
                return; // our timer will continue and the stop will get executed as soon as possible (or timer reset)
            }
        }
        if (this.checkEmitOrder(this.countdownOrder, true))
            this.removePlannedOrder();
        else
            this.log("Couldn't execute planned countdown order"); // impossible to happen?
    }

    protected getTimeUntilExecutionSec() {
        if (!this.countdownOrder || !this.countdownStart || this.countdownStart.getTime() > Date.now() || this.countdownOrder.time == 0 || !this.marketTime)
            return -1;
        let stopMs = this.countdownOrder.time * 1000 - (this.marketTime.getTime() - this.countdownStart.getTime());
        return stopMs > 0 ? Math.floor(stopMs/1000) : 0;
    }

    protected removePlannedOrder() {
        this.plannedOrder = null;
        this.countdownOrder = null;
        this.countdownStart = null;
        this.pendingTriggerOrder = null; // TODO move to parent?
        this.pendingOrder = null;
    }

    protected resetValues() {
        super.resetValues();
    }
}