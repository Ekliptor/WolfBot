
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
 * A simple version of WaveSurfer as StopLoss that only exits the market once a candle moves in the
 * other direction. The candle size should be larger.
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