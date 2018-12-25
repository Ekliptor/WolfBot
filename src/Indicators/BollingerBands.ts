import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, BolloingerBandsParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

export default class BollingerBands extends AbstractIndicator {
    protected params: BolloingerBandsParams; // TA-LIB says "overlap studies", though it's different from our line cross indicators
    protected valuesBollinger: number[] = [];

    protected upperValue: number = -1;
    protected middleValue: number = -1;
    protected lowerValue: number = -1;

    protected bandwidthHistory: number[] = [];

    constructor(params: BolloingerBandsParams) {
        super(params)
        this.params = Object.assign(new BolloingerBandsParams(), this.params); // params come in without type (ok for interfaces)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.valuesBollinger = this.addData(this.valuesBollinger, candle.close, this.params.N);
            if (this.valuesBollinger.length < this.params.N)
                return resolve(); // not enough data yet

            let bollingerParams = new TaLibParams("BBANDS", this.valuesBollinger, this.params.N);
            bollingerParams.optInNbDevUp = this.params.K;
            bollingerParams.optInNbDevDn = this.params.K;
            bollingerParams.optInMAType = this.params.MAType;
            this.taLib.calculate(bollingerParams).then((result) => {
                this.computeValues(result)
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public removeLatestCandle() {
        this.valuesBollinger = this.removeLatestData(this.valuesBollinger);
    }

    public isReady() {
        return this.upperValue !== -1 && this.middleValue !== -1 && this.lowerValue !== -1 && this.valuesBollinger.length >= this.params.N;
    }

    /**
     * Get %b
     * https://en.wikipedia.org/wiki/Bollinger_Bands
     * @param lastPrice the current market price
     * @returns {number} 1 = price at upper band, 0 = price at lower band. Price can be outside the bands = higher 1 or lower 0
     */
    public getPercentB(lastPrice: number) {
        return (lastPrice - this.lowerValue) / (this.upperValue - this.lowerValue);
    }

    /**
     * A measure of volatility. Higher values mean higher volatility.
     * @returns {number}
     */
    public getBandwidth() {
        return (this.upperValue - this.lowerValue) / this.middleValue;
    }

    /**
     * Indicates how much the current bandwidth is away from the average bandwidth (over the last 3*N candles).
     * @returns {number} 1 if current bandwidth === average, < 1 if current bw is less, > 1 if current bw is greater than avg bw
     */
    public getBandwidthAvgFactor() {
        if (this.bandwidthHistory.length < this.params.bandwidthHistoryLen)
            return 1;
        let sum = 0;
        for (let i = 0; i < this.bandwidthHistory.length; i++)
            sum += this.bandwidthHistory[i]
        let avg = sum / this.bandwidthHistory.length;
        return this.getBandwidth() / avg;
    }

    public getUpperValue() {
        return this.upperValue;
    }

    public getMiddleValue() {
        return this.middleValue;
    }

    public getLowerValue() {
        return this.lowerValue;
    }

    public getAllValues() {
        let last = this.valuesBollinger.length !== 0 ? this.valuesBollinger[this.valuesBollinger.length-1] : 0;
        return {
            percentB: this.getPercentB(last),
            bandwidth: this.getBandwidth(),
            bandwidthAvgFactor: this.getBandwidthAvgFactor(),
            upperValue: this.upperValue,
            middleValue: this.middleValue,
            lowerValue: this.lowerValue
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected computeValues(result: TaLibResult) {
        this.upperValue = TaLib.getLatestResultPoint(result, "outRealUpperBand");
        this.middleValue = TaLib.getLatestResultPoint(result, "outRealMiddleBand");
        this.lowerValue = TaLib.getLatestResultPoint(result, "outRealLowerBand");
        //if (this.upperValue >= 0 && this.middleValue >= 0 && this.lowerValue >= 0)
            //logger.verbose("Computed %s values: upper %s, middle %s, lower %s", this.className, this.upperValue, this.middleValue, this.lowerValue)
        this.addBandwidthHistory()
    }

    protected addBandwidthHistory() {
        this.bandwidthHistory.push(this.getBandwidth())
        if (this.bandwidthHistory.length > this.params.bandwidthHistoryLen)
            this.bandwidthHistory.shift();
    }
}

export {BollingerBands}