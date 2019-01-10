
// TODO https://www.youtube.com/watch?v=gG1iCf1EAig
/**
 * look for price high/low bars with with volume (1 min candles or small)
 * compute where these people entering with the trend at 100x get liquidated
 * place a limit buy/sell order near that price to catch their liquidations
 * those price points should be crossed after entry (to allow people to exit at profit). else there won't be many liquidations
 */

import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";


/**
 */
export default class LiquidationCatcher extends AbstractStrategy {
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