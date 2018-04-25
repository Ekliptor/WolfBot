import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, MomentumIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

export default class Aroon extends AbstractIndicator {
    protected params: MomentumIndicatorParams; // TA-LIB says "Momentum Indicators"
    protected valuesHigh: number[] = [];
    protected valuesLow: number[] = [];

    protected up: number = -1;
    protected down: number = -1;

    constructor(params: MomentumIndicatorParams) {
        super(params)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.valuesHigh = this.addData(this.valuesHigh, candle.high, this.params.interval);
            this.valuesLow = this.addData(this.valuesLow, candle.low, this.params.interval);
            if (this.valuesHigh.length < this.params.interval)
                return resolve(); // not enough data yet

            let aroonParams = new TaLibParams("AROON", [], this.params.interval);
            aroonParams.high = this.valuesHigh;
            aroonParams.low = this.valuesLow;
            aroonParams.endIdx = this.valuesHigh.length - 1;
            this.taLib.calculate(aroonParams).then((result) => {
                this.computeValues(result)
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public isReady() {
        return this.up !== -1 && this.down !== -1 && this.valuesHigh.length >= this.params.interval;
    }

    public getUp() {
        return this.up;
    }

    public getDown() {
        return this.down;
    }

    public getAllValues() {
        return {
            up: this.up,
            down: this.down
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected computeValues(result: TaLibResult) {
        this.up = TaLib.getLatestResultPoint(result, "outAroonUp");
        this.down = TaLib.getLatestResultPoint(result, "outAroonDown");
        //if (this.up >= 0 && this.down >= 0)
            //logger.verbose("Computed %s values: up %s, down %s", this.className, this.up, this.down)
    }
}

export {Aroon}