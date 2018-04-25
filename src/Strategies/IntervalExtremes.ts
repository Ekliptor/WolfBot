import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeDirection, TradeInfo} from "../Trade/AbstractTrader";
import * as _ from "lodash";
import {FibonacciRetracement} from "../Indicators/Trendline/FibonacciRetracement";
import {Trendlines} from "../Indicators/Trendline/Trendlines";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";


type IntervalPoint = "halfDay" | "daily" | "2Days" | "3days" | "weekly" | "2Weeks" | "monthly";
const ALL_INTERVALS: IntervalPoint[] = ["halfDay", "daily", "2Days", "3days", "weekly", "2Weeks", "monthly"];
const INTERVAL_SEC_MAP = new Map<string, number>([
    ["halfDay", 12*utils.constants.HOUR_IN_SECONDS],
    ["daily", 24*utils.constants.HOUR_IN_SECONDS],
    ["2Days", 2*24*utils.constants.HOUR_IN_SECONDS],
    ["3days", 3*24*utils.constants.HOUR_IN_SECONDS],
    ["weekly", 7*24*utils.constants.HOUR_IN_SECONDS],
    ["2Weeks", 14*24*utils.constants.HOUR_IN_SECONDS],
    ["monthly", 30*24*utils.constants.HOUR_IN_SECONDS]
]);

class IntervalPoints {
    low: number;
    high: number;
    lowTime = new Date(0);
    highTime = new Date(0);
    constructor() {
        this.low = Number.MAX_VALUE;
        this.high = 0;
    }
}
class IntervalPointMap extends Map<IntervalPoint, IntervalPoints> { // (duration of interval, points)
    constructor(iterable?: Iterable<[IntervalPoint, IntervalPoints]>) {
        super(iterable)
        if (this.size !== 0)
            return;
        // initialize it with min/max values
        ALL_INTERVALS.forEach((interval) => {
            this.set(interval, new IntervalPoints())
        })
    }
}

class CandlestickPattern {
    date: Date;
    constructor(date: Date) {
        this.date = date;
    }
}

interface IntervalExtremesAction extends TechnicalStrategyAction {
    tradeDirection: TradeDirection | "watch"; // in which direction shall we trade. "watch" means we don't trade
    mode: "bounce" | "breakout"; // do we assume prices bounce between interval high + low or breakout to new extremes?
    tradeInterval: IntervalPoint; // the time interval to look for extreme price points to trade on
    minRuntime: number; // optional, default 12h. how long the strategy must collect data before trading

    notifyPriceInterval: IntervalPoint; // optional, default disabled. send notifications if the price reaches a new high/low
    patternExpiryDays: number; // optional. default 2. remove identified patterns again after x days
    notifyPatterns: number; // optional, default 0 = disabled. send notifications for identified candlestick patterns after this amount has been found. 0 = disabled

    // RSI values, set low + high to receive notifications
    low: number;
    high: number;
    interval: number; // optional, default 25

    // Sentiment values. set to receive notifications
    sentimentLow: number;
    sentimentHigh: number;
}

/**
 * A strategy that remembers the 24h, 3 day, etc.. high/low price points and opens a position once that
 * price is reached.
 * Could also be achived with Aroon strategy.
 */
export default class IntervalExtremes extends /*AbstractStrategy*/TechnicalStrategy {
    protected static KEEP_HOUR_CANDLES = 24*30; // 1 month - must be set according to ALL_INTERVALS

    public action: IntervalExtremesAction;
    protected intervalMap = new IntervalPointMap();
    protected hourCandles: Candle.Candle[] = [];
    protected bullishPatterns: CandlestickPattern[] = [];
    protected bearishPatterns: CandlestickPattern[] = [];
    protected valuesRSI: number[] = [];
    protected buySellPercentageRSI: number[] = [];

    constructor(options) {
        super(options)
        if (!this.action.candleSize)
            this.action.candleSize = 60;
        else if (this.action.candleSize !== 60)
            throw new Error(utils.sprintf("Config candleSize must be set to 60 min for %s to work.", this.className))
        if (!this.action.minRuntime)
            this.action.minRuntime = 12;
        if (!this.action.patternExpiryDays)
            this.action.patternExpiryDays = 2;
        if (typeof this.action.notifyPatterns !== "number")
            this.action.notifyPatterns = 0;
        if (!this.action.interval)
            this.action.interval = 25;
        this.candlesticks = this.loadCandlestickPatternRecognizer(nconf.get("serverConfig:candlestickPatternRecognizer"))

        ALL_INTERVALS.forEach((interval) => {
            this.addInfoFunction(interval + "Interval", () => {
                let dataPoints = this.intervalMap.get(interval)
                return utils.sprintf("low: %s, high: %s", dataPoints.low.toFixed(8), dataPoints.high.toFixed(8));
            })
        })
        this.fibonacci = new FibonacciRetracement();
        this.addInfoFunction("fibUp", () => {
            let fib = this.fibonacci.getFibonacciFromLow();
            return fib ? fib.toString().replaceAll(",", ", ") : "";
        })
        this.addInfoFunction("fibDown", () => {
            let fib = this.fibonacci.getFibonacciFromHigh();
            return fib ? fib.toString().replaceAll(",", ", ") : "";
        })
        this.addInfoFunction("bullishPatterns", () => {
            return this.bullishPatterns.length;
        })
        this.addInfoFunction("bearishPatterns", () => {
            return this.bearishPatterns.length;
        })

        if (this.action.low && this.action.high) {
            this.addIndicator("RSI", "RSI", this.action);
            this.addInfoFunction("RSIs", () => {
                return this.valuesRSI.toString().replaceAll(",", ", ");
            });
            this.addInfoFunction("buySellRSIs", () => {
                return this.buySellPercentageRSI.toString().replaceAll(",", ", ");
            });
        }

        this.addIndicator("Sentiment", "Sentiment", this.action);
        this.addInfoFunction("longShortPercentage", () => {
            return this.getSentiment("Sentiment").getLongShortPercentage();
        });

        this.mainStrategy = true; // we can always trade
        this.saveState = true;
    }

    public serialize() {
        let state = super.serialize();
        state.intervalMap = this.intervalMap.toToupleArray<IntervalPoints>();
        state.hourCandles = Candle.Candle.copy(this.hourCandles);
        state.bullishPatterns = this.bullishPatterns;
        state.bearishPatterns = this.bearishPatterns;
        state.valuesRSI = this.valuesRSI;
        state.buySellPercentageRSI = this.buySellPercentageRSI;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        //this.intervalMap = utils.objects.mapFromToupleArray<IntervalPoints>(state.intervalMap);
        this.intervalMap = new IntervalPointMap(state.intervalMap);
        if (!this.intervalMap || this.intervalMap.size === 0) { // safety check, shouldn't be needed
            this.intervalMap = new IntervalPointMap();
            logger.error("Error restoring %s %s map", this.action.pair.toString(), this.className)
        }
        this.hourCandles = Candle.Candle.copy(state.hourCandles);
        this.bullishPatterns = state.bullishPatterns;
        this.bearishPatterns = state.bearishPatterns;
        this.valuesRSI = state.valuesRSI;
        this.buySellPercentageRSI = state.buySellPercentageRSI;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            if (this.action.tradeDirection !== "watch" && this.hourCandles.length >= this.action.minRuntime) {
                switch (this.action.mode)
                {
                    case "breakout":            this.tradeBreakout();       break;
                    case "bounce":              this.tradeBounce();         break;
                    default:
                        logger.error("Unknown trade mode '%s' in %s", this.action.mode, this.className)
                }
            }
            super.tick(trades).then(() => {
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.countPatterns();
            this.notifyMarketBreakouts(); // must be called before we add interval points
            this.addHourCandle(candle);
            this.addCandleToIntervalPoints(candle);
            super.candleTick(candle).then(() => {
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected checkIndicators() {
        let rsi = this.getRSI("RSI")
        if (rsi) {
            const value = rsi.getValue();
            const valueFormatted = Math.round(value * 100) / 100.0;
            this.valuesRSI.push(valueFormatted);
            if (this.valuesRSI.length > this.action.interval)
                this.valuesRSI.shift(); // remove the first/oldest
            const rsiBuySell = Math.round(rsi.getBuySellPercentage() * 100) / 100.0;
            this.buySellPercentageRSI.push(rsiBuySell)
            if (this.buySellPercentageRSI.length > this.action.interval)
                this.buySellPercentageRSI.shift();

            const rsiMsg = utils.sprintf("RSI %s, candle size %s min, RSI interval %s", valueFormatted, this.action.candleSize, this.action.interval)
            let msgTitle = "";
            if (valueFormatted < this.action.low)
                msgTitle = utils.sprintf("RSI oversold %s", valueFormatted);
            else if (valueFormatted > this.action.high)
                msgTitle = utils.sprintf("RSI overbought %s", valueFormatted);
            if (msgTitle) {
                this.log(rsiMsg);
                this.sendNotification(msgTitle, rsiMsg, false, true, true)
            }
        }

        let sentiment = this.getSentiment("Sentiment")
        if (this.action.sentimentLow && this.action.sentimentHigh) {
            const sentimentValue = sentiment.getLongShortPercentage();
            const sentimentValueFormatted = Math.round(sentimentValue * 100) / 100.0;
            const sentimentMsg = utils.sprintf("Sentiment %s%%, long %s, short %s, candle size %s min", sentimentValueFormatted,
                sentiment.getLongAmount().toFixed(8), sentiment.getShortAmount().toFixed(8), this.action.candleSize)
            let msgTitle = "";
            if (sentimentValueFormatted < this.action.sentimentLow)
                msgTitle = utils.sprintf("DOWN sentiment %s, consider BUY", sentimentValueFormatted);
            else if (sentimentValueFormatted > this.action.sentimentHigh)
                msgTitle = utils.sprintf("UP sentiment %s, consider SELL", sentimentValueFormatted);
            if (msgTitle) {
                this.log(sentimentMsg);
                this.sendNotification(msgTitle, sentimentMsg, false, true, true)
            }
        }
    }

    protected tradeBreakout() {
        // only StopLoss or TakeProfit will close breakout positions
        if (this.strategyPosition !== "none")
            return;
        let tradePoint = this.intervalMap.get(this.action.tradeInterval);
        if (this.avgMarketPrice < tradePoint.low)
            this.openShort(utils.sprintf("SHORT breakout below %s low of %s interval", tradePoint.low.toFixed(8), this.action.tradeInterval));
        else if (this.avgMarketPrice > tradePoint.high)
            this.openLong(utils.sprintf("LONG breakout above %s high of %s interval", tradePoint.high.toFixed(8), this.action.tradeInterval));
    }

    protected tradeBounce() {
        let tradePoint = this.intervalMap.get(this.action.tradeInterval);
        if (this.strategyPosition !== "none") { // check if we should close at the peak
            // TODO percentage decrease config if we don't reach the interval, but 90% of it
            if (this.strategyPosition === "long" && this.avgMarketPrice >= tradePoint.high)
                this.emitClose(Number.MAX_VALUE, utils.sprintf("Closing LONG position at %s interval high %s", this.action.tradeInterval, tradePoint.high.toFixed(8)))
            else if (this.strategyPosition === "short" && this.avgMarketPrice <= tradePoint.low)
                this.emitClose(Number.MAX_VALUE, utils.sprintf("Closing SHORT position at %s interval low %s", this.action.tradeInterval, tradePoint.low.toFixed(8)))
            return;
        }

        if (this.avgMarketPrice < tradePoint.low)
            this.openLong(utils.sprintf("Bouncing up LONG below %s low of %s interval", tradePoint.low.toFixed(8), this.action.tradeInterval));
        else if (this.avgMarketPrice > tradePoint.high)
            this.openShort(utils.sprintf("Bouncing down SHORT above %s high of %s interval", tradePoint.high.toFixed(8), this.action.tradeInterval));
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

    protected addCandleToIntervalPoints(candle: Candle.Candle) {
        // called every hour
        ALL_INTERVALS.forEach((interval) => {
            // use candle low/high values to find the extreme points
            let point = this.intervalMap.get(interval);
            if (point.high <= candle.high) {
                point.high = candle.high;
                point.highTime = /*this.marketTime*/candle.start; // candle start (or end?) is more accurate
            }
            if (point.low >= candle.low) {
                point.low = candle.low;
                point.lowTime = candle.start;
            }
            let intervalCandles = this.hourCandles.filter(c => !this.isExpiredPointValue(interval, c.start));
            if (this.isExpiredPointValue(interval, point.highTime)) {
                //const maxCandle = _.max(this.hourCandles.map(c => c.high)); // we need the full candle
                const maxCandle = this.getMaxCandle(intervalCandles);
                if (maxCandle) {
                    point.high = maxCandle.high;
                    point.highTime = maxCandle.start;
                }
                else
                    this.log("Unable to get next max candle. Keeping expired candle"); // should never happen
            }
            if (this.isExpiredPointValue(interval, point.lowTime)) {
                const minCandle = this.getMinCandle(intervalCandles);
                if (minCandle) {
                    point.low = minCandle.low;
                    point.lowTime = minCandle.start;
                }
                else
                    this.log("Unable to get next min candle. Keeping expired candle"); // should never happen
            }
        })
    }

    protected isExpiredPointValue(interval: IntervalPoint, addedTime: Date) {
        const secInterval = INTERVAL_SEC_MAP.get(interval);
        if (addedTime.getTime() < this.marketTime.getTime() - secInterval*1000 - 1*utils.constants.HOUR_IN_SECONDS*1000) // remove 1h from candle start til now
            return true;
        return false;
    }

    protected countPatterns() {
        // check for patterns first
        if (this.candlesticks.isBullishAny())
            this.bullishPatterns.push(new CandlestickPattern(this.marketTime));
        if (this.candlesticks.isBearishAny())
            this.bearishPatterns.push(new CandlestickPattern(this.marketTime));

        // remove expired patterns
        this.bullishPatterns = this.removeOldPatterns(this.bullishPatterns);
        this.bearishPatterns = this.removeOldPatterns(this.bearishPatterns);
    }

    protected removeOldPatterns(list: CandlestickPattern[]) {
        let removeIndex = 0;
        for (let i = 0; i < list.length; i++)
        {
            if (list[i].date.getTime() + this.action.patternExpiryDays*utils.constants.DAY_IN_SECONDS*1000 < this.marketTime.getTime())
                removeIndex = i;
            else
                break; // list is sorted
        }
        if (removeIndex > 0)
            list.splice(0, removeIndex); // modifies array, returns removed elements
        return list;
    }

    protected notifyMarketBreakouts() {
        if (nconf.get("trader") === "Backtester" || !this.isNotificationHour())
            return;
        if (this.action.notifyPriceInterval) {
            let dataPoints = this.intervalMap.get(this.action.notifyPriceInterval)
            if (dataPoints) {
                if (this.candle.close > dataPoints.high) {
                    const priceMsg = utils.sprintf("new %s high reached, price %s", this.action.notifyPriceInterval, this.avgMarketPrice.toFixed(8))
                    this.log(priceMsg);
                    this.sendNotification("New high reached", priceMsg, false, true)
                }
                else if (this.candle.close < dataPoints.low) {
                    const priceMsg = utils.sprintf("new %s low reached, price %s", this.action.notifyPriceInterval, this.avgMarketPrice.toFixed(8))
                    this.log(priceMsg);
                    this.sendNotification("New low reached", priceMsg, false, true)
                }
            }
        }
        if (this.action.notifyPatterns > 0) {
            // TODO create own strategy to be able to identify patterns on different candle sizes
            // TODO implement check functions for each pattern separately so we can get the name of the identified pattern
            if (this.bullishPatterns.length >= this.action.notifyPatterns && this.bullishPatterns.length % this.action.notifyPatterns === 0) {
                const patternMsg = utils.sprintf("%s bullish (%s bearish) patterns found on candle size %s min", this.bullishPatterns.length, this.bearishPatterns.length, this.action.candleSize)
                this.log(patternMsg);
                this.sendNotification("Bullish pattern", patternMsg, false, true)
            }
            else if (this.bearishPatterns.length >= this.action.notifyPatterns && this.bearishPatterns.length % this.action.notifyPatterns === 0) {
                const patternMsg = utils.sprintf("%s bearish (%s bullish) patterns found on candle size %s min", this.bearishPatterns.length, this.bullishPatterns.length, this.action.candleSize)
                this.log(patternMsg);
                this.sendNotification("Bearish pattern", patternMsg, false, true)
            }
        }
    }

    protected isNotificationHour() {
        return this.marketTime.getUTCHours() % 6 === 0; // notify every 6 hours = 1/2 lowest interval
    }

    protected addHourCandle(candle: Candle.Candle) {
        this.hourCandles.unshift(candle);
        if (this.hourCandles.length > IntervalExtremes.KEEP_HOUR_CANDLES)
            this.hourCandles.pop();
    }
}