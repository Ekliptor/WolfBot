import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {TradeDirection} from "../Trade/AbstractTrader";
import {AbstractMomentumAction, AbstractMomentumStrategy} from "./AbstractMomentumStrategy";

export interface VolumeSpikeAction extends AbstractMomentumAction {
    spikeFactor: number; // 3.0 // The minimum spike to open a position. Defined as x times higher than the average volume.
    minVolBtc: number; // 1.2 // The minimum volume for the current candle and average volume to prevent spikes near 0 trading volume. Defined in the base currency of your trading pair, usually BTC or USD.
    historyCandle: number; // optional, default 36. How many candles to look back to compare if price and volume really are a spike. Set 0 to disable it.

    tradeDirection: TradeDirection | "notify" | "watch"; // optional. default "up"
    // The minimum percent the price has to change to confirm the volume spike and trade on it. If you are trading on small candles (5min) then a value of 1.5 or lower can also be a good setting. See PriceSpikeDetector for a strategy looking only at price spikes.
    minPriceChangePercent: number; // default 3.0 // 1.5 for 5min candles // 3.5 is already too much for small coins as Sia on Poloniex
    tradeOppositeDirection: boolean; // optional. default "false" = don't trade if we have an open position in the other direction
    strongRate: boolean; // optional. default true = adjust the rate to ensure the order gets filled immediately
    onlyDailyTrend: boolean; // optional. default true = only trade when the spike is in the same direction as the 24h % change
    keepCandleCount: number; // optional, default 3 // The number of candles to keep to compute the average volume.
}

/**
 * Detect if there is a spike in the trade volume of a coin.
 * This usually means a sharp spike/drop is happening (especially for smaller Altcoins).
 * This strategy works great at detecting fast pumps in a coin. It should be used with a small candle size such as 3-15min and
 * a 'spikeFactor' according to your coin's volume profile changes. You should look at the chart and set the 'spikeFactor' value
 * high enough so that this strategy only triggers about once a week for your coin.
 * This is to avoid false positives and jump on late spikes too late.
 * Take a look at VolumeSpikeDetectorLong for volume spikes in longer candle intervals (>= 12h) to detect if attention in a coin is rising.
 */
export default class VolumeSpikeDetector extends AbstractMomentumStrategy {
    protected action: VolumeSpikeAction;
    protected avgCandles: Candle.Candle[] = [];
    protected avgCandleVolume: number = 0;

    constructor(options) {
        super(options)
        this.tradeOnce = true; // TradeNotifier doesn't emit buy/sell so we can still get multiple notifications
        if (this.action.historyCandle === undefined)
            this.action.historyCandle = 36;
        if (!this.action.minPriceChangePercent)
            this.action.minPriceChangePercent = 3.0;
        if (!this.action.keepCandleCount)
            this.action.keepCandleCount = 3;

        this.addInfoFunction("avgCandleCount", () => {
            return this.avgCandles.length;
        });
        this.addInfo("avgCandleVolume", "avgCandleVolume");
        this.addInfoFunction("last candle vol", () => {
            return this.candle ? this.candle.getVolumeBtc() : "";
        });
        this.addInfoFunction("lastVolumeSpike", () => {
            if (!this.candle || this.avgCandleVolume === 0)
                return -1;
            const volumeSpike = this.candle.getVolumeBtc() / this.avgCandleVolume;
            return volumeSpike;
        });
        this.addInfoFunction("last candle price diff %", () => {
            return this.candle ? this.getPriceDiffPercent(this.candle) : "";
        });
        this.addInfo("done", "done");
        this.saveState = true; // ensures faster start if bot crashes (often happens on big spikes with exchange errors)
    }

    public serialize() {
        let state = super.serialize();
        state.avgCandles = Candle.Candle.copy(this.avgCandles);
        state.avgCandleVolume = this.avgCandleVolume;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.avgCandles = Candle.Candle.copy(state.avgCandles);
        this.avgCandleVolume = state.avgCandleVolume;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            // TODO additionally count number of trades?
            resolve()
        })
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.done)
                return resolve();

            this.computeAvgVolume(); // compute the avg volume before adding the new candle
            this.avgCandles.push(candle);
            this.removeOldCandles();
            this.checkVolumeSpike(candle);

            this.logSpikeValues(candle);
            resolve()
        })
    }

    protected removeOldCandles() {
        let i = this.avgCandles.length - this.action.keepCandleCount;
        if (i > 0)
            this.avgCandles.splice(0, i) // remove oldest ones
    }

    protected computeAvgVolume() {
        if (this.avgCandles.length === 0)
            return;
        let totalVolume = 0;
        this.avgCandles.forEach((candle) => {
            //totalVolume += candle.volume;
            totalVolume += candle.getVolumeBtc();
        })
        this.avgCandleVolume = totalVolume / this.avgCandles.length;
    }

    protected checkVolumeSpike(candle: Candle.Candle) {
        if (this.avgCandleVolume === 0 || this.avgCandles.length < this.action.keepCandleCount)
            return;
        const volumeSpike = candle.getVolumeBtc() / this.avgCandleVolume;
        if (volumeSpike < this.action.spikeFactor)
            return;
        if (candle.getVolumeBtc() < this.action.minVolBtc)
            return this.log("BTC volume of current candle too low for a spike, vol", candle.getVolumeBtc());
        else if (this.avgCandleVolume < this.action.minVolBtc)
            return this.log("Avg BTC volume too low for a spike, vol", this.avgCandleVolume);

        // TODO also check a longer candle trend to ensure it's really going up? (and not just a spike an huge drop). but history candle check is similar
        // this candle is a spike. check the open and close price to determine the direction
        const spikeTxt = volumeSpike.toFixed(3);
        //const minPriceDiff = candle.open / 100 * this.action.minPriceChangePercent;
        //const priceDiff = candle.open - candle.close;
        const priceDiffPercent = this.getPriceDiffPercent(candle);
        const priceDiffPercentTxt = priceDiffPercent.toFixed(2) + "%";
        const btcVolume = Math.floor(candle.getVolumeBtc() * 1000) / 1000.0;
        this.log("current volume spike", spikeTxt, "price diff", priceDiffPercentTxt);
        //if (priceDiff < -1 * minPriceDiff) {
        if (priceDiffPercent >= this.action.minPriceChangePercent) {
            if (this.betterThanHistoryPrice(true) && this.betterThanHistoryVolume(true)) {
                this.log("emitting buy because price is rising fast to", this.avgMarketPrice.toFixed(8), "volumeSpike", spikeTxt);
                this.openLong("price rising with high vol " + spikeTxt + "x\nPrice change " + priceDiffPercentTxt + "\nBTC Vol " + btcVolume);
                //this.done = true;
            }
        }
        else if (priceDiffPercent <= this.action.minPriceChangePercent * -1) {
            if (this.betterThanHistoryPrice(false) && this.betterThanHistoryVolume(false)) {
                this.log("emitting sell because price is dropping fast to", this.avgMarketPrice.toFixed(8), "volumeSpike", spikeTxt);
                this.openShort("price dropping with high vol " + spikeTxt + "x\nPrice change " + priceDiffPercentTxt + "\nBTC Vol " + btcVolume);
                //this.done = true;
            }
        }
    }

    protected getPriceDiffPercent(candle: Candle.Candle) {
        return ((candle.close - candle.open) / candle.open) * 100; // ((y2 - y1) / y1)*100 - positive % if price is rising
    }

    protected betterThanHistoryPrice(higher: boolean) {
        if (!this.action.historyCandle)
            return true;
        let history = this.getCandleAt(this.action.historyCandle)
        if (!history)
            return false;
        if (higher)
            return this.avgMarketPrice > history.close;
        return this.avgMarketPrice < history.close;
    }

    protected betterThanHistoryVolume(higher: boolean) {
        if (!this.action.historyCandle)
            return true;
        let history = this.getCandleAt(this.action.historyCandle)
        if (!history)
            return false;
        // get the avg volume of the next 3 candles
        let candles = [];
        for (let i = this.action.historyCandle; i > 0; i--)
        {
            candles.push(this.getCandleAt(i));
            if (candles.length >= 3)
                break;
        }
        let avg = this.getCandleAvg(candles)
        if (higher)
            return this.candle.volume > avg.volume;
        return this.candle.volume < avg.volume;
    }

    protected logSpikeValues(candle: Candle.Candle) {
        const priceDiffPercentTxt = this.getPriceDiffPercent(candle).toFixed(2) + "%";
        this.log("market price", this.avgMarketPrice.toFixed(8), "avgCandleVolume", this.avgCandleVolume, "priceDiff", priceDiffPercentTxt)
    }
}