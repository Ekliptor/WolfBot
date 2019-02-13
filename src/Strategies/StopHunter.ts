import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import * as helper from "../utils/helper";
import {VolumeProfileBar} from "../Indicators/VolumeProfile";


interface StopHunterAction extends TechnicalStrategyAction {
    candleTailPercent: number; // optional, default 20% - The minimum percentage relative to the candle body ( abs(open - close) ) the candle high/low has to be long.
    CrossMAType: "EMA" | "DEMA" | "SMA"; // optional, default EMA - The indicator to use to look for line cross signals to identify an up/down trend. Values: EMA|DEMA|SMA
    short: number; // optional, default 7 - The number of candles for the short moving average.
    long: number; // optional, default 30 - The number of candles for the long moving average.
    interval: number; // optional, default 24 - The number of candles to compute the average volume from and to check for price highs/lows.
    minVolumeSpike: number; // optional, default 1.5 - The min volume compared to the average volume of the last 'interval' candles to open a position.
}

/**
 * Strategy that keeps track of price highs and lows and opens a position with the current market trend after a possible stop-loss hunt
 * took place. A stop-loss hunt is detected by a high volume candle with a long tail making a new price high/low.
 * The current market trend is detected by the crossing of 2 EMAs.
 * This is a medium/ designed for 60min candles in trending markets.
 * This strategy only opens positions. You need a stop-loss and/or take profit strategy.
 */
export default class StopHunter extends TechnicalStrategy {
    public action: StopHunterAction;
    protected low: Candle.Candle = null;
    protected high: Candle.Candle = null;

    constructor(options) {
        super(options)
        if (typeof this.action.candleTailPercent !== "number")
            this.action.candleTailPercent = 20;
        if (typeof this.action.CrossMAType !== "string")
            this.action.CrossMAType = "EMA";
        if (typeof this.action.short !== "number")
            this.action.short = 7;
        if (typeof this.action.long !== "number")
            this.action.long = 30;
        if (typeof this.action.interval !== "number")
            this.action.interval = 24;
        if (typeof this.action.minVolumeSpike !== "number")
            this.action.minVolumeSpike = 1.5;

        this.addIndicator("EMA", this.action.CrossMAType, this.action);
        this.addIndicator("AverageVolume", "AverageVolume", this.action);

        this.addInfo("low", "low");
        this.addInfo("high", "high");
        const ema = this.indicators.get("EMA");
        const averageVolume = this.getVolume("AverageVolume");
        this.addInfoFunction("shortValue", () => {
            return ema.getShortLineValue();
        });
        this.addInfoFunction("longValue", () => {
            return ema.getLongLineValue();
        });
        this.addInfoFunction("line diff", () => {
            return ema.getLineDiff();
        });
        this.addInfoFunction("line diff %", () => {
            return ema.getLineDiffPercent();
        });
        this.addInfoFunction("AverageVolume", () => {
            return averageVolume.getValue();
        });
        this.addInfoFunction("VolumeFactor", () => {
            return averageVolume.getVolumeFactor();
        });
        this.saveState = true;
        this.mainStrategy = true;
    }

    public serialize() {
        let state = super.serialize();
        state.low = this.low;
        state.high = this.high;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.low = state.low;
        this.high = state.high;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        //const averageVolume = this.getVolume("AverageVolume");
        //const ema = this.indicators.get("EMA");

        if (this.strategyPosition !== "none")
            return;

        if (this.isSufficientVolume() === false)
            this.log("Insufficient volume for a stop-loss hunt " + this.getVolumeStr());
        else if (this.isUpTrend() === true) {
            const low = this.getPriceLow();
            if (this.isSufficientTail(this.candle, true) === false)
                this.log("Insufficient candle tail to go long in uptrend");
            else if (this.candle.equals(low) === false)
                this.log("Not at lowest candle to go long in uptrend");
            else
                this.emitBuy(this.defaultWeight, utils.sprintf("Going LONG after stop-loss hunt in uptrend on candle %s, vol: %s", this.candle.toString(), this.getVolumeStr()));
        }
        else {
            const high = this.getPriceHigh();
            if (this.isSufficientTail(this.candle, false) === false)
                this.log("Insufficient candle tail to go short in uptrend");
            else if (this.candle.equals(high) === false)
                this.log("Not at highest candle to go short in downtrend");
            else
                this.emitSell(this.defaultWeight, utils.sprintf("Going SHORT after stop-loss hunt in downtrend on candle %s, vol: %s", this.candle.toString(), this.getVolumeStr()));
        }
    }

    protected getPriceHigh() {
        let max = 0.0, index = 0;
        for (let i = 0; i < this.action.interval && i < this.candleHistory.length; i++)
        {
            if (this.candleHistory[i].high > max) {
                max = this.candleHistory[i].high;
                index = i;
            }
        }
        return this.candleHistory[index];
    }

    protected getPriceLow() {
        let min = Number.MAX_VALUE, index = 0;
        for (let i = 0; i < this.action.interval && i < this.candleHistory.length; i++)
        {
            if (this.candleHistory[i].low < min) {
                min = this.candleHistory[i].low;
                index = i;
            }
        }
        return this.candleHistory[index];
    }

    protected isSufficientTail(candle: Candle.Candle, high: boolean) {
        const bodySize = Math.abs(candle.open - candle.close);
        if (bodySize <= 0.0)
            return false; // shouldn't happen
        if (high === true) {
            const percentUp = Math.abs(candle.high - candle.close) / bodySize * 100.0;
            return percentUp >= this.action.candleTailPercent;
        }
        const percentDown = Math.abs(candle.close - candle.low) / bodySize * 100.0;
        return percentDown >= this.action.candleTailPercent;
    }

    protected isUpTrend() {
        const ema = this.indicators.get("EMA");
        return ema.getLineDiff() > 0.0;
    }

    protected isSufficientVolume() {
        if (this.action.minVolumeSpike == 0.0)
            return true; // disabled
        let averageVolume = this.getVolume("AverageVolume")
        return averageVolume.getVolumeFactor() >= this.action.minVolumeSpike;
    }

    protected getVolumeStr() {
        let averageVolume = this.getVolume("AverageVolume");
        return utils.sprintf("%s %s, spike %sx", averageVolume.getValue().toFixed(8), this.action.pair.getBase(), averageVolume.getVolumeFactor().toFixed(8));
    }
}