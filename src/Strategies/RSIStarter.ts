import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import * as helper from "../utils/helper";

interface RSIStarterAction extends TechnicalStrategyAction {
    low: number;
    high: number;
    lowStartFactor: number; // optional, default 0.75, max 1.0 = always immediately. the bot will enter a trend immediately if RSI <= lowStartFactor*low, otherwise wait for the end of it and go long
    candlePercentReverse: number; // optional, default 4.0. how many percent the last candle has to go in the other direction to enter the market at the end of a spike/drop
    pauseCandles: number; // optional, default 25. how many candles to pause after a bad trade
    historyCandleSize: number; // optional, default 60. candle size in min to check for the long trend
}

/**
 * A strategy that only opens positions based on RSI (should be used together with other strategies)
 * 1. after a sharp drop when the price goes up again (scalping, also see MomentumTurn strategy)
 * 2. when there is a sudden spike upwards
 */
export default class RSIStarter extends TechnicalStrategy {
    protected static readonly PAUSE_TICKS = 25;
    protected static readonly HISTORY_CANDLE_SIZE = 10;

    public action: RSIStarterAction;
    protected scheduledOrder: TradeAction = null;
    protected pauseTicks: number = 0; // pause after a wrong decision to prevent waiting for a turn in longer trends

    constructor(options) {
        super(options)
        if (!this.action.lowStartFactor)
            this.action.lowStartFactor = 0.75;
        if (this.action.lowStartFactor > 1.0)
            this.action.lowStartFactor = 1.0;
        if (!this.action.candlePercentReverse)
            this.action.candlePercentReverse = 4.0;
        if (!this.action.pauseCandles)
            this.action.pauseCandles = RSIStarter.PAUSE_TICKS;
        if (!this.action.historyCandleSize)
            this.action.historyCandleSize = RSIStarter.HISTORY_CANDLE_SIZE;
        this.saveState = true;

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
        // TODO only open again if value increasing (to prevent opening again after another strategy just closed it) ?
        // but pauseCandles should have the same effect
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        if (this.pauseTicks > 0) {
            this.pauseTicks--;
            return;
        }
        else if (!this.canTrade())
            return;

        let rsi = this.indicators.get("RSI")
        const value = rsi.getValue();
        if (value > this.action.high) {
            this.log("UP trend detected, value", value)
            this.emitBuy(this.defaultWeight, "RSI value: " + value); // enter into an up trend immediately
            //this.scheduledOrder = "sell";
        }
        /* // TODO add a factor to wait for the end of an up trend? up trends are very long and heavy in crypto land...
        else if (value > this.action.high * this.action.lowStartFactor) {
            this.log("UP trend detected, waiting for the end, value", value)
            //this.emitBuy(this.defaultWeight, "RSI value: " + value);
            this.scheduledOrder = "sell"; // sell at the end of the up trend
        }
        */
        else if (value < this.action.low * this.action.lowStartFactor) {
            this.log("DOWN trend detected, value", value)
            this.emitSell(this.defaultWeight, "RSI value: " + value + ", threshold: " + (this.action.low * this.action.lowStartFactor).toFixed(1)); // enter into a down trend immediately
        }
        else if (value < this.action.low) {
            this.log("DOWN trend detected, waiting for the end, value", value)
            //this.emitSell(this.defaultWeight, "RSI value: " + value);
            this.scheduledOrder = "buy"; // Scalping once the drop ends
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
        let rsi = this.indicators.get("RSI")
        const value = rsi.getValue();

        if (this.scheduledOrder === "buy" && value >= this.action.low &&
            (this.candleTrend !== "down" || helper.getDiffPercent(this.candle.close, this.candle.low) > this.action.candlePercentReverse)) {
            if (this.candleTrendMatches("down", historyCandles)) {
                this.log("Skipping RSIStarter turn BUY because long candle trend is down")
                this.scheduledOrder = null;
            }
            else {
                this.emitBuy(this.defaultWeight, "End of RSI oversold");
                this.scheduledOrder = null;
                this.pauseTicks = this.action.pauseCandles; // just pause after every trade for now // TODO improve
            }
        }
        else if (this.scheduledOrder === "sell" && value <= this.action.high &&
            (this.candleTrend !== "up" || helper.getDiffPercent(this.candle.high, this.candle.close) > this.action.candlePercentReverse)) {
            if (this.candleTrendMatches("up", historyCandles)) {
                this.log("Skipping RSIStarter turn SELL because long candle trend is up")
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