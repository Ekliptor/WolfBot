import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, IntervalIndicatorParams, VIXParams} from "./AbstractIndicator";
import {AbstractCryptotraderIndicator, CryptoTraderInstrument} from "./AbstractCryptotraderIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

/**
 * VIX indicator. Ported from Trendatron.coffee
 */
export default class VIX extends AbstractCryptotraderIndicator {
    protected params: VIXParams;

    // ported parameters
    protected period: number; // copy "interval" for easier portability
    protected close: number[] = [];
    protected wvf: number[] = [];
    protected trade: number[] = [];
    protected count = 0;

    protected sdev = -1;
    protected midline = -1;

    constructor(params: VIXParams) {
        super(params)
        this.params = Object.assign(new VIXParams(), this.params);
        let i, j, k, ref, ref1, ref2, ref3;
        this.period = this.params.stddevPriod; // Period of stddev and midline
        for (i = ref = this.close.length; ref <= 22 ? i <= 22 : i >= 22; ref <= 22 ? i++ : i--) {
            this.close.push(0);
        }
        for (j = ref1 = this.wvf.length, ref2 = this.period; ref1 <= ref2 ? j <= ref2 : j >= ref2; ref1 <= ref2 ? j++ : j--) {
            this.wvf.push(0);
        }
        for (k = ref3 = this.trade.length; ref3 <= 10 ? k <= 10 : k >= 10; ref3 <= 10 ? k++ : k--) {
            this.trade.push(0);
        }
        this.result = {
            wvf: -1,
            rangehigh: -1,
            rangelow: -1,
            trade: -1
        }
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.updateInstrument(candle);
            let close, high, highest, low, lowerband, midline, rangehigh, rangelow, result, sdev, upperband;
            close = candle.close;
            high = candle.high;
            low = candle.low;
            this.count++;
            this.close.pop();
            this.wvf.pop();
            this.trade.pop();
            this.close.unshift(0);
            this.wvf.unshift(0);
            this.trade.unshift(0);
            this.close[0] = close;
            highest = this.close.reduce((a, b) => {
                return Math.max(a, b);
            });
            this.wvf[0] = ((highest - low) / highest) * 100;

            if (this.instrument.low.length < this.period)
                return resolve(); // not enough data yet

            let calcOps = []
            let sdevParams = new TaLibParams("STDDEV", this.wvf, this.period);
            sdevParams.optInNbDev = 1;
            calcOps.push(this.taLib.calculate(sdevParams))
            let midLineParams = new TaLibParams("SMA", this.wvf, this.period);
            calcOps.push(this.taLib.calculate(midLineParams))
            let fastHighMaParams = new TaLibParams("SMA", this.instrument.high, this.period / 5);
            calcOps.push(this.taLib.calculate(fastHighMaParams))
            let fastLowMaParams = new TaLibParams("SMA", this.instrument.low, this.period / 5);
            calcOps.push(this.taLib.calculate(fastLowMaParams))
            Promise.all(calcOps).then((results) => {
                sdev = TaLib.getLatestResultPoint(results[0]);
                midline = TaLib.getLatestResultPoint(results[1]);
                this.sdev = sdev;
                this.midline = midline;
                lowerband = midline - sdev;
                upperband = midline + sdev;
                rangehigh = (this.wvf.reduce((a, b) => {
                        return Math.max(a, b);
                    })) * 0.85;
                rangelow = (this.wvf.reduce((a, b) => {
                        return Math.min(a, b);
                    })) * 1.01;
                if (this.wvf[0] >= upperband || this.wvf[0] >= rangehigh) {
                    this.trade[0] = 0;
                    this.plotMark({
                        "wvf1": this.wvf[0]
                    }, true);
                } else {
                    this.trade[0] = 1;
                    this.plotMark({
                        "wvf2": this.wvf[0]
                    }, true);
                }
                this.result = {
                    wvf: this.wvf[0],
                    rangehigh: rangehigh,
                    rangelow: rangelow,
                    trade: this.trade
                };
                //logger.verbose("Computed %s: sdev %s, midline %s, lowerband %s, upperband %s, rangehigh %s, rangelow %s", this.className, sdev,
                    //midline, lowerband, upperband, rangehigh, rangelow)

                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public removeLatestCandle() {
        this.close = this.removeLatestData(this.close);
        this.wvf = this.removeLatestData(this.wvf);
        this.trade = this.removeLatestData(this.trade);
    }

    public isReady() {
        return this.instrument.low.length >= this.period && this.sdev > 0 && this.midline > 0;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}

export {VIX}