
// TODO A strategy that recovers a margin position which is currently at a loss (without closing it in between trades).
// Works well together with StopLossTurnPartial to prevent further losses.

// config
// targetGain - the % gain/loss when the position shall be closed. negative for loss
// minGainRun - the min % gain per single buy/sell run
// trailingTakeProfitStop - the trailing stop in % that wll be placed after minGainRun is reached


import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";


/**
 */
export default class MarginPositionRecovery extends AbstractStrategy {
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