
// TODO implement Wyckkoff method to analyize volume
/**
 * spread = volatility, BBannds
 * Rally:
 1. Increased spread and volume              ->  Demand is present
 2. Increased spread and decreased volume    ->  A lack of supply
 3. Decreased spread and volume              ->  A lack of demand
 4. Decreased spread and increased volume    ->  Supply is coming into the market

 Reaction:
 1. Increased spread and volume              ->  Supply is present
 2. Increased spread and decreased volume    ->  A lack of demand, desire to sell
 3. Decreased spread and volume              ->  A lack of supply
 4. Decreased spread and increased volume    ->  Demand is coming into the market
 */


import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";


/**
 */
export default class Wyckoff extends AbstractStrategy {
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