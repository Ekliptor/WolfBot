import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, MomentumIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

export default class MFI extends AbstractIndicator {
    protected params: MomentumIndicatorParams;
    protected valuesHigh: number[] = [];
    protected valuesLow: number[] = [];
    protected valuesClose: number[] = [];
    protected valuesVolume: number[] = [];

    constructor(params: MomentumIndicatorParams) {
        super(params)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.valuesHigh = this.addData(this.valuesHigh, candle.high, this.params.interval);
            this.valuesLow = this.addData(this.valuesLow, candle.low, this.params.interval);
            this.valuesClose = this.addData(this.valuesClose, candle.close, this.params.interval);
            this.valuesVolume = this.addData(this.valuesVolume, candle.volume, this.params.interval);
            if (this.valuesHigh.length < this.params.interval)
                return resolve(); // not enough data yet

            let msiParams = new TaLibParams("MFI", [], this.params.interval);
            msiParams.high = this.valuesHigh;
            msiParams.low = this.valuesLow;
            msiParams.close = this.valuesClose;
            msiParams.volume = this.valuesVolume;
            msiParams.endIdx = this.valuesHigh.length - 1;
            this.taLib.calculate(msiParams).then((result) => {
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

export {MFI}