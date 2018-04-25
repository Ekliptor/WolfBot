import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";

interface ExtrapolationAction extends StrategyAction {
}

/**
 * Use extrapolation to predict the next candle close price
 * http://borischumichev.github.io/everpolate/#step
 * alternative library: https://www.npmjs.com/package/extrapolate
 * Might not work well enough to predict prices, but the predicted value can be used as EMA/SMA input
 * to remove the lag. Or we can extrapolate the EMA/SMA itself.
 */
export default class Extrapolation extends AbstractStrategy {
    protected action: ExtrapolationAction;

    constructor(options) {
        super(options)
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            resolve()
        })
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {

            resolve()
        })
    }
}