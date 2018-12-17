import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {AbstractStopStrategy, AbstractStopStrategyAction} from "./AbstractStopStrategy";
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import StopLossTurn from "./StopLossTurn";

interface StopLossTurnPartialAction extends AbstractStopStrategyAction {
    stop: number; // optional. a fixed stop price when to sell (< long position) or buy (> short position). if present takes precedence over "setback"
    percentage: number; // 70% // how many percent of the open position shall be closed
    setback: number; // 1.3% // in %
    setbackLong: number; // 2.5% // optional a higher setback for long positions. default = 0 = setback for both. setbackProfit takes precedence
    // time the threshold has to be passed to trigger the stop
    // "time" makes sense with higher setbacks (> 3%) to prevent "panic selling" on spikes
    time: number; // in seconds, optional
    // close early if the last high/low is x minutes back (instead of waiting for the stop to trigger)
    //closeTimeMin: number; // in minutes, optional, only use this if we have a profit already // removed, use TakeProfit strategy
    increaseTimeByVolatility: boolean; // optional, default false. increase the stop time during volatile markets. takes precedence over reduceTimeByVolatility
    reduceTimeByVolatility: boolean; // optional, default true. reduce the stop time during high volatility market moments
    keepTrendOpen: boolean; // optional, default true, don't close if the last candle moved in our direction (only applicable with "time" and "candleSize")
    forceMaker: boolean; // optional false, force the order to be a maker order
    //protectProfit: number; // optional, default 0 = disabled. close a a position immediately before a profit turns into a loss once this profit % is reached
    notifyBeforeStopSec: number; // optional, notify seconds before the stop executes

    // optional higher stop after a certain profit
    setbackProfit: number; // 2.5% // how much loss we allow once triggerProfit is reached (same value for long and short)
    triggerProfit: number; // 4.5% // the min profit to be reached for setbackProfit to replace setback (allow higher losses)
    timeProfit: number; // in seconds. a higher/lower time to close if position is in profit. reduce/increase time by volatility doesn't apply
    ensureProfit: boolean; // default true. ensure there is really profit before closing at "setbackProfit" (otherwise fallback to the normal stop)

    // optional RSI values: don't close short if RSI < low (long if RSI > high)
    low: number; // 52 // default 0 = disabled
    high: number; // 56
    interval: number; // default 9
}

/**
 * A stop loss strategy that follows a trend and triggers after the market moves "setback" percent into the other direction.
 * aka Trailing Stop Loss
 * This strategy only closes part of the position which is useful for margin trading to keep the loss open and increase the
 * position amount again later.
 * example:
 * "StopLossTurnPartial": {
          "order": "closeLong",
          "percentage": 85,
          "setback": 99.9,
          "setbackLong": 14.2,
          "time": 7200,
          "notifyBeforeStopSec": 1800,
          "reduceTimeByVolatility": false,
          "low": 52,
          "high": 56,
          "candleSize": 5,
          "pair": "USD_SAN",
          "enableLog": false
        },
 */
export default class StopLossTurnPartial extends StopLossTurn {
    public action: StopLossTurnPartialAction;
    protected enabled = true;

    constructor(options) {
        super(options)
        if (nconf.get("serverConfig:openOppositePositions")) {
            logger.error("serverConfig:openOppositePositions has to be disabled for %s to work. Disabling strategy", this.className)
            this.enabled = false;
        }

        this.addInfo("holdingCoins", "holdingCoins");
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
    }

    public getOrderAmount(tradeTotalBtc: number, leverage: number = 1): number {
        let amount = tradeTotalBtc * leverage;
        // TODO better support to specify amount in coins for futures, see getOrderAmount() of IndexStrategy
        // if StopLossTurn has a small candleSize it will do almost the same (but close the order completely)
        if (nconf.get("trader") !== "Backtester") { // backtester uses BTC as unit, live mode USD
            if (leverage >= 10 && this.isPossibleFuturesPair(this.action.pair) === true)
                amount = tradeTotalBtc * leverage * /*this.ticker.last*/this.avgMarketPrice;
        }

        // TODO tradeTotalBtc is the value from config. compare with this.holdingCoins to ensure we don't "close" too much if config changed (or manual trade)
        this.orderAmountPercent = this.action.percentage;
        if (!this.orderAmountPercent || this.orderAmountPercent === 100)
            return amount;
        return amount / 100 * this.orderAmountPercent;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected closeLongPosition() {
        if (this.enabled) {
            this.log("emitting sell because price dropped to", this.avgMarketPrice, "stop", this.getStopSell());
            this.emitSell(Number.MAX_VALUE, "price dropped" + (this.profitTriggerReached ? ", profit triggered" : ""));
        }
        this.done = true;
    }

    protected closeShortPosition() {
        if (this.enabled) {
            this.log("emitting buy because price rose to", this.avgMarketPrice, "stop", this.getStopBuy());
            this.emitBuy(Number.MAX_VALUE, "price rose" + (this.profitTriggerReached ? ", profit triggered" : ""));
        }
        this.done = true;
    }
}