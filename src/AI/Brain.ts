import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import * as async from "async";
import * as db from "../database";
import {AbstractExchange, ExchangeMap} from "../Exchanges/AbstractExchange";
import {default as HistoryDataExchange, HistoryExchangeMap, HistoryDataExchangeOptions} from "../Exchanges/HistoryDataExchange";
import {Architect, Layer, Network, Neuron, Trainer} from "synaptic";
import {Currency, Trade, TradeHistory, Candle, Order} from "@ekliptor/bit-models";
import {BrainConfig} from "./BrainConfig";
import {BudFox, CombinedCurrencyData} from "./BudFox";
import ExchangeController from '../ExchangeController';
import {LiveOracle} from "./LiveOracle";
import {ModelManager} from "./ModelManager";
import {IndicatorAdder} from "./IndicatorAdder";

export class TrainingSetMap extends Map<string, Trainer.TrainingSet> { // (currency pair, training set)
    constructor() {
        super()
    }
}
export interface PredictionCurrencyData {
    [pair: string]: number; // currency pair -> price/rate
}

// better use TensorFlow?
// alternative to synaptic: https://github.com/wagenaartje/neataptic
// TODO in live mode we can feed the neural network more input data such as the orderbook and ticker (of all markets since they often move together)
// TODO improve accuracy if we split market data into 2 groups: low and high volatility, then train 2 different network for each group?
// TODO learn from user input buy/sell signals on historical data? but will probably learn the wrong/not repeatable features?

// TODO try genetic algorithms for evolving neural networks: https://en.wikipedia.org/wiki/Neuroevolution_of_augmenting_topologies
// TODO genetic algorithm framework (basically a neural network doing parameter optimization, similar to our Backfind class): https://github.com/mkmarek/forex.analytics
// see Evolution class

export class Brain {
    public static readonly TEMP_DATA_DIR = "ai-train";

    protected configFilename: string;
    protected exchanges: ExchangeMap;
    protected errorState = false;
    protected config: BrainConfig;
    protected indicatorAdder: IndicatorAdder;
    //protected exchangeConntroller: ExchangeController;
    protected budFox: BudFox = null;
    protected liveOracle: LiveOracle = null;
    protected modelManager: ModelManager = null;
    protected static trainingInstance = false;

    protected network: Network = null;

    constructor(configFilename: string, exchanges: ExchangeMap) {
        this.configFilename = configFilename;
        if (this.configFilename.substr(-5) !== ".json")
            this.configFilename += ".json";
        this.exchanges = exchanges;
        this.loadConfig();
        this.budFox = new BudFox(this.config, this.exchanges);
        this.modelManager = new ModelManager(this.config, this.budFox);
        if (!Brain.trainingInstance) {
            this.modelManager.loadModel().then((network) => {
                this.network = network;
            }).catch((err) => {
                logger.error("Error loading Brain model", err)
            })
            this.liveOracle = new LiveOracle(this);
        }

        if (Array.prototype.mathMax) {
            logger.warn("Removing Array.prototype extensions from apputils because they are incompatible with synaptic")
            // TODO wait until they change their for ... in loops on their arrays. PR already submitted: https://www.bountysource.com/issues/43453704-from-connected-is-not-a-function
            delete Array.prototype.mathMax;
            delete Array.prototype.mathMin;
            delete Array.prototype.arrayDiff;
            delete Array.prototype.shuffle;
        }
    }

    public static firstStart(trainingInstance: boolean) {
        Brain.trainingInstance = trainingInstance;
        if (trainingInstance === true)
            nconf.set("trader", "Backtester") // needed for ExchangeController to load history data
    }

    public getConfig() {
        return this.config;
    }

    public getBudFox() {
        return this.budFox;
    }

    public getLiveOracle() {
        return this.liveOracle;
    }

    public train() {
        return new Promise<void>((resolve, reject) => {
            this.trainNetwork().then(() => {
                logger.info("Training has finished")
                resolve()
            }).catch((err) => {
                logger.error("Error training neural network", err);
            })
        })
    }

    /**
     * Predict the next prices based on current prices. The order of currencies for the prices has to be the same as in "markets"
     * of config file during training.
     * @param prices as a flat (1 dimensional) numeric array. If multiple history points of the same asset are used, make sure to pass them in the same orde
     *          as during training.
     * @param normalize normalize the prices
     * @returns {Promise<number[]>} returns the predicted prices for each currency
     */
    public predict(prices: number[], normalize = true) {
        return new Promise<number[]>((resolve, reject) => {
            const requiredLen = this.getNumInputs();
            if (prices.length !== requiredLen || prices.length !== this.network.inputs())
                return reject({txt: "Invalid number of price points in predict() function", provided: prices.length, required: requiredLen, network: this.network.inputs()})
            if (normalize)
                prices = prices.map(p => this.budFox.normalizePrice(p))
            let output = this.network.activate(prices)
            if (output.length !== this.config.markets.length)
                return reject({txt: "Invalid number of output prices. Most likely a different network was used for training.", provided: output.length, required: this.config.markets.length})
            if (normalize) // undo the normalization to get the real prices
                output = output.map(p => this.budFox.getRealPrice(p))
            resolve(output)
        })
    }

    /**
     * Predict the next prices with a map-like object instead of a numeric array. See predict() for details.
     * @param pricesInArr
     * @param normalize
     * @returns {Promise<PredictionCurrencyData>}
     */
    public predictForCurrencies(pricesInArr: PredictionCurrencyData[], normalize = true) {
        return new Promise<PredictionCurrencyData>((resolve, reject) => {
            let priceMap = new Map<string, number[]>(); // (currency pair, prices)
            let priceArr = []
            pricesInArr.forEach((prices) => {
                // prices are being concatenated like this (see mergeCurrencyTrainingSets() ):
                // [LTC price1, LTC price2, ETH price1, ETH price2, ...]
                for (let i = 0; i < this.config.markets.length; i++)
                {
                    const pairStr = this.config.markets[i].toString();
                    if (prices[pairStr] === undefined)
                        return reject({txt: "Missing currency pair price to predict next value", missing: pairStr})
                    //priceArr.push(prices[pairStr])
                    let arr = priceMap.get(pairStr);
                    if (!arr)
                        arr = [];
                    arr.push(prices[pairStr])
                    priceMap.set(pairStr, arr)
                }
            })
            for (let arr of priceMap)
                priceArr = priceArr.concat(arr[1])
            this.predict(priceArr, normalize).then((prediction) => {
                let predictionPrices: PredictionCurrencyData = {}
                for (let i = 0; i < this.config.markets.length; i++)
                {
                    const pairStr = this.config.markets[i].toString();
                    predictionPrices[pairStr] = prediction[i];
                }
                resolve(predictionPrices)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getNumInputs() {
        let inputPoints = this.config.pricePoints-1; // the last point is output
        //return inputPoints * this.config.markets.length + inputPoints * this.config.indicatorCount; // add an indicator value to every price point
        //return inputPoints * this.config.markets.length + inputPoints * this.indicatorAdder.getIndicaterValueCount()
        // only 1 indicator per series of price points. otherwise indicators get too much weight
        return inputPoints * this.config.markets.length + this.config.markets.length * this.indicatorAdder.getIndicaterValueCount()
    }

    public getNumOutputs() {
        return this.config.markets.length;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected trainNetwork() {
        return new Promise<void>((resolve, reject) => { // synaptic v2 will be async on nodejs too
            const numInputNeurons = this.getNumInputs();
            const numOutputNeurons = this.getNumOutputs();
            const numHiddenNeurons = Math.ceil(nconf.get("serverConfig:hiddenNeuronFactor")*numInputNeurons) + numOutputNeurons;
            logger.info("Creating %s x %s x %s neural network", numInputNeurons, numHiddenNeurons, numOutputNeurons)
            this.network = new Architect.Perceptron(numInputNeurons, numHiddenNeurons, numOutputNeurons)
            let trainer = new Trainer(this.network)

            /*
            let trainingSet = [
                {
                    input: [0,0],
                    output: [0]
                },
                {
                    input: [0,1],
                    output: [1]
                },
                {
                    input: [1,0],
                    output: [1]
                },
                {
                    input: [1,1],
                    output: [0]
                },
            ]
            */
            this.loadTrainingData().then((trainingSet) => {
                // check for correct input/output count
                if (trainingSet.length === 0)
                    return Promise.reject({txt: "Training set is empty"})
                if (trainingSet[0].input.length !== numInputNeurons)
                    return Promise.reject({txt: "Invalid number of inputs in training set", input: trainingSet[0].input.length, required: numInputNeurons});
                if (trainingSet[0].output.length !== numOutputNeurons)
                    return Promise.reject({txt: "Invalid number of outputs in training set", input: trainingSet[0].output.length, required: numOutputNeurons});
                if (!this.budFox.validateMinMax())
                    return Promise.reject({txt: "Invalid min/max price", min: this.budFox.getMinPrice(), max: this.budFox.getMaxPrice()});

                const stopTraining = Date.now() + 6*utils.constants.HOUR_IN_SECONDS*1000;
                trainer.train(trainingSet, {
                    rate: .01,
                    iterations: 100000,
                    // MSE -> regression, CE -> classification: https://stackoverflow.com/questions/36515202/why-is-the-cross-entropy-method-preferred-over-mean-squared-error-in-what-cases
                    //error: 0.005, // for cross entropy
                    error: 0.000005, // for MSE // done training below this error
                    shuffle: false,
                    //log: 1000, // use console.log ever x iterations
                    cost: Trainer.cost.MSE,
                    schedule: {
                        //every: numInputNeurons, // repeat this task every x iterations
                        every: 2,
                        do: (data) => {
                            logger.verbose("training: error", data.error, "iterations", data.iterations, "rate", data.rate);
                            if (Date.now() > stopTraining)
                                return true; // abort/stop training
                        }
                    }
                });
                //trainer.test() // TODO validation with different data during training & load different data for testing the learned network afterwards
                return this.modelManager.saveModel(this.network)
            }).then(() => {
                resolve()
            }).catch((err) => {
                logger.error("Error training neural network", err)
                setTimeout(() => { // our log is async
                    process.exit(1)
                }, 1000)
            })
            /*
             var inputLayer = new Layer(4);
             var hiddenLayer = new Layer(6);
             var outputLayer = new Layer(2);

             inputLayer.project(hiddenLayer);
             hiddenLayer.project(outputLayer);

             var myNetwork = new Network({
             input: inputLayer,
             hidden: [hiddenLayer],
             output: outputLayer
             });

             myNetwork.activate([1,0,1,0]); // [0.5200553602396137, 0.4792707231811006]
             */
        })
    }

    protected loadTrainingData() {
        return new Promise<Trainer.TrainingSet>((resolve, reject) => {
            let cached = this.loadCachedTrainingData();
            if (cached) {
                logger.verbose("Using cached training data")
                return resolve(cached)
            }
            logger.verbose("No cached training data available for current configuration. Creating new...")
            // use the same date range as for backtesting (thus importing)
            const start = utils.date.parseAsGmt0(nconf.get("serverConfig:backtest:from"))
            const end = utils.date.parseAsGmt0(nconf.get("serverConfig:backtest:to"))
            let ex = this.exchanges.get(this.config.exchanges[0]);
            if ((ex instanceof HistoryDataExchange) === false)
                return reject({txt: "Can not train neural network with live exchange instance", exchange: ex.getClassName()})
            let exchange = ex as HistoryDataExchange;

            this.allRangesAvailable(exchange, start, end).then((available) => {
                if (available === false)
                    return reject({txt: "Can not start training because of missing data"});

                let combinedCandles: CombinedCurrencyData[] = []
                this.budFox.on("data", (data: CombinedCurrencyData) => {
                    // 1 candle for every currency pair is ready. data will be emitted after ALL currencies have been replayed
                    combinedCandles.push(data)
                })

                let trainingSets = new TrainingSetMap();
                let createTrainingSets = () => {
                    logger.info("Creating training sets...")
                    let setOps = []
                    this.config.markets.forEach((currencyPair) => {
                        setOps.push((resolve) => {
                            let indicatorAdder = new IndicatorAdder(this.config)
                            if (this.indicatorAdder)
                                indicatorAdder.updateMinMax(this.indicatorAdder.getMinValue(), this.indicatorAdder.getMaxValue())
                            this.indicatorAdder = indicatorAdder;
                            this.createMarketTrainingSets(trainingSets, combinedCandles, currencyPair).then(() => {
                                resolve()
                            })
                        })
                    })
                    return new Promise((resolve, reject) => {
                        async.series(setOps, (err, result) => {
                            if (err)
                                reject(err)
                            resolve()
                        })
                    })
                }
                let replayCurrencyPair = (i) => {
                    if (i >= this.config.markets.length) {
                        createTrainingSets().then((resultArr) => {
                            let data = this.mergeCurrencyTrainingSets(trainingSets);
                            this.cacheTrainingData(data);
                            resolve(data);
                        })
                        return
                    }

                    exchange.replay(this.config.markets[i], start, end).then(() => {
                        logger.info("%s training set ready", this.config.markets[i])
                        replayCurrencyPair(++i)
                    })
                }
                replayCurrencyPair(0)
            })
        })
    }

    protected async createMarketTrainingSets(trainingSets: TrainingSetMap, combinedCandles: CombinedCurrencyData[], currencyPair: Currency.CurrencyPair) {
        let trainingSet: Trainer.TrainingSet = []
        let candles: Candle.Candle[] = [];
        let count = 0;
        const pairStr = currencyPair.toString();
        for (let i = 0; i < combinedCandles.length; i++)
        {
            let candleData = combinedCandles[i];
            count++;
            await this.createTrainigSet(trainingSet, candleData, candles, count, currencyPair);
        }
        trainingSets.set(pairStr, trainingSet)
    }

    protected async createTrainigSet(trainingSet: Trainer.TrainingSet, candleData: CombinedCurrencyData, candles: Candle.Candle[], count: number, currencyPair: Currency.CurrencyPair) {
        const pairStr = currencyPair.toString();
        if (!candleData[pairStr])
            return logger.error("Training data is missing currency pair %s", pairStr) // or better throw? but then we need another catch

        let candle = candleData[pairStr];
        candles.push(candle)
        //count++;
        let indicatorValues: number[];
        try {
            indicatorValues = await this.indicatorAdder.addIndicatorData(candles)
            //if (!this.indicatorAdder.allIndicatorValuesReady(indicatorValues)) // they will get removed when merging
                //return; // don't add prices for values we don't have all indicator values for
        }
        catch (err) {
            return logger.error("Error computing indicator data", err)
        }
        if (!nconf.get("serverConfig:consecutiveLearningSteps") && count % (this.config.pricePoints+1) === 0) {
            let last = candles.pop();
            trainingSet.push({
                // normalization should be done when merging so we have the final min/max price
                input: this.budFox.getCandleNetworkData(candles).concat(indicatorValues),
                output: this.budFox.getCandleNetworkData([last])
            })
            //candles = [] // changing the reference won't pass it back by reference
            while (candles.length !== 0)
                candles.shift();
        }
        else if (nconf.get("serverConfig:consecutiveLearningSteps") && candles.length >= this.config.pricePoints) {
            // only remove the first when using consecutive learning steps. so we have more (and consecutive) training data
            let consecutiveCandles = Object.assign([], candles.slice(0, candles.length-1));
            let last = candles[candles.length-1];
            trainingSet.push({
                // normalization should be done when merging so we have the final min/max price
                input: this.budFox.getCandleNetworkData(consecutiveCandles).concat(indicatorValues),
                output: this.budFox.getCandleNetworkData([last])
            })
            candles.shift();
        }
        // discard incomplete candle lists during training
    }

    protected loadCachedTrainingData(): Trainer.TrainingSet {
        // creating many months of candles (out of raw trades) for training data can take many minutes
        // so we cache and restore it for faster experiments
        const cachePath = path.join(utils.appDir, nconf.get("tempDir"), Brain.TEMP_DATA_DIR, this.getCachedTrainingDataKey() + ".json")
        if (!fs.existsSync(cachePath))
            return null;
        let data = fs.readFileSync(cachePath, {encoding: "utf8"});
        if (!data)
            throw new Error("Unable to read cached training data");
        let json = utils.parseJson(data);
        if (!json || ! json.points)
            throw new Error("Unable to parse cached training data");

        this.budFox.setMinPrice(json.budFox.minPrice);
        this.budFox.setMaxPrice(json.budFox.maxPrice);
        return json.points;
    }

    protected cacheTrainingData(data: Trainer.TrainingSet) {
        const cachePath = path.join(utils.appDir, nconf.get("tempDir"), Brain.TEMP_DATA_DIR, this.getCachedTrainingDataKey() + ".json")
        this.budFox.validateMinMax();
        const dataJson = JSON.stringify({
            budFox: {
                minPrice: this.budFox.getMinPrice(),
                maxPrice: this.budFox.getMaxPrice()
            },
            points: data
        });
        fs.writeFileSync(cachePath, dataJson, {encoding: "utf8"});
    }

    protected getCachedTrainingDataKey() {
        // serverConfig:backtest:from and to are being added implicitly
        const keyInput = JSON.stringify(this.config) + JSON.stringify(nconf.get("serverConfig"))// + nconf.get("serverConfig:backtest:from") + nconf.get("serverConfig:backtest:to")
        return crypto.createHash('sha512').update(keyInput, 'utf8').digest('hex').substr(0, 16);
    }

    protected mergeCurrencyTrainingSets(sets: TrainingSetMap): Trainer.TrainingSet {
        // we loaded a training set for every currency pair. now merge all input vectors and output vectors together
        // then we train our network on those vectors
        // the goal of the network is to detect global market trends (across all currency pairs)
        let merged: Trainer.TrainingSet = []
        let length = 0;
        for (let set of sets)
        {
            let curSet: Trainer.TrainingSet = set[1];
            logger.verbose("Formatting %s data: %s data sets available", set[0], curSet.length)
            if (length === 0) {
                length = set[1].length; // the first set. we merge on this set
                curSet = set[1];
                merged = curSet;
                continue;
            }
            else if (set[1].length > length) {
                logger.warn("Training set of %s is %s data points long. Using only the first %s entries", set[0], set[1].length, length)
                curSet = set[1].slice(0, length)
                curSet = curSet;
            }
            else if (set[1].length < length) {
                logger.error("Training set of %s is too short. Only %s data points, %s required. Please run an import first.", set[0], set[1].length, length)
                throw new Error("Training set is too short")
            }

            for (let i = 0; i < merged.length; i++)
            {
                let mergedPoint = merged[i];
                let newPoint = curSet[i];
                mergedPoint.input = mergedPoint.input.concat(newPoint.input);
                mergedPoint.output = mergedPoint.output.concat(newPoint.output);
            }
        }

        // skip the first few elements that have "-1" indicator values (indicator not ready)
        let i = 0;
        while (merged[i].input.indexOf(-1) !== -1)
        {
            i++;
            if (i >= merged.length) {
                logger.warn("The whole training data set contains technical indicators that are not (fully) initialized. Please increase the size of your input data period.")
                i = 0;
                break;
            }
        }
        merged = merged.slice(i);
        logger.info("Valid training input begins at position %s with %s elements", i, merged.length)

        // do this at the end so we can be sure the min/max values are final
        if (this.config.indicatorCount !== 0)
            this.budFox.updateMinMax(this.indicatorAdder.getMinValue(), this.indicatorAdder.getMaxValue());
        merged.forEach((mergedPoint) => {
            mergedPoint.input = mergedPoint.input.map(p => this.budFox.normalizePrice(p))
            mergedPoint.output = mergedPoint.output.map(p => this.budFox.normalizePrice(p))
        })
        return merged
    }

    /*
    protected connectExchanges() {
        return new Promise<void>((resolve, reject) => {
            this.exchangeConntroller.process().then(() => {
                resolve()
            }).catch((err) => {
                reject({txt: "Error loading exchanges", err: err})
            })
        })
    }
    */

    protected allRangesAvailable(exchange: AbstractExchange, start: Date, end: Date) {
        return new Promise<boolean>((resolve, reject) => {
            let checks = [];
            this.config.markets.forEach((currencyPair) => {
                checks.push(new Promise<boolean>((resolve, reject) => {
                    // check if we have fully imported that range
                    let history = new TradeHistory.TradeHistory(currencyPair, exchange.getExchangeLabel(), start, end);
                    TradeHistory.isAvailable(db.get(), history).then((available) => {
                        if (available === false) {
                            TradeHistory.getAvailablePeriods(db.get(), history.exchange, history.currencyPair).then((periods) => {
                                logger.error("Trade history to train %s is not available. Please run import first. Available periods:", currencyPair.toString())
                                logger.error(JSON.stringify(periods))
                            })
                            return resolve(false);
                        }
                        resolve(true)
                    })
                }))
            })
            Promise.all(checks).then((results) => {
                for (let i = 0; i < results.length; i++)
                {
                    if (results[i] === false)
                        return resolve(false)
                }
                resolve(true) // all ranges for all currency pairs are imported
            })
        })
    }

    protected loadConfig() {
        const filePath = path.join(utils.appDir, "config", "machine-learning", this.configFilename)
        let data = fs.readFileSync(filePath, {encoding: "utf8"});
        if (!data) {
            logger.error("Can not load config file under: %s", filePath)
            return this.waitForRestart()
        }
        let json = utils.parseJson(data);
        if (!json || !json.data) {
            logger.error("Invalid JSON in config file: %s", filePath)
            return this.waitForRestart()
        }
        if (json.data.length > 1) // TODO increase limit? but takes long time either way and difficult to evaluate otherwise
            logger.error("WARNING: Config has %s entries. Currently AI is only supported with the first entry", json.data.length);
        let configs = []
        json.data.forEach((conf) => {
            let config = new BrainConfig(conf, this.configFilename);
            configs.push(config)
        })
        this.config = configs[0]
        IndicatorAdder.setRawConfigJson(json.data[0]);
        //this.indicatorAdder = new IndicatorAdder(this.config, json.data[0]) // we need 1 instance per currency pair, re-created later
        this.indicatorAdder = new IndicatorAdder(this.config)
    }

    protected waitForRestart() {
        this.errorState = true;
        //process.exit(1) // don't exit or else we can't restart it via http API, AI training will only be done locally (for now)
        logger.error("App entered error state. Please restart the app")
    }
}