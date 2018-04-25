import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, SarParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

export default class SAR extends AbstractIndicator {
    protected params: SarParams;
    protected valuesHigh: number[] = [];
    protected valuesLow: number[] = [];

    constructor(params: SarParams) {
        super(params)
        this.params = Object.assign(new SarParams(), this.params); // params come in without type (ok for interfaces)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.valuesHigh = this.addData(this.valuesHigh, candle.high);
            this.valuesLow = this.addData(this.valuesLow, candle.low);
            //if (this.valuesHigh.length < AbstractIndicator.MAX_DATAPOINTS_DEFAULT)
                //return resolve(); // we don't know how many data points it will need

            let sarParams = new TaLibParams("SAR", []);
            sarParams.high = this.valuesHigh;
            sarParams.low = this.valuesLow;
            sarParams.endIdx = this.valuesHigh.length - 1;
            sarParams.optInAcceleration = this.params.accelerationFactor;
            sarParams.optInMaximum = this.params.accelerationMax;
            this.taLib.calculate(sarParams).then((result) => {
                this.computeValue(result)
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public isReady() {
        return this.value !== -1/* && this.valuesHigh.length >= this.params.interval*/;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}

export {SAR}