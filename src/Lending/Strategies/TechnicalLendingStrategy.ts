import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, BolloingerBandsParams, TrendDirection} from "../../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import * as path from "path";
import {BollingerBands as BollingerIndicator} from "../../Indicators/BollingerBands";
import {Aroon as AroonIndicator} from "../../Indicators/Aroon";
import {MACD as MACDIndicator} from "../../Indicators/MACD";
import {ADX as ADXIndicator} from "../../Indicators/ADX";
import {StochRSI as StochRSIIndicator} from "../../Indicators/StochRSI";
import {RSI as RSIIndicator} from "../../Indicators/RSI";
import {Sentiment as SentimentIndicator} from "../../Indicators/Sentiment";
import {AbstractCryptotraderIndicator} from "../../Indicators/AbstractCryptotraderIndicator";
import {TaLib, TaLibParams, TaLibResult} from "../../Indicators/TaLib";
import {TechnicalAnalysis} from "../../Strategies/Mixins/TechnicalAnalysis";
import {AbstractLendingStrategy, LendingStrategyAction} from "./AbstractLendingStrategy";
import AverageVolume from "../../Indicators/AverageVolume";
import VolumeProfile from "../../Indicators/VolumeProfile";
import PivotPoints from "../../Indicators/PivotPoints";
import IchimokuClouds from "../../Indicators/IchimokuClouds";
import Liquidator from "../../Indicators/Liquidator";

export interface TechnicalLendingStrategyAction extends LendingStrategyAction {
    // TODO remove and only use TechnicalStrategAction? so far identical
    // for DEMA, EMA,...
    short: number; // number of candles for the short line
    long: number; // number of candles for the long line

    // for RSI, Trendatron,... (every strategy with just an interval)
    interval: number; // number of candles

    // for (almost) all
    thresholds: {
        down: number; // how many % the 2 lines have to cross over for it to be considered a down trend
        up: number; // same for up trend
        persistence: number; // for how many candles the trend has to stay for the strategy to trigger
    }
}

/**
 * Strategy that emits buy/sell based on technical indicators.
 * Typically these are strategies where a short average (10 candles) crosses a long average (21 candles).
 */
export abstract class TechnicalLendingStrategy extends AbstractLendingStrategy implements TechnicalAnalysis {
    // TechnicalAnalysis mixin members
    public action: TechnicalLendingStrategyAction;
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
                persistence: thresholds.persistence
            }
        }
        else {
            const defaults = ["down", "up", "persistence"];
            defaults.forEach((prop) => {
                if (!this.action.thresholds[prop])
                    this.action.thresholds[prop] = thresholds[prop];
            })
        }
    }

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

    public unserialize(state: any) {
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
                indicator.sync(candle, this.avgMarketPrice); // only needed for plotting, shouldn't matter
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

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    // TechnicalAnalysis mixin members
    public init: (options) => void;
    public addCandle: (candle: Candle.Candle) => void;
    public addIndicator: (name: string, type: string, params: TechnicalLendingStrategyAction) => void;
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
    public getIchimokuClouds: (name: string) => IchimokuClouds;
    public getLiquidator: (name: string) => Liquidator;
    public allIndicatorsReady: () => boolean;
    public getXMinuteMA: (minutes: number, period: number, depth: number) => Promise<number>;
    public computeCustomIndicator: (name: string, computeResult: Promise<number>) => Promise<number>;
    public allCustomIndicatorsReady: () => boolean;
    public resetTechnicalValues: () => void;

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

    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.addCandle(candle);
            this.removeTradesFromCandles(this.candles, nconf.get("serverConfig:keepTradesOnCandles"));

            let candleCalcOps = []
            for (let ind of this.indicators)
            {
                ind[1].sync(candle, this.avgMarketPrice);
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

    /**
     * Check if we should buy or sell. Called every candle. Candle size is mandatory for technical strategies, even if the strategy
     * only relies on price points.
     */
    protected abstract checkIndicators(): void;

    protected resetValues(): void {
        this.resetTechnicalValues();
        super.resetValues();
    }
}

utils.objects.applyMixins(TechnicalLendingStrategy, [TechnicalAnalysis]);