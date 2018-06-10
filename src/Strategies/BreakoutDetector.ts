
// TODO use 1min RSI and 5min Bolliner Bands. if RSI is high/low and the price is
// at the higher/lower band we assume this breakout trend will continue and buy/sell.

// TODO how to combine 2 candleSizes in 1 strategy? use CandleBatcher for 1min candles in strategy?
// or better make candleSize config an array and check the interval in candleTick()
// or we could allow for a design where a strategy can instantiate other sub strategies (and add them to config at runtime)


import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";


/**
 */
export default class BreakoutDetector extends AbstractStrategy {
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