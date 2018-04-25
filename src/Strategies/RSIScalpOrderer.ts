import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, ScheduledTrade, StrategyAction, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import {AbstractOrderer, AbstractOrdererAction} from "./AbstractOrderer";

interface RSIScalpOrdererAction extends AbstractOrdererAction {
    // RSI values
    low: number; // the RSI low to be reached before we look for a bounce back up
    high: number; // the RSI high to be reached before we look for a bounce back down
    interval: number; // optional, default 6

    immediateLow: number; // 38
    immediateHigh: number; // 61

    onlyBounceBack: boolean; // default false. only use the bounce back to open positions (no immediate RSI values)
    enterLow: number; // default 50. the max RSI value to open a short position
    enterHigh: number; // default 50. the min RSI value to open a long position
    expiry: number; // default = 5 candles. stop waiting for a bounce back if it doesn't happen for "expiry" candles. 0 = disabled
    deleteExpired: boolean; // default true. true = delete expired orders instead of executing them
}

/**
 * Strategy that uses the RSI indicator for scalping - buying/selling on recovery after spikes.
 * Alternatively it will enter the market immediately on higher/lower values.
 */
export default class RSIScalpOrderer extends AbstractOrderer {
    public action: RSIScalpOrdererAction;
    protected lastRSI: number = -1; // identical ro RSI because it's updated on every candle tick
    protected secondLastRSI: number = -1;

    constructor(options) {
        super(options)
        if (!this.action.immediateLow)
            this.action.immediateLow = 38;
        if (!this.action.immediateHigh)
            this.action.immediateHigh = 61;
        if (typeof this.action.onlyBounceBack !== "boolean")
            this.action.onlyBounceBack = false;
        if (!this.action.enterLow)
            this.action.enterLow = 50;
        if (!this.action.enterHigh)
            this.action.enterHigh = 50;

        this.addIndicator("RSI", "RSI", this.action);
        this.addInfo("secondLastRSI", "secondLastRSI");
        this.addInfoFunction("RSI", () => {
            return this.indicators.get("RSI").getValue();
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        let rsi = this.getRSI("RSI")
        const value = rsi.getValue();
        const valueFormatted = Math.round(value * 100) / 100.0;
        this.secondLastRSI = this.lastRSI;
        if (!this.pendingOrder) {
            this.lastRSI = value;
            return; // nothing to do, be quiet
        }
        this.checkBounceBack(); // can set pendingOrder to null
        if (!this.pendingOrder) {
            this.lastRSI = value;
            return; // nothing to do, be quiet
        }

        if (!this.action.onlyBounceBack && value > this.action.immediateHigh) {
            this.log("Immediate UP trend detected, value", valueFormatted, "rate", this.avgMarketPrice.toFixed(8))
            if (this.pendingOrder.action === "buy") {
                this.emitBuy(this.pendingOrder.weight, utils.sprintf("Immediate RSI value: %s - %s", valueFormatted, this.pendingOrder.reason), this.pendingOrder.fromClass, this.pendingOrder.exchange);
                this.pendingOrder = null;
            }
            else if (this.planTrade("sell"))
                this.waitingBounceBack = true;
        }
        else if (value > this.action.high) {
            this.log("UP trend detected, value", valueFormatted, "rate", this.avgMarketPrice.toFixed(8))
            // good to check it here because we don't want to schedule an order if it doesn't match the direction of our main strategy
            if (this.planTrade("sell"))
                this.waitingBounceBack = true;
        }
        else if (!this.action.onlyBounceBack && value < this.action.immediateLow) {
            this.log("Immediate DOWN trend detected, value", valueFormatted, "rate", this.avgMarketPrice.toFixed(8))
            if (this.pendingOrder.action === "sell") {
                this.emitSell(this.pendingOrder.weight, utils.sprintf("Immediate RSI value: %s - %s", valueFormatted, this.pendingOrder.reason), this.pendingOrder.fromClass, this.pendingOrder.exchange);
                this.pendingOrder = null;
            }
            else if (this.planTrade("buy"))
                this.waitingBounceBack = true;
        }
        else if (value < this.action.low) {
            this.log("DOWN trend detected, value", valueFormatted, "rate", this.avgMarketPrice.toFixed(8))
            if (this.planTrade("buy"))
                this.waitingBounceBack = true;
        }
        else
            this.log("no trend detected, value", valueFormatted, "rate", this.avgMarketPrice.toFixed(8))
        this.lastRSI = value;
    }

    protected planTrade(action: TradeAction) {
        return this.pendingOrder.action === action && this.canExecuteTrade(action);
    }

    protected checkBounceBack() {
        if (!this.waitingBounceBack || !this.pendingOrder)
            return;
        let rsi = this.indicators.get("RSI")
        const value = rsi.getValue();
        this.expiryCount--;
        if (this.action.expiry > 0 && this.expiryCount <= 0) {
            if (this.action.deleteExpired) {
                this.log(utils.sprintf("Pending scalper order %s: %s has epxired. Deleting it", this.pendingOrder.action.toUpperCase(), this.pendingOrder.reason));
            }
            else {
                // else execute it now after "expiry" candle ticks
                const msg = utils.sprintf("RSI order expired after %s ticks. current %s, last %s - %s", this.action.expiry, value, this.lastRSI, this.pendingOrder.reason);
                if (this.pendingOrder.action === "buy")
                    this.emitBuy(this.pendingOrder.weight, msg);
                else if (this.pendingOrder.action === "sell")
                    this.emitSell(this.pendingOrder.weight, msg);
            }
            this.pendingOrder = null;
            return;
        }

        // TODO optionally also check avgMarketPrice and last candle
        const valueFormatted = Math.round(value * 100) / 100.0;
        const lastRsiFormatted = Math.round(this.lastRSI * 100) / 100.0;
        let traded = false;
        if (this.pendingOrder.action === "buy" && this.lastRSI < value && value > this.action.enterHigh) {
            this.emitBuy(this.pendingOrder.weight, utils.sprintf("RSI bouncing back UP. current %s, last %s - %s", valueFormatted, lastRsiFormatted, this.pendingOrder.reason), this.pendingOrder.fromClass, this.pendingOrder.exchange);
            traded = true;
        }
        else if (this.pendingOrder.action === "sell" && this.lastRSI > value && value < this.action.enterLow) {
            this.emitSell(this.pendingOrder.weight, utils.sprintf("RSI bouncing back DOWN. current %s, last %s - %s", valueFormatted, lastRsiFormatted, this.pendingOrder.reason), this.pendingOrder.fromClass, this.pendingOrder.exchange);
            traded = true;
        }
        if (traded) {
            this.pendingOrder = null;
            this.waitingBounceBack = false;
        }
    }

    protected canExecuteTrade(action: TradeAction) {
        //if (this.pendingOrder)
            //return false; // don't overwrite scheduled orders
        return true;
    }

    protected resetValues() {
        //this.lastRSI = -1; // don't reset lastRSI
        //this.expiryCount = 0; // only on close
        super.resetValues();
    }
}