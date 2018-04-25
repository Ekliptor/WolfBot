import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction, ScheduledTrade} from "./AbstractStrategy";
import {AbstractWaveSurfer, WaveSurferAction} from "./AbstractWaveSurfer";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import {MarginPosition} from "../structs/MarginPosition";

interface WaveOpenerAction extends WaveSurferAction {
    patternSize: number; // optional, default 6. how many candles to keep in the pattern (to search for highs + lows)
}

/**
 * A WaveSurfer with a smaller candle size that will only open a position at the low/high point.
 */
export default class WaveOpener extends AbstractWaveSurfer {
    public action: WaveOpenerAction;

    constructor(options) {
        //if (!this.action.patternSize)
            //this.action.patternSize = 6;
        if (!options.patternSize && !options.PATTERN_SIZE)
            options.PATTERN_SIZE = 6;
        else
            options.PATTERN_SIZE = options.PATTERN_SIZE ? options.PATTERN_SIZE : options.patternSize;
        options.minSurfCandles = 1; // not used here because another strategy is closing
        super(options)
    }

    public isActiveStrategy() {
        // TODO allow opening again as scalping option if longTrend == up and there is a sharp drop
        return this.strategyPosition === "none";
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected exitMarket() {
        // nothing to do, up to other strategies
    }
}