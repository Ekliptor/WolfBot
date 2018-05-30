import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as db from "../database";
import * as path from "path";
import {Architect, Layer, Network, Neuron, Trainer} from "synaptic";
import {AbstractIndicator, IndicatorParams} from "../Indicators/AbstractIndicator";
import {Currency, Trade, TradeHistory, Candle, Order} from "@ekliptor/bit-models";
import {BrainConfig} from "./BrainConfig";

export class IndicatorAdderMap extends Map<string, IndicatorAdder> { // (currency pair, instance)
    constructor() {
        super()
    }
}
export interface CombinedCurrencyValue {
    [pair: string]: number[]; // currency pair -> indicator values
}

export interface ConfigIndicator {
    //[type: string]: IndicatorParams; // subset of TechnicalStrategyAction
    [type: string]: {
        instance: any;
        [prop: string]: any;
    };
}

export class IndicatorAdder {
    protected className: string;
    protected config: BrainConfig;
    protected indicators: ConfigIndicator[];
    //protected candles: Candle.Candle[] = []; // all candles, not used currently
    protected firstAdd = true;

    protected minValue: number = Number.POSITIVE_INFINITY;
    protected maxValue: number = Number.NEGATIVE_INFINITY;

    protected static rawConfigJson: any = {};

    constructor(config: BrainConfig, rawConfigJson: any = null) {
        this.className = this.constructor.name;
        this.config = config;
        if (!rawConfigJson)
            rawConfigJson = IndicatorAdder.rawConfigJson;
        this.indicators = Array.isArray(rawConfigJson.indicators) ? rawConfigJson.indicators : []
        this.loadIndicators();
    }

    public static setRawConfigJson(rawConfigJson: any) {
        IndicatorAdder.rawConfigJson = rawConfigJson;
    }

    public addIndicatorData(candles: Candle.Candle[]) {
        return new Promise<number[]>((resolve, reject) => {
            candles = Object.assign([], candles); // make sure not to modify them
            let newCandles;
            if (!nconf.get("serverConfig:consecutiveLearningSteps")) {
                newCandles = candles;
                //this.candles = this.candles.concat(candles)
            }
            else {
                if (this.firstAdd === true) {
                    newCandles = candles;
                    //this.candles = candles; // add all
                }
                else {
                    let last = candles[candles.length - 1];
                    newCandles = [last];
                    //this.candles.push(last) // add the latest (only new) candle
                }
            }
            this.firstAdd = false;

            // compute values
            let computeOps = []
            this.indicators.forEach((indicator) => {
                for (let type in indicator)
                {
                    newCandles.forEach((candle) => {
                        computeOps.push(indicator[type].instance.addCandle(candle))
                    })
                }
            })
            Promise.all(computeOps).then(() => {
                let values = this.getAllValues()
                resolve(values)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public allIndicatorValuesReady(values: number[]) {
        for (let i = 0; i < values.length; i++)
        {
            if (values[i] === -1)
                return false;
        }
        return true; // return true if we don't use any indicators
    }

    public getIndicators() {
        return this.indicators;
    }

    public getIndicaterValueCount() {
        let count = 0;
        this.indicators.forEach((indicator) => {
            for (let type in indicator)
                count += indicator[type].instance.getAllValueCount()
        })
        return count;
    }

    public getMinValue() {
        return this.minValue;
    }

    public getMaxValue() {
        return this.maxValue;
    }

    public updateMinMax(min: number, max: number) {
        if (this.minValue > min)
            this.minValue = min;
        if (this.maxValue > max)
            this.maxValue = max;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected getAllValues() {
        let values: number[] = []
        this.indicators.forEach((indicator) => {
            for (let type in indicator)
            {
                let indicatorValues = indicator[type].instance.getAllValues();
                for (let prop in indicatorValues)
                {
                    let value = indicatorValues[prop];
                    if (value === undefined || value === false || value === Number.NEGATIVE_INFINITY || value === Number.POSITIVE_INFINITY)
                        value = -1; // easier to handle in later checks
                    if (this.minValue > value && value !== -1) // check for ready
                        this.minValue = value;
                    if (this.maxValue < value) // TODO also warn if it changes during live mode? see BudFox for price changes
                        this.maxValue = value;
                    values.push(value)
                }
            }
        })
        return values;
    }

    protected loadIndicators() {
        this.indicators.forEach((indicator) => {
            for (let type in indicator)
            {
                // should be 1 name/type and 1 config
                const modulePath = path.join(__dirname, "..", "Indicators", type);
                let instance = this.loadModule(modulePath, indicator[type]);
                indicator[type].instance = instance;
            }
        })
    }

    protected loadModule(modulePath: string, options = undefined) {
        try {
            let ModuleClass = require(modulePath)
            if (ModuleClass.default)
                ModuleClass = ModuleClass.default; // fix for typescript default exports
            let instance = new ModuleClass(options)
            return instance
        }
        catch (e) { // e.code === 'MODULE_NOT_FOUND'
            logger.error('failed to load module in %s: %s', this.className, modulePath, e)
            return null
        }
    }
}