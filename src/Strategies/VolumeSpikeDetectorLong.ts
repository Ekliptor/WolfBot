import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {TradeDirection} from "../Trade/AbstractTrader";
import {AbstractMomentumAction, AbstractMomentumStrategy} from "./AbstractMomentumStrategy";
import {default as VolumeSpikeDetector, VolumeSpikeAction} from "./VolumeSpikeDetector";

interface VolumeSpikeLongAction extends VolumeSpikeAction {
    spikeFactor: number; // 3.0 // as x times higher/lower as avg
    // not used here
    //minVolBtc: number; // 1.2 // minVol for current candle and avg in BTC to prevent spikes from 0 trading volume
    //historyCandle: number; // optional, default 36. how many candles to look back to compare if price/volume really is a spike. set 0 to disable it

    //tradeDirection: TradeDirection; // optional. default "up"
    //tradeOppositeDirection: boolean; // optional. default "false" = don't trade if we have an open position in the other direction
    //strongRate: boolean; // optional. default true = adjust the rate to ensure the order gets filled immediately
}

/**
 * VolumeSpikeDetector version for longer intervals (daily) to detect if interest/attention in a coin is rising.
 * Half day is also a good interval (especially since the bot might not run 24h without restart to collect enough data)
 * This class only sends notifications and doesn't trade.
 */
export default class VolumeSpikeDetectorLong extends VolumeSpikeDetector {
    protected action: VolumeSpikeLongAction;

    constructor(options) {
        super(options)
        this.saveState = true;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkVolumeSpike(candle: Candle.Candle) {
        // simpler version than parent class without
        // - checking for min BTC trading volume
        // - checking for price
        // - any further history candle comparisons
        if (this.avgCandleVolume === 0 || this.avgCandles.length < VolumeSpikeDetector.KEEP_CANDLE_COUNT)
            return;
        const volumeSpike = candle.getVolumeBtc() / this.avgCandleVolume;
        if (volumeSpike < this.action.spikeFactor)
            return;

        const spikeTxt = volumeSpike.toFixed(3);
        const priceDiffPercent = this.getPriceDiffPercent(candle);
        const priceDiffPercentTxt = priceDiffPercent.toFixed(2) + "%";
        //const btcVolume = Math.floor(candle.getVolumeBtc() * 1000) / 1000.0;
        const spikeMsg = utils.sprintf("current volume spike %s price diff %s, interval %s h", spikeTxt, priceDiffPercentTxt, Math.floor(this.action.candleSize/60))
        this.log(spikeMsg);

        this.sendNotification("Volume Spike", spikeMsg)
    }
}