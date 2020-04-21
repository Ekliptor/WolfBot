import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {AbstractStopStrategy, AbstractStopStrategyAction} from "./AbstractStopStrategy";
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import * as helper from "../utils/helper";
import {MarginPosition} from "../structs/MarginPosition";

interface SARStopAction extends AbstractStopStrategyAction {
    initialStop: boolean; // optional, default false // Use the candle high/low of the current candle when opening a position as an initial stop.

    // SAR params (optional)
    accelerationFactor: number; // default 0.02 // SAR indicator Acceleration Factor used up to the Maximum value.
    accelerationMax: number; // default 0.2 // SAR indicator Acceleration Factor Maximum value.

    time: number; // in seconds, optional // The time until the stop gets executed.
    // close early if the last high/low is x minutes back (instead of waiting for the stop to trigger)
    keepTrendOpen: boolean; // optional, default true, Don't close if the last candle moved in our direction (only applicable with 'time' and 'candleSize' set).
}

/**
 * A stop loss strategy that uses the Parabolic SAR as a trailing stop. Works great with every other strategy.
 * Increase the acceleration factor for tighter stops if you are doing many trades per day.
 */
export default class SARStop extends AbstractStopStrategy {
    public action: SARStopAction;
    protected initialStop: number = -1;
    protected trailingStopPrice: number = -1;
    //protected priceTime: Date = new Date(Date.now() +  365*utils.constants.DAY_IN_SECONDS * 1000); // time of the last high/low
    //protected lastRSI: number = -1; // identical ro RSI because it's updated on every candle tick

    constructor(options) {
        super(options)
        if (typeof this.action.initialStop !== "boolean")
            this.action.initialStop = false;
        if (!this.action.time)
            this.stopCountStart = new Date(0); // sell immediately
        if (this.action.keepTrendOpen === undefined)
            this.action.keepTrendOpen = true;
        //if (!this.action.interval)
            //this.action.interval = 9; // for RSI

        //if (this.action.low > 0 && this.action.high > 0)
            //this.addIndicator("RSI", "RSI", this.action);
        this.addIndicator("SAR", "SAR", this.action);

        //this.addInfo("highestPrice", "highestPrice");
        //this.addInfo("lowestPrice", "lowestPrice");
        this.addInfoFunction("stop", () => {
            return this.getStopPrice();
        });
        this.addInfoFunction("untilStopSec", () => {
            return this.getTimeUntilStopSec();
        });
        this.addInfo("stopCountStart", "stopCountStart");
        this.addInfo("entryPrice", "entryPrice");

        this.addInfoFunction("ParabolicSAR", () => {
            return this.indicators.get("SAR").getValue();
        });
        this.addInfoFunction("InitialStop", () => {
            return this.initialStop;
        });

        /*
        if (this.action.low > 0 && this.action.high > 0) {
            this.addInfoFunction("RSI", () => {
                return this.indicators.get("RSI").getValue();
            });
        }
        */

        this.saveState = true;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action !== "close" && this.initialStop === -1 && this.candle)
            this.initialStop = action === "buy" ? this.candle.low : this.candle.high;
        if (action === "close") {
            this.initialStop = -1;
            this.trailingStopPrice = -1;
        }
    }

    public onSyncPortfolio(coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange) {
        super.onSyncPortfolio(coins, position, exchangeLabel)
        if (this.strategyPosition === "none") {
            this.initialStop = -1;
            this.trailingStopPrice = -1;
        }
    }

    public serialize() {
        let state = super.serialize();
        state.initialStop = this.initialStop;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.initialStop = state.initialStop;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            if (this.done)
                return resolve();

            if (this.strategyPosition !== "none") {
                if (this.isCloseLongPending() === true)
                    this.checkStopSell();
                else if (this.isCloseShortPending() === true)
                    this.checkStopBuy();
            }
            super.tick(trades).then(() => {
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            super.candleTick(candle).then(() => { // call parent function to update indicator values before executing code in this class
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected checkIndicators() {
        this.checkStop();
    }

    protected checkStop() {
        // here we just update our stop and let the timeout in the strategy close the position
        if (this.action.initialStop === true && this.initialStop !== -1) {
            if (this.strategyPosition === "long" && this.candle.close < this.initialStop) {
                this.log("initial long stop reached, value " + this.initialStop.toFixed(8));
                this.trailingStopPrice = this.initialStop;
                //this.strategyPosition = "none"; // to prevent the strategy being stuck // Backtester can sync state now too
            }
            else if (this.strategyPosition === "short" && this.candle.close > this.initialStop) {
                this.log("initial short stop reached, value"  + this.initialStop.toFixed(8));
                this.trailingStopPrice = this.initialStop;
                //this.strategyPosition = "none";
            }
        }

        // use SAR as trailing stop
        let sar = this.indicators.get("SAR")
        if (this.strategyPosition === "long" && this.candle.close < sar.getValue()) {
            this.log("SAR long stop reached, value " + sar.getValue().toFixed(8));
            this.trailingStopPrice = sar.getValue();
            //this.strategyPosition = "none";
        }
        else if (this.strategyPosition === "short" && this.candle.close > sar.getValue()) {
            this.log("SAR short stop reached, value " + sar.getValue().toFixed(8));
            this.trailingStopPrice = sar.getValue();
            //this.strategyPosition = "none";
        }
    }

    protected checkStopSell() {
        if (this.avgMarketPrice > this.getStopSell()) {
            if (this.action.time)
                this.stopCountStart = null;
            this.stopNotificationSent = false;
            return;
        }
        if (!this.stopCountStart)
            this.stopCountStart = this.marketTime;
        // must come first to prevent sending notification too late
        else if (this.action.notifyBeforeStopSec && !this.stopNotificationSent && this.getTimeUntilStopSec() > 0 && this.getTimeUntilStopSec() < this.action.notifyBeforeStopSec)
            this.sendStopNotification();
        else if (this.action.keepTrendOpen === true && this.candleTrend === "up")
            return this.logOnce("skipping stop SELL because candle trend is up %", this.candle.getPercentChange());
        //else if (this.lastRSI !== -1 && this.lastRSI > this.action.high)
            //return this.logOnce("skipping stop SELL because RSI value indicates up:", this.lastRSI);
        else if (this.stopCountStart.getTime() + this.getStopTimeSec() * 1000 <= this.marketTime.getTime())
            this.closeLongPosition();
    }

    protected checkStopBuy() {
        if (this.avgMarketPrice < this.getStopBuy()) {
            if (this.action.time)
                this.stopCountStart = null;
            this.stopNotificationSent = false;
            return;
        }
        if (!this.stopCountStart)
            this.stopCountStart = this.marketTime;
        // must come first to prevent sending notification too late
        else if (this.action.notifyBeforeStopSec && !this.stopNotificationSent && this.getTimeUntilStopSec() > 0 && this.getTimeUntilStopSec() < this.action.notifyBeforeStopSec)
            this.sendStopNotification();
        else if (this.action.keepTrendOpen === true && this.candleTrend === "down")
            return this.logOnce("skipping stop BUY because candle trend is down %", this.candle.getPercentChange());
        //else if (this.lastRSI !== -1 && this.lastRSI < this.action.low)
            //return this.logOnce("skipping stop BUY because RSI value indicates down:", this.lastRSI);
        else if (this.stopCountStart.getTime() + this.getStopTimeSec() * 1000 <= this.marketTime.getTime())
            this.closeShortPosition();
    }

    protected closeLongPosition() {
        this.log("emitting sell because price dropped to", this.avgMarketPrice, "stop", this.getStopSell());
        this.emitSellClose(Number.MAX_VALUE, this.getCloseReason(true) + (this.profitTriggerReached ? ", profit triggered" : ""));
        this.done = true;
    }

    protected closeShortPosition() {
        this.log("emitting buy because price rose to", this.avgMarketPrice, "stop", this.getStopBuy());
        this.emitBuyClose(Number.MAX_VALUE, this.getCloseReason(false) + (this.profitTriggerReached ? ", profit triggered" : ""));
        this.done = true;
    }

    protected getStopSell() {
        if (this.trailingStopPrice !== -1)
            return this.trailingStopPrice;
        return 0.0;
    }

    protected getStopBuy() {
        if (this.trailingStopPrice !== -1)
            return this.trailingStopPrice;
        return Number.MAX_VALUE;
    }

    protected getStopPrice() {
        if (this.isCloseLongPending() === true)
            return this.getStopSell()
        return this.getStopBuy()
    }

    protected getStopTimeSec() {
        return super.getStopTimeSec();
    }

    protected resetValues() {
        if (this.action.time)
            this.stopCountStart = null;
        else
            this.stopCountStart = new Date(0);
        super.resetValues();
    }
}
