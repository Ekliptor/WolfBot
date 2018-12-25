import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, MomentumIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

/**
 * OBV indicator.
 * http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:on_balance_volume_obv
 */
export default class OBV extends AbstractIndicator {
    protected params: MomentumIndicatorParams;
    protected valuesPrice: number[] = [];
    protected valuesVolume: number[] = [];

    constructor(params: MomentumIndicatorParams) {
        super(params)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.valuesPrice = this.addData(this.valuesPrice, candle.close, this.params.interval);
            this.valuesVolume = this.addData(this.valuesVolume, candle.volume, this.params.interval);
            if (this.valuesPrice.length < this.params.interval)
                return resolve(); // not enough data yet
            this.valuesPrice = this.removeData(this.valuesPrice, this.params.interval);
            this.valuesVolume = this.removeData(this.valuesVolume, this.params.interval);

            let obvParams = new TaLibParams("OBV", this.valuesPrice, this.params.interval);
            obvParams.inPriceV = this.valuesVolume;
            obvParams.volume = this.valuesVolume; // not in their "explain()" function, but ta-lib throws an error if missing
            /** explain() output:
             * { name: 'OBV',
              group: 'Volume Indicators',
              hint: 'On Balance Volume',
              inputs:
               [ { name: 'inReal', type: 'real' },
                 { name: 'inPriceV', type: 'price', flags: [Object] } ],
              optInputs: [],
              outputs: [ { '0': 'line', name: 'outReal', type: 'real', flags: {} } ] }
                         */
            this.taLib.calculate(obvParams).then((result) => {
                this.computeValue(result)
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public removeLatestCandle() {
        this.valuesPrice = this.removeLatestData(this.valuesPrice);
        this.valuesVolume = this.removeLatestData(this.valuesVolume);
    }

    public isReady() {
        return this.value !== -1 && this.valuesPrice.length >= this.params.interval;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}

export {OBV}