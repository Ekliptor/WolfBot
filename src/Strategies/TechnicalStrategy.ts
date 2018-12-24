import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {AbstractIndicator, BolloingerBandsParams, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import * as path from "path";
import {BollingerBands as BollingerIndicator} from "../Indicators/BollingerBands";
import {Aroon as AroonIndicator} from "../Indicators/Aroon";
import {MACD as MACDIndicator} from "../Indicators/MACD";
import {ADX as ADXIndicator} from "../Indicators/ADX";
import {StochRSI as StochRSIIndicator} from "../Indicators/StochRSI";
import {RSI as RSIIndicator} from "../Indicators/RSI";
import {Sentiment as SentimentIndicator} from "../Indicators/Sentiment";
import {AbstractCryptotraderIndicator} from "../Indicators/AbstractCryptotraderIndicator";
import {TaLib, TaLibParams, TaLibResult} from "../Indicators/TaLib";
import {TechnicalAnalysis} from "./Mixins/TechnicalAnalysis";
import * as helper from "../utils/helper";
import {isWindows} from "@ekliptor/apputils";
import {GenericStrategyState} from "./AbstractGenericStrategy";
import {CandleBatcher} from "../Trade/Candles/CandleBatcher";
import AverageVolume from "../Indicators/AverageVolume";
import VolumeProfile from "../Indicators/VolumeProfile";
import PivotPoints from "../Indicators/PivotPoints";

export interface TechnicalStrategyAction extends StrategyAction {
    // properties are optional because not all strategies will have all indicators (and some might inherit TechnicalStrategy for other functions)
    // for DEMA, EMA,...
    short?: number; // number of candles for the short line
    long?: number; // number of candles for the long line

    // for RSI, Trendatron,... (every strategy with just an interval)
    interval?: number; // number of candles

    // for (almost) all
    thresholds?: {
        down: number; // how many % the 2 lines have to cross over for it to be considered a down trend
        up: number; // same for up trend
        persistence: number; // for how many candles the trend has to stay for the strategy to trigger
        sidewaysPercent: number; // price change % for a market to be considered sideways. usually change from now back to candleSize*long
    }
}

/**
 * Strategy that emits buy/sell based on technical indicators.
 * Typically these are strategies where a short average (10 candles) crosses a long average (21 candles).
 */
export abstract class TechnicalStrategy extends AbstractStrategy implements TechnicalAnalysis {
    // TechnicalAnalysis mixin members
    public action: TechnicalStrategyAction;
    public candles: Candle.Candle[] = [];
    public taLib = new TaLib();
    public indicators = new Map<string, AbstractIndicator>(); // (indicator name, indicator)
    public lastTrend: TrendDirection = "none"; // we store the last trend and don't buy repeatedly, only when lines cross
    public customIndicators = new Map<string, number>(); // (indicator name, latest value)
    public persistenceCount: number = 0;

    constructor(options) {
        super(options)

        // set default values for strategies
        let thresholds = nconf.get('serverConfig:strategyDefaults:thresholds')
        if (!this.action.thresholds) {
            this.action.thresholds = {
                down: thresholds.down,
                up: thresholds.up,
                persistence: thresholds.persistence,
                sidewaysPercent: thresholds.sidewaysPercent
            }
        }
        else {
            const defaults = ["down", "up", "persistence", "sidewaysPercent"];
            defaults.forEach((prop) => {
                if (!this.action.thresholds[prop])
                    this.action.thresholds[prop] = thresholds[prop];
            })
        }
    }

    public getPlotData() {
        let plotData = this.plotData;
        // add marks from all indicators on top of it
        // this will overwrite all keys, so make sure to choose unique names for your marks to be plotted
        for (let ind of this.indicators)
            plotData = plotData.mergeMarkData(ind[1]);
        return plotData;
    }

    /**
     * Save the strategy state before the bot closes.
     * @returns {GenericStrategyState}
     */
    public serialize() {
        // can't come from mixin when we have to call super
        let state = super.serialize();
        // serialize candles for indicators
        state.candles = Candle.Candle.copy(this.candles);
        state.lastTrend = this.lastTrend;
        state.indicators = {}
        for (let ind of this.indicators)
        {
            const indicatorName = ind[0];
            let indicator: AbstractIndicator = ind[1];
            state.indicators[indicatorName] = indicator.serialize();
        }
        return state;
    }

    /**
     * Restore the strategy state after the bot has restarted.
     * @param state
     */
    public unserialize(state: GenericStrategyState) {
        super.unserialize(state);
        this.candles = Candle.Candle.copy(state.candles);
        this.lastTrend = state.lastTrend;
        let calcCandle = (i) => {
            if (i >= this.candles.length)
                return; // done
            let candle = this.candles[i];
            let candleCalcOps = []
            for (let ind of this.indicators)
            {
                const indicatorName = ind[0];
                let indicator: AbstractIndicator = ind[1];
                indicator.sync(candle); // only needed for plotting, shouldn't matter
                candleCalcOps.push(indicator.addCandle(candle));
                if (state.indicators && state.indicators[indicatorName])
                    indicator.unserialize(state.indicators[indicatorName]);
            }
            Promise.all(candleCalcOps).then(() => {
                //this.indicators.get("RSI").addCandle(this.candles[this.candles.length-1]) // indicator will be ready once the next (live) candle arrives
                calcCandle(++i); // has to be done async for every candle or else we might calculate them in a different order
            }).catch((err) => {
                logger.error("Error restoring indicators in %s", this.className, err)
                calcCandle(++i);
            })
        }
        calcCandle(0);
    }

    /**
     * Create a strategy state for this strategy from 1min candles.
     * You can overwrite this function and create the state from the parent class to add more data.
     * @param candles1min
     */
    public createStateFromMinuteCandles(candles1min: Candle.Candle[]) {
        let state = super.createStateFromMinuteCandles(candles1min);
        state.candles = state.candleHistory;
        return state;
    }

    /**
     * Return the min number of candles this strategy needs to start trading.
     * This is used to fetch a history and run backtest.
     * @returns {number}
     */
    public getMinWarumCandles() {
        let numbers = [this.action.interval, this.action.long, this.action.short].filter(n => n !== undefined);
        let maxCandles = Math.max(...numbers);
        return maxCandles + Math.ceil(maxCandles / 100 + nconf.get("serverConfig:importWarmupAddPercent"));
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    // TechnicalAnalysis mixin members
    public init: (options) => void;
    public addCandle: (candle: Candle.Candle) => void;

    /**
     * Add an indicator under a unique name
     * @param {name} the unique name of the indicator (must be unique within your strategy class)
     * @param {type} the type of the indicator. There must be a class with the same name available in the /Indicators folder.
     * @param {params} the parameters for this indicator. They depend on the type.
     */
    public addIndicator: (name: string, type: string, params: TechnicalStrategyAction) => void;

    /**
     * Get an indicator by its unique name.
     */
    public getIndicator: (name: string) => AbstractIndicator;

    public getBollinger: (name: string) => BollingerIndicator;
    public getAroon: (name: string) => AroonIndicator;
    public getMACD: (name: string) => MACDIndicator;
    public getADX: (name: string) => ADXIndicator;
    public getStochRSI: (name: string) => StochRSIIndicator;
    public getRSI: (name: string) => RSIIndicator;
    public getSentiment: (name: string) => SentimentIndicator;
    public getCryptotraderIndicator: (name: string) => AbstractCryptotraderIndicator;
    public getVolume: (name: string) => AverageVolume;
    public getVolumeProfile: (name: string) => VolumeProfile;
    public getPivotPoints: (name: string) => PivotPoints;
    public allIndicatorsReady: () => boolean;
    public getXMinuteMA: (minutes: number, period: number, depth: number) => Promise<number>;
    public computeCustomIndicator: (name: string, computeResult: Promise<number>) => Promise<number>;
    public allCustomIndicatorsReady: () => boolean;
    public resetTechnicalValues: () => void;

    /**
     * Called when new trades happen on the exchange.
     * This function is called every few seconds (depending on how many trades happen for the currency pair set with this.action.pair).
     * Use this for fast trading or fast stops, scalping, etc...
     * @param {Trade[]} trades the new trades
     * @returns {Promise<void>}
     */
    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            for (let ind of this.indicators)
            {
                ind[1].addTrades(trades);
                ind[1].addPricePoint(this.avgMarketPrice);
            }
            resolve()
        })
    }

    /**
     * Called when a new candle is ready. Meaning it is called once every this.action.candleSize minutes.
     * @param {Candle} candle the new candle
     * @returns {Promise<void>}
     */
    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.config.updateIndicatorsOnTrade === true)
                return resolve();
            this.addCandle(candle);

            let candleCalcOps = []
            for (let ind of this.indicators)
            {
                ind[1].sync(candle);
                candleCalcOps.push(ind[1].addCandle(candle));
            }
            Promise.all(candleCalcOps).then(() => {
                let promise = null;
                if (this.allIndicatorsReady())
                    promise = this.checkIndicators();
                return promise ? promise : Promise.resolve()
            }).then(() => {
                resolve() // wait for the possibly async indicator check
            }).catch((err) => {
                logger.error("Error calculating indicators on candle update in %s", this.className, err)
            })
            //resolve() // we can continue immediately
        })
    }

    protected currentCandleTick(candle: Candle.Candle, isNew: boolean): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.config.updateIndicatorsOnTrade === false)
                return resolve();
            if (this.candles.length !== 0)
                this.candles.splice(-1, 1);
            this.addCandle(candle);
            //if (this.candle === null)
                this.candle = candle; // a lot of strategies use it in checkIndicators() // always set it for now
            // TODO this means secondLastRSI etc.. values are from the last tick instead of the last candle. strategies using this setting should be modified

            let candleCalcOps = []
            for (let ind of this.indicators)
            {
                const indicator: AbstractIndicator = ind[1];
                // TODO also replace candle on indicator
                indicator.sync(candle);
                candleCalcOps.push(indicator.addCandle(candle));
            }
            Promise.all(candleCalcOps).then(() => {
                let promise = null;
                if (this.allIndicatorsReady())
                    promise = this.checkIndicators();
                return promise ? promise : Promise.resolve()
            }).then(() => {
                resolve() // wait for the possibly async indicator check
            }).catch((err) => {
                logger.error("Error calculating indicators on current candle update in %s", this.className, err)
            })
            //resolve() // we can continue immediately
        })
    }

    /**
     * Check if we should buy or sell. Called every candle. Candle size is mandatory for technical strategies, even if the strategy
     * only relies on price points.
     */
    protected abstract checkIndicators(): void;

    protected isSidewaysMarket() {
        // TODO move to AbstractStrategy class?
        // TODO use Bollinger bw as alternative?
        let startCandle = this.getCandleAt(this.action.long)
        if (!startCandle || !this.candle)
            return false;
        let change = helper.getDiffPercent(this.candle.close, startCandle.close); // > 0 if market is rising
        return Math.abs(change) < this.action.thresholds.sidewaysPercent;
    }

    /**
     * This is called every time a trade happens. That includes trades from other strategies running on the same currency pair.
     */
    protected resetValues(): void {
        this.resetTechnicalValues();
        super.resetValues();
    }
}

utils.objects.applyMixins(TechnicalStrategy, [TechnicalAnalysis]);