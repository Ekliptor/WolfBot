import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Candle, Currency, Trade, Order, Ticker, MarketOrder} from "@ekliptor/bit-models";
import * as helper from "../utils/helper";


export class MaxSpreadCandles {
    protected minCandle: Candle.Candle;
    protected maxCandle: Candle.Candle;

    constructor(minCandle: Candle.Candle, maxCandle: Candle.Candle) {
        this.minCandle = minCandle;
        this.maxCandle = maxCandle;
    }

    public getMinCandle() {
        return this.minCandle;
    }

    public getMaxCandle() {
        return this.maxCandle;
    }

    public getSpreadPercentage() {
        return Math.abs(helper.getDiffPercent(this.minCandle.close, this.maxCandle.close))
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}