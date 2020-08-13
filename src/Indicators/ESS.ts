import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, IntervalIndicatorParams, ESSIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

/**
ESS - Ehlers Super Smoother Filter (two and three poles)
https://www.tradingview.com/script/VdJy0yBJ-Ehlers-Super-Smoother-Filter/
further literature of two and three pole butterworth filter by John Ehlers:
https://www.mesasoftware.com/papers/Poles.pdf
 **/
export default class ESS extends AbstractIndicator {
    protected params: ESSIndicatorParams;
    protected valuesClose: number[] = [];
    protected valuePrev: number[] = [];

    constructor(params: ESSIndicatorParams) {
        super(params)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            if ((this.params.numberOfPoles !== 2) && (this.params.numberOfPoles !== 3)) {
                logger.error("ESS indicator: Number of poles have to be 2 or 3 - given value %s", this.params.numberOfPoles);
                return resolve();
            }
            if (this.params.numberOfPoles > this.params.interval) {
                logger.error("ESS indicator: interval has to be greater that number of poles");
                return resolve();
            }
            this.valuesClose = this.addData(this.valuesClose, candle.close, this.params.interval);
            if (this.valuesClose.length < this.params.interval)
                return resolve(); // not enough data yet
            let ssf = 0;
            if (this.params.numberOfPoles == 2)
                this.value = this.ssf2();
            else
                this.value = this.ssf3();
			resolve();
        })
    }

    public removeLatestCandle() {
        this.valuesClose = this.removeLatestData(this.valuesClose);
    }

    public isReady() {
        return this.value !== -1 && this.valuesClose.length >= this.params.interval;
    }


    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    protected ssf2(): number {
        // TV: arg = sqrt(2) * PI / length
        let arg = Math.sqrt(2) * Math.PI / this.params.interval;
        // TV: a1 = exp(-arg)
        let a1 = Math.exp(-arg);
        // TV: b1 = 2 * a1 * cos(arg)
        let b1 = 2 * a1 * Math.cos(arg);
        // TV: coef3 = -pow(a1, 2)
        let coef3 = -1 * Math.pow(a1, 2)
        // TV: coef2 = b1
        let coef2 = b1
        // TV: coef1 = 1 - coef2 - coef3
        let coef1 = 1 - coef2 - coef3
        // TV: src1 = nz(src[1], src)
        let length = this.valuesClose.length;
        let src1 = this.valuesClose[length - 1];
        // TV: src2 = nz(src[2], src1)
        let src2 = this.valuesClose[length - 2];
        // TV: ssf := coef1 * src + coef2 * nz(ssf[1], src1) + coef3 * nz(ssf[2], src2)
        length = this.valuePrev.length;
        let ssf1 = src1;
        if (length >= 1)
            ssf1 = this.valuePrev[length - 1];
        let ssf2 = src2
        if (length >= 2)
            ssf2 = this.valuePrev[length - 2];
        // use (close) as src1 instead of ((close + 2 * close[1] + close[2]) / 4)
        let ssf = coef1 * src1 + coef2 * ssf1 + coef3 * ssf2;
        this.valuePrev = this.addData(this.valuePrev, ssf, 2);
        return ssf;
    }

    protected ssf3(): number {
        // arg = PI / length
        let arg = Math.PI / this.params.interval;
        // a1 = exp(-arg)
        let a1 = Math.exp(-arg);
        // b1 = 2 * a1 * cos(1.738 * arg)
        let b1 = 2 * a1 * Math.cos(1.738 * arg);
        // c1 = pow(a1, 2)
        let c1 = Math.pow(a1, 2);
        // coef4 = pow(c1, 2)
        let coef4 = Math.pow(c1, 2);
        // coef3 = -(c1 + b1 * c1)
        let coef3 = -(c1 + b1 * c1)
        // coef2 = b1 + c1
        let coef2 = b1 + c1
        // coef1 = 1 - coef2 - coef3 - coef4
        let coef1 = 1 - coef2 - coef3 - coef4
        // src1 = nz(src[1], src)
        let length = this.valuesClose.length;
        let src1 = this.valuesClose[length - 1];
        // TV: src2 = nz(src[2], src1)
        let src2 = this.valuesClose[length - 2];
        // TV: src3 = nz(src[3], src2)
        let src3 = this.valuesClose[length - 3];
        length = this.valuePrev.length;
        let ssf1 = src1;
        if (length >= 1)
            ssf1 = this.valuePrev[length - 1];
        let ssf2 = src2
        if (length >= 2)
            ssf2 = this.valuePrev[length - 2];
        let ssf3 = src3
        if (length >= 3)
            ssf3 = this.valuePrev[length - 3];
        // ssf := coef1 * src + coef2 * nz(ssf[1], src1) + coef3 * nz(ssf[2], src2) + coef4 * nz(ssf[3], src3)
        // use (close) as src1 instead of ((close + 3 * close[1] + 3 * close[2] + close[3]) / 8)
        let ssf = coef1 * src1 + coef2 * ssf1 + coef3 * ssf2 + coef4 * ssf3
        this.valuePrev = this.addData(this.valuePrev, ssf, 3);
        return ssf;
    }
}

export {ESS}
// from https://www.mesasoftware.com/papers/Poles.pdf:
// The equations for a 2 pole Butterworth filter in EasyLanguage notation are:
// a = ExpValue(-1.414*3.14159/P;
// b = 2*a*Cosine(1.414*180/P);
// f = b*f[1] – a*a*f[2] +((1 – b + a*a)/4)*(g + 2*g[1] + g[2]);
// where P = critical period of the 2 pole filter
// The equations for a 3 pole Butterworth filter in EasyLanguage notation are:
// a = ExpValue(-3.14159 / P);
// b = 2*a*Cosine(1.738*180 / P);
// c = a*a;
// f = (b + c)*f[1] - (c + b*c)*f[2] + c*c*f[3] + ((1 - b + c)*(1 - c) /8)*(g + 3*g[1] + 3*g[2] +
// g[3]);
// where P = critical period of the 3 pole filter.
