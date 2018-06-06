import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, ScheduledTrade, StrategyAction, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import {AbstractOrderer, AbstractOrdererAction} from "./AbstractOrderer";

interface RsiOrdererAction extends AbstractOrdererAction {
    // RSI values
    low: number; // 40 // This strategy will start a buy trade after RSI oversold ends.
    high: number; // 60 // This strategy will start a sell trade after RSI overbought ends.
    immediateLow: number; // 30 // Enter the market in the same direction as the RSI points immediately
    immediateHigh: number; // 70
    interval: number; // optional, default 6

    onlyImmediate: boolean; // default true. If true, this strategy only trades on immediate low/high values. On false it use low/high values to start trades in opposite direction.
    waitBounceBack: boolean; // default true = If true, wait for the RSI to bounce back after reaching the low/high threshold. If false, open position immediately.
    //tradeOnDip: boolean; // default true. This strategy will buy/sell after the RSI value goes above/below immediate low/high again. Otherwise wait for a new trend to start.
    expiry: number; // default = 5 candles. Execute the order after x candles if the threshold isn't reached. 0 = disabled
    deleteExpired: boolean; // default true. If true, delete expired orders instead of executing them after 'expiry' candles have passed.
    deleteOppositeOrders: boolean; // default false. Delete opposite buy/sell orders if immediate thresholds are reached.
}

/**
 * Secondary Strategy that executes buy/sell based on the RSI indicator after overbought/oversold periods.
 * Should be used with a smaller candleSize than the main strategy to execute an order defined by your main strategy.
 * // TODO RSICloser strategy subclass for StopLossTurn to close at the optimal moment
 *
 * "RSIOrderer": {
          "low": 39,
          "high": 60,
          "immediateLow": 38,
          "immediateHigh": 61,
          "waitBounceBack": false,
          "expiry": 20,
          "candleSize": 5,
          "pair": "USD_IOTA",
          "enableLog": true
        },
 */
export default class RSIOrderer extends AbstractOrderer {
    public action: RsiOrdererAction;
    protected lastRSI: number = -1; // identical ro RSI because it's updated on every candle tick
    protected secondLastRSI: number = -1;

    constructor(options) {
        super(options)
        if (typeof this.action.onlyImmediate !== "boolean")
            this.action.onlyImmediate = true;
        if (typeof this.action.waitBounceBack !== "boolean")
            this.action.waitBounceBack = true;
        //if (typeof this.action.tradeOnDip !== "boolean")
            //this.action.tradeOnDip = true;

        this.addIndicator("RSI", "RSI", this.action);
        this.addInfo("secondLastRSI", "secondLastRSI");
        this.addInfoFunction("RSI", () => {
            return this.indicators.get("RSI").getValue();
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        let rsi = this.indicators.get("RSI")
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

        // TODO check for this.action.thresholds.persistence, add a counter
        // buy and sell oders are opposite to the RSI strategy -> this is used by a strategy with larger candleSize, trading with a longer trend
        // simply buy low and sell high
        if (value > this.action.immediateHigh) {
            this.log("Immediate UP trend detected, value", valueFormatted, "rate", this.avgMarketPrice.toFixed(8))
            if (this.pendingOrder.action === "buy") {
                this.emitBuy(this.pendingOrder.weight, utils.sprintf("Immediate RSI value: %s - %s", valueFormatted, this.pendingOrder.reason), this.pendingOrder.fromClass, this.pendingOrder.exchange);
                this.pendingOrder = null;
            }
            else if (this.action.deleteOppositeOrders) {
                this.pendingOrder = null;
                this.log("Deleting SELL order because of immediate UP trend");
            }
        }
        else if (!this.action.onlyImmediate && value > this.action.high) {
            this.log("UP trend detected, value", valueFormatted, "rate", this.avgMarketPrice.toFixed(8))
            if (this.pendingOrder.action === "sell") {
                if (this.action.waitBounceBack)
                    this.waitingBounceBack = true;
                else {
                    this.emitSell(this.pendingOrder.weight, utils.sprintf("RSI value: %s - %s", valueFormatted, this.pendingOrder.reason), this.pendingOrder.fromClass, this.pendingOrder.exchange);
                    this.pendingOrder = null;
                }
            }
        }
        else if (value < this.action.immediateLow) {
            this.log("Immediate DOWN trend detected, value", valueFormatted, "rate", this.avgMarketPrice.toFixed(8))
            if (this.pendingOrder.action === "sell") {
                this.emitSell(this.pendingOrder.weight, utils.sprintf("Immediate RSI value: %s - %s", valueFormatted, this.pendingOrder.reason), this.pendingOrder.fromClass, this.pendingOrder.exchange);
                this.pendingOrder = null;
            }
            else if (this.action.deleteOppositeOrders) {
                this.pendingOrder = null;
                this.log("Deleting BUY order because of immediate DOWN trend");
            }
        }
        else if (!this.action.onlyImmediate && value < this.action.low) {
            this.log("DOWN trend detected, value", valueFormatted, "rate", this.avgMarketPrice.toFixed(8))
            if (this.pendingOrder.action === "buy") {
                if (this.action.waitBounceBack)
                    this.waitingBounceBack = true;
                else {
                    this.emitBuy(this.pendingOrder.weight, utils.sprintf("RSI value: %s - %s", valueFormatted, this.pendingOrder.reason), this.pendingOrder.fromClass, this.pendingOrder.exchange);
                    this.pendingOrder = null;
                }
            }
        }
        else
            this.log("no trend detected, value", value, "rate", this.avgMarketPrice.toFixed(8))
        this.lastRSI = value;
    }

    protected checkBounceBack() {
        if (!this.pendingOrder)
            return;
        let rsi = this.indicators.get("RSI")
        const value = rsi.getValue();
        this.expiryCount--;
        if (this.action.expiry > 0 && this.expiryCount <= 0) { // <= because counter started with order, expiry == 1 means wait at most 1 tick
            if (this.action.deleteExpired) {
                this.log(utils.sprintf("Pending order %s: %s has epxired. Deleting it", this.pendingOrder.action.toUpperCase(), this.pendingOrder.reason));
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
        if (!this.waitingBounceBack)
            return;

        // for sharper scalping to enter the market see RSIScalpOrderer
        if (this.pendingOrder.action === "buy" && this.lastRSI < value)
            this.emitBuy(this.pendingOrder.weight, utils.sprintf("RSI bouncing back UP. current %s, last %s - %s", value, this.lastRSI, this.pendingOrder.reason), this.pendingOrder.fromClass, this.pendingOrder.exchange);
        else if (this.pendingOrder.action === "sell" && this.lastRSI > value)
            this.emitSell(this.pendingOrder.weight, utils.sprintf("RSI bouncing back DOWN. current %s, last %s - %s", value, this.lastRSI, this.pendingOrder.reason), this.pendingOrder.fromClass, this.pendingOrder.exchange);
        this.pendingOrder = null;
    }

    protected resetValues() {
        //this.lastRSI = -1; // don't reset lastRSI
        //this.expiryCount = 0; // only on close
        super.resetValues();
    }
}