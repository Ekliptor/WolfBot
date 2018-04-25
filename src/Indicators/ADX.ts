import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, IntervalIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

/**
 * ADX Indicator. Can require about 150 candles to get good values according to:
 * http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:average_directional_index_adx
 * Additionally we add DM, DI and ADXR
 * http://www.fmlabs.com/reference/default.htm?url=DI.htm
 * https://www.scottrade.com/knowledge-center/investment-education/research-analysis/technical-analysis/the-indicators/average-directional-movement-index-rating-adxr.html
 */
export default class ADX extends AbstractIndicator {
    protected params: IntervalIndicatorParams;
    protected valuesHigh: number[] = [];
    protected valuesLow: number[] = [];
    protected valuesClose: number[] = [];

    protected adx: number = -1; // ADX
    protected plusDM: number = -1; // +DM: Directional Movement
    protected minusDM: number = -1; // -DM
    protected plusDI: number = -1; // +DI: Directional Indicator
    protected minusDI: number = -1; // -DI
    protected adxr: number = -1; // ADXR: Average Directional Movement Index Rating
    protected disabledADXR = false;

    constructor(params: IntervalIndicatorParams) {
        super(params)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.valuesHigh = this.addData(this.valuesHigh, candle.high, this.params.interval);
            this.valuesLow = this.addData(this.valuesLow, candle.low, this.params.interval);
            this.valuesClose = this.addData(this.valuesClose, candle.close, this.params.interval);
            if (this.valuesHigh.length < this.params.interval)
                return resolve(); // not enough data yet

            let calcOps = []
            let adxParams = new TaLibParams("ADX", [], this.params.interval);
            adxParams.high = this.valuesHigh;
            adxParams.low = this.valuesLow;
            adxParams.close = this.valuesClose;
            adxParams.endIdx = this.valuesHigh.length - 1;
            calcOps.push(this.taLib.calculate(adxParams))
            let plusDmParams = Object.assign(new TaLibParams("PLUS_DM", [], this.params.interval), adxParams);
            plusDmParams.name = "PLUS_DM";
            calcOps.push(this.taLib.calculate(plusDmParams))
            let minusDmParams = Object.assign(new TaLibParams("MINUS_DM", [], this.params.interval), adxParams);
            minusDmParams.name = "MINUS_DM";
            calcOps.push(this.taLib.calculate(minusDmParams))
            let plusDiParams = Object.assign(new TaLibParams("PLUS_DI", [], this.params.interval), adxParams);
            plusDiParams.name = "PLUS_DI";
            calcOps.push(this.taLib.calculate(plusDiParams))
            let minusDiParams = Object.assign(new TaLibParams("MINUS_DI", [], this.params.interval), adxParams);
            minusDiParams.name = "MINUS_DI";
            calcOps.push(this.taLib.calculate(minusDiParams))
            let adxrParams = Object.assign(new TaLibParams("ADXR", [], this.params.interval), adxParams);
            adxrParams.name = "ADXR";
            calcOps.push(this.taLib.calculate(adxrParams))
            Promise.all(calcOps).then((results) => {
                this.adx = TaLib.getLatestResultPoint(results[0]);
                this.plusDM = TaLib.getLatestResultPoint(results[1]);
                this.minusDM = TaLib.getLatestResultPoint(results[2]);
                this.plusDI = TaLib.getLatestResultPoint(results[3]);
                this.minusDI = TaLib.getLatestResultPoint(results[4]);
                this.adxr = TaLib.getLatestResultPoint(results[5]);
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public isReady() {
        return this.adx !== -1 && this.plusDM !== -1 && this.plusDI !== -1 && this.valuesHigh.length >= this.params.interval
            && (this.adxr !== -1 || this.disabledADXR);
    }

    /**
     * Disable waiting for ADXR. This way the indicator will be ready faster
     * (without waiting for "interval" candles to compute ADX average).
     * It will still get computed and be ready later on.
     * @param {boolean} disable
     */
    public disableADXR(disable: boolean) {
        this.disabledADXR = disable;
    }

    /**
     * Get the strength of the trend.
     * @returns {number}
     */
    public getADX() {
        return this.adx;
    }

    /**
     * Get the positive directional movement (DI before smoothening).
     * @returns {number}
     */
    public getPlusDM() {
        return this.plusDM;
    }

    /**
     * Get the negative directional movement (DI before smoothening).
     * @returns {number}
     */
    public getMinusDM() {
        return this.minusDM;
    }

    /**
     * Get the positive/up direction index of the trend
     * @returns {number} value > 0
     */
    public getPlusDI() {
        return this.plusDI;
    }

    /**
     * Get the negative/down direction index of the trend.
     * @returns {number} value > 0
     */
    public getMinusDI() {
        return this.minusDI;
    }

    /**
     * Get the ADX index rating. Slightly less responsive than ADX.
     * @returns {number}
     */
    public getADXR() {
        return this.adxr;
    }

    public getAllValues() {
        return {
            adx: this.adx,
            plusDM: this.plusDM,
            minusDM: this.minusDM,
            plusDI: this.plusDI,
            minusDI: this.minusDI,
            adxr: this.adxr
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}

export {ADX}