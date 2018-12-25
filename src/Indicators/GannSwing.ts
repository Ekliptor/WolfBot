import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, IntervalIndicatorParams} from "./AbstractIndicator";
import {AbstractCryptotraderIndicator, CryptoTraderInstrument} from "./AbstractCryptotraderIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

/**
 * GannSwing indicator. Ported from Trendatron.coffee
 */
export default class GannSwing extends AbstractCryptotraderIndicator {
    // ported parameters
    protected period: number; // copy "interval" for easier portability
    protected count = 0;
    protected buycount = 0;
    protected sellcount = 0;
    protected lowma: number[] = [];
    protected highma: number[] = [];
    protected fastlowma: number[] = [];
    protected fasthighma: number[] = [];

    constructor(params: IntervalIndicatorParams) {
        super(params)
        let i, j, k, l, ref, ref1, ref2, ref3;
        this.period = params.interval; // Period of highma and lowma
        for (i = ref = this.lowma.length; ref <= 5 ? i <= 5 : i >= 5; ref <= 5 ? i++ : i--) {
            this.lowma.push(0);
        }
        for (j = ref1 = this.highma.length; ref1 <= 5 ? j <= 5 : j >= 5; ref1 <= 5 ? j++ : j--) {
            this.highma.push(0);
        }
        for (k = ref2 = this.fastlowma.length; ref2 <= 5 ? k <= 5 : k >= 5; ref2 <= 5 ? k++ : k--) {
            this.fastlowma.push(0);
        }
        for (l = ref3 = this.fasthighma.length; ref3 <= 5 ? l <= 5 : l >= 5; ref3 <= 5 ? l++ : l--) {
            this.fasthighma.push(0);
        }
        this.result = {
            tradesell: false,
            tradebuy: false
        }
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.updateInstrument(candle);
            let close, fasthighma, fastlowma, hi, high, highma, hld, hlv, lo, low, lowma, result, tradebuy, tradesell;
            close = candle.close;
            high = candle.high;
            low = candle.low;
            this.lowma.pop();
            this.highma.pop();
            this.fastlowma.pop();
            this.fasthighma.pop();
            this.lowma.unshift(0);
            this.highma.unshift(0);
            this.fastlowma.unshift(0);
            this.fasthighma.unshift(0);

            if (this.instrument.low.length < this.period)
                return resolve(); // not enough data yet

            let calcOps = []
            let highMaParams = new TaLibParams("SMA", this.instrument.high, this.period);
            calcOps.push(this.taLib.calculate(highMaParams))
            let lowMaParams = new TaLibParams("SMA", this.instrument.low, this.period);
            calcOps.push(this.taLib.calculate(lowMaParams))
            let fastHighMaParams = new TaLibParams("SMA", this.instrument.high, this.period / 5);
            calcOps.push(this.taLib.calculate(fastHighMaParams))
            let fastLowMaParams = new TaLibParams("SMA", this.instrument.low, this.period / 5);
            calcOps.push(this.taLib.calculate(fastLowMaParams))
            Promise.all(calcOps).then((results) => {
                this.highma[0] = TaLib.getLatestResultPoint(results[0]);
                this.lowma[0] = TaLib.getLatestResultPoint(results[1]);
                this.fasthighma[0] = TaLib.getLatestResultPoint(results[2]);
                this.fastlowma[0] = TaLib.getLatestResultPoint(results[3]);

                if (close > this.highma[1] * 0.998 || (close > this.fasthighma[1] && close > this.fastlowma[1] * 1.01 && this.fasthighma[1] > this.highma[1])) {
                    hld = 1;
                } else if (close < this.lowma[1] / 0.998 || (close < this.fastlowma[1] && close < this.fasthighma[1] / 1.01 && this.fastlowma[1] < this.lowma[1])) {
                    hld = -1;
                } else {
                    hld = 0;
                }
                if (hld !== 0) {
                    this.count++;
                }
                if (hld !== 0 && this.count === 1) {
                    hlv = hld;
                    this.count = 0;
                } else {
                    hlv = 0;
                }
                if (hlv === -1) {
                    hi = this.highma[0];
                    this.plotMark({
                        "hi": 50            // indicates sell mood
                    }, true, true);
                    this.sellcount++;
                    this.buycount = 0;
                }
                if (hlv === 1) {
                    lo = this.lowma[0];
                    this.plotMark({
                        "lo": -5            // indicates buy mood
                    }, true, true);
                    this.buycount++;
                    this.sellcount = 0;
                }
                if (this.buycount >= 3) {
                    tradebuy = true;
                    this.buycount = 0;
                } else {
                    tradebuy = false;
                }
                if (this.sellcount >= 3) {
                    tradesell = true;
                    this.sellcount = 0;
                } else {
                    tradesell = false;
                }
                this.result = {
                    tradesell: tradesell,
                    tradebuy: tradebuy
                };
                //logger.verbose("Computed %s: highMA %s, lowMA %s, fast highMA %s, fast lowMA %s, buy count %s, sell count %s", this.className, this.highma[0],
                    //this.lowma[0], this.fasthighma[0], this.fastlowma[0], this.buycount, this.sellcount)

                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public removeLatestCandle() {
        if (this.loggedUnsupportedCandleUpdateOnTrade === true)
            return;
        this.loggedUnsupportedCandleUpdateOnTrade = true;
        this.warn("Using updateIndicatorsOnTrade is not yet supported by this indicator");
    }

    public isReady() {
        return this.instrument.low.length >= this.period && this.highma[0] > 0 && this.lowma[0] > 0;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}

export {GannSwing}