
// TODO take a coin that has USD and BTC trading pair. for example XRP
// 1. compute the price: XRP/USD / BTC/USD -> USD gets out and we get a computed XRP/BTC price
// 2. trade the XRP/BTC under the assumption that this price will follow the computed price
// might work better if the computed price is on a high volume exchange and the actual rate on a low volume exchange

// TODO add API to allow following multiple pairs and compute rates


import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";


/**
 */
export default class CurrencyPairArbitrage extends AbstractStrategy {
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