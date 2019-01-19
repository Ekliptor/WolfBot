import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import * as _ from "lodash";
import {TradeInfo} from "../Trade/AbstractTrader";

interface TripleTrendAction extends TechnicalStrategyAction {
    // EMA
    CrossMAType: "EMA" | "DEMA" | "SMA"; // default EMA
    shortEma: number; // optional, default 13 - The number of candles to use for the short (fast) moving average.
    longEma: number; // optional, default 48 - The number of candles to use for the long (slow) moving average.

    // ADX
    interval: number; // optional, default 14 - Number of candles to use for ADX indicator.
    adxTrend: number; // optional, default 20 - ADX will be considered trending when above this value.
    adxMaxTrend: number; // optional, default 0 = disabled. ADX must be below this value. This prevents opening a position too late.

    // MACD indicator technical parameters
    short: number; // optional, default 12 - Number of candles for the short EMA line of MACD.
    long: number; // optional, default 26 - Number of candles for the long EMA line of MACD.
    signal: number; // optional, default 9 - Number of candles for the MACD signal line (candles for EMA(short) - EMA(long)).

    closeOppositeCross: boolean; // optional, default true - Close a position when the 2 EMAs cross the other direction.
    initialStop: boolean; // optional, default false - Use the candle high/low of the current candle as initial stop on sell/buy actions.
    stopLongEma: boolean; // optional, default true - Place a trailing stop at the rate of the long EMA.
}

/**
 * A strategy that follows the current market trend by looking at 3 indicators:
 * EMA crossover, ADX and MACD
 * A buy signal occurs when short EMA > long EMA, ADX and MACD histogram are trending up.
 * A sell signal occurs when short EMA < long EMA, ADX and MACD histogram are going down.
 * This strategy closes a position when the 2 EMAs cross the opposite direction. It can be used with an additional stop-loss or take profit strategy.
 * This strategy works well on 1h candles.
 * https://www.forex22.com/forex-strategies/ema-cross-adx-macd/
 * https://docs.google.com/document/d/e/2PACX-1vTPDA6woWwg-X_UKjlkEnPyiDMV_G1lJzM5AWDxY42uNyp6s2ZmwfAqsKlL4YgllMM76PvKd72A0HG8/pub
 */
export default class TripleTrend extends TechnicalStrategy {
    public action: TripleTrendAction;
    protected lastLineDiff: number = 0;

    protected initialStop: number = -1;
    protected lastADX: number = -1; // last values are identical to current because updated on candle tick
    protected lastADXR: number = -1;
    protected secondLastADX: number = -1;
    protected secondLastADXR: number = -1;
    protected adxTrend: Candle.TrendDirection = "none";

    protected histograms: number[] = [];
    protected maxHistogram: number = -1;
    protected lastHistogram: number = -1;
    protected macdTrend: Candle.TrendDirection = "none";

    constructor(options) {
        super(options)
        if (!this.action.CrossMAType)
            this.action.CrossMAType = "EMA";
        if (typeof this.action.shortEma !== "number")
            this.action.shortEma = 13;
        if (typeof this.action.longEma !== "number")
            this.action.longEma = 48;
        if (typeof this.action.interval !== "number")
            this.action.interval = 14;
        if (typeof this.action.adxTrend !== "number")
            this.action.adxTrend = 20;
        if (typeof this.action.adxMaxTrend !== "number")
            this.action.adxMaxTrend = 0;
        if (typeof this.action.short !== "number")
            this.action.short = 12;
        if (typeof this.action.long !== "number")
            this.action.long = 26;
        if (typeof this.action.signal !== "number")
            this.action.signal = 9;
        if (typeof this.action.closeOppositeCross !== "boolean")
            this.action.closeOppositeCross = true;
        if (typeof this.action.initialStop !== "boolean")
            this.action.initialStop = false;
        if (typeof this.action.stopLongEma !== "boolean")
            this.action.stopLongEma = true;

        this.addIndicator("EMA", this.action.CrossMAType, this.getEmaAction());
        this.addIndicator("ADX", "ADX", this.action);
        this.addIndicator("MACD", "MACD", this.action);

        this.addInfo("lastTrend", "lastTrend");
        this.addInfo("lastLineDiff", "lastLineDiff");
        const dema = this.indicators.get("EMA");
        this.addInfoFunction("shortValue", () => {
            return dema.getShortLineValue();
        });
        this.addInfoFunction("longValue", () => {
            return dema.getLongLineValue();
        });
        this.addInfoFunction("EMA line diff", () => {
            return dema.getLineDiff();
        });
        this.addInfoFunction("EMA line diff %", () => {
            return dema.getLineDiffPercent();
        });
        const adx = this.getADX("ADX");
        adx.disableADXR(true);
        this.addInfo("secondLastADX", "secondLastADX");
        this.addInfo("secondLastADXR", "secondLastADXR");
        this.addInfo("adxTrend", "adxTrend");
        this.addInfoFunction("ADX", () => {
            return adx.getADX();
        });
        this.addInfoFunction("+DM", () => {
            return adx.getPlusDM();
        });
        this.addInfoFunction("-DM", () => {
            return adx.getMinusDM();
        });
        this.addInfoFunction("+DI", () => {
            return adx.getPlusDI();
        });
        this.addInfoFunction("-DI", () => {
            return adx.getMinusDI();
        });
        this.addInfoFunction("ADXR", () => {
            return adx.getADXR();
        });
        const macd = this.getMACD("MACD");
        this.addInfo("macdTrend", "macdTrend");
        this.addInfoFunction("MACD", () => {
            return macd.getMACD();
        });
        this.addInfoFunction("Signal", () => {
            return macd.getSignal();
        });
        this.addInfoFunction("Histogram", () => {
            return macd.getHistogram();
        });
        this.addInfoFunction("MACD Change %", () => {
            if (this.maxHistogram === -1)
                return -1;
            return Math.abs(this.maxHistogram - macd.getHistogram()) / this.maxHistogram * 100;
        });

        this.saveState = true;
        this.mainStrategy = true;
    }

    protected tick(trades: Trade.Trade[]): Promise<void> {
        this.checkLongEmaStop();
        if (this.positionOpenTicks > 0)
            this.checkInitialCandleStop();
        return super.tick(trades);
    }

    public serialize() {
        let state = super.serialize();
        state.lastLineDiff = this.lastLineDiff;
        state.initialStop = this.initialStop;
        state.lastADX = this.lastADX;
        state.lastADXR = this.lastADXR;
        state.secondLastADX = this.secondLastADX;
        state.secondLastADXR = this.secondLastADXR;
        state.adxTrend = this.adxTrend;
        state.histograms = this.histograms;
        state.maxHistogram = this.maxHistogram;
        state.lastHistogram = this.lastHistogram;
        state.macdTrend = this.macdTrend;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.lastLineDiff = state.lastLineDiff;
        this.initialStop = state.initialStop;
        this.lastADX = state.lastADX;
        this.lastADXR = state.lastADXR;
        this.secondLastADX = state.secondLastADX;
        this.secondLastADXR = state.secondLastADXR;
        this.adxTrend = state.adxTrend;
        this.histograms = state.histograms;
        this.maxHistogram = state.maxHistogram;
        this.lastHistogram = state.lastHistogram;
        this.macdTrend = state.macdTrend;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            this.initialStop = -1;
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        const dema = this.indicators.get("EMA");
        //const adx = this.getADX("ADX");
        //const macd = this.getMACD("MACD");
        const demaDiff = dema.getLineDiffPercent();
        let upThreshold = this.action.thresholds.up;
        let downThreshold = this.action.thresholds.down;
        this.checkAdx();
        this.checkMacd();
        this.checkEmaCrossStop();

        if (demaDiff > upThreshold) {
            this.log("DEMA UP trend detected, line diff", demaDiff, "persistence", this.action.thresholds.persistence)
            if (this.strategyPosition === "none" && this.adxTrend === "up" && this.macdTrend === "up") {
                this.emitBuy(this.defaultWeight, "DEMA line diff %: " + demaDiff);
            }
            this.lastTrend = "up";
        }
        else if (demaDiff < downThreshold) {
            this.log("DEMA DOWN trend detected, line diff", demaDiff, "persistence", this.action.thresholds.persistence)
            if (this.strategyPosition === "none" && this.adxTrend === "down" && this.macdTrend === "down") {
                this.emitSell(this.defaultWeight, "DEMA line diff %: " + demaDiff);
            }
            this.lastTrend = "down";
        }
        else {
            //this.persistenceCount = 0;
            this.log("no DEMA trend detected, line diff", demaDiff)
        }

        this.lastLineDiff = demaDiff;
    }

    protected checkAdx() {
        const adx = this.getADX("ADX");
        this.secondLastADX = this.lastADX;
        this.secondLastADXR = this.lastADXR;
        let updateLastValues = () => {
            this.lastADX = adx.getADX();
            this.lastADXR = adx.getADXR();
        }

        if (adx.getADX() < this.action.adxTrend || (this.action.adxMaxTrend !== 0 && adx.getADX() > this.action.adxMaxTrend)) {
            updateLastValues();
            return; // we are not in a trend, don't open a position
        }

        const adxMsg = utils.sprintf("ADX %s (last %s), +DI %s, -DI %s", adx.getADX().toFixed(2), this.secondLastADX.toFixed(2),
            adx.getPlusDI().toFixed(2), adx.getMinusDI().toFixed(2))
        if (adx.getPlusDI() > adx.getMinusDI()/* && adx.getADX() > this.secondLastADX*/) {
            this.log("ADX UP trend detected,", adxMsg)
            this.adxTrend = "up";
            if (this.initialStop === -1)
                this.initialStop = this.candle.low;
        }
        else if (adx.getMinusDI() > adx.getPlusDI()/* && adx.getADX() > this.secondLastADX*/) {
            this.log("ADX DOWN trend detected,", adxMsg)
            this.adxTrend = "down";
            if (this.initialStop === -1)
                this.initialStop = this.candle.high;
        }
        else {
            this.log("no ADX trend detected,", adxMsg)
            this.adxTrend = "none";
        }
        updateLastValues();
    }

    protected checkMacd() {
        const macd = this.getMACD("MACD");
        const histogram = macd.getHistogram();
        this.setMaxHistogram(histogram);
        // we use the max histogram and check the % change. this means on highly volatile markets (1 candle up, 1 candle down) our MACD won't open a position
        const changePercent = Math.abs(this.maxHistogram - histogram) / this.maxHistogram * 100;
        const histogramChangeTxt = utils.sprintf("Change %s%%", changePercent.toFixed(3));

        if (histogram > 0.0 && changePercent > this.action.thresholds.up*100) { // we use % instead of absolute values here
            //this.persistenceCount++;
            this.log("MACD UP trend detected, histogram", histogram, "last", this.lastHistogram, histogramChangeTxt)
            this.macdTrend = "up";
        }
        else if (histogram < 0.0 && changePercent > this.action.thresholds.down*-100) {
            //this.persistenceCount++;
            this.log("MACD DOWN trend detected, histogram", histogram, "last", this.lastHistogram, histogramChangeTxt)
            this.macdTrend = "down";
        }
        else {
            //this.persistenceCount = 0;
            this.log(utils.sprintf("no MACD trend detected, histogram %s, %s, last %s", histogram, histogramChangeTxt, this.lastHistogram))
            this.macdTrend = "none";
        }

        this.lastHistogram = histogram;
    }

    protected checkEmaCrossStop() {
        if (this.action.closeOppositeCross !== true)
            return;
        const dema = this.indicators.get("EMA");
        const emaDiff = dema.getLineDiff();
        if (this.strategyPosition === "long" && emaDiff < 0.0)
            this.emitClose(Number.MAX_VALUE, "EMA cross stop for long position reached, value " + emaDiff.toFixed(8));
        else if (this.strategyPosition === "short" && emaDiff > 0.0)
            this.emitClose(Number.MAX_VALUE, "EMA cross stop for short position reached, value"  + emaDiff.toFixed(8));
    }

    protected checkInitialCandleStop() {
        if (this.action.initialStop !== true || !this.candle)
            return;
        if (this.strategyPosition === "long" && this.candle.close < this.initialStop) {
            this.emitClose(Number.MAX_VALUE, "initial long stop reached, value " + this.initialStop.toFixed(8));
        }
        else if (this.strategyPosition === "short" && this.candle.close > this.initialStop) {
            this.emitClose(Number.MAX_VALUE, "initial short stop reached, value"  + this.initialStop.toFixed(8));
        }
    }

    protected checkLongEmaStop() {
        if (this.action.stopLongEma !== true)
            return;
        const dema = this.indicators.get("EMA");
        const stop = dema.getLongLineValue();
        if (this.strategyPosition === "long" && this.candle.close < stop) {
            this.emitClose(Number.MAX_VALUE, "long EMA for long position reached, value " + stop.toFixed(8));
        }
        else if (this.strategyPosition === "short" && this.candle.close > stop) {
            this.emitClose(Number.MAX_VALUE, "long EMA for short position reached, value"  + stop.toFixed(8));
        }
    }

    protected setMaxHistogram(max: number) {
        max = Math.abs(max);
        this.histograms.push(max);
        if (this.histograms.length > this.action.long)
            this.histograms.shift();
        //this.maxHistogram = _.max(this.histograms); // use avg to react faster
        let sum = 0;
        for (let i = 0; i < this.histograms.length; i++)
            sum += this.histograms[i];
        this.maxHistogram = sum / this.histograms.length;
    }

    protected getEmaAction() {
        let action = this.action;
        action.long = this.action.longEma;
        action.short = this.action.shortEma;
        return action;
    }
}