import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {
    AbstractIndicator, IntervalIndicatorParams, LineCrossIndicatorParams,
    MomentumIndicatorParams
} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

/**
 * http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:kaufman_s_adaptive_moving_average
 */
export default class KAMA extends AbstractIndicator {
    protected params: IntervalIndicatorParams;
    protected valuesClose: number[] = [];

    constructor(params: IntervalIndicatorParams) {
        // could also be used with LineCrossIndicatorParams - but already laggy. better use 1 line and compare to prices
        // TODO KAMA has 3 params, but TA-Lib only offers 1
        super(params)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.valuesClose = this.addData(this.valuesClose, candle.close, this.params.interval);
            if (this.valuesClose.length < this.params.interval)
                return resolve(); // not enough data yet

            let kamaParams = new TaLibParams("KAMA", this.valuesClose, this.params.interval);
            this.taLib.calculate(kamaParams).then((result) => {
                this.computeValue(result)
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public isReady() {
        return this.value !== -1 && this.valuesClose.length >= this.params.interval;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}

export {KAMA}