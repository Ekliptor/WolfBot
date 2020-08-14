import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
//import {AbtractCryptotraderIndicator} from "./AbtractCryptotraderIndicator"; // circular reference: parent - child
import {DataPlotCollector, PlotMarkValues, PlotMark} from "./DataPlotCollector";
import {Currency, Trade, Candle, MarketOrder} from "@ekliptor/bit-models";
import {OrderBook} from "../Trade/OrderBook";

export interface IndicatorParams {
    enableLog: boolean; // since params get copied from Strategy this value will be the same as "enableLog" for the strategy
}
export interface IntervalIndicatorParams extends IndicatorParams {
    interval: number; // number of candles for the indicator
}
export interface LineCrossIndicatorParams extends IndicatorParams {
    short: number; // number of candles for the short line
    long: number; // number of candles for the long line
}
export interface MomentumIndicatorParams extends IndicatorParams {
    interval: number; // number of candles for the indicator
    low: number; // value to trigger down trend (in % or absolute, depending on indicator)
    high: number; // value to trigger up trend (in % or absolute, depending on indicator)
}
export class StochRSIIndicatorParams implements MomentumIndicatorParams {
    enableLog: boolean;
    interval: number;
    low: number;
    high: number;
    optInFastK_Period: number = 5;
    optInFastD_Period: number = 3;
    optInFastD_MAType: number = 0;
    constructor() {
    }
}
export class BolloingerBandsParams implements IndicatorParams {
    enableLog: boolean;
    N: number = 20; // time period for MA
    K: number = 2; // factor for upper/lower band
    MAType: number = 0; // moving average type, 0 = SMA
    /**
     * 0=SMA
     1=EMA
     2=WMA
     3=DEMA
     4=TEMA
     5=TRIMA
     6=KAMA
     7=MAMA
     8=T3
     * https://cryptotrader.org/topics/203955/thanasis-all-indicators-code
     */
    bandwidthHistoryLen: number = 60; // default 3*N
    constructor() {
        this.bandwidthHistoryLen = 3*this.N;
    }
}
export class SarParams implements IndicatorParams {
    enableLog: boolean;
    accelerationFactor: number = 0.02; // Acceleration Factor used up to the Maximum value
    accelerationMax: number = 0.2; // Acceleration Factor Maximum value
    constructor() {
    }
}
export interface MACDParams extends LineCrossIndicatorParams { // TA-LIB says "Momentum Indicators", but the signal is crossing lines
    signal: number; // number of candles for the signal line
}
export class VIXParams implements IntervalIndicatorParams {
    enableLog: boolean;
    interval: number; // the candle interval of another (the main) indicator
    stddevPriod: number = 20; // works better with this value, see Bollinger
    constructor() {
    }
}
export interface KamaIndicatorParams extends IntervalIndicatorParams {
    useTrueRange: boolean; // Use true range of candle close as KAMA input (instead of candle close)
}
export class TristarParams implements IntervalIndicatorParams {
    enableLog: boolean;
    interval: number = 30; // works better with this value
    constructor() {
    }
}
export class ESSIndicatorParams implements IntervalIndicatorParams {
    enableLog: boolean;
    interval: number;
    numberOfPoles: number = 2;
    constructor() {
    }
}
export class STCIndicatorParams implements IndicatorParams {
    fast: number = 23; // number of fast EMA candles
    slow: number = 50; // number of slow EMA candles
    stcLength: number = 10; // MACD signal + STC candles
    factor: number = 0.5;
    enableLog: boolean;
}
export class VolumeProfileParams implements IntervalIndicatorParams {
    enableLog: boolean;
    interval: number = 48; // the number of candles to compute the volume profile from
    volumeRows: number = 24; // the number of equally-sized price zones
    valueAreaPercent: number = 70;
    useSingleTrades: boolean = true; // use single trades to compute volume profile (if available) or candle close prices
    constructor() {
    }
}
export type PivotPointsType = "standard" | "fibonacci" | "demark";
export class PivotPointsParams implements IntervalIndicatorParams {
    type: PivotPointsType = "standard";
    interval: number = 15; // the number of candles to use for high/low calculation
    enableLog: boolean;
}
export class PivotsHLParams implements IndicatorParams {
    leftLen: number = 14; // the number of candles to go back after a high/low
    rightLen: number = 14; // the number of candles to go forward after a high/low
    enableLog: boolean;
}
export class OrderbookHeatIndicatorParams implements IntervalIndicatorParams {
    interval: number = 14; // number of candles for the indicator
    priceStepBucket: number = 0.1; // The orderbook granularity, meaning how much of a price change in the order book shall be combined in a single bucket.
    enableLog: boolean;
}
export class IchimokuIndicatorParams implements IndicatorParams {
    conversionPeriod: number = 9;
    basePeriod: number = 26;
    spanPeriod: number = 52;
    displacement: number = 26;
    enableLog: boolean;
}
export class LiquidatorParams implements IntervalIndicatorParams {
    feed: ExchangeFeed = "BitmexMarketData";
    //exchangePairs: Currency.CurrencyPair[] = [new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.BTC)];
    currencyPairs: string[] = ["USD_BTC"]; // value is parsed to CurrencyPair
    interval: number = 15; // the number of candles to store liquidations for
    enableLog: boolean;
    public getPairs(): Currency.CurrencyPair[] {
        let pairs = [];
        this.currencyPairs.forEach((pair) => {
            let pairObj = Currency.CurrencyPair.fromString(pair);
            if (pairObj)
                pairs.push(pairObj);
            else if (this.enableLog)
                logger.warn("Unable to parse currency pair %s in %s Liquidator", pair, this.feed);
        });
        return pairs;
    }
}
export class MarketDepthParams implements IndicatorParams {
    pair: Currency.CurrencyPair;
    depthInterval: number = 6; // number of candles to keep data
    minUpdateIntervalMin: number = 30; // the minimum update interval in minutes (to prevent DDos)
    enableLog: boolean;
}

export type TrendDirection = Candle.TrendDirection; // moved, keep it as alias

export interface AllIndicators {
    [name: string]: number;
}

export abstract class AbstractIndicator extends DataPlotCollector {
    protected static readonly KEEP_OLD_DATA_FACTOR = 70;
    protected static readonly MAX_DATAPOINTS_DEFAULT = 50;

    protected params: IndicatorParams;
    protected taLib = new TaLib();

    // only present for trading indicators (not in lending mode)
    protected orderBook: OrderBook<MarketOrder.MarketOrder> = null;

    // for line cross indicators
    protected shortLineValue = -1;
    protected longLineValue = -1;

    // for momentum indicators
    protected value = -1;

    protected loggedUnsupportedCandleUpdateOnTrade = false;

    constructor(params: IndicatorParams) {
        super()

        if (AbstractIndicator.isLineCrossIndicator(params)) {
            if (typeof params.long === "number" && params.short === undefined) // for lending strategies we only use "long"
                params.short = Math.max(1, params.long-1);
            if (params.short < 1)
                logger.error("Invalid params. 'short' has to be at least 1 in %s", this.className)
            else if (params.short >= params.long) {
                //logger.error("Invalid params. 'short' has to be strictly lower than 'long' in %s", this.className)
                params.long = params.short + 1; // fix the error here so Evulution/Backfind continues
                logger.warn("Invalid params. 'short' has to be strictly lower than 'long' in %s. Increasing long to %s", this.className, params.long)
            }
        }
        else if (AbstractIndicator.isMomentumIndicator(params)) {
            if (params.low >= params.high) {
                //logger.error("Invalid params. 'low' has to be strictly lower than 'high' in %s", this.className)
                params.high = params.low + 1;
                logger.warn("Invalid params. 'low' has to be strictly lower than 'high' in %s. Increasing high to %s", this.className, params.high)
            }
        }

        this.params = params;
    }

    public addTrades(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            // overwrite in subclass if this strategy uses trades
            resolve()
        })
    }

    public addCandle(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            // overwrite in subclass if this strategy uses candles
            resolve()
        })
    }

    public removeLatestCandle() {
        // overwrite this if your indicator uses updateIndicatorsOnTrade to update its value within the same candle on live trades
        // usually means calling removeLatestData() on all number arrays of indicator values
    }

    public addPricePoint(price: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            // overwrite in subclass if this strategy uses a price stream
            resolve()
        })
    }

    /**
     * Sets the order book ONLY if it hasn't already been set.
     * @param orderBook
     */
    public setOrderBook(orderBook: OrderBook<MarketOrder.MarketOrder>, avgMarketPrice: number) {
        //if (this.orderBook === null) // be safe in case reference gets updated
            this.orderBook = orderBook;
        this.avgMarketPrice = avgMarketPrice;
    }

    public abstract isReady() :boolean;

    public getLineDiff() {
        return this.shortLineValue - this.longLineValue;
    }

    public getLineDiffPercent() {
        // ((y2 - y1) / y1)*100 - positive % if price is rising -> we are in an up trend
        return ((this.shortLineValue - this.longLineValue) / this.longLineValue) * 100;
    }

    public getValue() {
        return this.value;
    }

    public getShortLineValue() {
        return this.shortLineValue;
    }

    public getLongLineValue() {
        return this.longLineValue;
    }

    /**
     * Get all current indicator values as an object.
     * Overwrite this in your subclas if required.
     * This function MUST return numeric values only, no nested objects (because we use them to train our neural network).
     * @returns {object}
     */
    public getAllValues(): AllIndicators {
        if (AbstractIndicator.isLineCrossIndicator(this.params)) {
            return {
                shortLineValue: this.shortLineValue,
                longLineValue: this.longLineValue
            }
        }
        else if (AbstractIndicator.isMomentumIndicator(this.params)) {
            return {
                value: this.value
            }
        }
        if (this.isReady() === true && this.value === -1)
            logger.error("getAllValues() should be implemented in %s", this.className)
        return {value: this.value}
    }

    public getAllValueCount() {
        return Object.keys(this.getAllValues()).length;
    }

    /**
     * Serialize indicator data for bot restart.
     * State is normally stored in Strategies and only forwarded to indicators.
     * However, some indicators might need extra data.
     * @returns {{}}
     */
    public serialize(): any {
        let state: any = {}
        state.value = this.value;
        return state;
    }

    public unserialize(state: any) {
        if (state.value !== undefined)
            this.value = state.value;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    /**
     * Add data points to our history array
     * @param {number[]} data
     * @param {number} add
     * @param {number} maxDataPoints
     * @param {boolean} keepMore
     * @returns {number[]} the history array with the new data point
     */
    protected addData(data: number[], add: number, maxDataPoints: number = AbstractIndicator.MAX_DATAPOINTS_DEFAULT, keepMore: boolean = true) {
        data.push(add)
        // internally TA-LIB needs more data to compute a valid result for many indicators. so keep a lot more than our longest interval
        const max = keepMore === true ? maxDataPoints * AbstractIndicator.KEEP_OLD_DATA_FACTOR : maxDataPoints;
        if (data.length > max)
            data.shift();
        return data;
    }

    protected removeData(data: number[], maxLen: number) {
        if (maxLen <= 0)
            return data; // unlimited
        while (data.length > maxLen)
            data.shift();
        return data;
    }

    protected removeLatestData(data: number[]) {
        if (data.length !== 0)
            data.splice(-1, 1);
        return data;
    }

    protected addDataAny<T>(data: T[], add: T, maxDataPoints: number = AbstractIndicator.MAX_DATAPOINTS_DEFAULT, keepMore: boolean = true) {
        data.push(add)
        // internally TA-LIB needs more data to compute a valid result for many indicators. so keep a lot more than our longest interval
        const max = keepMore === true ? maxDataPoints * AbstractIndicator.KEEP_OLD_DATA_FACTOR : maxDataPoints;
        if (data.length > max)
            data.shift();
        return data;
    }

    protected removeDataAny<T>(data: T[], maxLen: number) {
        if (maxLen <= 0)
            return data; // unlimited
        while (data.length > maxLen)
            data.shift();
        return data;
    }

    protected removeLatestDataAny<T>(data: T[]) {
        if (data.length !== 0)
            data.splice(-1, 1);
        return data;
    }

    protected computeLineDiff(shortResult: TaLibResult, longResult: TaLibResult) {
        this.shortLineValue = TaLib.getLatestResultPoint(shortResult);
        this.longLineValue = TaLib.getLatestResultPoint(longResult);
        if (this.shortLineValue < 0 || this.longLineValue < 0)
            return;
        // low: 0.05%
        // high: 1.4%
        //logger.verbose("Computed %s line diff: %s - %s = %s (%s%)", this.className, this.shortLineValue, this.longLineValue, this.getLineDiff(), this.getLineDiffPercent().toFixed(3))
    }

    protected computeValue(result: TaLibResult) {
        this.value = TaLib.getLatestResultPoint(result);
        //if (this.value >= 0)
            //logger.verbose("Computed %s value: %s", this.className, this.getValue())
    }

    protected getTrueRange(candle: Candle.Candle, previousCandle: Candle.Candle): number {
        // custom true range
        const range1 = candle.high - candle.low;
        const range2 = candle.high - previousCandle.close;
        const range3 = previousCandle.close - candle.low;
        let trueRange = range1
        if (range1 >= range2 && range1 >= range3)
            trueRange = range1
        if (range2 >= range1 && range2 >= range3)
            trueRange = range2
        if(range3 >= range1 && range3 >= range2)
            trueRange = range3
        return trueRange;
    }

    /**
     * Log arguments
     * @param args the arguments to log. You can't use %s, but arguments will be formatted as string.
     */
    protected log(...args) {
        if (!this.params.enableLog)
            return;
        logger.info("Indicator %s:", this.className, ...args)
    }

    /**
     * Log arguments as warning
     * @param args the arguments to log. You can't use %s, but arguments will be formatted as string.
     */
    protected warn(...args) {
        if (!this.params.enableLog)
            return;
        logger.warn("Indicator %s:", this.className, ...args)
    }

    protected static isLineCrossIndicator(params: any): params is LineCrossIndicatorParams {
        //if (nconf.get("lending"))
            return params.long !== undefined;
        //return params.short && params.long;
    }

    protected static isMomentumIndicator(params: any): params is MomentumIndicatorParams {
        return params.interval && params.low && params.high;
    }
}

// force loading dynamic imports for TypeScript
import "./ADLine";
import "./ADX";
import "./Aroon";
import "./AverageVolume";
import "./BollingerBands";
import "./BVOL";
import "./CCI";
import "./DEMA";
import "./EhlerTrendline";
import "./EMA";
import "./GannSwing";
import "./IchimokuClouds";
import "./Kairi";
import "./KAMA";
import "./Liquidator";
import "./MACD";
//import "./MarketDepth";
import "./MayerMultiple";
import "./MFI";
import "./NVTSignal";
import "./OBV";
import "./OpenInterest";
import "./OrderbookHeatmap";
import "./PivotPoints";
import "./RSI";
import "./SAR";
import "./Sentiment";
import "./SMA";
import "./SocialSentiment";
import "./STC";
import "./Stochastic";
import "./StochRSI";
import "./TristarPattern";
import "./VIX";
import "./VolumeProfile";
import "./VWMA";
import {ExchangeFeed} from "../Exchanges/feeds/AbstractMarketData";
