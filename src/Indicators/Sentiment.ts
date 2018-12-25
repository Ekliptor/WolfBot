import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, MomentumIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

class TradeRatioBucket {
    public readonly candle: number;
    public longAmount = 0.0;
    public shortAmount = 0.0;

    constructor(candle: number) {
        this.candle = candle;
    }

    public addBuy(trade: Trade.Trade) {
        this.longAmount += trade.amount;
        this.shortAmount -= trade.amount; // assume close short
        if (this.shortAmount < 0.0)
            this.shortAmount = 0.0;
    }

    public addSell(trade: Trade.Trade) {
        this.shortAmount += trade.amount;
        this.longAmount -= trade.amount; // assume close long
        if (this.longAmount < 0.0)
            this.longAmount = 0.0;
    }

    public static unserialize(bucket: any): TradeRatioBucket {
        return Object.assign(new TradeRatioBucket(bucket.candle), bucket);
    }
}

/**
 * Sentiment indicator to check if the market is short or long.
 * This simply counts market buy vs market sell trades. Also known as cumulative volume delta.
 * This is not margin funding 'sentiment' or opinion mining of social media 'sentiment'.
 */
export default class Sentiment extends AbstractIndicator {
    protected params: MomentumIndicatorParams;
    protected candleCount = 0;
    protected buckets: TradeRatioBucket[] = [];
    protected currentBucket: TradeRatioBucket = null;
    protected canAddNewBucket = true;

    constructor(params: MomentumIndicatorParams) {
        super(params)
        this.addRatioBucket(); // start with a bucket even before we have a candle
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            if (this.canAddNewBucket === true) {
                this.candleCount++;
                this.addRatioBucket();
            }
            this.canAddNewBucket = true; // on the next call we can add a new bucket unless removeLatestCandle() has been called again before
            resolve()
        })
    }

    public removeLatestCandle() {
        this.canAddNewBucket = false;
    }

    public addTrades(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            // TODO better way to differentiate between "buy" and "close short"?
            // TODO volume of closed/executed trades (sentiment are open positions)
            trades.forEach((trade) => {
                if (trade.type === Trade.TradeType.BUY)
                    this.currentBucket.addBuy(trade);
                else if (trade.type === Trade.TradeType.SELL)
                    this.currentBucket.addSell(trade);
                else
                    logger.error("Unknown trade type %s in %s", trade.type, this.className)
            })
            resolve()
        })
    }

    public getLongAmount() {
        //return this.longAmount;
        let total = 0.0;
        for (let i = 0; i < this.buckets.length; i++)
            total += this.buckets[i].longAmount;
        return total;
    }

    public getShortAmount() {
        let total = 0.0;
        for (let i = 0; i < this.buckets.length; i++)
            total += this.buckets[i].shortAmount;
        return total;
    }

    public getLongShortPercentage() {
        const longAmount = this.getLongAmount();
        const shortAmount = this.getShortAmount();
        if (longAmount === 0 || shortAmount === 0)
            return -1;
        return longAmount / (longAmount + shortAmount) * 100.0;
    }

    public getAllValues() {
        return {
            longAmount: this.getLongAmount(),
            shortAmount: this.getShortAmount(),
            longShortPerc: this.getLongShortPercentage()
        }
    }

    public isReady() {
        return this.candleCount >= this.params.interval;
    }

    public serialize() {
        let state = super.serialize();
        //state.longAmount = this.longAmount;
        state.candleCount = this.candleCount;
        state.buckets = this.buckets;
        state.currentBucket = this.currentBucket;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        if (!state.currentBucket) // update from old version
            return;
        this.candleCount = state.candleCount;
        this.buckets = state.buckets.map(b => TradeRatioBucket.unserialize(b));
        this.currentBucket = TradeRatioBucket.unserialize(state.currentBucket);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected addRatioBucket() {
        this.currentBucket = new TradeRatioBucket(this.candleCount);
        this.buckets.push(this.currentBucket);
        if (this.buckets.length > this.params.interval)
            this.buckets.shift();
    }

}

export {Sentiment}