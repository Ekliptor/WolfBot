import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, OrderbookHeatIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import * as _ from "lodash";


/**
 * Represents historical bids + asks within a price range
 */
export class OrderbookSnapshot {
    public priceLow: number; // inclusive
    public priceHigh: number; // exclusive
    public start: Date;
    public interval: number; // in minutes, just like for candles
    public asks: number = 0.0;
    public bids: number = 0.0;
    public total: number = 0.0;

    protected sampleCount = 1; // how many samples we took
    protected finalized = true; // set to true after diving asks/bids by sample count

    constructor(start: Date, interval: number, priceLow: number, priceHigh: number) {
        this.start = start;
        this.interval = interval;
        this.priceLow = priceLow;
        this.priceHigh = priceHigh;
    }
    public static unserialize(snapshots: any[]) {
        let snapshotObjects: OrderbookSnapshot[] = [];
        for (let i = 0; i < snapshots.length; i++)
        {
            let curSnapshot = new OrderbookSnapshot(snapshots[i].start, snapshots[i].interval, snapshots[i].priceLow, snapshots[i].priceHigh);
            curSnapshot = Object.assign(curSnapshot, snapshots[i]);
            snapshotObjects.push(curSnapshot);
        }
        return snapshotObjects;
    }

    public isPriceWithinRange(price: number) {
        return this.priceLow <= price && this.priceHigh > price;
    }
    public isBelowPrice(price: number) {
        return this.priceHigh < price; // or use low?
    }
    public isAbovePrice(price: number) {
        return this.priceLow > price; // or use high?
    }
    public getMeanPrice() {
        return (this.priceLow + this.priceHigh) / 2.0;
    }

    /**
     * Get the percentage of this volume bar relative to totalVolume.
     * @param totalVolume
     */
    public getVolumePercentage(totalVolume: number) {
        if (totalVolume < 0.0)
            return 0.0;
        return this.total / totalVolume * 100;
    }

    public toString() {
        return utils.sprintf("low %s, high %s, vol %s (asks %s, bids %s)",
            this.priceLow.toFixed(8), this.priceHigh.toFixed(8), this.total.toFixed(8),
            this.asks.toFixed(8), this.bids.toFixed(8));
    }

    public add(snapshot: OrderbookSnapshot) {
        // start is different (1 sample every minute), keep the original
        if (this.interval !== snapshot.interval) {
            logger.error("Can not combine orderbook heat snapshots with different time intervals %s and %s", this.interval, snapshot.interval);
            return;
        }
        this.finalized = false;
        this.sampleCount++;
        this.priceLow = Math.min(this.priceLow, snapshot.priceLow); // min/max shouldn't change
        this.priceHigh = Math.max(this.priceHigh, snapshot.priceHigh);
        this.asks += snapshot.asks;
        this.bids += snapshot.bids;
        this.total += snapshot.total;
    }

    public finalize() {
        this.finalized = true;
        this.asks /= this.sampleCount; // take averages
        this.bids /= this.sampleCount;
        this.total /= this.sampleCount;
    }
}

/**
 * Represents all bids and asks at a given time.
 */
export class OrderbookFullSnapshot {
    public rangeSnapshots: OrderbookSnapshot[] = [];
    constructor() {
    }

    public getAverageSnapshot() {

    }

    public static unserialize(snapshots: any[]) {
        let snapshotObjects: OrderbookFullSnapshot[] = [];
        for (let i = 0; i < snapshots.length; i++)
        {
            let cur: OrderbookFullSnapshot = Object.assign(new OrderbookFullSnapshot(), snapshots[i]);
            cur.rangeSnapshots = OrderbookSnapshot.unserialize(cur.rangeSnapshots);
            snapshotObjects.push(cur);
        }
        return snapshotObjects;
    }
}

class OrderbookPriceMap extends Map<number, OrderbookSnapshot> { // (price low, book)
    constructor() {
        super()
    }
    public add(snapshot: OrderbookSnapshot) {
        let existing = this.get(snapshot.priceLow);
        if (existing === undefined) {
            existing = snapshot;
            this.set(existing.priceLow, existing);
        }
        else
            existing.add(snapshot);
    }
    public finalize() {
        for (let book of this)
            book[1].finalize();
    }
    public getSortedObject(): any {
        return utils.objects.sortByKey(this, (a: string, b: string) => {
            return parseFloat(a) - parseFloat(b); // keys are always treated as strings
        });
    }
}

/**
 * Indicator taking historical snapshots of orderbook bids and asks on every candle for every price level.
 * Keeps up to 'interval' candles in history.
 * This is similar to volume profile. The difference is that volume profile shows trades that took place per price level,
 * while this indicator shows the historical depth of the order book.
 */
export default class OrderbookHeatmap extends AbstractIndicator {
    protected params: OrderbookHeatIndicatorParams;
    protected previousCandle: Candle.Candle = null;
    protected lastSnapshot = new Date(0);
    protected minuteSnapshots: OrderbookFullSnapshot[] = [];
    protected candleSnapshots: OrderbookFullSnapshot[] = [];

    constructor(params: OrderbookHeatIndicatorParams) {
        super(params)
        this.params = Object.assign(new OrderbookHeatIndicatorParams(), this.params);
        if (nconf.get("trader") === "Backtester")
            throw new Error(utils.sprintf("%s is not available during backtesting because the order book is only available during live trading.", this.className))
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            if (!this.orderBook)
                return resolve(); // shouldn't happen
            if (this.previousCandle && this.previousCandle.start.getTime() === candle.start.getTime())
                return;
            this.previousCandle = candle;
            this.computeCandleOrderbookHeat();
        })
    }

    public addTrades(trades: Trade.Trade[]): Promise<void> {
        this.takeOrderbookSnapshot();
        return super.addTrades(trades);
    }

    public removeLatestCandle() {
        // we only add on new candles
    }

    /**
     * Gets all orderbook ranges (including bids + asks) in ascending order by price.
     */
    public getRanges(): OrderbookSnapshot[] {
        if (this.candleSnapshots.length === 0)
            return [];
        return this.candleSnapshots[this.candleSnapshots.length-1].rangeSnapshots;
    }

    public getAllValues() {
        const ranges = this.getRanges();
        const askVolume = _.sum(ranges.map(r => r.asks));
        const bidVolume = _.sum(ranges.map(r => r.bids));
        const totalVolume = _.sum(ranges.map(r => r.total));
        return {
            rangesCount: ranges.length,
            totalVolume: totalVolume,
            askVolume: askVolume,
            bidVolume: bidVolume
        }
    }

    public isReady() {
        return this.candleSnapshots.length >= this.params.interval;
    }

    public serialize() {
        let state = super.serialize();
        state.previousCandle = this.previousCandle;
        state.lastSnapshot = this.lastSnapshot;
        state.minuteSnapshots = this.minuteSnapshots;
        state.candleSnapshots = this.candleSnapshots;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.previousCandle = Candle.Candle.copy([state.previousCandle])[0];
        this.lastSnapshot = state.lastSnapshot;
        this.minuteSnapshots = OrderbookFullSnapshot.unserialize(state.minuteSnapshots);
        this.candleSnapshots = OrderbookFullSnapshot.unserialize(state.candleSnapshots);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected takeOrderbookSnapshot() {
        if (this.lastSnapshot.getTime() + 1*utils.constants.MINUTE_IN_SECONDS*1000 > Date.now())
            return;
        this.lastSnapshot = new Date();
        if (!this.orderBook || this.orderBook.getAskAmount() === 0.0/* || this.orderBook.getLast() === -1*/ || this.avgMarketPrice === -1) {
            this.warn(utils.sprintf("Orderbook not yet ready, retrying next minute. book %s, rate %s, asks %s", (this.orderBook ? "yes" : "no"),
                this.avgMarketPrice.toFixed(8), this.orderBook.getAskAmount().toFixed(2)));
            return;
        }
        const precision = utils.calc.getNumberPrecision(this.params.priceStepBucket);
        const shift = Math.pow(10, precision);
        //let askRate = Math.floor(this.orderBook.getLast() * shift) / shift;
        let askRate = Math.floor(this.avgMarketPrice * shift) / shift;
        let bidRate = askRate;
        let snapshots = new OrderbookFullSnapshot();
        while (true)
        {
            //let askRateUpper = askRate + askRate/100.0*this.params.pricePercentBucket; // use absolute values so we can easier merge the 1min buckets
            let askRateUpper = Math.floor((askRate + this.params.priceStepBucket) * shift) / shift; // floor required again because of strange floating point arithmetic
            let bidRateLower = Math.floor((bidRate - this.params.priceStepBucket) * shift) / shift;
            if (bidRateLower < 0.0)
                bidRateLower = 0.0;
            const asks = this.orderBook.getAskAmount(askRate, askRateUpper);
            const bids = this.orderBook.getBidAmount(bidRate, bidRateLower);
            let snapshot = new OrderbookSnapshot(new Date(), 1, bidRateLower, askRateUpper);
            snapshot.bids = bids;
            snapshot.asks = asks;
            snapshot.total = bids + asks;
            if (snapshot.total !== 0)
                snapshots.rangeSnapshots.push(snapshot);
            if (/*snapshot.total === 0 || */bidRateLower === 0.0) // there might be levels in between with 0 bids + asks // TODO better go through book from 0 to max?
                break;
            askRate = askRateUpper;
            bidRate = bidRateLower;
        }
        //console.log("1min", snapshots)
        this.minuteSnapshots.push(snapshots);
    }

    protected computeCandleOrderbookHeat() {
        if (this.minuteSnapshots.length === 0 || !this.previousCandle)
            return;
        // use the average of 1min candles for the full candle interval
        // to get a more accurate picture of how the order book looked during that timeframe
        let mergeMap = new OrderbookPriceMap();
        for (let i = 0; i < this.minuteSnapshots.length; i++)
        {
            for (let u = 0; u < this.minuteSnapshots[i].rangeSnapshots.length; u++)
                mergeMap.add(this.minuteSnapshots[i].rangeSnapshots[u]);
        }
        mergeMap.finalize();
        const sortedMap = mergeMap.getSortedObject();
        let fullCandleSnapshot = new OrderbookFullSnapshot();
        for (let priceLow in sortedMap)
        {
            let rangeSnapshot: OrderbookSnapshot = sortedMap[priceLow];
            rangeSnapshot.start = this.previousCandle.start;
            rangeSnapshot.interval = this.previousCandle.interval;
            fullCandleSnapshot.rangeSnapshots.push(rangeSnapshot);
        }
        this.minuteSnapshots = [];
        this.candleSnapshots.push(fullCandleSnapshot);
        if (this.candleSnapshots.length > this.params.interval)
            this.candleSnapshots.shift();
        //console.log("FULL", fullCandleSnapshot)
    }
}

export {OrderbookHeatmap}