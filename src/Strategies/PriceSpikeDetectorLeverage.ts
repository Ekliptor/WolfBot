import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {default as PriceSpikeDetector} from "./PriceSpikeDetector";
import {TradeDirection} from "../Trade/AbstractTrader";

interface PriceSpikeLeverageAction extends StrategyAction {
    spikePercent: number; // 3.0% // as x% price difference (higher/lower) as the last candle
    endOfSpike: boolean; // optional, default false. true = wait until the spike reverses, false = buy/sell immediately with the spike
    historyCandle: number; // optional, default 36. how many candles to look back to compare if price really is a spike. set 0 to disable it

    // optionally set a min/max price
    stop: number; // 0.05226790 BTC
    // optional. default buy = <, sell = >
    // does the price have to be higher or lower than the stop?
    comp: "<" | ">";

    // look at last x candles to check for a spike too. default disabled
    spikeHistoryPercent: number; // 5.5%
    historyCandleCount: number; // 3

    tradeDirection: TradeDirection | "notify" | "watch"; // optional. default "both"
    tradeOppositeDirection: boolean; // optional. default "false" = don't trade if we have an open position in the other direction
    strongRate: boolean; // optional. default true = adjust the rate to ensure the order gets filled immediately
    onlyDailyTrend: boolean; // optional. default true = only trade when the spike is in the same direction as the 24h % change
}

/**
 * Detect if the price of spikes x % up/down (compared to the last candle).
 */
export default class PriceSpikeDetectorLeverage extends PriceSpikeDetector {

    protected action: PriceSpikeLeverageAction;

    constructor(options) {
        super(options)
        // no need to "inherit" IndexStrategy Mixin. we only use this as a secondary strategy
        // the purpose of this strategy is to open immediately on a spike and not confirm with the market trend
        // BTC 0.28 and LTC 0.33 still causes too many false positives
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    public getOrderAmount(tradeTotalBtc: number, leverage: number = 1): number {
        // TODO proper support for using coin currency in config (and UI)
        let amountBase = tradeTotalBtc * leverage * /*this.ticker.last*/this.avgMarketPrice;
        return amountBase;
    }

    public getBacktestClassName() {
        return "PriceSpikeDetector";
    }
}