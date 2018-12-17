import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, ScheduledTrade, StrategyAction, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";

interface RSIScalperAction extends TechnicalStrategyAction {
    percentage: number; // The order amount percentage of the config's total trading volume. Use 100% to trade the same amount again and double your position size.

    // RSI values
    low: number; // the RSI low to be reached before we look for a bounce back up
    high: number; // the RSI high to be reached before we look for a bounce back down
    interval: number; // optional, default 6

    enterLow: number; // default 50. The max RSI value to open a short position.
    enterHigh: number; // default 50. The min RSI value to open a long position.
    openPosition: boolean; // default = false. true means this strategy can also open new positions. false means it will only trade in the same direction if we already have an open position.
    expiry: number; // default = 14 candles. Stop waiting for a bounce back if it doesn't happen for 'expiry' candles. 0 = disabled
    scalpOnce: boolean; // default = true. Scalp only once per position to increase its size. If disabled we scalp multiple times on every opportunity.
    // TODO add parameter "scalpingDirection: TradeDirection" to enable/disable scalping only for long/short
}

/**
 * Strategy that uses the RSI indicator for scalping. By scaling this strategy means buying/selling on a pull back after spikes.
 * This strategy is ideal to use together with a main strategy that does about 1 trade per day. If prices move quickly in the opposite
 * direction and you assume recovery, you can use this strategy to increase the size of your existing position by 'percentage' from
 * the strategy config.
 */
export default class RSIScalper extends TechnicalStrategy {
    public action: RSIScalperAction;
    protected lastRSI: number = -1; // identical ro RSI because it's updated on every candle tick
    protected secondLastRSI: number = -1;
    protected waitingBounceBack = false;
    protected expiryCount = 0;
    protected scalpingDone = false;

    constructor(options) {
        super(options)
        if (!this.action.interval)
            this.action.interval = 6;
        if (!this.action.enterLow)
            this.action.enterLow = 50;
        if (!this.action.enterHigh)
            this.action.enterHigh = 50;
        if (!this.action.openPosition)
            this.action.openPosition = false;
        if (!this.action.expiry)
            this.action.expiry = 14;
        if (typeof this.action.scalpOnce !== "boolean")
            this.action.scalpOnce = true;

        this.addIndicator("RSI", "RSI", this.action);
        this.addInfo("secondLastRSI", "secondLastRSI");
        this.addInfo("waitingBounceBack", "waitingBounceBack");
        this.addInfo("expiryCount", "expiryCount");
        this.addInfo("scalpingDone", "scalpingDone");
        this.addInfoFunction("RSI", () => {
            return this.indicators.get("RSI").getValue();
        });
        this.saveState = true;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            this.expiryCount = 0;
            this.scalpingDone = false;
            //this.pendingOrder = null;
        }
    }

    public getOrderAmount(tradeTotalBtc: number, leverage: number = 1): number {
        let amount = tradeTotalBtc * leverage;
        // TODO better support to specify amount in coins for futures, see getOrderAmount() of IndexStrategy
        if (nconf.get("trader") !== "Backtester") { // backtester uses BTC as unit, live mode USD
            if (leverage >= 10 && this.isPossibleFuturesPair(this.action.pair) === true)
                amount = tradeTotalBtc * leverage * /*this.ticker.last*/this.avgMarketPrice;
        }

        this.orderAmountPercent = this.action.percentage;
        if (!this.orderAmountPercent || this.orderAmountPercent === 100)
            return amount;
        return amount / 100 * this.orderAmountPercent;
    }

    public serialize() {
        let state = super.serialize();
        //state.pendingOrder = this.pendingOrder;
        state.waitingBounceBack = this.waitingBounceBack;
        state.scalpingDone = this.scalpingDone;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        //this.pendingOrder = state.pendingOrder; // done in parent with re-creating the actual object
        this.waitingBounceBack = state.waitingBounceBack;
        this.scalpingDone = state.scalpingDone;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        let rsi = this.indicators.get("RSI")
        const value = rsi.getValue();
        const valueFormatted = Math.round(value * 100) / 100.0;
        this.secondLastRSI = this.lastRSI;

        this.checkBounceBack();

        if (value > this.action.high) {
            this.log("UP trend detected, value", valueFormatted)
            // good to check it here because we don't want to schedule an order if it doesn't match the direction of our main strategy
            if (this.canExecuteTrade("sell")) {
                this.waitingBounceBack = true;
                this.expiryCount = this.action.expiry;
                this.pendingOrder = new ScheduledTrade("sell", this.defaultWeight, "UP trend, awaiting down bounce back", this.className);
            }
        }
        else if (value < this.action.low) {
            this.log("DOWN trend detected, value", valueFormatted)
            if (this.canExecuteTrade("buy")) {
                this.waitingBounceBack = true;
                this.expiryCount = this.action.expiry;
                this.pendingOrder = new ScheduledTrade("buy", this.defaultWeight, "DOWN trend, awaiting up bounce back", this.className);
            }
        }
        //else
            //this.log("no trend detected, value", valueFormatted)
        this.lastRSI = value;
    }

    protected checkBounceBack() {
        if (!this.waitingBounceBack || !this.pendingOrder)
            return;
        let rsi = this.indicators.get("RSI")
        const value = rsi.getValue();
        this.expiryCount--;
        if (this.action.expiry > 0 && this.expiryCount <= 0) {
            this.log(utils.sprintf("Pending scalper order %s: %s has epxired. Deleting it", this.pendingOrder.action.toUpperCase(), this.pendingOrder.reason));
            this.pendingOrder = null;
            return;
        }
        else if (this.strategyPosition === "none") {
            this.pendingOrder = null; // we closed our position while waiting for the bounce back
            return;
        }

        // TODO optionally also check avgMarketPrice and last candle
        const valueFormatted = Math.round(value * 100) / 100.0;
        const lastRsiFormatted = Math.round(this.lastRSI * 100) / 100.0;
        let traded = false;
        if (this.pendingOrder.action === "buy" && this.lastRSI < value && value > this.action.enterHigh && this.canScalpNow("buy")) {
            this.emitBuy(this.pendingOrder.weight, utils.sprintf("RSI bouncing back UP. current %s, last %s - %s", valueFormatted, lastRsiFormatted, this.pendingOrder.reason));
            traded = true;
        }
        else if (this.pendingOrder.action === "sell" && this.lastRSI > value && value < this.action.enterLow && this.canScalpNow("sell")) {
            this.emitSell(this.pendingOrder.weight, utils.sprintf("RSI bouncing back DOWN. current %s, last %s - %s", valueFormatted, lastRsiFormatted, this.pendingOrder.reason));
            traded = true;
        }
        if (traded) {
            this.scalpingDone = true;
            this.pendingOrder = null;
            this.waitingBounceBack = false;
        }
    }

    protected canExecuteTrade(action: TradeAction) {
        if (this.pendingOrder)
            return false; // don't overwrite scheduled orders
        if (this.action.openPosition === true && this.strategyPosition === "none")
            return true;
        if (action === "buy" && this.strategyPosition === "long")
            return true;
        if (action === "sell" && this.strategyPosition === "short")
            return true;
        return false;
    }

    protected canScalpNow(action: TradeAction) {
        let stopStrategies = this.strategyGroup.getStopStrategies();
        for (let i = 0; i < stopStrategies.length; i++)
        {
            if (stopStrategies[i].getStopCountStart() != null) {
                this.logOnce(utils.sprintf("Prevented scalp %s because stop counter is running", action.toUpperCase()))
                return false;
            }
        }
        // check if we are allowed to scalp multiple times
        if (!this.action.scalpOnce)
            return true;
        if (!this.scalpingDone)
            return true;
        this.log("Scalping already done. Config is set to only scalp once.");
        return false;
    }

    protected resetValues() {
        this.waitingBounceBack = false;
        //this.lastRSI = -1; // don't reset lastRSI
        //this.expiryCount = 0; // only on close
        super.resetValues();
    }
}