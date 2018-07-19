
// TODO look at interest rates of exchanges (supported with AbstractLendingExchange)
// if interest rates for an altcoin are high -> many people shorten it -> go short too
// if interest rates for BTC are high -> people expect altcoins to rise -> go long

// TODO https://blog.bitmex.com/funding-mean-reversions-2018/
// TODO look at time spread of futures
// TODO tradingview buy vs sell widget: https://coinfarm.online/index.asp?tcs=1h


import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";


/**
 */
export default class InterestIndicator extends AbstractStrategy {
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