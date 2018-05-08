import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, MomentumIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

/**
 * CCI indicator - an oscillator around 0.
 * http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:commodity_channel_index_cci
 */
export default class CCI extends AbstractIndicator {
    protected params: MomentumIndicatorParams;
    protected valuesHigh: number[] = [];
    protected valuesLow: number[] = [];
    protected valuesClose: number[] = [];

    constructor(params: MomentumIndicatorParams) {
        super(params)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.valuesHigh = this.addData(this.valuesHigh, candle.close, this.params.interval);
            this.valuesLow = this.addData(this.valuesLow, candle.volume, this.params.interval);
            this.valuesClose = this.addData(this.valuesClose, candle.volume, this.params.interval);
            if (this.valuesHigh.length < this.params.interval)
                return resolve(); // not enough data yet

            let cciParams = new TaLibParams("CCI", [], this.params.interval);
            cciParams.high = this.valuesHigh;
            cciParams.low = this.valuesLow;
            cciParams.close = this.valuesClose;
            cciParams.endIdx = this.valuesHigh.length - 1;
            this.taLib.calculate(cciParams).then((result) => {
                this.computeValue(result)
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public isReady() {
        return this.value !== -1 && this.valuesHigh.length >= this.params.interval;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}

export {CCI}