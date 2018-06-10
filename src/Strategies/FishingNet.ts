
// TODO https://cryptotrader.org/topics/501391/fisherman-s-friend-margin-bot-proposal
// A Strategy that starts buying amounts on/after a peak as the price declines.
// It starts with small amounts and increases the size of the orders as the price goes down (thus dividing the total order
// size into chunks of increasing size). As the prices falls into this "fishing net", our losses increase, but since we bought
// larger amounts at a lower price it doesn't take long to get a profit at any point as soon as the market turns.

import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";


/**
 */
export default class FishingNet extends AbstractStrategy {
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