import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, MomentumIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

/**
 * RSI indicator that additionally shows the buy/sell ratio in volume.
 * http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:relative_strength_index_rsi
 * // TODO compute open positions instead? (close Long != open short) - we would have to count all submitted trades and see if maker/taker
 */
export default class RSI extends AbstractIndicator {
    protected params: MomentumIndicatorParams;
    protected valuesRSI: number[] = [];
    protected valuesVolume: number[] = [];
    protected buyVolume = -1;
    protected sellVolume = -1;

    constructor(params: MomentumIndicatorParams) {
        super(params)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.valuesRSI = this.addData(this.valuesRSI, candle.close, this.params.interval);
            this.valuesVolume = this.addData(this.valuesVolume, candle.volume, this.params.interval);
            if (this.valuesRSI.length < this.params.interval)
                return resolve(); // not enough data yet

            let rsiParams = new TaLibParams("RSI", this.valuesRSI, this.params.interval);
            this.taLib.calculate(rsiParams).then((result) => {
                this.computeValue(result)
                this.computeVolume();
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public removeLatestCandle() {
        this.valuesRSI = this.removeLatestData(this.valuesRSI);
        this.valuesVolume = this.removeLatestData(this.valuesVolume);
    }

    public getBuyVolume() {
        return this.buyVolume;
    }

    public getSellVolume() {
        return this.sellVolume;
    }

    public getBuySellPercentage() {
        if (this.buyVolume === -1 || this.sellVolume === -1)
            return -1;
        return this.buyVolume / (this.buyVolume + this.sellVolume) * 100.0;
    }

    public isReady() {
        return this.value !== -1 && this.valuesRSI.length >= this.params.interval;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected computeVolume() {
        const start = this.params.interval + 1;
        if (this.valuesRSI.length < start)
            return;
        let gainVolume = 0, lossVolume = 0, lastPrice = 0;
        for (let i = this.valuesRSI.length - start; i < this.valuesRSI.length; i++)
        {
            if (i === 0) {
                lastPrice = this.valuesRSI[i];
                continue;
            }
            if (lastPrice > this.valuesRSI[i]) // price went down
                lossVolume += this.valuesVolume[i];
            else
                gainVolume += this.valuesVolume[i];
            lastPrice = this.valuesRSI[i];
        }
        this.buyVolume = gainVolume;
        this.sellVolume = lossVolume;
    }
}

export {RSI}