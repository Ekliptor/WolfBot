import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction, ScheduledTrade} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeDirection, TradeInfo} from "../Trade/AbstractTrader";
import {MarginPosition} from "../structs/MarginPosition";
import {ChartMark} from "./AbstractGenericStrategy";

export interface WaveSurferAction extends TechnicalStrategyAction {
    minSurfCandles: number; // The minimum number of candles to keep a position open. Will usually be less than 'patternSize'.
    patternSize: number; // optional, default 2. The number of candles to keep to search for a pattern. 2 will mean we keep 4 candles (2 recent lows, 2 recent highs).
    // 2 is a good value for larger candles above 1h. For fast trading on lower candles you should increase this to 5 or more.

    //takeProfitCandles: number; // always 1 for now
    //breakoutVolatility: number; // the min bollinger bandwidth that must exist to assume/risk breakouts
    takeProfitCandleSize: number; // optional, default 10. The candle size in minutes of the candles this strategy uses to close a protitable position.
    // At the end of the wave (consisting of bigger candles) it will schedule to close the position on the first candle of this small size moving against our position.

    historyPriceCandles: number; // optional, default 6 - The number of candles to look for price history to decide if the bot should open long or short.
    lossPauseCandles: number; // optional, default 0 - How many candles the bot shall pause trading after closing a position at a loss. The assumption is
    // that the market is currently very irregular and no wave pattern can be detected.

    maxVolatility: number; // optional, default 0 = disabled. This strategy will not enter or exit the market above this volatility. Can only be enabled if this is the only main strategy for your currency pair.
    // A value > 0 means Bollinger Bandwidth has to be below this value.
    // volatility depends on candle size: don't use min + max for different strategies. we use isActiveStrategy() instead to check the other strategy

    openBreakouts: boolean; // default true. Open a new position even if the current candle isn't the min/max candle as long as it confirms with the current on EMA crossover trend.

    tradeDirection: TradeDirection; // optional. default "both" - can also be set globally on config level

    latestCandlePercent: number; // default 20%. How recent (in percent of 2*patternSize) the latest min/max candle has to be for the bot to open a position in the opposite direction (consider the wave to turn).
    longTrend: "candles" | "ticker" | "up" | "down"; // default candles. How this strategy detects the long trend. Ticker means long trend will be set from daily ticker instead of pattern candles.
    notifyBeforeExit: boolean; // default true. Send a notification 1 candle tick before exiting the market at a loss.

    // both recommended true for longer periods (positions open > 3h)
    onlyFollowIndicatorTrend: boolean; // optional, default true. Only trade if the EMA indicator matches our candle pattern and candle trend. The EMA indicator trend is usually longer (more time back) that the candle trend.
    tradeIncreaseingTrendOnly: boolean; // optional, default true. Only open a position if the EMA crossover line difference is increasing.
    // TODO measure volatility and open x% (more or less than 100% possible) of total trading value on high volatility
    // TODO increase minSurfCandles on low volatility? currently still kind of 50:50 to make profit in low volatility markets
    // TODO include speed option? % change in price, see PriceSpikeDetector
    // TODO dynamic stop loss: if the price increased more than the last candle && next candle trend is wrong -> close immediately (assume it won't go back down)
    // TODO parameter to detect scalping: if a sharp drop occurred during a long trend -> don't close if on next candle if the price is lower

    // EMA cross params (optional)
    CrossMAType: "EMA" | "DEMA" | "SMA"; // optional, default EMA
    short: number; // default 2
    long: number; // default 7

    // Falling Knife Protection - don't buy/sell on overbought/oversold
    // RSI parameters (optional)
    interval: number;   // default 14
    low: number;        // default 20
    high: number;       // default 80 - crypto currencies have a trend to explode upwards

    // optional, for defaults see BolloingerBandsParams
    N: number; // time period for MA
    K: number; // factor for upper/lower band
    MAType: number; // moving average type, 0 = SMA

    // old idea: Holds the coin until exitLossPercent or profit decreases & exitProfitPercent is reached
    // Similar to StopLossTurn, but StopLossTurn only exit's the market (doesn't do the initial buy/sell).
    //exitLossPercent: number; // 5 %
    //exitProfitPercent: number; // 10 %
    //minHoldSec: number;
}

/**
 * Buy at a low/high (depending on the longer trend) and keep it for minSurfCandles. Once we have a profit we close the position
 * after the market moves takeProfitCandles in the opposite direction.
 * aka surf on a (hopefully) existing wave.
 *
 * Surfing waves will only work well with high leverage (because we close losses sooner and continue to take profits by keeping
 * our position open - both will get leveraged).
 *
 * Strategy will allow manual trading too. It will still open a position (in both directions if allowed in tradeDirection).
 *
 * Forked from PatternRepeater strategy.
 */
export abstract class AbstractWaveSurfer extends TechnicalStrategy {
    protected readonly PATTERN_SIZE: number = 2; // 2 or 3  - configurable (and higher) in subclasses

    public action: WaveSurferAction;
    protected patternSize: number;
    protected patternCandles: Candle.Candle[] = []; // the latest patternSize*patternRepeat candles
    protected intervalHighs: ChartMark[] = [];
    protected intervalLows: ChartMark[] = [];
    protected longTrend: TrendDirection = "none"; // the trend over all patternSize*patternRepeat candles
    protected lastRSI: number = -1;
    protected positionOpenTickCount = -1; // counter for how many candles our position is open. -1 = no position, 0 = just opened
    protected lastLineDiff: number = 0;
    protected lastTradeProfitable = false;
    protected scheduledTrade: ScheduledTrade = null;
    protected repeatingTrade: ScheduledTrade = null;
    protected pauseTicks = 0;

    //protected static readonly backtesting = nconf.get('trader') === "Backtester";
    protected static readonly backtesting: boolean = true; // always close our positions for now

    constructor(options) {
        super(options)
        if (options.patternSize)
            this.PATTERN_SIZE = options.patternSize; // pattern size is set as a member variable and can't be changed after startup
        if (options.minSurfCandles)
            this.action.minSurfCandles = options.minSurfCandles;
        //let minPatternFactor = Math.max(this.action.minSurfCandles, 2); // using 1 causes ever candle to be added to highs + lows
        let minPatternFactor = 2; // now we can configure pattern size directly, no need for this anymore
        this.patternSize = minPatternFactor*this.PATTERN_SIZE;
        if (!this.action.takeProfitCandleSize)
            this.action.takeProfitCandleSize = Math.min(10, this.action.candleSize);
        if (!this.action.historyPriceCandles)
            this.action.historyPriceCandles = 6;
        if (!this.action.lossPauseCandles)
            this.action.lossPauseCandles = 0;
        if (!this.action.maxVolatility)
            this.action.maxVolatility = 0;
        if (typeof this.action.openBreakouts !== "boolean")
            this.action.openBreakouts = true;
        if (!this.action.tradeDirection)
            this.action.tradeDirection = "both";
        if (!this.action.latestCandlePercent)
            this.action.latestCandlePercent = 20;
        if (!this.action.longTrend)
            this.action.longTrend = "candles";
        if (typeof this.action.notifyBeforeExit !== "boolean")
            this.action.notifyBeforeExit = true;
        if (typeof this.action.onlyFollowIndicatorTrend !== "boolean")
            this.action.onlyFollowIndicatorTrend = true;
        if (typeof this.action.tradeIncreaseingTrendOnly !== "boolean")
            this.action.tradeIncreaseingTrendOnly = true;
        if (!this.action.CrossMAType)
            this.action.CrossMAType = "EMA";
        if (!this.action.short)
            this.action.short = 2;
        if (!this.action.long)
            this.action.long = 7;
        if (!this.action.interval)
            this.action.interval = 14;
        if (!this.action.low)
            this.action.low = 20;
        if (!this.action.high)
            this.action.high = 80;
        this.saveState = true;
        this.mainStrategy = true; // always main
        if (this.action.takeProfitCandleSize >= this.action.candleSize)
            logger.warn("takeProfitCandleSize should be less than candleSize in %s", this.className)

        this.addIndicator("RSI", "RSI", this.action);
        this.addIndicator("BollingerBands", "BollingerBands", this.action); // used to measure volatility in bandwidth
        this.addIndicator("EMA", this.action.CrossMAType, this.action); // can be type EMA, DEMA or SMA

        this.addInfo("patternSize", "patternSize");
        this.addInfo("lastTrade", "lastTrade");
        this.addInfo("longTrend", "longTrend");
        this.addInfo("holdingCoins", "holdingCoins");
        this.addInfo("entryPrice", "entryPrice");
        this.addInfo("positionOpenTickCount", "positionOpenTickCount");
        this.addInfo("lastLineDiff", "lastLineDiff");
        this.addInfo("pauseTicks", "pauseTicks");
        this.addInfoFunction("pattern candle count", () => {
            return this.patternCandles.length;
        })
        this.addInfoFunction("interval lows", () => {
            let lows = this.mapInterval(this.intervalLows, true);
            return lows.join(", ");
        })
        this.addInfoFunction("interval highs", () => {
            let highs = this.mapInterval(this.intervalHighs, true);
            return highs.join(", ");
        })
        this.addInfoFunction("interval min", () => {
            if (this.intervalLows.length === 0)
                return "";
            let highs = this.mapInterval([this.getMinMark()], true);
            return highs.join(", ");
        })
        this.addInfoFunction("interval max", () => {
            if (this.intervalHighs.length === 0)
                return "";
            let highs = this.mapInterval([this.getMaxMark()], true);
            return highs.join(", ");
        })
        this.addInfoFunction("RSI", () => {
            return this.indicators.get("RSI").getValue();
        });
        let bollinger = this.getBollinger("BollingerBands")
        this.addInfoFunction("Bandwidth", () => {
            return bollinger.getBandwidth();
        });
        this.addInfoFunction("EMA line diff %", () => {
            return this.indicators.get("EMA").getLineDiffPercent();
        });
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info); // really good idea to reset values?
        if (action === "close") {
            this.onClose();
            // opening again immediately produces A LOT worse results. maybe add another param and only open if we suspect a strong trend?
            // gets about 80% market exposure time
            //this.tradeWithPattern();
        }
        else {
            if (this.positionOpenTickCount === -1) // don't reset it if we do 2 consecutive sells/buys because of prolonged trend
                this.positionOpenTickCount = 0;
        }
        if (this.repeatingTrade) {
            this.executeTrade(this.repeatingTrade);
            this.repeatingTrade = null;
        }
    }

    public onSyncPortfolio(coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange) {
        let previousPos = this.strategyPosition;
        super.onSyncPortfolio(coins, position, exchangeLabel)
        if (this.strategyPosition !== previousPos) {
            if (this.strategyPosition === "none"/* && this.positionOpenTickCount !== -1*/)
                this.onClose();
            else { //if (this.strategyPosition !== "none")
                if (this.positionOpenTickCount === -1)
                //this.positionOpenTickCount = this.action.minSurfCandles; // assume already running
                    this.positionOpenTickCount = 0; // safer when we use multiple strategies (such as RSIStarter)
            }
        }
    }

    public forceMakeOnly() {
        return true;
    }

    public isActiveStrategy() {
        if (this.strategyGroup.getMainStrategies().length <= 1) { // only this strategy is set in config
            if (this.action.maxVolatility !== 0.0) {
                let bollinger = this.getBollinger("BollingerBands")
                if (bollinger.getBandwidth() > this.action.maxVolatility)
                    return false;
            }
            return true
        }

        // only enable as fallback if no other strategy is active
        if (this.strategyGroup.getActiveMainStrategies().length <= 1)
            return true;
        return false;
    }

    public serialize() {
        let state = super.serialize();
        state.patternCandles = Candle.Candle.copy(this.patternCandles);
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        //this.patternCandles = Candle.Candle.copy(state.candles1min);
        this.patternCandles = Candle.Candle.copy(state.patternCandles);
        while (this.patternCandles.length > this.patternSize)
            this.patternCandles.pop(); // remove oldest ones from the end
        let timer = setInterval(() => {
            if (this.avgMarketPrice === -1)
                return; // not yet ready
            clearInterval(timer);
            this.findPatterns();
            this.setLongTrend();
        }, 4000);
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
                    (this.strategyPosition === "short" && candle.trend !== "down") ||
                    this.strategyPosition === "none") { // none shouldn't happen
                    this.log(utils.sprintf("Executing scheduled close of %s position. Candle trend %s", this.strategyPosition, candle.trend))
                    this.executeTrade(this.scheduledTrade);
                    this.scheduledTrade = null;
                    this.onClose(); // call it immediately in case the position already has been closed by another strategy
                }
            }
            // TODO scheduled trade for entering the market, just like in WaveSurferLeverage but without timer
        }
        return super.tick(trades)
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        this.lastRSI = this.indicators.get("RSI").getValue();

        this.addPatternCandle(this.candle)
        this.findPatterns();
        this.setLongTrend();
        if (this.positionOpenTickCount !== -1) // TODO good idea to check? then we will never close manually opened positiony by ticks
            this.positionOpenTickCount++;
        if (this.pauseTicks > 0)
            this.pauseTicks--;
        if (AbstractWaveSurfer.backtesting === false) {
            if (!this.tradeWithPattern()) {
                if (this.positionOpenTickCount >= this.action.minSurfCandles)
                    this.exitMarket();
            }
        }
        else {
            if (this.positionOpenTickCount >= this.action.minSurfCandles) // be safe and always exit first
                this.exitMarket();
            else
                this.tradeWithPattern()
        }

        this.logPatterns();

        return super.candleTick(candle)
    }

    protected checkIndicators() {
        /*
        this.plotData.plotMark({
            "RSI": this.indicators.get("RSI").getValue()
        }, true)
        */
        /*
        let bollinger = this.getBollinger("BollingerBands")
        this.plotData.plotMark({
            "bandwidth": bollinger.getBandwidth()
        }, true)
        */
        let ema = this.indicators.get("EMA")
        this.plotData.plotMark({
            "shortEMA": ema.getShortLineValue(),
            "longEMA": ema.getLongLineValue()
        })
        /*
         this.plotData.plotMark({
         "diffEMAPercent": ema.getLineDiffPercent()
         }, true)
         */
        // done in candleTick() to fire before we update indicators. this means RSI == lastRSI
    }

    protected findPatterns() {
        // TODO reduce patternSize on high volatility
        if (this.patternCandles.length < this.patternSize)
            return // not enough data

        let high = Number.NEGATIVE_INFINITY, low = Number.POSITIVE_INFINITY, iHigh = -1, iLow = -1;
        this.intervalLows = [];
        this.intervalHighs = [];
        const size = Math.floor(this.patternSize / this.PATTERN_SIZE);
        let addIntervalData = (i) => {
            if (i !== 0 && i % size === 0 && iHigh !== -1) {
                this.intervalLows.push({position: iLow, rate: low, candle: this.patternCandles[iLow]});
                this.intervalHighs.push({position: iHigh, rate: high, candle: this.patternCandles[iHigh]});
                high = Number.NEGATIVE_INFINITY, low = Number.POSITIVE_INFINITY, iHigh = -1, iLow = -1;
            }
        }
        let i = 0;
        for (; i < this.patternCandles.length; i++)
        {
            // find the highs/lows accross "size" candles
            // we start with the oldest candle at patternCandles[0] forward to the latest and try to find the lows/highs within patternSize
            // pos 0 == most recent pattern candle
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
        if (this.action.longTrend === "up" || this.action.longTrend === "down") {
            this.longTrend = this.action.longTrend;
            return;
        }
        else if (this.action.longTrend === "ticker") {
            this.longTrend = this.getDailyChange() > 0.0 ? "up" : "down";
            return;
        }
        if (this.patternCandles.length < this.patternSize)
            return // not enough data

        // compare the avg price of the first interval half with the last
        /*
        const size = Math.floor(this.patternSize / this.PATTERN_SIZE);
        let sum = 0;
        for (let i = 0; i < size; i++)
            sum += this.patternCandles[i].close;
        let avgFirst = sum / size;
        sum = 0;
        for (let i = this.patternCandles.length - size; i < this.patternCandles.length; i++)
            sum += this.patternCandles[i].close;
        let avgLast = sum / size;
        this.longTrend = avgLast > avgFirst ? "up" : "down";
        */
        // compare the pattern candle average price with the current price
        let sum = 0;
        for (let i = 0; i < this.patternCandles.length; i++)
            sum += this.patternCandles[i].close;
        let avg = sum / this.patternCandles.length;
        this.longTrend = this.avgMarketPrice > avg  ? "up" : "down"; // UP trend if current avg price is bigger than candle history avg
    }

    protected tradeWithPattern() {
        let traded = false;
        if (this.patternCandles.length < this.patternSize || this.pauseTicks > 0)
            return traded;
        else if (this.intervalHighs.length === 0 || this.intervalLows.length === 0)
            return traded; // needed since subclasses. why?
        else if (this.positionOpenTickCount !== -1 && this.positionOpenTickCount < this.action.minSurfCandles)
            return traded;
        else if (!this.isActiveStrategy()) {
            let bollinger = this.getBollinger("BollingerBands")
            this.log("market volatility too high to open positions (or disabled). bandwidth", bollinger.getBandwidth())
            return traded;
        }
        else if (!this.openFirstPosition())
            return traded;
        // TODO only trade above min volatility using Bollinger bandwidth?
        // TODO don't trade when highs and lows are too close together?

        // we assume the pattern will continue
        // so we wait for the lowest/highest candle and issue a buy/sell order
        // this function is called ever candle tick, so we are at the right moment once the high/low is at position 0 (then the oldest pattern is repeating again)
        // TODO always check both intervals? would mean less trades
        // TODO don't open a position if we are near a resistance/support line?

        let rsi = this.indicators.get("RSI")
        const rsiValue = rsi.getValue();
        //let bollinger = this.getBollinger("BollingerBands")
        let ema = this.indicators.get("EMA")
        const emaDiff = ema.getLineDiffPercent();
        const openShort = (this.longTrend === "down" && !this.action.onlyFollowIndicatorTrend)  || (this.longTrend === "down" && this.action.onlyFollowIndicatorTrend && this.canOpenShortEma());
        const openLong = (this.longTrend === "up" && !this.action.onlyFollowIndicatorTrend) || (this.longTrend === "up" && this.action.onlyFollowIndicatorTrend && this.canOpenLongEma());
        //const lastIndex = /*this.patternSize*/this.patternCandles.length - 1;
        // candles must have lower index position (be newer) than this number to open a position in the opposite direction (short when high is new)
        const latestIndices = this.getRequiredCandleIndex();

        if (openShort || this.strategyPosition === "long") {
            // sell at the high point
            // if the first element in the array is never reached we have to sell/buy above/below the average
            // otherwise we are missing big up/down trends because we only enter the market on the opposite high/low
            //const onBreakoutTrend = this.getAvgExtremePrice() < this.candle.close;
            //const onBreakoutTrend = this.getCandleHistoryPrice() < this.candle.close; // we are in an down trend, price now is higher than 6h history -> sell
            //const onBreakoutTrend = this.intervalHighs[0].position === 1; // 1 position away from high
            // on high volatility we assume/risk breakouts
            //const onBreakoutTrend = bollinger.getBandwidth() > this.action.breakoutVolatility && this.intervalHighs[this.intervalHighs.length-1].position === 1;
            //const onBreakoutTrend = bollinger.getBandwidth() > this.action.breakoutVolatility;
            const onBreakoutTrend = this.action.openBreakouts && emaDiff < this.getDownThreshold(); // TODO use global config thresholds instead of 0?
            //if (this.intervalHighs[this.intervalHighs.length-1].position === 0 || (this.strategyPosition === "none" && onBreakoutTrend)) {
            //if (this.intervalHighs[0].position === 0 || (this.strategyPosition === "none" && onBreakoutTrend)) {
            // check if the most recent candle in collected intervalls is a high
            //if (this.intervalHighs[this.intervalHighs.length-1].position === lastIndex || (this.strategyPosition === "none" && onBreakoutTrend)) {
            // also require that the latest min mark > latestIndices. this means less trades in sideways + high volatility markets
            const markHighReached = this.getMaxMark().position <= latestIndices && this.getMinMark().position > latestIndices;
            if (markHighReached || (this.strategyPosition === "none" && onBreakoutTrend)) {
                if (rsiValue !== -1 && (rsiValue <= this.action.low || this.lastRSI <= this.action.low))
                    this.log(utils.sprintf("Falling Knife Protection: Preventing sell at RSI %s, last %s", rsiValue, this.lastRSI))
                else {
                    traded = this.openShort(onBreakoutTrend);
                }
            }
        }
        else if (openLong || this.strategyPosition === "short") {
            // buy at the low point
            //const onBreakoutTrend = this.getCandleHistoryPrice() > this.candle.close;
            //const onBreakoutTrend = this.intervalLows[0].position === 1;
            const onBreakoutTrend = this.action.openBreakouts && emaDiff > this.getUpThreshold();
            const markLowReached = this.getMinMark().position <= latestIndices && this.getMaxMark().position > latestIndices;
            if (markLowReached || (this.strategyPosition === "none" && onBreakoutTrend)) {
                if (rsiValue >= this.action.high || this.lastRSI >= this.action.high)
                    this.log(utils.sprintf("Falling Knife Protection: Preventing buy at RSI %s, last %s", rsiValue, this.lastRSI))
                else {
                    traded = this.openLong(onBreakoutTrend);
                }
            }
        }
        if (traded) {
            if (this.strategyPosition === "none")
                this.entryPrice = this.candle.close;
        }
        this.lastLineDiff = emaDiff;
        return traded;
    }

    protected openLong(onBreakoutTrend: boolean) {
        const reason = "Pattern LOW reached, " + (onBreakoutTrend ? "up breakout happening" : "up trend expected") + this.getPatternMsg();
        if (this.action.tradeDirection === "down" && this.lastTrade !== "sell") { // if the last trade was (short) sell we can buy now
            this.log("Skipped opening LONG position because trade direction is set to DOWN only. reason: " + reason);
            return false;
        }
        else if (this.lastTrade === "buy" && this.strategyPosition !== "none") { // checking for != none should be ok, we might change our pos direction
            this.log("Skipped opening LONG position the currently open trade was already long. reason: " + reason);
            return false;
        }
        this.emitBuy(this.defaultWeight, reason);
        if (this.strategyPosition !== "none" && AbstractWaveSurfer.backtesting === false)
            this.repeatingTrade = new ScheduledTrade("buy", this.defaultWeight, reason)
        return true;
    }

    protected openShort(onBreakoutTrend: boolean) {
        const reason = "Pattern HIGH reached, " + (onBreakoutTrend ? "down breakout happening" : "down trend expected") + this.getPatternMsg();
        if (this.action.tradeDirection === "up" && this.lastTrade !== "buy") {
            this.log("Skipped opening SHORT position because trade direction is set to UP only. reason: " + reason);
            return false;
        }
        else if (this.lastTrade === "sell" && this.strategyPosition !== "none") {
            this.log("Skipped opening SHORT position the currently open trade was already short. reason: " + reason);
            return false;
        }
        this.emitSell(this.defaultWeight, reason);
        // if we alread have an open position we have to trade 2x to move our position in the other direction
        // avoid calling close before because we only want to pay the maker fee
        // TODO doesn't work yet during backtesting because of changing margin collateral in simulation
        if (this.strategyPosition !== "none" && AbstractWaveSurfer.backtesting === false)
            this.repeatingTrade = new ScheduledTrade("sell", this.defaultWeight, reason)
        return true;
    }

    protected exitMarket() {
        if (this.scheduledTrade)
            return;
        // good idea to check candle & long trend?
        if ((this.strategyPosition === "long" && this.candle.trend === "up" && this.longTrend === "up") ||
            (this.strategyPosition === "short" && this.candle.trend === "down" && this.longTrend === "down")) {
            this.log(utils.sprintf("Keeping %s position open because of candle trend %s for %s candles", this.strategyPosition, this.candle.trend,
                this.positionOpenTickCount))
            return;
        }
        if (!this.isActiveStrategy()) {
            let bollinger = this.getBollinger("BollingerBands")
            this.log("market volatility too high to close positions (or disabled). bandwidth", bollinger.getBandwidth())
            return;
        }

        // TODO schedule close instead and do it in tick() if price turns? wont make a difference for largre candle sizes
        // TODO pause the bot for x candles if we exit at a loss (got the long trend wrong)? but backtesting shows for longer candle sizes the next trade normally wins again
        // TODO implement a way to close losses in multiple steps at high/lows to minimize loss
        if (this.strategyPosition === "long") {
            //this.lastTradeProfitable = this.candle.close > this.entryPrice; // has to be done in onTrade() to catch StopLossTurn
            //this.emitClose(this.defaultWeight, "Closing long position"); // will become "sell" for non-margin trading
            this.scheduledTrade = new ScheduledTrade("close", Number.MAX_VALUE, utils.sprintf("Closing long position after %s candles", this.action.minSurfCandles));
        }
        else if (this.strategyPosition === "short") {
            //this.emitClose(this.defaultWeight, "Closing short position"); // no short-selling possible for non-margin trading
            this.scheduledTrade = new ScheduledTrade("close", Number.MAX_VALUE, utils.sprintf("Closing short position after %s candles", this.action.minSurfCandles));
        }
    }

    protected addPatternCandle(candle: Candle.Candle) {
        // we get candles in order they apper with pos 0 == latest candle. add it to the front of our list, remove from the back. so pos 0 == always newest candle
        this.patternCandles.unshift(candle);
        if (this.patternCandles.length > this.patternSize+1) // keep 1 more (otherwise in findPattern() the last entry will always be the same high/low)
            this.patternCandles.pop();
    }

    protected getRequiredCandleIndex() {
        //return this.patternCandles.length - 1 - Math.floor(this.patternCandles.length * (this.action.latestCandlePercent/100));
        return Math.floor(this.patternCandles.length * (this.action.latestCandlePercent/100)); // we use <= so 0 is ok
    }

    protected getMaxMark(): ChartMark {
        let maxMark: ChartMark = null;
        this.intervalHighs.forEach((mark) => {
            if (!maxMark || mark.rate > maxMark.rate)
                maxMark = mark;
        })
        return maxMark;
    }

    protected getMinMark(): ChartMark {
        let minMark: ChartMark = null;
        this.intervalLows.forEach((mark) => {
            if (!minMark || mark.rate < minMark.rate)
                minMark = mark;
        })
        return minMark;
    }

    protected mapInterval(interval: ChartMark[], toString = false) {
        return interval.map((int) => {
            if (toString === true)
                return utils.sprintf("pos: %s, rate: %s", int.position, int.rate)
            return {position: int.position, rate: int.rate}
        })
    }

    protected getCandleAvgPrice(interval: ChartMark[]) {
        let candles = [];
        interval.forEach((int) => {
            candles.push(int.candle);
        })
        let price = this.getCandleAvg(candles)
        return price.simplePrice;
    }

    protected getAvgExtremePrice() {
        return (this.getCandleAvgPrice(this.intervalHighs) + this.getCandleAvgPrice(this.intervalLows)) / 2;
    }

    protected getUpThreshold() {
        //return this.action.thresholds.up; // opening immediately (at 0) has better results
        return 0;
    }

    protected getDownThreshold() {
        //return this.action.thresholds.down;
        return 0;
    }

    protected getPatternMsg() {
        return ", max " + this.getMaxMark().position + ", min " + this.getMinMark().position
            + ", latest high " + this.intervalHighs[0].position + ", latest low " + this.intervalLows[0].position
            + ", required <= " + this.getRequiredCandleIndex();
    }

    protected canOpenShortEma() {
        let ema = this.indicators.get("EMA")
        const emaDiff = ema.getLineDiffPercent();
        if (!this.action.tradeIncreaseingTrendOnly)
            return emaDiff < this.getDownThreshold();
        return emaDiff < this.getDownThreshold() && emaDiff < this.lastLineDiff;
    }

    protected canOpenLongEma() {
        let ema = this.indicators.get("EMA")
        const emaDiff = ema.getLineDiffPercent();
        if (!this.action.tradeIncreaseingTrendOnly)
            return emaDiff > this.getUpThreshold()
        return emaDiff > this.getUpThreshold() && emaDiff > this.lastLineDiff;
    }

    protected getCandleHistoryPrice() {
        //return this.getCandleAvg(this.getCandles(this.action.candleSize, this.action.historyPriceCandles)).simplePrice; // made from 1min candles
        let candles = [];
        for (let i = 0; i < this.candleHistory.length && i < this.action.historyPriceCandles; i++)
            candles.push(this.candleHistory[i]);
        return this.getCandleAvg(candles).simplePrice;
    }

    protected onClose() {
        if (this.strategyPosition === "short") // TODO wrong if we move our positions without closing them
            this.lastTradeProfitable = this.candle.close < this.entryPrice;
        else if (this.strategyPosition === "long")
            this.lastTradeProfitable = this.candle.close > this.entryPrice;
        if (!this.lastTradeProfitable)
            this.pauseTicks = this.action.lossPauseCandles;
        this.positionOpenTickCount = -1;
        this.strategyPosition = "none";
        this.holdingCoins = 0;
        this.entryPrice = -1;
    }

    protected logPatterns() {
        if (this.action.notifyBeforeExit && this.action.minSurfCandles > 1 && this.positionOpenTickCount >= this.action.minSurfCandles-1 && !this.hasProfitReal()) {
            let exitMsg = utils.sprintf("Closing open position at a loss in %s min", this.action.candleSize);
            if (this.position)
                exitMsg += " p/l: " + this.position.pl.toFixed(8) + " " + this.action.pair.getBase();
            this.sendNotification("Close imminent", exitMsg)
        }
        let lows = this.mapInterval(this.intervalLows, true);
        let highs = this.mapInterval(this.intervalHighs, true);
        this.log("lows", lows, "highs", highs,
            "long trend", this.longTrend, "open tick count", this.positionOpenTickCount)
    }
}