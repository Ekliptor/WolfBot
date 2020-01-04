import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {
    AbstractIndicator, IntervalIndicatorParams, KamaIndicatorParams, LineCrossIndicatorParams,
    MomentumIndicatorParams
} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

/**
 * http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:kaufman_s_adaptive_moving_average
 */
export default class KAMA extends AbstractIndicator {
    protected params: KamaIndicatorParams;
    protected valuesClose: number[] = [];
    protected candles: Candle.Candle[] = []; // previous candles starting the the latest one at index 0

    constructor(params: KamaIndicatorParams) {
        // could also be used with LineCrossIndicatorParams - but already laggy. better use 1 line and compare to prices
        // TODO KAMA has 3 params, but TA-Lib only offers 1
        super(params)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            const inputValue = this.params.useTrueRange === true && this.candles.length !== 0 ? this.getTrueRange(candle, this.candles[0]) : candle.close;
            this.valuesClose = this.addData(this.valuesClose, inputValue, this.params.interval);
            this.storeCandle(candle);
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

    public removeLatestCandle() {
        this.valuesClose = this.removeLatestData(this.valuesClose);
    }

    public isReady() {
        return this.value !== -1 && this.valuesClose.length >= this.params.interval;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected storeCandle(candle: Candle.Candle) {
        this.candles.unshift(candle);
        if (this.candles.length > 3)
            this.candles.pop();
    }
}

export {KAMA}
