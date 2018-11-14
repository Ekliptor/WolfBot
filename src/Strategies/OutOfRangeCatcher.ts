
// TODO a strategy that places orders outside of the trading range on high price-volume nodes of the
// volume profile. Used best with an execution strategy such as RSIScalpOrderer with a very low candleSize (1-3min).
// could be based on PingPong
// TODO problem: if it's out of the trading range, the short term volume profile will only have low value nodes too there


import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";


/**
 */
export default class OutOfRangeCatcher extends AbstractStrategy {
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