import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, IntervalIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

/**
 * Hull Moving Average indicator
 * https://tradingsim.com/blog/hull-ma/
 */
export default class HullMA extends AbstractIndicator {
    protected params: IntervalIndicatorParams;
    protected valuesClose: number[] = [];
    protected wmaValue: number = -1.0;
    protected wmaHalfValue: number = -1.0;
    protected currentInnerVal: number = -1.0;
    protected hullSeries: number[] = []; // the difference of the 2 inner WMA

    constructor(params: IntervalIndicatorParams) {
        super(params)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.valuesClose = this.addData(this.valuesClose, candle.close, this.params.interval);
            if (this.valuesClose.length < this.params.interval)
                return resolve(); // not enough data yet

            let wmaParams = new TaLibParams("WMA", this.valuesClose, this.params.interval);
            this.taLib.calculate(wmaParams).then(async (result) => {
                this.wmaValue = TaLib.getLatestResultPoint(result);

                // hullma = wma(2*wma(src, 9/2)-wma(src, 9), round(sqrt(9)))
                let wmaHalfIntervalParams = new TaLibParams("WMA", this.valuesClose, Math.floor(this.params.interval/2));
                this.wmaHalfValue = TaLib.getLatestResultPoint(await this.taLib.calculate(wmaHalfIntervalParams));
                if (this.wmaHalfValue === -1)
                    return resolve();
                this.currentInnerVal = 2*this.wmaHalfValue - this.wmaValue;
                this.hullSeries.push(this.currentInnerVal);
                const outerInterval = Math.round(Math.sqrt(this.params.interval));
                if (this.hullSeries.length < outerInterval)
                    return resolve();

                let hullParams = new TaLibParams("WMA", this.hullSeries, outerInterval);
                this.value = TaLib.getLatestResultPoint(await this.taLib.calculate(hullParams));
                this.cleanupValues();
                resolve()
            }).catch((err) => {
                reject(err)
            })
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

    protected cleanupValues() {
        while (this.hullSeries.length > 2*this.params.interval)
            this.hullSeries.shift();
    }
}

export {HullMA}
