import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";
import {Aroon as AroonIndicator} from "../Indicators/Aroon";
import BollingerStop, {BollingerStopAction} from "./BollingerStop";
import {TradeInfo} from "../Trade/AbstractTrader";

interface BollingerDayTraderAction extends BollingerStopAction {
    percentReached: number; // 0.05, optional, A number indicating how close to %b the price has to be to consider it "reached".
    trendingBbMax: number; // default 0.15 - The max above/below 0.5 (the middle of %b bands) to go long/short in trending markets.
    tradeMarkets: "trending" | "sideways" | "both"; // default "both" - In which markets this strategy shall open positions. The Aroon indicator is used to check if we are in a sideways market.

    // stop config
    stopBandTrending: "middle" | "opposite"; // optional, default "middle". The band to close a position if we are in a trending market.
    delayTicks: number; // optional, default 1. Keep a position open for at least x candle ticks to avoid stopping immediately.
    notifyBeforeStopSec: number; // optional, Send a notification (for example to the smartphone) x seconds before the stop executes.
    keepPriceOpen: boolean; // default true. Keep the position open if the last candle close-value price was higher/lower than the current rate. This means if we are outside of the Bollinger Bands stop, but the last candle was moving in the same direction as our open position.
    time: number; // wait seconds before closing the position, optional

    // optional, for defaults see BolloingerBandsParams
    N: number; // time period for MA
    K: number; // factor for upper/lower band
    MAType: number; // moving average type, 0 = SMA

    // optional, default MACD indicator params
    short: number; // 12
    long: number; // 26
    signal: number; // 9

    //sidewaysIndicator: "Aroon"; // optional, default Aroon. if sideways indicator says we are in a sideways market, then the trend indicator is not checked
    trendIndicator: "MACD"; // optional, default MACD // TODO add more indicators
    interval: number; // optional, Aroon and MACD candle interval, default = 25
    aroonSidewaysLevel: number; // optional, default 50. Consider the market sideways if both AroonUp and ArronDown values are <= x.

    // optional volume config
    // look at volume for confirmation: huge volume = trend starting (or end of drop = also uptrend starting)
    volumeAvgCandles: number; // default 3. How many candles to look back to compute the average volume.
    volumeSpikeFactor: number; // default 1.9. How much higher the current candle volume must be (than average) to allow opening trend positions on the opposite Bollinger Band.
}

/**
 * Strategy that looks at MACD histogram (or EMA) to check if we are in an up or down trend.
 * It will then open a position when we cross the Bollinger middle line and keep it open until we cross the middle line
 * again (or the opposite line as a more risky stop).
 * If we are in a sideways market: It uses Aroon and requires both <= 50 and trade between upper and lower band.
 *
 * Works well with 1 hour candles. Should still be used with StopLossTurn because we might never reach the closing band (unlikely).
 * warm up time: >= 35 candles (default parameters)
 * more Bollinger strategies: https://tradingsim.com/blog/bollinger-bands/
 *
 * TODO check BB width: low volatility -> breakout imminent
 * TODO use trend indicators (such as ADX) to open a trend position if bollinger doesn't fire for > 1 day
 */
export default class BollingerDayTrader extends BollingerStop {
    public action: BollingerDayTraderAction;

    constructor(options) {
        super(options)
        if (!this.action.percentReached)
            this.action.percentReached = 0.05;
        if (!this.action.trendingBbMax)
            this.action.trendingBbMax = 0.15;
        if (!this.action.tradeMarkets)
            this.action.tradeMarkets = "both";
        if (!this.action.stopBandTrending)
            this.action.stopBandTrending = "middle";
        if (!this.action.short)
            this.action.short = 12;
        if (!this.action.long)
            this.action.long = 26;
        if (!this.action.signal)
            this.action.signal = 9;
        if (!this.action.trendIndicator)
            this.action.trendIndicator = "MACD";
        if (typeof this.action.aroonSidewaysLevel !== "number")
            this.action.aroonSidewaysLevel = 50;
        if (!this.action.interval)
            this.action.interval = 25;
        if (!this.action.volumeAvgCandles)
            this.action.volumeAvgCandles = 3;
        if (!this.action.volumeSpikeFactor)
            this.action.volumeSpikeFactor = 1.9;

        this.addIndicator(this.action.trendIndicator, this.action.trendIndicator, this.action);
        this.addIndicator("Aroon", "Aroon", this.action);

        this.addInfoFunction("sidewaysMarket", () => {
            return this.isSidewaysMarketTred();
        });
        this.addInfoFunction("upwardsMarket", () => {
            return this.isUpwardsMarketTrend();
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
        let aroon = this.getAroon("Aroon")
        this.addInfoFunction("AroonUp", () => {
            return aroon.getUp();
        });
        this.addInfoFunction("AroonDown", () => {
            return aroon.getDown();
        });
        this.addInfoFunction("volumeSpikeFactor", () => {
            return this.getVolumeSpikeFactor();
        });
        this.mainStrategy = true;
        this.saveState = true;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action !== "close") // TODO check if the trade came from this class?
            this.done = false; // reset it for BollingerStop class to fire. reset in AbstractStrategy for close (if from this class)
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        let bollinger = this.getBollinger("BollingerBands")
        const value = bollinger.getPercentB(this.candle.close)
        const valueFormatted = Math.round(value * 100) / 100.0;

        // this strategy can buy and sell in opposite directions (without closing). good idea?
        if (this.isSidewaysMarketTred() && this.action.tradeMarkets !== "trending") {
            // trade between upper and lower Bollinger Band
            this.action.stopBand = "opposite";
            if (this.strategyPosition === "none") {
                if (value >= 1 - this.action.percentReached) {
                    const reason = utils.sprintf("reached upper band in sideways market, DOWN trend imminent, %%b value %s", valueFormatted)
                    this.log(reason)
                    this.emitSell(this.defaultWeight, reason);
                }
                else if (value <= this.action.percentReached) {
                    const reason = utils.sprintf("reached lower band in sideways market, UP trend imminent, %%b value %s", valueFormatted)
                    this.log(reason)
                    this.emitBuy(this.defaultWeight, reason);
                }
                else
                    this.log("no trend detected in sideways market, %b value", valueFormatted)
            }
        }
        else if (this.action.tradeMarkets !== "sideways") {
            // TODO only trade if momentum trend is increasing?? but might mean we miss just as many good trades as we prevent bad ones
            this.action.stopBand = this.action.stopBandTrending; // TODO keep it to "opposite" if we already have an open sidways position?
            if (this.strategyPosition === "none") {
                if (this.isUpwardsMarketTrend()) {
                    // open on the middle line UP
                    if (value >= 0.5 + this.action.percentReached && value < 0.5 + this.action.trendingBbMax) {
                        const reason = utils.sprintf("reached middle band in UP trend market, UP trend imminent, %%b value %s", valueFormatted)
                        this.log(reason)
                        this.emitBuy(this.defaultWeight, reason);
                    }
                    // allow opening from the lower band UP on high volume (trend reversal)
                    else if (this.getVolumeSpikeFactor() >= this.action.volumeSpikeFactor && value >= this.action.percentReached && value < 0.5 + this.action.trendingBbMax) {
                        const reason = utils.sprintf("reached lower/middle band with high volume %sx in UP trend market, UP trend imminent, %%b value %s", this.getVolumeSpikeFactor(), valueFormatted)
                        this.log(reason)
                        this.emitBuy(this.defaultWeight, reason);
                    }
                }
                else {
                    // open on the middle line DOWN
                    if (value <= 0.5 - this.action.percentReached && value > 0.5 - this.action.trendingBbMax) {
                        const reason = utils.sprintf("reached middle band in DOWN trend market, DOWN trend imminent, %%b value %s", valueFormatted)
                        this.log(reason)
                        this.emitSell(this.defaultWeight, reason);
                    }
                    // allow opening from the upper band DOWN on high volume (trend reversal)
                    else if (this.getVolumeSpikeFactor() >= this.action.volumeSpikeFactor && value <= 1.0 - this.action.percentReached && value > 0.5 - this.action.trendingBbMax) {
                        const reason = utils.sprintf("reached upper/middle band with high volume %sx in DOWN trend market, DOWN trend imminent, %%b value %s", this.getVolumeSpikeFactor(),  valueFormatted)
                        this.log(reason)
                        this.emitSell(this.defaultWeight, reason);
                    }
                }
            }
        }

        this.checkStopIndicators();
    }

    protected isSidewaysMarketTred() {
        //return this.isSidewaysMarket() // only checks candle trend
        let aroon = this.getAroon("Aroon")
        return aroon.getUp() <= this.action.aroonSidewaysLevel && aroon.getDown() <= this.action.aroonSidewaysLevel;
    }

    protected isUpwardsMarketTrend() {
        let macd = this.getMACD(this.action.trendIndicator);
        return macd.getHistogram() > 0.0;
    }

    protected getVolumeSpikeFactor() {
        let candles = [];
        for (let i = 1; i < this.candleHistory.length && i < this.action.volumeAvgCandles+1; i++)
        {
            // position 0 is the current candle (this.candle)
            candles.push(this.candleHistory[i]);
        }
        let avgVolume = this.computeAverageCandleVolume(candles);
        if (avgVolume === 0.0 || !this.candle)
            return 0.0;
        return this.candle.volume / avgVolume;
    }

    protected emitBuy(weight: number, reason = "", fromClass = "") {
        if (this.strategyPosition !== "long")
            super.emitBuy(weight, reason, fromClass);
    }

    protected emitSell(weight: number, reason = "", fromClass = "") {
        if (this.strategyPosition !== "short")
            super.emitSell(weight, reason, fromClass);
    }
}