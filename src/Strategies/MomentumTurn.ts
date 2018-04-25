import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import * as helper from "../utils/helper";

interface MomentumTurnAction extends TechnicalStrategyAction {
    low: number;
    high: number;
    pauseCandles: number; // optional, default 25. how many candles to pause after a bad trade
    historyCandleSize: number; // optional, default 60. candle size in min to check for the long trend
}

/**
 * A strategy that looks for RSI overbought/oversold signals and waits for this momentum to stop.
 * Then it opens a position in the other direction. Used for short-time trading intervals (5min).
 */
export default class MomentumTurn extends TechnicalStrategy {
    protected static readonly CANDLE_PERCENT_SPREAD_END = 3.5;
    protected static readonly PAUSE_TICKS = 25;
    protected static readonly HISTORY_CANDLE_SIZE = 60;

    public action: MomentumTurnAction;
    protected scheduledOrder: TradeAction = null;
    protected pauseTicks: number = 0; // pause after a wrong decision to prevent waiting for a turn in longer trends

    constructor(options) {
        super(options)
        if (!this.action.pauseCandles)
            this.action.pauseCandles = MomentumTurn.PAUSE_TICKS;
        if (!this.action.historyCandleSize)
            this.action.historyCandleSize = MomentumTurn.HISTORY_CANDLE_SIZE;

        this.addIndicator("RSI", "RSI", this.action);
        this.addInfoFunction("low", () => {
            return this.action.low;
        });
        this.addInfoFunction("high", () => {
            return this.action.high;
        });
        this.addInfoFunction("interval", () => {
            return this.action.interval;
        });
        this.addInfoFunction("RSI", () => {
            return this.indicators.get("RSI").getValue();
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        if (this.pauseTicks > 0) {
            this.pauseTicks--;
            return;
        }
        let rsi = this.indicators.get("RSI")
        const value = rsi.getValue();
        if (value > this.action.high) {
            this.log("UP trend detected, value", value)
            //this.emitBuy(this.defaultWeight, "RSI value: " + value);
            this.scheduledOrder = "sell";
        }
        else if (value < this.action.low) {
            this.log("DOWN trend detected, value", value)
            //this.emitSell(this.defaultWeight, "RSI value: " + value);
            this.scheduledOrder = "buy";
        }
        //else
            //this.log("no trend detected, value", value)
        this.checkEndOfTrend();
    }

    protected checkEndOfTrend() {
        if (!this.scheduledOrder)
            return;

        // check the longer candle trend and don't buy sell if that trend goes down too. otherwise our momentum turn
        // isn't really a turn, but just a moment of more sells/buys in a longer down/up trend
        let historyCandles = this.getCandles(this.action.historyCandleSize, 5);

        if (this.scheduledOrder === "buy" && (this.candleTrend !== "down" || helper.getDiffPercent(this.candle.close, this.candle.low) > MomentumTurn.CANDLE_PERCENT_SPREAD_END)) {
            if (this.candleTrendMatches("down", historyCandles)) {
                this.log("Skipping momentum turn BUY because long candle trend is down")
                this.scheduledOrder = null;
            }
            else {
                this.emitBuy(this.defaultWeight, "End of RSI oversold");
                this.scheduledOrder = null;
                this.pauseTicks = this.action.pauseCandles; // just pause after every trade for now // TODO improve
            }
        }
        else if (this.scheduledOrder === "sell" && (this.candleTrend !== "up" || helper.getDiffPercent(this.candle.high, this.candle.close) > MomentumTurn.CANDLE_PERCENT_SPREAD_END)) {
            if (this.candleTrendMatches("up", historyCandles)) {
                this.log("Skipping momentum turn SELL because long candle trend is up")
                this.scheduledOrder = null;
            }
            else {
                this.emitSell(this.defaultWeight, "End of RSI value overbought");
                this.scheduledOrder = null;
                this.pauseTicks = this.action.pauseCandles;
            }
        }
    }
}