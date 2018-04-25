import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, StochRSIIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

export default class StochRSI extends AbstractIndicator {
    protected params: StochRSIIndicatorParams;
    protected valuesRSI: number[] = [];
    protected outFastK: number = -1;
    protected outFastD: number = -1;

    constructor(params: StochRSIIndicatorParams) {
        super(params)
        this.params = Object.assign(new StochRSIIndicatorParams(), this.params); // params come in without type (ok for interfaces)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.valuesRSI = this.addData(this.valuesRSI, candle.close, this.params.interval);
            if (this.valuesRSI.length < this.params.interval)
                return resolve(); // not enough data yet

            let rsiParams = new TaLibParams("STOCHRSI", this.valuesRSI, this.params.interval);
            rsiParams.optInFastK_Period = this.params.optInFastK_Period;
            rsiParams.optInFastD_Period = this.params.optInFastD_Period;
            rsiParams.optInFastD_MAType = this.params.optInFastD_MAType;
            this.taLib.calculate(rsiParams).then((result) => {
                this.outFastK = TaLib.getLatestResultPoint(result, "outFastK"); // the value by price points
                this.outFastD = TaLib.getLatestResultPoint(result, "outFastD"); // the value smoothened by MA
                this.value = this.outFastD; // for easier access
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public isReady() {
        return this.outFastK !== -1 && this.outFastD !== -1 && this.valuesRSI.length >= this.params.interval;
    }

    /**
     * Return the real RSI value based on actual price points.
     * @returns {number}
     */
    public getOutFastK() {
        return this.outFastK;
    }

    /**
     * Return the RSI value smoothened by applying a MA before calculating RSI.
     * @returns {number}
     */
    public getOutFastD() {
        return this.outFastD;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}

export {StochRSI}