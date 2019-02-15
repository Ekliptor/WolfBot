import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction, ScheduledTrade} from "../AbstractStrategy";
import WaveSurfer from "../WaveSurfer";
import {AbstractIndicator, BolloingerBandsParams, TrendDirection} from "../../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TechnicalStrategyAction} from "../TechnicalStrategy";
import {TaLib, TaLibParams} from "../../Indicators/TaLib";
import * as path from "path";
import {BollingerBands as BollingerIndicator} from "../../Indicators/BollingerBands";
import {Aroon as AroonIndicator} from "../../Indicators/Aroon";
import {MACD as MACDIndicator} from "../../Indicators/MACD";
import {ADX as ADXIndicator} from "../../Indicators/ADX";
import {StochRSI as StochRSIIndicator} from "../../Indicators/StochRSI";
import {RSI as RSIIndicator} from "../../Indicators/RSI";
import {Sentiment as Sentimentndicator} from "../../Indicators/Sentiment";
import {AbstractCryptotraderIndicator} from "../../Indicators/AbstractCryptotraderIndicator";
import {AbstractGenericStrategy} from "../AbstractGenericStrategy";
import {TechnicalLendingStrategyAction} from "../../Lending/Strategies/TechnicalLendingStrategy";
import AverageVolume from "../../Indicators/AverageVolume";
import VolumeProfile from "../../Indicators/VolumeProfile";
import PivotPoints from "../../Indicators/PivotPoints";
import IchimokuClouds from "../../Indicators/IchimokuClouds";
import Liquidator from "../../Indicators/Liquidator";


export abstract class TechnicalAnalysis extends AbstractGenericStrategy {
    protected static readonly KEEP_OLD_CANDLES_ADD = 520; // some indicators need more data to start returning values

    // members must still be added in the implementation class for TS
    public action: TechnicalStrategyAction | TechnicalLendingStrategyAction;
    public candles: Candle.Candle[] = [];
    public taLib = new TaLib();
    public indicators = new Map<string, AbstractIndicator>(); // (indicator name, indicator)
    public lastTrend: TrendDirection = "none"; // we store the last trend and don't buy repeatedly, only when lines cross
    public customIndicators = new Map<string, number>(); // (indicator name, latest value)
    public persistenceCount: number = 0;

    // constructor of a mixin is never called

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    // TypeScript implements mixins as an interface, so these functions have to be public too

    public init(options) {
    }

    public addCandle(candle: Candle.Candle) {
        this.candles.push(candle); // TODO candles are just a copy of candleHistory. can be removed?
        // TODO cleanup if the strategy doesn't have "long" ?
        /*
        if (this.action.long) {
            if (this.candles.length > this.action.long)
                this.candles.shift(); // remove the oldest candle
        }
        else if (this.action.interval) {
            if (this.candles.length > this.action.interval)
                this.candles.shift();
        }
        */
        let intervals = [this.action.long, this.action.interval];
        if (this.action instanceof BolloingerBandsParams)
            intervals.push((this.action as BolloingerBandsParams).N);
        intervals.push(1); // Math.max() results in -Infinity on empty array and we filter 0
        intervals = intervals.filter(i => i > 0); // filter undefined
        let max = Math.max(...intervals) + TechnicalAnalysis.KEEP_OLD_CANDLES_ADD;
        if (this.candles.length > max)
            this.candles.shift(); // remove the oldest candle
    }

    /**
     * Adds a new indicator
     * @param name a unique name for this indicator
     * @param type the type of this indicator, for example "DEMA"
     * @param params indicator params such as short & long
     */
    public addIndicator(name: string, type: string, params: TechnicalStrategyAction | TechnicalLendingStrategyAction) {
        const modulePath = path.join(__dirname, "..", "..", "Indicators", type);
        let indicatorInstance = this.loadModule<AbstractIndicator>(modulePath, params)
        if (!indicatorInstance) {
            logger.error("Indicator of type %s doesn't exist", type)
            return
        }
        if (this.indicators.has(name)) {
            logger.error("Duplicate indicator name %s of type %s. Only using the first one", name, type)
            return
        }
        this.indicators.set(name, indicatorInstance);
    }

    public getIndicator(name: string): AbstractIndicator {
        let indicator = this.indicators.get(name);
        if (indicator)
            return indicator;
        logger.error("Indicator with name %s doesn't exist in %s", name, this.className)
        return null;
    }

    public getBollinger(name: string): BollingerIndicator {
        let indicator = this.getIndicator(name);
        if (indicator instanceof BollingerIndicator)
            return indicator;
        logger.error("Indicator with name %s has the wrong instance type in %s", name, this.className)
        return null;
    }

    public getAroon(name: string): AroonIndicator {
        let indicator = this.getIndicator(name);
        if (indicator instanceof AroonIndicator)
            return indicator;
        logger.error("Indicator with name %s has the wrong instance type in %s", name, this.className)
        return null;
    }

    public getMACD(name: string): MACDIndicator {
        let indicator = this.getIndicator(name);
        if (indicator instanceof MACDIndicator)
            return indicator;
        logger.error("Indicator with name %s has the wrong instance type in %s", name, this.className)
        return null;
    }

    public getADX(name: string): ADXIndicator {
        let indicator = this.getIndicator(name);
        if (indicator instanceof ADXIndicator)
            return indicator;
        logger.error("Indicator with name %s has the wrong instance type in %s", name, this.className)
        return null;
    }

    public getStochRSI(name: string): StochRSIIndicator {
        let indicator = this.getIndicator(name);
        if (indicator instanceof StochRSIIndicator)
            return indicator;
        logger.error("Indicator with name %s has the wrong instance type in %s", name, this.className)
        return null;
    }

    public getRSI(name: string): RSIIndicator {
        let indicator = this.getIndicator(name);
        if (indicator instanceof RSIIndicator)
            return indicator;
        logger.error("Indicator with name %s has the wrong instance type in %s", name, this.className)
        return null;
    }

    public getSentiment(name: string): Sentimentndicator {
        let indicator = this.getIndicator(name);
        if (indicator instanceof Sentimentndicator)
            return indicator;
        logger.error("Indicator with name %s has the wrong instance type in %s", name, this.className)
        return null;
    }

    public getCryptotraderIndicator(name: string): AbstractCryptotraderIndicator {
        let indicator = this.getIndicator(name);
        if (indicator instanceof AbstractCryptotraderIndicator)
            return indicator;
        logger.error("Indicator with name %s has the wrong instance type in %s", name, this.className)
        return null;
    }

    public getVolume(name: string): AverageVolume {
        let indicator = this.getIndicator(name);
        if (indicator instanceof AverageVolume)
            return indicator;
        logger.error("Indicator with name %s has the wrong instance type in %s", name, this.className)
        return null;
    }

    public getVolumeProfile(name: string): VolumeProfile {
        let indicator = this.getIndicator(name);
        if (indicator instanceof VolumeProfile)
            return indicator;
        logger.error("Indicator with name %s has the wrong instance type in %s", name, this.className)
        return null;
    }

    public getPivotPoints(name: string): PivotPoints {
        let indicator = this.getIndicator(name);
        if (indicator instanceof PivotPoints)
            return indicator;
        logger.error("Indicator with name %s has the wrong instance type in %s", name, this.className)
        return null;
    }

    public getIchimokuClouds(name: string): IchimokuClouds {
        let indicator = this.getIndicator(name);
        if (indicator instanceof IchimokuClouds)
            return indicator;
        logger.error("Indicator with name %s has the wrong instance type in %s", name, this.className)
        return null;
    }

    public getLiquidator(name: string): Liquidator {
        let indicator = this.getIndicator(name);
        if (indicator instanceof Liquidator)
            return indicator;
        logger.error("Indicator with name %s has the wrong instance type in %s", name, this.className)
        return null;
    }

    public allIndicatorsReady() {
        let ready = true;
        for (let ind of this.indicators)
        {
            if (!ind[1].isReady()) {
                ready = false;
                break;
            }
        }
        return ready;
    }

    /**
     * Computes the Simple Moving Average with candle size of x minutes
     * @param minutes the candleSize to use (regardless of the config value of this strategy)
     * @param period the number of candles this MA shall be calculated for
     * @param depth number of candles into the past (ignoring "depth" latest candles)
     * @returns {Promise<number>}
     */
    public getXMinuteMA(minutes: number, period: number, depth: number) {
        return new Promise<number>((resolve, reject) => {
            let candles = this.getCandles(minutes);
            depth = Math.abs(depth);
            if (candles.length <= depth)
                return resolve(-1); // not yet enough data
            if (depth > 0)
                candles.splice(candles.length - depth, depth); // remove the past depth candles
            let valuesIn = candles.map(x => x.close); // we could remove more old candles here (depending on period, but the strategy will remove them)
            let maParams = new TaLibParams("SMA", valuesIn, period);
            this.taLib.calculate(maParams).then((result) => {
                let value = TaLib.getLatestResultPoint(result);
                resolve(value)
            }).catch((err) => {
                logger.error("Error computing %s minutes MA", minutes, err)
                resolve(-1)
            })
        })
    }

    public computeCustomIndicator(name: string, computeResult: Promise<number>) {
        return new Promise<number>((resolve, reject) => {
            computeResult.then((value) => {
                this.customIndicators.set(name, value)
                resolve(value)
            }).catch((err) => {
                logger.error("Error computing custom indicator %s", name, err)
                this.customIndicators.set(name, -1)
                resolve(-1); // continue with other indicators
            })
        })
    }

    public allCustomIndicatorsReady() {
        for (let ind of this.customIndicators)
        {
            if (ind[1] === -1)
                return false;
        }
        return true;
    }

    public resetTechnicalValues(): void {
        // don't reset our candles and indicators. we want to detect trends based on historical data
        //this.lastTrend = "none"; // value should be kept and not reset here
        this.persistenceCount = 0;
    }
}