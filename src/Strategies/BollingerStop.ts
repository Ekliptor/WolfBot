import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {AbstractStopStrategy, AbstractStopStrategyAction} from "./AbstractStopStrategy";

export interface BollingerStopAction extends AbstractStopStrategyAction {
    time: number; // wait seconds before closing the position, optional
    percentReached: number; // 0.05, optional, a number indicating how close to the band the rate has to be to consider it "reached". increase it for "opposite" stop
    stopBand: "middle" | "opposite"; // optional, default "middle"
    delayTicks: number; // optional, default 1. delay setting the stop for x candle ticks to avoid stopping immediately
    notifyBeforeStopSec: number; // optional, notify seconds before the stop executes
    keepPriceOpen: boolean; // default true. keep the position open if the last candle close price was higher/lower than the current rate

    // optional, for defaults see BolloingerBandsParams
    N: number; // time period for MA
    K: number; // factor for upper/lower band
    MAType: number; // moving average type, 0 = SMA

    // we work with a larger candle size (1h), so not closing based on RSI or candle trend is a risky idea as it might cause much higher losses
}

/**
 * Strategy that closes a position if we reach the middle line of Bollinger for "time" seconds.
 * Works well with 1 hour candles.
 *
 * "BollingerStop": {
          "time": 3600,
          "notifyBeforeStopSec": 900,
          "stopBand": "opposite",
          "delayTicks": 2,
          "candleSize": 60,
          "pair": "BTC_ETH",
          "enableLog": false
        }
 */
export default class BollingerStop extends AbstractStopStrategy {
    public action: BollingerStopAction;
    protected stop = -1;

    constructor(options) {
        super(options)
        //this.addIndicator("BollingerBands", "BollingerBands", this.action); // already added in parent
        if (!this.action.percentReached)
            this.action.percentReached = 0.05;
        if (!this.action.stopBand)
            this.action.stopBand = "middle";
        if (typeof this.action.delayTicks !== "number")
            this.action.delayTicks = 1;
        if (typeof this.action.keepPriceOpen !== "boolean")
            this.action.keepPriceOpen = true;

        this.addInfo("stop", "stop")
        this.addInfo("positionOpenTicks", "positionOpenTicks")
        let bollinger = this.getBollinger("BollingerBands")
        this.addInfoFunction("%b", () => {
            if (!this.candle)
                return -1;
            return bollinger.getPercentB(this.candle.close);
        });
        this.addInfoFunction("Bandwidth", () => {
            return bollinger.getBandwidth();
        });
        this.addInfoFunction("BandwidthAvgFactor", () => {
            return bollinger.getBandwidthAvgFactor();
        });
        this.addInfoFunction("upperValue", () => {
            return bollinger.getUpperValue();
        });
        this.addInfoFunction("middleValue", () => {
            return bollinger.getMiddleValue();
        });
        this.addInfoFunction("lowerValue", () => {
            return bollinger.getLowerValue();
        });
        this.saveState = true;
    }

    public serialize() {
        let state = super.serialize();
        state.stop = this.stop;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.stop = state.stop;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            if (this.strategyPosition !== "none" && this.stop !== -1) {
                if (this.action.delayTicks > 0 && this.positionOpenTicks < this.action.delayTicks)
                    this.logOnce(utils.sprintf("Skipped checking close %s at %s because position is only open for %s candle ticks", this.strategyPosition.toUpperCase(), this.stop.toFixed(8), this.positionOpenTicks))
                //else if (this.action.order === "sell" || this.action.order === "closeLong")
                else if (this.strategyPosition === "long")
                    this.checkStopSell();
                else if (this.strategyPosition === "short")
                    this.checkStopBuy();
            }
            super.tick(trades).then(() => {
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected checkIndicators() {
        this.checkStopIndicators();
    }

    protected checkStopIndicators() { // called from subclasses too
        let bollinger = this.getBollinger("BollingerBands")
        /*
        let value = bollinger.getPercentB(this.candle.close)
        if (value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) {
            this.log("fast moving market (consider increasing candleSize), no trend detected, percent b value", value)
            return;
        }
        */

        if (this.strategyPosition === "long") {
            this.stop = this.action.stopBand === "middle" ? bollinger.getMiddleValue() : bollinger.getLowerValue();
            if (this.stop > this.entryPrice)
                this.stop = this.entryPrice;
            else if (this.action.percentReached > 0.0)
                this.stop = this.stop + this.stop / 100.0 * this.action.percentReached; // stop before = above
        }
        else if (this.strategyPosition === "short") {
            this.stop = this.action.stopBand === "middle" ? bollinger.getMiddleValue() : bollinger.getUpperValue();
            if (this.stop < this.entryPrice)
                this.stop = this.entryPrice;
            else if (this.action.percentReached > 0.0)
                this.stop = this.stop - this.stop / 100.0 * this.action.percentReached; // stop before = below
        }
    }

    protected checkStopSell() {
        if (this.avgMarketPrice > this.getStopPrice()) {
            if (this.action.time)
                this.stopCountStart = null;
            this.stopNotificationSent = false;
            return;
        }
        //const lastCandle = this.getCandleAt(1); // use last candle from indicator calc, this would be 2nd last
        if (!this.stopCountStart)
            this.stopCountStart = this.marketTime;
        // must come first to prevent sending notification too late
        else if (this.action.notifyBeforeStopSec && !this.stopNotificationSent && this.getTimeUntilStopSec() > 0 && this.getTimeUntilStopSec() < this.action.notifyBeforeStopSec)
            this.sendStopNotification();
        //else if (this.action.keepTrendOpen === true && this.candleTrend === "up")
            //return this.logOnce("skipping stop SELL because candle trend is up %", this.candle.getPercentChange());
        //else if (this.lastRSI !== -1 && this.lastRSI > this.action.high)
            //return this.logOnce("skipping stop SELL because RSI value indicates up:", this.lastRSI);
        else if (this.action.keepPriceOpen === true && this.candle && this.candle.close < this.avgMarketPrice)
            return this.logOnce(utils.sprintf("skipping stop SELL because last candle %s less than current rate %s", this.candle.close.toFixed(8), this.avgMarketPrice.toFixed(8)));
        else if (this.stopCountStart.getTime() + this.getStopTimeSec() * 1000 <= this.marketTime.getTime())
            this.closeLongPosition();
    }

    protected checkStopBuy() {
        if (this.avgMarketPrice < this.getStopPrice()) {
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
        //else if (this.action.keepTrendOpen === true && this.candleTrend === "down")
            //return this.logOnce("skipping stop BUY because candle trend is down %", this.candle.getPercentChange());
        //else if (this.lastRSI !== -1 && this.lastRSI < this.action.low)
            //return this.logOnce("skipping stop BUY because RSI value indicates down:", this.lastRSI);
        else if (this.action.keepPriceOpen === true && this.candle && this.candle.close > this.avgMarketPrice)
            return this.logOnce(utils.sprintf("skipping stop BUY because last candle %s greater than current rate %s", this.candle.close.toFixed(8), this.avgMarketPrice.toFixed(8)));
        else if (this.stopCountStart.getTime() + this.getStopTimeSec() * 1000 <= this.marketTime.getTime())
            this.closeShortPosition();
    }

    protected closeLongPosition() {
        this.log("emitting sell because price dropped to", this.avgMarketPrice, "stop", this.getStopPrice(), "%b", this.getPercentBDisplay());
        this.emitSellClose(Number.MAX_VALUE, this.getCloseReason(true));
        this.done = true;
    }

    protected closeShortPosition() {
        this.log("emitting buy because price rose to", this.avgMarketPrice, "stop", this.getStopPrice(), "%b", this.getPercentBDisplay());
        this.emitBuyClose(Number.MAX_VALUE, this.getCloseReason(false));
        this.done = true;
    }

    protected getCloseReason(closeLong: boolean) {
        return utils.sprintf("%s, %%b value %s", super.getCloseReason(closeLong), this.getPercentBDisplay());
    }

    protected getStopPrice() { // getStopSell() and getStopBuy()
        return this.stop;
    }

    protected getPercentBDisplay() {
        if (!this.candle)
            return -1;
        let bollinger = this.getBollinger("BollingerBands")
        const value = bollinger.getPercentB(this.candle.close)
        return Math.round(value * 100) / 100.0;
    }

    protected resetValues() {
        this.stop = -1;
        this.positionOpenTicks = -1; // reset it after every trade. good?
        if (this.action.time)
            this.stopCountStart = null;
        else
            this.stopCountStart = new Date(0);
        super.resetValues();
    }
}