import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, ScheduledTrade} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {AbstractTurnStrategy} from "./AbstractTurnStrategy";


interface TrendOscillatorAction extends TechnicalStrategyAction {
    CrossMAType: "EMA" | "DEMA" | "SMA" | "WMA"; // default EMA
    short: number;
    long: number;

    // strategy config when to go long/short
    low: number; // default 10 // Go long if STC goes up from this value.
    high: number; // default 90 // Go short if STC goes down from this value.
    closePositions: boolean; // default true. Close existing positions if an opposite signal occurs.

    // STC indicator config (optional)
    fast: number; // default 23, The number of fast EMA candles.
    slow: number; // default 50, The number of slow EMA candles.
    stcLength: number; // default 10, How many candles STC will keep to compute MACD signal and STC candle data.
    factor: number; // default 0.5, should be <= 1.0. A lower value means STC will forget historic data faster and be more responsive, thus doing more trades.
}

/**
 * Strategy that first checks for the current market trend using EMA crossover strategy.
 * It then emits buy/sell based on the Schaff Trend Cycle to only trade with the current trend. STC is a faster version of MACD that oscillates between 0 and 100.
 * Sell signals are given when STC goes down from a high and buy signals when it comes up from a low.
 * This strategy also closes positions if an opposite trade signal occurs.
 */
export default class TrendOscillator extends AbstractTurnStrategy {
    public action: TrendOscillatorAction;
    protected lastSTC: number = -1; // identical ro OBV because it's updated on every candle tick
    protected secondLastSTC: number = -1;
    protected demaTrend: Candle.TrendDirection = "none";

    constructor(options) {
        super(options)
        if (!this.action.CrossMAType)
            this.action.CrossMAType = "EMA";
        if (typeof this.action.short !== "number")
            this.action.short = 7;
        if (typeof this.action.long !== "number")
            this.action.long = 30;
        if (!this.action.low)
            this.action.low = 10;
        if (!this.action.high)
            this.action.high = 90;
        if (typeof this.action.closePositions !== "boolean")
            this.action.closePositions = true;
        this.addIndicator("EMA", this.action.CrossMAType, this.action);
        this.addIndicator("STC", "STC", this.action);

        const ema = this.indicators.get("EMA");
        this.addInfo("secondLastSTC", "secondLastSTC");
        this.addInfo("demaTrend", "demaTrend");
        this.addInfoFunction("STC", () => {
            return this.indicators.get("STC").getValue();
        });
        this.addInfoFunction("emaDiff", () => {
            return ema.getLineDiff();
        });
        this.addInfoFunction("emaDiffPercent", () => {
            return ema.getLineDiffPercent();
        });
        this.addInfoFunction("emaShort", () => {
            return ema.getShortLineValue();
        });
        this.addInfoFunction("emaLong", () => {
            return ema.getLongLineValue();
        });
        this.saveState = true;
        this.mainStrategy = true;
    }

    public serialize() {
        let state = super.serialize();
        state.lastSTC = this.lastSTC;
        state.secondLastSTC = this.secondLastSTC;
        state.demaTrend = this.demaTrend;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.lastSTC = state.lastSTC;
        this.secondLastSTC = state.secondLastSTC;
        this.demaTrend = state.demaTrend;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]): Promise<void> {
        return super.tick(trades);
    }

    protected checkIndicators() {
        this.plotChart();
        let stc = this.indicators.get("STC")
        const value = stc.getValue();
        const valueFormatted = Math.round(value * 100) / 100.0;
        this.secondLastSTC = this.lastSTC;
        const valueFormatted2nd = Math.round(this.secondLastSTC * 100) / 100.0;
        const ema = this.indicators.get("EMA");
        const emaDiff = ema.getLineDiffPercent();
        const emaDiffFormatted = Math.round(emaDiff * 100) / 100.0;

        // first check our EMA cross
        if (emaDiff > this.action.thresholds.up) { // UP trend
            this.demaTrend = "up";
            this.log(utils.sprintf("%s UP trend detected, value %s", this.action.CrossMAType, emaDiffFormatted));
        }
        else if (emaDiff < this.action.thresholds.down) { // DOWN trend
            this.demaTrend = "down";
            this.log(utils.sprintf("%s DOWN trend detected, value %s", this.action.CrossMAType, emaDiffFormatted));
        }
        else {
            this.demaTrend = "none";
            this.log(utils.sprintf("No %s trend detected, value %s", this.action.CrossMAType, emaDiffFormatted));
        }

        // then trade by STC. EMA will cancel opposite trade signals in emitClose()
        // TODO add option to pasue trading x ticks after a loss trade?
        if (this.secondLastSTC > this.action.high && value <= this.action.high) {
            // go short
            const reason = utils.sprintf("STC value passing high threshold DOWN. prev %s, current %s", valueFormatted2nd, valueFormatted);
            this.log(reason);
            if (this.strategyPosition === "none" || (this.strategyPosition === "long" && this.action.closePositions === true))
                this.openShort(reason);
        }
        else if (this.secondLastSTC < this.action.low && value >= this.action.low) {
            // go long
            const reason = utils.sprintf("STC value passing low threshold UP. prev %s, current %s", valueFormatted2nd, valueFormatted);
            this.log(reason);
            if (this.strategyPosition === "none" || (this.strategyPosition === "short" && this.action.closePositions === true))
                this.openLong(reason);
        }
        else
            this.log("No oscillator trend swing detected, STC", valueFormatted)

        this.lastSTC = value;
    }

    protected emitClose(weight: number, reason: string, fromClass = "", exchange: Currency.Exchange = Currency.Exchange.ALL): void {
        if (this.scheduledEnterMarketOnTick != null) {
            if (this.scheduledEnterMarketOnTick.action === "buy" && this.demaTrend === "down") {
                this.log(utils.sprintf("Cancelling %s action because %s is %s", this.scheduledEnterMarketOnTick.action.toUpperCase(), this.action.CrossMAType, this.demaTrend.toUpperCase()));
                this.scheduledEnterMarketOnTick = null;
                this.emitScheduledEvent = false;
            }
            else if (this.scheduledEnterMarketOnTick.action === "sell" && this.demaTrend === "up") {
                this.log(utils.sprintf("Cancelling %s action because %s is %s", this.scheduledEnterMarketOnTick.action.toUpperCase(), this.action.CrossMAType, this.demaTrend.toUpperCase()));
                this.scheduledEnterMarketOnTick = null;
                this.emitScheduledEvent = false;
            }
        }
        super.emitClose(weight, reason, fromClass, exchange);
    }

    protected plotChart() {
        /*
        let stc = this.indicators.get("STC")
        const value = stc.getValue();
        const valueFormatted = Math.round(value * 100) / 100.0;
         */
        const ema = this.indicators.get("EMA");
        this.plotData.plotMark({
            shortEMA: ema.getShortLineValue(),
            longEMA: ema.getLongLineValue()
        });
        /*
        this.plotData.plotMark({
            STC: valueFormatted
        }, true);*/
    }
}
