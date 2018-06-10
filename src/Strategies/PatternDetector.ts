
// TODO detect common paterns of candlestick data and trade accordingly
// IntervalExtremes already implements this and counts patterns (no trading based on them yet)
// http://www.investopedia.com/terms/e/eveningstar.asp


import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";


/**
 */
export default class PatternDetector extends AbstractStrategy {
    constructor(options) {
        super(options)
        throw new Error(this.className + " is not yet implemented");
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            resolve()
        })
    }
}