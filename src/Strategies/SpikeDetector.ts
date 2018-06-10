
// TODO if there is a huge spike (or drop) of a small altoin in 24h % change we sell our alt coins

// TODO ExchangeSpike Strategy (not really "Arbitrage")
// if the value on an exchange suddenly drops (compared to others) this might mean a local bull-trap + panic/margin sell on that exchange
// if the same drop doesn't occur on other exchanges -> buy immediately
// on those spikes the exchange often lags -> detect that in get/post methods
// if DASH "instant send" would work between exchanges we could even use that as a real Arbitrage Strategy


import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";


/**
 */
export default class SpikeDetector extends AbstractStrategy {
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