
// TODO implement Bid Ask Sum strategy
/**
 * https://data.bitcoinity.org/markets/bidask_sum/30d/USD/bitfinex?bp=1&bu=c&t=m
 * look at bids and asks within 1% of current price
 * price spike and asks (offers) increasing -> big money offloading at higher price (distribution) -> bearish sign
 * -> retail traders market buy at high pries
 * opposite: accumulation: big falloff in bids -> price crashes (just like stop-loss hunt) -> big money bus -> bullish sign
 * also see Wyckoff
 */


import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";


/**
 */
export default class BidAskSum extends AbstractStrategy {
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