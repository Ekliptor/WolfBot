import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {controller as Controller} from '../src/Controller';
import {Currency} from "@ekliptor/bit-models";
//import * as talib from "talib"; // not recognized as a module
const talib = require("talib");
import {TaLib, TaLibParams, TaLibResult} from "../src/Indicators/TaLib";
import * as fs from "fs";
import * as path from "path";
import * as TwitterApi from "twitter";

const marketContents = fs.readFileSync(path.join(utils.appDir, 'tests', 'marketdata.json'), 'utf8');


let testTaLib = () => {
    // currently we use ta-lib 1.0.2 because 1.0.3 always returns null on debian

    // alternatives https://github.com/anandanand84/technicalindicators
    // https://github.com/rubenafo/trendyways
    // https://github.com/Trendz/candlestick

    console.log("TALib Version: " + talib.version);
    // Display all available indicator function names
    let functions = talib.functions;
    for (let i in functions) {
        console.log(functions[i].name);
    }

    // Retreive Average Directional Movement Index indicator specifications
    let function_desc = talib.explain("WMA");
    console.dir(function_desc);


    // market data as arrays
    let marketData = TaLib.getMockMarketData()

    // execute Average Directional Movement Index indicator with time period 9
    talib.execute({
        name: "WMA",
        startIdx: 0,
        endIdx: marketData.close.length - 1,
        inReal: marketData.close,
        optInTimePeriod: 9,
        optInFastK_Period: 5,
        /*
        name: "SMA",
        startIdx: 0,
        endIdx: marketData.close.length - 1,
        optInAcceleration: 0.02,
        optInMaximum: 0.2,
        */
        open: marketData.open,
        high: marketData.high,
        low: marketData.low,
        close: marketData.close,
        volume: marketData.volume
    }, (err, result) => {
        // check result.error
        if (err || !result || result.error)
            return console.error(result)
        console.log("Function Results:");
        console.log(result);
    });

}

let testSma = () => {
    // Load market data
    var marketData = JSON.parse(marketContents);

    // execute SMA indicator function with time period 180
    talib.execute({
        //name: "SMA",
        name: "SAR",
        startIdx: 0,
        endIdx: marketData.close.length - 1,
        /*
        inReal: marketData.close,
        optInTimePeriod: 20,
        optInNbDevUp: 2,
        optInNbDevDn: 2,
        optInMAType: 0 // SMA
        */
        /*
        high: marketData.high,
        low: marketData.low,
        close: marketData.close, // ADX -> outReal > 150 candles
         optInTimePeriod: 14
         */

        // SAR -> outReal
        high: marketData.high,
        low: marketData.low,
        optInAcceleration: 0.02,
        optInMaximum: 0.2

        /*
        inReal: marketData.close,
        optInFastPeriod: 12,
        optInSlowPeriod: 26,
        optInSignalPeriod: 9
        */
    }, (err, result) => {

        // Show the result array
        console.log("Function Results:");
        //console.log(result);
    });
}

Controller.loadServerConfig(() => {
    testTaLib()
    //testSma()
})
