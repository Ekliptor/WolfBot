import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

interface SentimentAction extends TechnicalStrategyAction {
    low: number; // If the ratio of market buy vs sell orders is below this threshold this strategy will go short.
    high: number; // If the ratio of market buy vs sell orders is above this threshold this strategy will go long.
    interval: number; // The interval in candles to count market buy vs sell orders.
}

/**
 * Strategy that checks the market sentiment, meaning the volume of buy sv sell orders. It counts all trades and sum up the volume to see if the market majority is long or short.
 * Should be run with a candle size >= 6h or otherwise it will start trading too soon.
 */
export default class Sentiment extends TechnicalStrategy {
    public action: SentimentAction;

    constructor(options) {
        super(options)
        this.addIndicator("Sentiment", "Sentiment", this.action);
        this.addInfoFunction("long", () => {
            return this.getSentiment("Sentiment").getLongAmount();
        });
        this.addInfoFunction("short", () => {
            return this.getSentiment("Sentiment").getShortAmount();
        });
        this.addInfoFunction("longShortPercentage", () => {
            return this.getSentiment("Sentiment").getLongShortPercentage();
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        let sentiment = this.getSentiment("Sentiment")
        const value = sentiment.getLongShortPercentage();
        const valueFormatted = Math.round(value * 100) / 100.0;
        if (value > this.action.high) {
            this.log("UP sentiment detected, value", value)
            this.emitBuy(this.defaultWeight, "MFI value: " + valueFormatted);
        }
        else if (value < this.action.low) {
            this.log("DOWN sentiment detected, value", value)
            this.emitSell(this.defaultWeight, "MFI value: " + valueFormatted);
        }
        else
            this.log("no sentiment detected, value", valueFormatted)
    }
}