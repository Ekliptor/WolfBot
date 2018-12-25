import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, TristarParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

/**
 * value is positive (1 to 100) when bullish or negative (-1 to -100) when bearish
 */
export default class TristarPattern extends AbstractIndicator {
    protected params: TristarParams;
    protected open: number[] = [];
    protected high: number[] = [];
    protected low: number[] = [];
    protected close: number[] = [];

    constructor(params: TristarParams) {
        super(params)
        this.params = Object.assign(new TristarParams(), this.params);
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.open = this.addData(this.open, candle.open, this.params.interval);
            this.high = this.addData(this.high, candle.high, this.params.interval);
            this.low = this.addData(this.low, candle.low, this.params.interval);
            this.close = this.addData(this.close, candle.close, this.params.interval);
            if (this.open.length < this.params.interval)
                return resolve(); // not enough data yet

            let params = new TaLibParams("CDLTRISTAR", this.open, this.params.interval);
            params.open = this.open;
            params.high = this.high;
            params.low = this.low;
            params.close = this.close;
            this.taLib.calculate(params).then((result) => {
                this.value = TaLib.getLatestResultPoint(result, "outInteger");
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public removeLatestCandle() {
        this.open = this.removeLatestData(this.open);
        this.high = this.removeLatestData(this.high);
        this.low = this.removeLatestData(this.low);
        this.close = this.removeLatestData(this.close);
    }

    public isReady() {
        return this.value !== -1 && this.open.length >= this.params.interval;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}

export {TristarPattern}