import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as db from "../database";
import * as EventEmitter from 'events';
import {AbstractExchange, ExchangeMap} from "../Exchanges/AbstractExchange";
import {Currency, Trade, TradeHistory, Candle, Order} from "@ekliptor/bit-models";
import {Brain, PredictionCurrencyData} from "./Brain";
import {BrainConfig} from "./BrainConfig";
import {BudFox, CombinedCurrencyData} from "./BudFox";
import {IndicatorAdderMap, CombinedCurrencyValue, IndicatorAdder} from "./IndicatorAdder";


/**
 * A class that listens to BudFox's live data stream and asks the Brain for price predictions.
 * @events: predictions
 */
export class LiveOracle extends EventEmitter {
    protected brain: Brain;
    protected budFox: BudFox;
    protected marketData: CombinedCurrencyData[] = [];
    protected marketIndicatorValues: CombinedCurrencyValue[] = [];
    protected marketDataCount: number = 0;
    protected predictions: PredictionCurrencyData[] = [];
    protected realData: PredictionCurrencyData[] = []; // 1 tick behind predictions. the value at index 0 is the predicted value at index 1
    protected current: PredictionCurrencyData = {};
    protected indicatorAdder = new IndicatorAdderMap();
    protected computeQueue = Promise.resolve();

    constructor(brain: Brain) {
        super()
        this.brain = brain;
        this.budFox = this.brain.getBudFox();
        this.brain.getConfig().markets.forEach((currencyPair) => {
            let adder = new IndicatorAdder(this.brain.getConfig());
            adder.updateMinMax(this.budFox.getMinPrice(), this.budFox.getMaxPrice())
            this.indicatorAdder.set(currencyPair.toString(), adder)
        })
        this.watchMarkets();
    }

    public getPredictions() {
        return this.predictions;
    }

    public getRealData() {
        return this.realData;
    }

    public getCurrent() {
        return this.current;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected watchMarkets() {
        this.budFox.on("data", (data: CombinedCurrencyData) => {
            // 1 candle for every currency pair is ready
            this.computeQueue = this.computeQueue.then(() => {
                return this.addData(data)
            }).then(() => {
            })
        })
    }

    protected async addData(data: CombinedCurrencyData) {
        let values = await this.addIndicators(data);
        this.marketData.push(data);
        this.marketIndicatorValues.push(values);
        const requiredLen = this.brain.getConfig().pricePoints - 1; // the last point is output
        if (this.marketData.length < requiredLen)
            return logger.verbose("Not yet enough data for price prediction, available: %s/%s", this.marketData.length, requiredLen)

        let current = this.getPredictionData();
        if (!nconf.get("serverConfig:consecutiveLearningSteps")) {
            this.marketData = []
            this.marketIndicatorValues = [];
        }
        else {
            this.marketData.shift();
            this.marketIndicatorValues.shift();
        }

        this.brain.predictForCurrencies(current, true).then((next) => {
            if (this.predictions.length !== 0) {
                //this.realData.push(current[current.length-1])
                this.realData.push(current[this.marketDataCount-1])
            }
            this.predictions.push(next)
            this.current = current[this.marketDataCount-1];
            this.cleanHistory();
            this.emitPredictions();
        }).catch((err) => {
            logger.error("Error predicting markets", err)
        })
    }

    protected async addIndicators(data: CombinedCurrencyData) {
        let combinedIndicatorValues: CombinedCurrencyValue = {}
        for (let pairStr in data)
        {
            // add the indicators for every currency pairs
            let candle = data[pairStr];
            let indicatorValues: number[];
            try {
                indicatorValues = await this.indicatorAdder.get(pairStr).addIndicatorData([candle])
                combinedIndicatorValues[pairStr] = indicatorValues;
            }
            catch (err) {
                return logger.error("Error computing indicator data", err)
            }
        }
        return combinedIndicatorValues;
    }

    protected getPredictionData() {
        // get the prediction number[] for the current market state
        let predictionData: PredictionCurrencyData[] = [];
        this.marketDataCount = 0;
        this.marketData.forEach((data) => { // loop through market history
            let curPrediction: PredictionCurrencyData = {}
            for (let currency in data)
            {
                curPrediction[currency] = this.budFox.getCandleNetworkData([data[currency]], false)[0]; // add 1 candle, get 1 number back
            }
            predictionData.push(curPrediction)
            this.marketDataCount++;
        })

        // we only added indicators once after every series of price points
        // TODO add them after every point? but that would give indicators too much weight in relation to price points
        //let firstInd = this.marketIndicatorValues[0]; // should have the same length as marketData
        let firstInd = this.brain.getConfig().indicatorCount !== 0 ? Object.assign({}, this.marketIndicatorValues[this.marketIndicatorValues.length-1]) : {}; // the latest one
        let hasMoreData = true;
        while (Object.keys(firstInd).length !== 0 && hasMoreData) { // add possible indicator values to the network input
            let curPrediction: PredictionCurrencyData = {}
            for (let currency in firstInd)
            {
                let nextValue = firstInd[currency].shift(); // the next indicator value for every currency
                if (nextValue !== undefined)
                    curPrediction[currency] = nextValue; // normalization is done in predict()
                else
                    logger.error("Error iterating through indicator values of %s", currency)
                hasMoreData = firstInd[currency].length !== 0;
            }
            if (Object.keys(curPrediction).length === this.brain.getConfig().markets.length)
                predictionData.push(curPrediction)
        }
        return predictionData;
    }

    protected emitPredictions() {
        logger.verbose("Emitting new price predictions. %s predictions in history", this.predictions.length)
        this.emit("predictions", {
            predictions: this.predictions,
            realData: this.realData
        })
    }

    protected cleanHistory() {
        while (this.predictions.length > nconf.get("serverConfig:keepPredictionHistory") + 1)
            this.predictions.shift();
        while (this.realData.length > nconf.get("serverConfig:keepPredictionHistory"))
            this.realData.shift();
    }
}