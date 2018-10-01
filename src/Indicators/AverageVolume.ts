import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, MomentumIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import * as _ from "lodash";


/**
 * Indicator computing the average volume of 'interval' candles.
 */
export default class AverageVolume extends AbstractIndicator {
    protected params: MomentumIndicatorParams;
    protected candleVolumes: number[] = [];
    protected lastVolume: number = 0.0;
    //protected averageVolume: number = 0.0; use value

    constructor(params: MomentumIndicatorParams) {
        super(params)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.addCandleVolume(candle);
            this.value = _.sum(this.candleVolumes) / this.candleVolumes.length;
            this.lastVolume = candle.volume;
            // TODO add volume EMA and more...
            resolve()
        })
    }

    public addTrades(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            resolve()
        })
    }

    /**
     * Returns a factor how big volume of the latest candle was relative to average volume.
     * @return {number} values > 1.0 meaning the volume was bigger, values < 1.0 mean it was lower.
     */
    public getVolumeFactor() {
        if (this.value === 0.0)
            return 1.0; // no data yet
        return this.lastVolume / this.value;
    }

    public getAllValues() {
        return {
            averageVolume: this.value,
            volumeFactor: this.getVolumeFactor()
        }
    }

    public isReady() {
        return this.candleVolumes.length >= this.params.interval;
    }

    public serialize() {
        let state = super.serialize();
        state.candleVolumes = this.candleVolumes;
        state.lastVolume = this.lastVolume;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.candleVolumes = state.candleVolumes;
        this.lastVolume = state.lastVolume;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected addCandleVolume(candle: Candle.Candle) {
        this.candleVolumes.push(candle.volume);
        if (this.candleVolumes.length > this.params.interval)
            this.candleVolumes.shift();
    }

}

export {AverageVolume}