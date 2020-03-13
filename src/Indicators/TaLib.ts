import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
const argv = require('minimist')(process.argv.slice(2));
//import * as talib from "talib"; // not recognized as a module
const talib = argv.noTalib === true ? null : require("talib");


export class TaLibParams { // some indicator names have different parameters, see talib.explain(indicatorName)
    name: string; // indicator name
    startIdx: number = 0;
    endIdx: number;
    inReal: number[];
    optInTimePeriod: number; // in candles

    // bollinger bands
    optInNbDevUp?: number;
    optInNbDevDn?: number;
    optInMAType?: number;

    // MACD
    optInFastPeriod?: number;
    optInSlowPeriod?: number;
    optInSignalPeriod?: number;

    // Aroon (and other indicators that take in candle high/low)
    high?: number[];
    low?: number[];

    // Tristar
    open?: number[];
    close?: number[];

    // MSI
    volume?: number[];

    // OBV
    inPriceV?: number[]; // volume

    // STDDEV - Standard Deviation
    optInNbDev?: number;

    // SAR
    optInAcceleration?: number;
    optInMaximum?: number;

    // StochRSI
    optInFastK_Period?: number; // Time period for building the Fast-K line
    optInFastD_Period?: number; // Smoothing for making the Fast-D line
    optInFastD_MAType?: number; // Type of Moving Average for Fast-D

    constructor(name: string, data: number[], timePeriod = 0) {
        // TODO add all candle data here in constructor of all indicators
        // then in calculate() use setting to decide if we use open, high, low or close (or combination)
        // for indicator computation
        // also for non-Talib indicators

        this.name = name;
        this.endIdx = data.length - 1;
        this.inReal = data;
        if (timePeriod === 0)
            return;
        this.optInTimePeriod = Math.ceil(timePeriod); // has to be an integer >= 2
        if (this.optInTimePeriod < 2)
            this.optInTimePeriod = 2;
    }
}
export interface TaLibResult {
    error?: string;
    begIndex: number; // index of the first input (in inReal) for which a valid value could be calculated
    nbElement: number; // number of valid results (length of outReal)
    result: {
        outReal: number[]
    }
}

/**
 * Docs: https://mrjbq7.github.io/ta-lib/func.html
 */
export class TaLib {
    constructor() {
    }

    public calculate(params: TaLibParams) {
        return new Promise<TaLibResult>((resolve, reject) => {
            if (argv.noTalib === true)
                return reject({txt: "TA-LIB is disabled via command line"});
            talib.execute(params, (err, result) => {
                if (err || !result || result.error)
                    return reject({txt: "TA-LIB error", err: result ? result.error : "no result", errNew: err, params: params});

                resolve(result);
            });
        })
    }

    /**
     * Get the latest result from TA-LIB results
     * @param result the TA-LIB result object from calculate()
     * @param resultName the name of the property to return
     * @returns {number} the latest result number or -1 if there are no results
     */
    public static getLatestResultPoint(result: TaLibResult, resultName = "outReal") {
        if (result.nbElement === 0 || result.result[resultName] === undefined)
            return -1;
        let latest = result.result[resultName][result.nbElement-1];
        return latest;
    }

    public static getMockMarketData() {
        let simplePrices = [0.001, 0.002, 0.003, 0.005, 0.003, 0.006, 0.009, 0.011, 0.012, 0.0123, 0.0111];
        return { open: simplePrices, close: simplePrices, high: simplePrices, low: simplePrices, volume: simplePrices };
    }

    public static checkTaLibSupport() {
        return new Promise<boolean>((resolve, reject) => {
            if (argv.noTalib === true) {
                logger.warn("Ta-Lib is disabled via command line. You won't be able to compute technical indicators.")
                return resolve(false)
            }
            let version = talib.version;
            if (!version) {
                logger.error("Unable to get Ta-Lib version. Please check your Ta-Lib and Python 2.7 installation.")
                return resolve(false)
            }
            let marketData = TaLib.getMockMarketData()
            talib.execute({
                name: "RSI",
                startIdx: 0,
                endIdx: marketData.close.length - 1,
                inReal: marketData.close,
                optInTimePeriod: 9
            }, (err, result) => {
                if (err) {
                    logger.error("Ta-Lib test failed with error:", err)
                    return resolve(false)
                }
                // check result.error
                if (!result || result.error || !result.result || !result.result.outReal || !Array.isArray(result.result.outReal) || result.result.outReal.length < 1) {
                    logger.error("Ta-Lib test failed. Result", result)
                    return resolve(false)
                }
                logger.verbose("Ta-Lib successfully loaded. Ta-Lib Version %s ready", version)
                resolve(true)
            });
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}
