import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";
import {AbstractCandlestickPatterns} from "./AbstractCandlestickPatterns";
import {bullish, bearish} from "technicalindicators";


export default class NodeCandlestick extends AbstractCandlestickPatterns {
    constructor() {
        super()
    }

    public isBullishAny() {
        return bullish(this.candleInput);
    }

    public isBearishAny() {
        return bearish(this.candleInput);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}