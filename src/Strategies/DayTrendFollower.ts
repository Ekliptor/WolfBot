import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeDirection, TradeInfo} from "../Trade/AbstractTrader";
import {Trendlines} from "../Indicators/Trendline/Trendlines";
import {FibonacciRetracement} from "../Indicators/Trendline/FibonacciRetracement";

interface DayTrendFollowerAction extends StrategyAction {
    entryMode: "setback" | "candlestick"; // enter the market after setback % or by candlestick patterns
    entrySetbackPercent: number; // 1.5% // the percentage the last candle has to go against the daily trend to find a good entry point
    // can be 0 to use dynamic setback: >= historyCandles average movement
    dynamicFactor: number; // 0.7 // optional, default 1.0. a factor to multiply the dynamic setback with

    // optional values
    maxDailyTrend: number; // 20.0% // default 0. the max percentage of the daily trend to assume it will continue
    historyCandles: number; // default 10. the number of candles to use for dynamic setback
    closeLossCandles: number; // default 0. close an existing position if it's in loss for x candles
    trendLineDays: number; // default 0 = disabled. use a high + low trendline for x days to close a position immediately if the line gets crossed
    // TODO option to use fibonacci instead of trendline
    tradeDirection: TradeDirection; // default "both"
}

/**
 * Strategy that looks at the daily trend of the market (trends tend to continue).
 * It then trades on a small candle size (30 min) in that market.
 * Opens multiple positions daily.
 * Developed for fast moving markets (XRP), but works extremely well in low volatility markets with 2% daily change (LTC).
 * This strategy needs StopLoss and/or TakeProfit strategies to close positions (closeLossCandles can be StopLoss).
 * Similar to CandleRepeater and SimpleAndShort strategy.
 */
export default class DayTrendFollower extends AbstractStrategy {
    protected action: DayTrendFollowerAction;
    protected requiredEntrySetbackPercent = 0.0;
    protected positionOpenCandles = 0;

    constructor(options) {
        super(options)
        if (!this.action.dynamicFactor)
            this.action.dynamicFactor = 1.0;
        if (!this.action.maxDailyTrend)
            this.action.maxDailyTrend = 0.0;
        if (!this.action.historyCandles)
            this.action.historyCandles = 10;
        if (!this.action.closeLossCandles)
            this.action.closeLossCandles = 0;
        if (!this.action.trendLineDays)
            this.action.trendLineDays = 0;
        if (!this.action.tradeDirection)
            this.action.tradeDirection = "both";
        if (this.action.entryMode === "candlestick")
            this.candlesticks = this.loadCandlestickPatternRecognizer(nconf.get("serverConfig:candlestickPatternRecognizer"))
        if (this.action.trendLineDays) {
            this.trendlines = new Trendlines();
            this.addInfoFunction("resistance", () => {
                return this.trendlines.getResistanceLine(this.action.trendLineDays*24)
            })
            this.addInfoFunction("support", () => {
                return this.trendlines.getSupportLine(this.action.trendLineDays*24)
            })
        }
        this.fibonacci = new FibonacciRetracement();

        // TODO add RSI to prevent buying on overbought? and use it instead of setback percent?
        this.addInfo("done", "done");
        this.addInfo("requiredEntrySetbackPercent", "requiredEntrySetbackPercent");
        this.addInfo("positionOpenCandles", "positionOpenCandles");
        this.addInfoFunction("dailyChange", () => {
            return this.getDailyChange()
        })
        this.addInfoFunction("candleChange", () => {
            return this.getLastCandleChange()
        })
        this.saveState = true;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            this.done = false;
        }
    }

    public serialize() {
        let state = super.serialize();
        state.positionOpenCandles = this.positionOpenCandles;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.positionOpenCandles = state.positionOpenCandles;
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
            super.candleTick(candle)
            this.computeRequiredEntrySetback();
            this.followDailyTrendCandle();
            resolve()
        })
    }

    protected followDailyTrendCandle() {
        if (this.strategyPosition !== "none") {
            this.positionOpenCandles++; // TODO check pending TriggerOrders? or submit close as trigger order?
            if (this.action.closeLossCandles > 0 && !this.hasProfit(this.entryPrice) && this.positionOpenCandles >= this.action.closeLossCandles) {
                this.emitClose(Number.MAX_VALUE, utils.sprintf("position at a loss after %s candles", this.positionOpenCandles))
                return;
            }
            if (this.action.trendLineDays > 0 && this.trendlines.isReady(this.action.trendLineDays*24)) {
                if (this.strategyPosition === "long" && !this.trendlines.supportHolding(this.action.trendLineDays*24, this.avgMarketPrice)) {
                    this.emitClose(Number.MAX_VALUE, utils.sprintf("support line at %s broken", this.trendlines.getSupportLine(this.action.trendLineDays*24).toFixed(8)))
                    return;
                }
                else if (this.strategyPosition === "short" && !this.trendlines.resistanceHolding(this.action.trendLineDays*24, this.avgMarketPrice)) {
                    this.emitClose(Number.MAX_VALUE, utils.sprintf("resistance line at %s broken", this.trendlines.getResistanceLine(this.action.trendLineDays*24).toFixed(8)))
                    return;
                }
            }
        }

        //if (this.strategyPosition !== "none") // always allow to trade once
        if (this.done)
            return;

        this.plotChart();
        //console.log("down", this.fibonacci.getFibonacciRetracement("down"));
        //console.log("up", this.fibonacci.getFibonacciRetracement("up"));
        //console.log("down", this.fibonacci.getFibonacciFromHigh());
        //console.log("up", this.fibonacci.getFibonacciFromLow());

        // wait for 1 candle in the opposite direction as an entry point
        const dailyChange = this.getDailyChange();
        if (this.action.maxDailyTrend && Math.abs(dailyChange) > this.action.maxDailyTrend)
            return this.log(utils.sprintf("Skipped following daily trend because it's gone too far %s%%", dailyChange));
        const requiredSetback = this.action.entrySetbackPercent > 0.0 ? this.action.entrySetbackPercent : this.requiredEntrySetbackPercent;
        if (dailyChange === -1 || requiredSetback == 0.0)
            return; // not yet ready

        const candleChange = this.getLastCandleChange();
        const candleChangeAbs = Math.abs(candleChange);
        if (dailyChange > 0.0 && this.strategyPosition !== "short") { // don't trade in the opposite direction of our position
            // TODO also check 2 last candles combined?
            if (this.action.entryMode === "setback") {
                if (candleChange < 0.0 && candleChangeAbs >= requiredSetback)
                    this.openLong(utils.sprintf("Daily trend UP %s%%, last candle trend was DOWN with %s%%", dailyChange, candleChange));
                else
                    this.log(utils.sprintf("Skipped opening LONG position on candle trend %s because no good entry point %s%% candle change, required %s%%", this.candleTrend.toUpperCase(), candleChange, requiredSetback))
            }
            else {
                // our tests show we have better results if we still wait for a candle in the other direction
                if (candleChange < 0.0 && this.candlesticks.isBullishAny())
                    this.openLong(utils.sprintf("Bullish pattern, daily trend UP %s%%, last candle trend %s%%", dailyChange, candleChange));
                else
                    this.log(utils.sprintf("Skipped opening LONG position on candle trend %s because no bullish pattern %s%% candle change", this.candleTrend.toUpperCase(), candleChange))
            }
        }
        else if (dailyChange < 0.0 && this.strategyPosition !== "long") {
            if (this.action.entryMode === "setback") {
                if (candleChange > 0.0 && candleChangeAbs >= requiredSetback)
                    this.openShort(utils.sprintf("Daily trend DOWN %s%%, last candle trend was UP with %s%%", dailyChange, candleChange));
                else
                    this.log(utils.sprintf("Skipped opening SHORT position on candle trend %s because no good entry point %s%% candle change, required %s%%", this.candleTrend.toUpperCase(), candleChange, requiredSetback))
            }
            else {
                if (candleChange > 0.0 && this.candlesticks.isBearishAny())
                    this.openShort(utils.sprintf("Bearish pattern, daily trend DOWN %s%%, last candle trend %s%%", dailyChange, candleChange));
                else
                    this.log(utils.sprintf("Skipped opening SHORT position on candle trend %s because no bearish pattern %s%% candle change", this.candleTrend.toUpperCase(), candleChange))
            }
        }
        else
            this.log(utils.sprintf("No entry point or existing opposite position, daily %s%%, candle change %s%%", dailyChange, candleChange))
    }

    protected openLong(reason: string) {
        if (this.action.tradeDirection === "down")
            return this.log("Skipped opening LONG position because trade direction is set to DOWN only. reason: " + reason);
        //else if (!this.action.tradeOppositeDirection && this.strategyPosition === "short")
            //return this.log("Skipped opening LONG position because we have an open SHORT position. reason: " + reason);
        this.log(reason);
        this.emitBuy(Number.MAX_VALUE, reason);
        //this.done = true; // wait until the trade actually happened in onTrade() - exchange might be down, insufficient balance,...
    }

    protected openShort(reason: string) {
        if (this.action.tradeDirection === "up")
            return this.log("Skipped opening SHORT position because trade direction is set to UP only. reason: " + reason);
        //else if (!this.action.tradeOppositeDirection && this.strategyPosition === "long")
            //return this.log("Skipped opening SHORT position because we have an open LONG position. reason: " + reason);
        this.log(reason);
        this.emitSell(Number.MAX_VALUE, reason);
        //this.done = true;
    }

    protected computeRequiredEntrySetback() {
        let candles: Candle.Candle[] = []
        for (let i = 0; i < this.action.historyCandles; i++)
        {
            let candle = this.getCandleAt(i);
            if (!candle)
                break;
            candles.push(candle);
        }
        let avgChange = 0.0;
        if (candles.length === 0) // TODO or wait for all historyCandles?
            return;
        candles.forEach((candle) => {
            avgChange += Math.abs(candle.getPercentChange())
        })
        this.requiredEntrySetbackPercent = Math.round(avgChange / candles.length * this.action.dynamicFactor * 100) / 100.0;
    }

    protected getLastCandleChange() {
        if (!this.candle)
            return -1;
        const candleChange = this.candle.getPercentChange();
        return Math.round(candleChange * 100) / 100.0; // 2 decimals is enough for display
    }

    protected plotChart() {
        if (this.candlesticks) {
            let plotMarks: any = {}
            if (this.candlesticks.isBullishAny())
                plotMarks.bullish = 10;
            if (this.candlesticks.isBearishAny())
                plotMarks.bearish = 1;
            this.plotData.plotMark(plotMarks, true, true)
        }
        if (this.trendlines && this.trendlines.isReady(this.action.trendLineDays*24)) {
            this.plotData.plotMark({
                resistance: this.trendlines.getResistanceLine(this.action.trendLineDays*24),
                support: this.trendlines.getSupportLine(this.action.trendLineDays*24),
            })
        }
    }

    protected resetValues(): void {
        this.positionOpenCandles = 0; // reset it every time we trade
        super.resetValues();
    }
}