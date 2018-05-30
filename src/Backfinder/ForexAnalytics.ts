import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
// add to package.json: "forex.analytics": "git+https://github.com/mkmarek/forex.analytics.git",
import analytics from "forex.analytics";
import * as fs from "fs";

// TODO wait for this pull request: https://github.com/carlos8f/zenbot/pull/299
// then we can add a genetic algorithm that can optimize our custom strategies too
// or use another genetic algorithm framework written in JS

/**
 * Indicators selected for calculation
 * @type {Array}
 */
var indicators = [
    'CCI',
    'MACD',
    'MACD_Signal',
    'MACD_Histogram',
    'Momentum',
    'RSI',
    'BOP',
    'ATR',
    'SAR',
    'SMA15_SMA50',
    'Stochastic'
];

var stopLoss = 0.0030;
var takeProfit = 0.0030;

/**
 * Training csv file worth of 6 month data
 * @type {String}
 */
var trainingFile = './data/DAT_MT_EURUSD_M1_2015.csv';

/**
 * Testing data file worth of 1 month data.
 * The strategy trained on the training data set will be applied
 * to this data set to verify the output strategy
 *
 * @type {String}
 */
var testingFile = './data/DAT_MT_EURUSD_M1_201601.csv';

/**
 * Loads candlestick data from a file and then fires a callback with the data
 * as a parameter
 * @param  {String}   inputFile Path to the csv file
 * @param  {Function} callback  Callback function that is fired after data
 *                              is loaded
 */
function loadCsvData(inputFile, callback) {
    var csvContent = '';

    var stream = fs.createReadStream(inputFile)
        .on('readable', function() {
            var buf = stream.read();

            if (buf) {
                csvContent += buf.toString();
            }
        })
        .on('end', function() {
            var candlesticks = parseCsv(csvContent);
            candlesticks.sort(function(a, b) {
                return a.time - b.time;
            });

            callback(candlesticks);
        });
}

/**
 * Calculates and presents potential revenue of a given strategy for given
 * candlesticks
 */
function calculateTrades(candlesticks, strategy) {
    var trades = getTrades(candlesticks, strategy);

    var totalRevenue = 0;
    var totalNoOfTrades = 0;
    var numberOfProfitTrades = 0;
    var numberOfLossTrades = 0;
    var maximumLoss = 0;

    for (var i = 0; i < trades.length; i++) {

        var revenue;

        if (stopLoss < trades[i].MaximumLoss) {
            revenue = -stopLoss;
        } else if (takeProfit < trades[i].MaximumProfit  && (!trades[i].ProfitBeforeLoss || takeProfit > trades[i].MaximumProfit)) {
            revenue = takeProfit;
        } else {
            revenue = trades[i].Revenue || 0;
        }

        if (revenue > 0) numberOfProfitTrades++;
        else numberOfLossTrades++;

        totalNoOfTrades++;

        totalRevenue += revenue;

        if (maximumLoss < trades[i].MaximumLoss)
            maximumLoss = trades[i].MaximumLoss;
    }

    console.log('Total theoretical revenue is: ' + totalRevenue + ' PIPS');
    console.log('Maximum theoretical loss is: ' + maximumLoss + ' PIPS');
    console.log('Total number of Profitable trades is: ' + numberOfProfitTrades);
    console.log('Total number of loss trades is: ' + numberOfLossTrades);
    console.log('Total number of trades is: ' + totalNoOfTrades);
}

/**
 * Returns an object representing buy/sell strategy
 * @param  {Object} candlesticks Input candlesticks for strategy estimation
 */
function createStrategy(candlesticks, testing30MinuteCandlesticks) {

    var lastFitness = -1;

    return analytics.findStrategy(candlesticks, {
        populationCount: 3000,
        generationCount: 100,
        selectionAmount: 10,
        leafValueMutationProbability: 0.3,
        leafSignMutationProbability: 0.1,
        logicalNodeMutationProbability: 0.05,
        leafIndicatorMutationProbability: 0.2,
        crossoverProbability: 0.03,
        indicators: indicators
    }, function(strategy, fitness, generation) {

        console.log('---------------------------------');
        console.log('Fitness: ' + fitness + '; Generation: ' + generation);

        if (lastFitness == fitness)
            return;

        lastFitness = fitness;

        console.log('-----------Training--------------');
        calculateTrades(candlesticks, strategy);

        console.log('-----------Testing--------------');
        calculateTrades(testing30MinuteCandlesticks, strategy);
    });
}

/**
 * Gets an array of trades using a set of candlesticks and strategy
 * @param  {Object} candlesticks Input candlesticks for trade estimation
 * @param  {Object} strategy     Strategy obtained by the findStrategy function
 */
function getTrades(candlesticks, strategy) {
    return analytics.getTrades(candlesticks, {
        strategy: strategy
    });
}

/**
 * Parses the given csv and returns array of candlesticks
 * @param  {String} text The csv file content
 */
function parseCsv(text) {
    var candlesticks = [];
    var lines = text.split('\n');

    for (var i = 0; i < lines.length; i++) {
        var parts = lines[i].split(',');

        var date = new Date(parts[0] + ' ' + parts[1]);
        var time = (date.getTime()) / 1000;

        if (time) {
            candlesticks.push({
                open: parts[2],
                high: parts[3],
                low: parts[4],
                close: parts[5],
                time: time
            });
        }
    }

    return candlesticks;
}

/**
 * Converts candlesticks from lower timeframe to 30 minute timeframe
 */
function convertTo30MOhlc(candlesticks) {
    var n = analytics.convertOHLC(candlesticks, 1800);
    return n;
}

console.log('Loading training data set');
loadCsvData(testingFile, function(testingCandlesticks) {
    loadCsvData(trainingFile, function(candlesticks) {

        var thirtyMinuteCandlesticks = convertTo30MOhlc(candlesticks);
        var testing30MinuteCandlesticks = convertTo30MOhlc(testingCandlesticks);

        console.log('Calculating strategy')
        createStrategy(thirtyMinuteCandlesticks, testing30MinuteCandlesticks)
            .then(function(strategy) {
                console.log('------------Strategy-------------');
                console.log(JSON.stringify(strategy, null, 4));
                console.log('---------------------------------');

                calculateTrades(testing30MinuteCandlesticks, strategy);
            });
    });
});