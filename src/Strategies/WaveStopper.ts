
// TODO a simple version of WaveSurfer as StopLoss that exits the market once a candle moves in
// the other direction (after minSurfCandles)

import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction, ScheduledTrade} from "./AbstractStrategy";
import {AbstractWaveSurfer, WaveSurferAction} from "./AbstractWaveSurfer";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import {MarginPosition} from "../structs/MarginPosition";

/**
 * A simpler version of WaveSurfer that only closes positions once the market moves x candles in the
 * other direction. The value of x depends on 'minSurfCandles' and 'patternSize'. This strategy can be used
 * as a stop loss strategy. The candle size should be larger than when opening positions (>1h).
 * See WaveSurfer strategy for more details.
 */
export default class WaveStopper extends AbstractWaveSurfer {

    constructor(options) {
        super(options)
    }

    public isActiveStrategy() {
        return this.strategyPosition !== "none";
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tradeWithPattern() {
        // nothing to do, up to other strategies
        return false;
    }
}