import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, IntervalIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

export interface CryptoTraderInstrument { // just candle arrays
    low: number[];
    high: number[];
    close: number[];
}

/**
 * Abstract indicator class with similar members as the cryptotrader.org API for easier portability.
 */
export abstract class AbstractCryptotraderIndicator extends AbstractIndicator {
    protected params: IntervalIndicatorParams;
    protected result: any = {};

    // ported parameters
    protected instrument: CryptoTraderInstrument = {
        low: [],
        high: [],
        close: []
    }

    constructor(params: IntervalIndicatorParams) {
        super(params)
    }

    public getResult() {
        return this.result;
    }

    public getAllValues() {
        if (Object.keys(this.result).length === 0)
            logger.error("Empty result in %s. Please initialize result properties in the constructor", this.className)
        return this.result;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected updateInstrument(candle: Candle.Candle) {
        this.instrument.low.push(candle.low);
        this.instrument.high.push(candle.high);
        this.instrument.close.push(candle.close);
        // be convervative and allow a lot more data, we don't know what the subclass will do with it
        if (this.instrument.low.length > this.params.interval*AbstractIndicator.KEEP_OLD_DATA_FACTOR*2) {
            this.instrument.low.shift();
            this.instrument.high.shift();
            this.instrument.close.shift();
        }
    }
}