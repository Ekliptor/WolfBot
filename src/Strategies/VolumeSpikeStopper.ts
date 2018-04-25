import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {TradeDirection} from "../Trade/AbstractTrader";
import {AbstractMomentumAction, AbstractMomentumStrategy} from "./AbstractMomentumStrategy";
import {default as VolumeSpikeDetector, VolumeSpikeAction} from "./VolumeSpikeDetector";

interface VolumeSpikeStopperAction extends VolumeSpikeAction {
    spikeFactor: number; // 1.7 // as x times higher/lower as avg
    // not used here
    //minVolBtc: number; // 1.2 // minVol for current candle and avg in BTC to prevent spikes from 0 trading volume
    //historyCandle: number; // optional, default 36. how many candles to look back to compare if price/volume really is a spike. set 0 to disable it

    //tradeDirection: TradeDirection; // optional. default "up"
    //tradeOppositeDirection: boolean; // optional. default "false" = don't trade if we have an open position in the other direction
    //strongRate: boolean; // optional. default true = adjust the rate to ensure the order gets filled immediately
}

/**
 * VolumeSpikeDetector version that closes a position immediately if there is a huge spike in volume (somebody dropping/buying lots of money).
 * Works well on 30min candle size.
 */
export default class VolumeSpikeStopper extends VolumeSpikeDetector {
    protected action: VolumeSpikeStopperAction;

    constructor(options) {
        super(options)
        this.saveState = true;
    }

    // TODO count volume in candleTick() to react faster? see PriceSpikeDetector

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkVolumeSpike(candle: Candle.Candle) {
        // simpler version than parent class without
        // - checking for min BTC trading volume
        // - checking for price
        // - any further history candle comparisons
        if (this.strategyPosition === "none")
            return; // nothing to do
        if (this.avgCandleVolume === 0 || this.avgCandles.length < VolumeSpikeDetector.KEEP_CANDLE_COUNT)
            return;
        const volumeSpike = candle.getVolumeBtc() / this.avgCandleVolume;
        if (volumeSpike < this.action.spikeFactor)
            return;

        const spikeTxt = volumeSpike.toFixed(3);
        const priceDiffPercent = this.getPriceDiffPercent(candle);
        const priceDiffPercentTxt = priceDiffPercent.toFixed(2) + "%";
        //const btcVolume = Math.floor(candle.getVolumeBtc() * 1000) / 1000.0;
        const spikeMsg = utils.sprintf("volume spike %s price diff %s, interval %s min", spikeTxt, priceDiffPercentTxt, this.action.candleSize)
        this.log(spikeMsg);

        const lastCandle = this.getCandleAt(1);
        if ((this.strategyPosition === "long" && candle.trend === "down" && lastCandle.close > candle.close) ||
            (this.strategyPosition === "short" && candle.trend === "up" && lastCandle.close < candle.close))
            this.emitClose(Number.MAX_VALUE, spikeMsg);
    }
}