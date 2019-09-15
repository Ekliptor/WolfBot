import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, LineCrossIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

/**
 * Weighted Moving Average indicator
 */
export default class WMA extends AbstractIndicator {
    protected params: LineCrossIndicatorParams;
    protected shortWMA: number[] = [];
    protected longWMA: number[] = [];

    constructor(params: LineCrossIndicatorParams) {
        super(params)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.shortWMA = this.addData(this.shortWMA, candle.close, this.params.short);
            this.longWMA = this.addData(this.shortWMA, candle.close, this.params.long);
            if (this.longWMA.length < this.params.short)
                return resolve(); // not enough data yet

            let calcOps = []
            let shortParams = new TaLibParams("WMA", this.shortWMA, this.params.short);
            this.taLib.calculate(shortParams);
            let longParams = new TaLibParams("WMA", this.longWMA, this.params.long);
            this.taLib.calculate(longParams);
            Promise.all(calcOps).then((results) => {
                this.computeLineDiff(results[0], results[1])
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public removeLatestCandle() {
        this.shortWMA = this.removeLatestData(this.shortWMA);
        this.shortWMA = this.removeLatestData(this.shortWMA);
    }

    public isReady() {
        return this.shortLineValue !== -1 && this.longLineValue !== -1 && this.longWMA.length >= this.params.long;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}

export {WMA}
