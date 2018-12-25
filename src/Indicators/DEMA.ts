import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, LineCrossIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

export default class DEMA extends AbstractIndicator {
    protected params: LineCrossIndicatorParams;
    protected shortDEMA: number[] = [];
    protected longDEMA: number[] = [];

    constructor(params: LineCrossIndicatorParams) {
        super(params)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.shortDEMA = this.addData(this.shortDEMA, candle.close, this.params.short);
            this.longDEMA = this.addData(this.longDEMA, candle.close, this.params.long);
            if (this.longDEMA.length < this.params.long)
                return resolve(); // not enough data yet

            let calcOps = []
            let shortPrams = new TaLibParams("DEMA", this.shortDEMA, this.params.short);
            calcOps.push(this.taLib.calculate(shortPrams))
            let longParams = new TaLibParams("DEMA", this.longDEMA, this.params.long);
            calcOps.push(this.taLib.calculate(longParams))
            Promise.all(calcOps).then((results) => {
                this.computeLineDiff(results[0], results[1])
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public removeLatestCandle() {
        this.shortDEMA = this.removeLatestData(this.shortDEMA);
        this.longDEMA = this.removeLatestData(this.longDEMA);
    }

    public isReady() {
        return this.shortLineValue !== -1 && this.longLineValue !== -1 && this.longDEMA.length >= this.params.long;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}

export {DEMA}