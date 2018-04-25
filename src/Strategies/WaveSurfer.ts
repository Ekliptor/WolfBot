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
 * The default implementation of WaveSurfer which can handle buys and sells.
 */
export default class WaveSurfer extends AbstractWaveSurfer {

    constructor(options) {
        super(options)
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

}