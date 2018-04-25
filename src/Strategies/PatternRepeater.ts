import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction, ScheduledTrade} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import {ChartMark} from "./AbstractGenericStrategy";

interface PatternRepeaterAction extends TechnicalStrategyAction {
    patternSize: number;        // the size in candles the pattern shall have
    patternRepeat: number;      // the number of times the % changes of the candles have to repeat before we consider it a pattern
    maxOffset: number;          // optional, default 1. how many candles the highs/lows can be different in reptetitions to still be considered a pattern
    // optional, default true. always open a position in the other direction after a profitable trade (we can assume our pattern will work again)
    // only long positions will be repeated
    repeatProfit: boolean;
    takeProfitCandleSize: number; // optional, default 10. in minutes

    // Falling Knife Protection - don't buy/sell on overbought/oversold
    // RSI parameters (optional)
    interval: number;   // default 14
    low: number;        // default 30
    high: number;       // default 80 - crypto currencies have a trend to explode upwards
}

/**
 * A strategy that tries to identify patterns of x candles in size (patternSize) that repeat at least patternRepeat times.
 * Then assumes this pattern will repeat x times, adjust price levels and trade accordingly.
 * Backfinder is a good tool to find the good candle size of patterns.
 * Can not be done with a stop because a buy stop triggers at increasing price (and sell at decreasing).
 * Works well with high volume coins (ETH, LTC,..) but can fail badly with small coins because they have irregular spikes quite often.
 */
export default class PatternRepeater extends TechnicalStrategy {
    public action: PatternRepeaterAction;
    protected patternCandles: Candle.Candle[] = []; // the latest patternSize*patternRepeat candles
    protected intervalHighs: ChartMark[] = [];
    protected intervalLows: ChartMark[] = [];
    protected longTrend: TrendDirection = "none"; // the trend over all patternSize*patternRepeat candles
    protected lastRSI: number = -1;
    protected exitCandleCount = -1; // countdown to close our position if we don't find an optimal exit point
    protected postponedExit = false;
    protected lastTradeProfitable = false;
    protected scheduledTrade: ScheduledTrade = null;

    constructor(options) {
        super(options)
        if (this.action.patternRepeat < 2) {
            logger.error("patternRepeat has to be at least 2 in strategy %s", this.className)
            this.action.patternRepeat = 2;
        }
        if (!this.action.maxOffset)
            this.action.maxOffset = 1;
        if (typeof this.action.repeatProfit !== "boolean")
            this.action.repeatProfit = true;
        if (!this.action.takeProfitCandleSize)
            this.action.takeProfitCandleSize = 10;
        if (!this.action.interval)
            this.action.interval = 14;
        if (!this.action.low)
            this.action.low = 20;
        if (!this.action.high)
            this.action.high = 80;
        this.saveState = true;

        this.addIndicator("RSI", "RSI", this.action);

        this.addInfo("longTrend", "longTrend");
        this.addInfo("holdingCoins", "holdingCoins");
        this.addInfo("entryPrice", "entryPrice");
        this.addInfoFunction("pattern candle count", () => {
            return this.patternCandles.length;
        })
        this.addInfoFunction("interval lows", () => {
            let lows = this.mapInterval(this.intervalLows, true);
            return lows.join(", ") + " - repating " + this.isRepeating(this.intervalLows);
        })
        this.addInfoFunction("interval highs", () => {
            let highs = this.mapInterval(this.intervalHighs, true);
            return highs.join(", ") + " - repating " + this.isRepeating(this.intervalHighs);
        })
        this.addInfoFunction("RSI", () => {
            return this.indicators.get("RSI").getValue();
        });
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info); // really good idea to reset values?
        if (action === "close") {
            if (this.strategyPosition === "short")
                this.lastTradeProfitable = this.candle.close < this.entryPrice;
            else if (this.strategyPosition === "long")
                this.lastTradeProfitable = this.candle.close > this.entryPrice;
            this.exitCandleCount = -1;
            this.strategyPosition = "none";
            this.entryPrice = -1;
            this.postponedExit = false;
        }
    }

    public forceMakeOnly() {
        return true;
    }

    public serialize() {
        let state = super.serialize();
        //state.patternCandles = Candle.Candle.copy(this.patternCandles);
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.patternCandles = Candle.Candle.copy(state.candles1min);
        while (this.patternCandles.length > this.action.patternSize*this.action.patternRepeat)
            this.patternCandles.pop(); // remove oldest ones
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]): Promise<void> {
        if (this.scheduledTrade) {
            // works delayed (BAD) during backtesting because trades get executed too late // TODO
            let candle = this.getLatestCandle(this.action.takeProfitCandleSize);
            if (candle) {
                // keep our position open as long as the market moves in our direction
                if ((this.strategyPosition === "long" && candle.trend !== "up") ||
                    (this.strategyPosition === "short" && candle.trend !== "down")) {
                    this.log(utils.sprintf("Executing scheduled close of %s position. Candle trend %s", this.strategyPosition, candle.trend))
                    this.executeTrade(this.scheduledTrade);
                    this.scheduledTrade = null;
                }
            }
        }
        return super.tick(trades)
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        this.lastRSI = this.indicators.get("RSI").getValue();

        this.addPatternCandle(this.candle)
        this.findPatterns();
        this.setLongTrend();
        if (this.exitCandleCount !== -1)
            this.exitCandleCount--;
        if (this.exitCandleCount === 0) // be safe and always exit first
            this.exitMarket();
        else
            this.tradeWithPattern()
        this.logPatterns();

        return super.candleTick(candle)
    }

    protected checkIndicators() {
        this.plotData.plotMark({
            "RSI": this.indicators.get("RSI").getValue()
        }, true)
        // done in candleTick() to fire before we update indicators. this means RSI == lastRSI
    }

    protected findPatterns() {
        if (this.patternCandles.length < this.action.patternSize*this.action.patternRepeat)
            return // not enough data

        let high = Number.NEGATIVE_INFINITY, low = Number.POSITIVE_INFINITY, iHigh = -1, iLow = -1;
        this.intervalLows = [];
        this.intervalHighs = [];
        let addIntervalData = (i) => {
            if (i !== 0 && i % this.action.patternSize === 0) {
                this.intervalLows.push({position: iLow, rate: low, candle: this.patternCandles[iLow]});
                this.intervalHighs.push({position: iHigh, rate: high, candle: this.patternCandles[iHigh]});
                high = Number.NEGATIVE_INFINITY, low = Number.POSITIVE_INFINITY, iHigh = -1, iLow = -1;
            }
        }
        let i = 0;
        for (; i < this.patternCandles.length; i++)
        {
            // we start with the oldest candle forward to the latest and try to find the lows/highs within patternSize
            let candle = this.patternCandles[i];
            if (candle.close > high) {
                high = candle.close;
                iHigh = i;
            }
            if (candle.close < low) {
                low = candle.close;
                iLow = i;
            }

            addIntervalData(i);
        }
        addIntervalData(i);
    }

    protected setLongTrend() {
        if (this.patternCandles.length < this.action.patternSize*this.action.patternRepeat)
            return // not enough data

        // compare the avg price of the first interval with the last
        let sum = 0;
        for (let i = 0; i < this.action.patternSize; i++)
            sum += this.patternCandles[i].close;
        let avgFirst = sum / this.action.patternSize;
        sum = 0;
        for (let i = this.patternCandles.length - this.action.patternSize; i < this.patternCandles.length; i++)
            sum += this.patternCandles[i].close;
        let avgLast = sum / this.action.patternSize;
        this.longTrend = avgLast > avgFirst ? "up" : "down";
    }

    protected tradeWithPattern() {
        let traded = false;
        if (this.intervalLows.length < this.action.patternRepeat)
            return traded;

        // TODO only trade above min volatility using Bollinger bandwidth?
        // TODO don't trade when highs and lows are too close together?

        // we assume the pattern will continue
        // so we wait for the lowest/highest candle and issue a buy/sell order
        // this function is called ever candle tick, so we are at the right moment once the high/low is at position 0 (then the oldest pattern is repeating again)
        // TODO always check both intervals? would mean less trades

        let rsi = this.indicators.get("RSI")
        const rsiValue = rsi.getValue();
        //if ((this.longTrend === "down" || this.strategyPosition === "long") && (this.isRepeating(this.intervalHighs)/* || this.repeatTrade()*/)) {
        if ((this.longTrend === "down" && (this.isRepeating(this.intervalHighs)/* || this.repeatTrade()*/)) || this.strategyPosition === "long") {
            // sell at the high point
            // repeating down trades causes losses most of the time. the market has an upward bias, there is always a correction upwards on longer down phases
            if (this.intervalHighs[0].position === 0) {
                if (rsiValue !== -1 && (rsiValue <= this.action.low || this.lastRSI <= this.action.low))
                    this.log(utils.sprintf("Falling Knife Protection: Preventing sell at RSI %s, last %s", rsiValue, this.lastRSI))
                else {
                    const repeatStr = !this.isRepeating(this.intervalHighs) && this.repeatTrade() ? ", repeat" : "";
                    this.emitSell(this.defaultWeight, "Pattern HIGH reached, down trend expected" + repeatStr);
                    traded = true;
                    if (this.exitCandleCount === -1) // don't reset it if we do 2 consecutive sells/buys because of prolonged trend
                        this.exitCandleCount = this.action.patternSize;
                }
            }
        }
        else if ((this.longTrend === "up" && (this.isRepeating(this.intervalLows) || this.repeatTrade())) || this.strategyPosition === "short") {
            // buy at the low point
            if (this.intervalLows[0].position === 0) {
                if (rsiValue >= this.action.high || this.lastRSI >= this.action.high)
                    this.log(utils.sprintf("Falling Knife Protection: Preventing buy at RSI %s, last %s", rsiValue, this.lastRSI))
                else {
                    const repeatStr = !this.isRepeating(this.intervalLows) && this.repeatTrade() ? ", repeat" : "";
                    this.emitBuy(this.defaultWeight, "Pattern LOW reached, up trend expected" + repeatStr);
                    traded = true;
                    if (this.exitCandleCount === -1)
                        this.exitCandleCount = this.action.patternSize;
                }
            }
        }
        if (traded) {
            if (this.strategyPosition === "none")
                this.entryPrice = this.candle.close;
            this.postponedExit = false;
        }
        return traded;
    }

    protected exitMarket() {
        /* // only increases losses
        if (!this.postponedExit) {
            // postpone it once if we would exit with a loss
            if ((this.strategyPosition === "long" && this.entryPrice < this.candle.close) ||
                (this.strategyPosition === "short" && this.entryPrice > this.candle.close)) {
                this.exitCandleCount = this.action.patternSize;
                this.postponedExit = true;
                this.log("Postponing exit to prevent closing position at a loss");
                return;
            }
        }
        */

        // TODO schedule close instead and do it in tick() if price turns? wont make a difference for largre candle sizes
        // TODO pause the bot for x candles if we exit at a loss (got the long trend wrong)? but backtesting shows for longer candle sizes the next trade normally wins again
        if (this.strategyPosition === "long") {
            //this.lastTradeProfitable = this.candle.close > this.entryPrice; // has to be done in onTrade() to catch StopLossTurn
            //this.emitClose(this.defaultWeight, "Closing long position"); // will become "sell" for non-margin trading
            this.scheduledTrade = new ScheduledTrade("close", this.defaultWeight, "Closing long position");
        }
        else if (this.strategyPosition === "short") {
            //this.emitClose(this.defaultWeight, "Closing short position"); // no short-selling possible for non-margin trading
            this.scheduledTrade = new ScheduledTrade("close", this.defaultWeight, "Closing short position");
        }
    }

    protected isRepeating(pattern: ChartMark[]) {
        let expect = -1;
        for (let i = 0; i < pattern.length; i++)
        {
            if (expect !== -1) {
                if (pattern[i].position > expect + this.action.maxOffset || pattern[i].position < expect - this.action.maxOffset)
                    return false;
            }
            expect = pattern[i].position + this.action.patternSize;
        }
        return true;
    }

    protected repeatTrade() {
        return this.action.repeatProfit === true && this.lastTradeProfitable === true;
    }

    protected addPatternCandle(candle: Candle.Candle) {
        this.patternCandles.unshift(candle);
        if (this.patternCandles.length > this.action.patternSize*this.action.patternRepeat)
            this.patternCandles.pop();
    }

    protected mapInterval(interval: ChartMark[], toString = false) {
        return interval.map((int) => {
            if (toString === true)
                return utils.sprintf("pos: %s, rate: %s", int.position, int.rate)
            return {position: int.position, rate: int.rate}
        })
    }

    protected logPatterns() {
        let lows = this.mapInterval(this.intervalLows);
        let highs = this.mapInterval(this.intervalHighs);
        this.log("lows", lows, "repeating", this.isRepeating(this.intervalLows), "highs", highs, "repeating", this.isRepeating(this.intervalHighs),
            "long trend", this.longTrend, "exit count", this.exitCandleCount)
    }
}