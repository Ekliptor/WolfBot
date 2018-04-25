import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, LineCrossIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

export default class SMA extends AbstractIndicator {
    protected params: LineCrossIndicatorParams;
    protected shortSMA: number[] = [];
    protected longSMA: number[] = [];

    constructor(params: LineCrossIndicatorParams) {
        super(params)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.shortSMA = this.addData(this.shortSMA, candle.close, this.params.short);
            this.longSMA = this.addData(this.longSMA, candle.close, this.params.long);
            if (this.longSMA.length < this.params.long)
                return resolve(); // not enough data yet

            let calcOps = []
            let shortPrams = new TaLibParams("SMA", this.shortSMA, this.params.short);
            calcOps.push(this.taLib.calculate(shortPrams))
            let longParams = new TaLibParams("SMA", this.longSMA, this.params.long);
            calcOps.push(this.taLib.calculate(longParams))
            Promise.all(calcOps).then((results) => {
                this.computeLineDiff(results[0], results[1])
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public isReady() {
        return this.shortLineValue !== -1 && this.longLineValue !== -1 && this.longSMA.length >= this.params.long;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}

export {SMA}