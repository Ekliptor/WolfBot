import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, MACDParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

export default class MACD extends AbstractIndicator {
    protected params: MACDParams;
    protected valuesMACD: number[] = [];

    protected macd = -1;
    protected signal = -1;
    protected histogram = -1;

    constructor(params: MACDParams) {
        super(params)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.valuesMACD = this.addData(this.valuesMACD, candle.close, this.params.long);
            if (this.valuesMACD.length < this.params.long)
                return resolve(); // not enough data yet

            let params = new TaLibParams("MACD", this.valuesMACD, this.params.short);
            params.optInFastPeriod = this.params.short;
            params.optInSlowPeriod = this.params.long;
            params.optInSignalPeriod = this.params.signal;
            this.taLib.calculate(params).then((result) => {
                this.computeValues(result)
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public removeLatestCandle() {
        this.valuesMACD = this.removeLatestData(this.valuesMACD);
    }

    public isReady() {
        return this.macd !== -1 && this.signal !== -1 && this.histogram !== -1 && this.valuesMACD.length >= this.params.long;
    }

    public getMACD() {
        return this.macd;
    }

    public getSignal() {
        return this.signal;
    }

    public getHistogram() {
        return this.histogram;
    }

    public getAllValues() {
        return {
            macd: this.macd,
            signal: this.signal,
            histogram: this.histogram
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected computeValues(result: TaLibResult) {
        this.macd = TaLib.getLatestResultPoint(result, "outMACD");
        this.signal = TaLib.getLatestResultPoint(result, "outMACDSignal");
        this.histogram = TaLib.getLatestResultPoint(result, "outMACDHist");
        //if (this.macd < 0 || this.signal < 0 || this.histogram < 0)
            //return;
        //logger.verbose("Computed %s: MACD %s, Signal %s, Histogram %s", this.className, this.macd, this.signal, this.histogram)
    }
}

export {MACD}