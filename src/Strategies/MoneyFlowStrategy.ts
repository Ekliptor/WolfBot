
// TODO A strategy that finds patterns where the money flows between currencies.
// For example BTC goes down and XRP or BCH up.
// TODO requires strategy API to access other currencies within a strategy

import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";


/**
 */
export default class MoneyFlowStrategy extends AbstractStrategy {
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