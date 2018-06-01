import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import * as _ from "lodash";
import {AbstractTurnStrategy} from "./AbstractTurnStrategy";
import {TradeInfo} from "../Trade/AbstractTrader";
import * as helper from "../utils/helper";

interface MacdAction extends TechnicalStrategyAction {
    // MACD indicator technical parameters
    short: number; // Number of candles for the short EMA line.
    long: number; // Number of candles for the long EMA line.
    signal: number; // Number of candles for the MACD signal line (candles for EMA(short) - EMA(long)).

    takeProfitTicks: number; // default 0 = disabled. Close a position with profit early if the MACD histogram decreases for x candles.
    closeLossEarly: boolean; // default = true. Close positions at a loss after takeProfitTicks too.
    noiseFilterFactor: number; // default = 2.5. Increase the max histogram after a loss trade. Useful to protect further losses in sideways markets.
    histogramIncreaseFactor: number; // default 1.05. Only open a position if the histogram increases/decreases by this factor.
    closeSidewaysMarkets: boolean; // default false. Close a position in sideways markets at the first tick with a profit.
    openAgainPriceChange: number; // default 0.3%. How much the price has to change at least to open a long/short position again (in the same direction as the previous position).
    openDecreasingHist: number; // optional, default 0 = open on Histogram 0 (minimum). A value > 0 means we open on Histogram max after the histogram value decreases for x candles.

    // optional: Aroon to only trade if we are in a trending market (not sideways)
    interval: number; // default 0 = disabled. compute Aroon up/down of the latest candles
    trendCandleThreshold: number; // default = 76. The min value of the Aroon up/down to open a long/short position (to prevent opening positions in sideways markets).

    // TODO pauseTicks after closing early (if the trend is still in the same direction)
    // TODO option to allow multiple trades (in the same direction) if we don't use it for futures (and as 2nd strategy)
    // TODO option to buy/sell at min/max histogram instead of 0
}

/**
 * Strategy that emits buy/sell based on the MACD indicator.
 * You can open a position on MACD signal line crossovers (most common, default setting) when the histogram is 0 or alternatively you
 * can open positions on decreasing momentum against the current momentum (buy in downside momentum). Use 'openDecreasingHist' for this.
 * This strategy can also close positions if the upside/downside momentum is decreasing for 'takeProfitTicks' candle ticks.
 */
export default class MACD extends AbstractTurnStrategy {
    public action: MacdAction;
    protected histograms: number[] = [];
    protected maxHistogram: number = -1;
    protected lastHistogram: number = -1;
    protected decreasingHistogramTicks: number = 0;
    // useful to prevent opening and closing multiple times in sideways markets
    protected lastOpenShortPrice: number = Number.POSITIVE_INFINITY;
    protected lastOpenLongPrice: number = Number.NEGATIVE_INFINITY;
    protected nextLastOpenPrice: number = -1;

    constructor(options) {
        super(options)
        if (!this.action.takeProfitTicks)
            this.action.takeProfitTicks = 0;
        if (!this.action.closeLossEarly)
            this.action.closeLossEarly = true;
        if (!this.action.noiseFilterFactor)
            this.action.noiseFilterFactor = 2.5;
        if (!this.action.histogramIncreaseFactor)
            this.action.histogramIncreaseFactor = 1.05;
        if (typeof this.action.closeSidewaysMarkets !== "boolean")
            this.action.closeSidewaysMarkets = false;
        if (!this.action.openAgainPriceChange)
            this.action.openAgainPriceChange = 0.3;
        if (!this.action.openDecreasingHist)
            this.action.openDecreasingHist = 0;
        if (!this.action.interval)
            this.action.interval = 0;
        if (!this.action.trendCandleThreshold)
            this.action.trendCandleThreshold = 76;

        this.addIndicator("MACD", "MACD", this.action);
        if (this.action.interval)
            this.addIndicator("Aroon", "Aroon", this.action);

        //this.addInfo("lastHistogram", "lastHistogram"); // equals the current histogram, only differs during candle tick
        this.addInfo("decreasingHistogramTicks", "decreasingHistogramTicks");
        this.addInfo("entryPrice", "entryPrice");
        this.addInfoFunction("short", () => {
            return this.action.short;
        });
        this.addInfoFunction("long", () => {
            return this.action.long;
        });
        let macd = this.getMACD("MACD");
        this.addInfoFunction("MACD", () => {
            return macd.getMACD();
        });
        this.addInfoFunction("Signal", () => {
            return macd.getSignal();
        });
        this.addInfoFunction("Histogram", () => {
            return macd.getHistogram();
        });
        this.addInfoFunction("Change %", () => {
            if (this.maxHistogram === -1)
                return -1;
            return Math.abs(this.maxHistogram - macd.getHistogram()) / this.maxHistogram * 100;
        });
        this.addInfoFunction("sidewaysMarket", () => {
            return this.isSidewaysMarket();
        });
        if (this.action.interval) {
            let aroon = this.getAroon("Aroon")
            this.addInfoFunction("AroonUp", () => {
                return aroon.getUp();
            });
            this.addInfoFunction("AroonDown", () => {
                return aroon.getDown();
            });
        }
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        const profitable = this.hasProfit(this.entryPrice); // must be called first
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            //this.lastHistogram = -1; // never reset it (otherwise we might enter too soon after close)
            this.entryPrice = -1;
            //this.nextLastOpenPrice = -1;
            if (!profitable && this.action.noiseFilterFactor > 1.0 && this.histograms.length >= 2) {
                this.histograms.shift(); // remove the oldest and add factor * the latest
                this.setMaxHistogram(this.maxHistogram * this.action.noiseFilterFactor); // TODO upper limit? we might already be in a volatile market
                this.log(utils.sprintf("Increased max histogram by %s after a loss trade", this.action.noiseFilterFactor));
            }
        }
        else if (this.entryPrice === -1) { // else it's TakeProfit
            this.entryPrice = order.rate;
            if (this.nextLastOpenPrice !== -1) {
                if (order.type === Trade.TradeType.BUY)
                    this.lastOpenLongPrice = this.nextLastOpenPrice;
                else
                    this.lastOpenShortPrice = this.nextLastOpenPrice;
                this.nextLastOpenPrice = -1;
            }
        }
    }

    public serialize() {
        let state = super.serialize();
        state.histograms = this.histograms;
        state.lastHistogram = this.lastHistogram;
        state.decreasingHistogramTicks = this.decreasingHistogramTicks;
        state.lastOpenShortPrice = this.lastOpenShortPrice;
        state.lastOpenLongPrice = this.lastOpenLongPrice;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.histograms = state.histograms;
        this.lastHistogram = state.lastHistogram;
        this.decreasingHistogramTicks = state.decreasingHistogramTicks;
        this.lastOpenShortPrice = state.lastOpenShortPrice;
        this.lastOpenLongPrice = state.lastOpenLongPrice;
    }

    public isActiveStrategy() {
        if (!this.action.interval)
            return true;
        let aroon = this.getAroon("Aroon")
        return aroon.getUp() >= this.action.trendCandleThreshold || aroon.getDown() >= this.action.trendCandleThreshold;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        this.plotChart();
        let macd = this.getMACD("MACD")
        const histogram = macd.getHistogram();
        this.setMaxHistogram(histogram);
        // we use the max histogram and check the % change. this means on highly volatile markets (1 candle up, 1 candle down) our MACD won't open a position
        const changePercent = Math.abs(this.maxHistogram - histogram) / this.maxHistogram * 100;
        const histogramChangeTxt = utils.sprintf("Change %s%%", changePercent.toFixed(3));
        // TODO store lastCloseLineDiff and option to open a position we closed early again. but MACD is a momentum indicator = more volatile, not like DEMA
        // TODO on startup: only open a position if this is a new up/down trend?
        // TODO improve for sideways markets: store last close histogram, price, last open price... and compare before opening again
        // TODO disable on low volatility (bollinger bw) and for weak EMA diffs
        // TODO store previous highs and lows to detect sideways markets
        // TODO we have many losses on slight down trends: compare candle trend > x% before opening short

        if (this.lastHistogram !== -1 && Math.abs(histogram) < Math.abs(this.lastHistogram)) {
            this.decreasingHistogramTicks++;
            if (this.action.takeProfitTicks !== 0 && !this.candleTrendMatchesPosition()) {
                // TODO won't trigger if we manually opened a position in the other direction
                // if we don't have a profit (and MACD is most likely in the same direction) don't close it early to avoid opening & closing repeatedly
                if (this.decreasingHistogramTicks >= this.action.takeProfitTicks && (this.action.closeLossEarly || this.hasProfit(this.entryPrice))) {
                    this.emitClose(this.defaultWeight, utils.sprintf("closing decreasing %s trend after %s ticks", this.lastTrend.toUpperCase(), this.decreasingHistogramTicks));
                    this.decreasingHistogramTicks = 0; // reset, but shouldn't fire again either way
                }
            }
        }
        else {
            //this.decreasingHistogramTicks = 0; // decrement instead
            if (this.decreasingHistogramTicks > 0)
                this.decreasingHistogramTicks--;
        }

        // not trading repeatedly is important here because we don't want to buy/sell in the middle of the histogram, only when the lines cross
        if (this.openByHistogramUp(histogram) && changePercent > this.action.thresholds.up*100) { // we use % instead of absolute values here
            if (this.lastTrend !== "up")
                this.persistenceCount = 0;
            this.persistenceCount++;
            this.log("UP trend detected, histogram", histogram, "last", this.lastHistogram, histogramChangeTxt)
            if (this.openPosition() && this.canOpenLong()) {
                //if (this.lastTrend !== "up" || this.strategyPosition === "none") // only if reversal from lastTrend to prevent circling around 0 ("none" only happens on start)
                //if (/*this.lastTrend !== "up" && */this.lastTrend === "down" || this.strategyPosition === "none") // bad because trend can go down -> none -> up, better use position only
                if (this.strategyPosition !== "long") {
                    this.openLong(utils.sprintf("MACD line histogram: %s (last: %s) %s", histogram, this.lastHistogram, histogramChangeTxt));
                    //this.lastOpenLongPrice = this.avgMarketPrice; // don't set it immediately because our tradeStrategy might not execute it
                    this.nextLastOpenPrice = this.avgMarketPrice;
                }
            }
            this.lastOpenShortPrice = Number.POSITIVE_INFINITY; // reset it
            this.lastTrend = "up";
        }
        else if (this.openByHistogramDown(histogram) && changePercent > this.action.thresholds.down*-100) {
            if (this.lastTrend !== "down")
                this.persistenceCount = 0;
            this.persistenceCount++;
            this.log("DOWN trend detected, histogram", histogram, "last", this.lastHistogram, histogramChangeTxt)
            if (this.openPosition() && this.canOpenShort()) {
                if (this.strategyPosition !== "short") {
                    this.openShort(utils.sprintf("MACD line histogram: %s (last: %s) %s", histogram, this.lastHistogram, histogramChangeTxt));
                    this.nextLastOpenPrice = this.avgMarketPrice;
                }
            }
            this.lastOpenLongPrice = Number.NEGATIVE_INFINITY; // reset it
            this.lastTrend = "down";
        }
        else {
            this.persistenceCount = 0;
            this.log(utils.sprintf("no trend detected, histogram %s, %s, last %s", histogram, histogramChangeTxt, this.lastHistogram))
        }

        // better results if we check this always (and not just on decreasing ticks)
        if (this.action.closeSidewaysMarkets && this.isSidewaysMarket() && this.hasProfit(this.entryPrice) && this.decreasingHistogramTicks > 0) {
            // TODO sometimes closing at a loss. why? just quick price fluctuations in small currencies (+ small orderbook)?
            this.emitClose(this.defaultWeight, utils.sprintf("closing %s trend early in sideways market after %s ticks", this.lastTrend.toUpperCase(), this.decreasingHistogramTicks));
            this.decreasingHistogramTicks = 0; // reset, but shouldn't fire again either way
        }

        this.lastHistogram = histogram;
    }

    protected resetValues() {
        // done for close only
        this.decreasingHistogramTicks = 0;
        super.resetValues();
    }

    protected plotChart() {
        let macd = this.getMACD("MACD")
        this.plotData.plotMark({
            MACD: macd.getMACD(),
            signal: macd.getSignal(),
            histogram: macd.getHistogram()
        }, true)
    }

    protected openPosition() {
        if (!this.isActiveStrategy()) {
            let aroon = this.getAroon("Aroon")
            this.log(utils.sprintf("Skipped trading because we are in a sideways market. Aroon up %s, down %s", aroon.getUp(), aroon.getDown()))
            return false;
        }
        return this.persistenceCount >= this.action.thresholds.persistence;
    }

    protected canOpenShort() {
        // TODO reset values after x ticks?
        if (this.strategyPosition !== "none")
            return true; // always allow changing the position
        //return this.avgMarketPrice < this.lastOpenShortPrice;
        const change = helper.getDiffPercent(this.avgMarketPrice, this.lastOpenShortPrice);
        const resetChange = Math.min(10, this.action.openAgainPriceChange*10);
        if (this.lastOpenShortPrice === Number.POSITIVE_INFINITY || change < -1*this.action.openAgainPriceChange || change > resetChange) // drop > 0.1%  or rise > 1.0%
            return true;
        this.log(utils.sprintf("Prevented opening SHORT because price is too close to last open short price - current %s, last %s, change %s%%", this.avgMarketPrice, this.lastOpenShortPrice, change));
        return false;
    }

    protected canOpenLong() {
        if (this.strategyPosition !== "none")
            return true; // always allow changing the position
        //return this.avgMarketPrice > this.lastOpenLongPrice;
        const change = helper.getDiffPercent(this.avgMarketPrice, this.lastOpenLongPrice);
        const resetChange = Math.min(10, this.action.openAgainPriceChange*10);
        if (this.lastOpenLongPrice === Number.NEGATIVE_INFINITY || change > this.action.openAgainPriceChange || change < -1*resetChange) // rise > 0.1% or drop > 1.0%
            return true;
        this.log(utils.sprintf("Prevented opening LONG because price is too close to last open long price - current %s, last %s, change %s%%", this.avgMarketPrice, this.lastOpenLongPrice, change));
        return false;
    }

    protected setMaxHistogram(max: number) {
        max = Math.abs(max);
        this.histograms.push(max);
        if (this.histograms.length > this.action.long)
            this.histograms.shift();
        //this.maxHistogram = _.max(this.histograms); // use avg to react faster
        let sum = 0;
        for (let i = 0; i < this.histograms.length; i++)
            sum += this.histograms[i];
        this.maxHistogram = sum / this.histograms.length;
    }

    protected openByHistogramUp(histogram: number) {
        if (this.action.openDecreasingHist > 0) {
            // wait for the down trend to decrease, then go long
            if (histogram < 0 && histogram < this.getHistogramThresholdDown())
                return this.decreasingHistogramTicks >= this.action.openDecreasingHist;
            return false;
        }
        return histogram > 0 && histogram > this.getHistogramThresholdUp();
    }

    protected openByHistogramDown(histogram: number) {
        if (this.action.openDecreasingHist > 0) {
            // wait for the up trend to decrease, then go short
            if (histogram > 0 && histogram > this.getHistogramThresholdUp())
                return this.decreasingHistogramTicks >= this.action.openDecreasingHist;
            return false;
        }
        return histogram < 0 && histogram < this.getHistogramThresholdDown();
    }

    protected getHistogramThresholdUp() {
        if (this.lastHistogram > 0)
            return this.lastHistogram*this.action.histogramIncreaseFactor;
        return this.lastHistogram; // otherwise our thresholds for 0 take care of it
    }

    protected getHistogramThresholdDown() {
        // we have losses in slightly downwards markets. but increasing this by a factor reduces our general profit
        if (this.lastHistogram < 0)
            return this.lastHistogram*this.action.histogramIncreaseFactor;
        return this.lastHistogram;
    }
}