
// TODO measure sharp drops in prices (or even better check on huge orders that cause those drops in advance?)
// forced liquidation at 20% -> deposit/value = 1/5 < 0.2 will cause many more more sells
// assume: 1 coin deposit last check / value now (relative to current coin and to BTC as deposit)


import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";


/**
 */
export default class MarginCallBuyer extends AbstractStrategy {
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