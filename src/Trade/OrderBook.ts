import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Trade, Order, MarketOrder, Currency, Candle} from "@ekliptor/bit-models";
import {Comparator, RBTree, BinTree, Iterator, Callback} from "@ekliptor/bintrees-local";
import * as createTree from "functional-red-black-tree";
// TODO change tree implementation: https://github.com/mikolalysenko/functional-red-black-tree
// TODO might be more performant to use 2 arrays for orderbook (bids, ask). see https://github.com/bitfinexcom/bitfinex-api-node/blob/master/lib/models/order_book.js


export interface OrderBookEntry {
    amount: number;
    rate: number;
    marked: boolean; // market to be removed
}
interface DatabaseOrderBookEntry extends OrderBookEntry {
    exchange: Currency.Exchange;
    currencyPair?: Currency.CurrencyPair; // in trading mode
    currency?: Currency.Currency; // in lending mode
}
interface QueuedOrder<T> {
    order: T;
    modificationType: "add" | "remove";
    seqNr: number;
}

export class RBTreeFixed<T> extends BinTree<T> { // RBTree consumes too much CPU for balancing
    constructor(comparator: Comparator<T>) {
        super(comparator)
    }

    public insert(item: T) {
        // workaround for: https://github.com/vadimg/js_bintrees/issues/25
        // caused us many forced kills...
        //if (Array.isArray(item) === true) { // TS doesn't recognize it as an array and can't cast it for forEach()
        if (item instanceof Array) {
            item.forEach((childItem) => {
                if (Array.isArray(childItem) === true)
                    return logger.error("Skipping insert of nested array into RBTree. Please insert items separately. Item:", childItem)
                super.insert(childItem);
            })
            return true;
        }
        super.insert(item);
    }
}

/**
 * A wrapper for function trees to keep our API consistent for both binary tree implementations.
 */
/*
export class RBTreeIterator<T> /*extends Iterator<T>*** {
    protected iterator;
    constructor(/*tree****iterator) {
        this.iterator = iterator;
    }
    // iterator methods
    public data(): T {
        return this.iterator.value;
    }
    public next(): T {
        return this.iterator.next();
    }
    public prev(): T {
        return this.iterator.prev();
    }
}
export class RBTreeFixed<T> {
    protected tree;
    constructor(compareFn?: (a: T, b: T) => number) {
        this.tree = createTree(/*compareFn****) // we just use the numeric rates as key
    }

    // tree base methods
    public get size(): number {
        return this.tree.length;
    }
    public clear(): void {
        this.tree = createTree();
    }
    public find(data: T): T {
        let it = this.tree.find(this.createKey(data));
        if (it)
            return it.value;
        return null;
    }
    public findIter(data: T): Iterator<T> {
        return new RBTreeIterator(this.tree.find(this.createKey(data)));
    }
    public lowerBound(item: T): Iterator<T> {
        return new RBTreeIterator(this.tree.ge(this.createKey(item)));
    }
    public upperBound(item: T): Iterator<T> {
        return new RBTreeIterator(this.tree.gt(this.createKey(item)));
    }
    public min(): T {
        let start = this.tree.begin;
        let last;
        while (start != null)
        {
            last = start;
            start = start.prev();
        }
        return last;
    }
    public max(): T {
        let start = this.tree.begin;
        let last;
        while (start != null)
        {
            last = start;
            start = start.next();
        }
        return last;
    }
    public iterator(): Iterator<T> {
        return null; // TODO return null-iterator
    }
    public each(cb: Callback<T>): void {
        this.tree.forEach((key, value) => {
            cb(value)
        })
    }
    public reach(cb: Callback<T>): void {
        // TODO walk through in reverse order
    }

    // tree methods
    public insert(item: T): boolean {
        this.tree = this.tree.insert(this.createKey(item), item); // TODO causes infinite loop
        return this.tree != null; // always true
    }

    public remove(item: T): boolean {
        this.tree = this.tree.remove(this.createKey(item));
        return this.tree != null; // always true
    }

    protected createKey(item: T) {
        return (item as any).rate; // TODO make this a parameter
    }
}
*/

/**
 * Class implementing a real-time order book copy of an exchange (for 1 currency pair).
 * It uses a binary tree with market rates on each node for efficient lookups.
 *
 * The startup algorithm behind it is: https://docs.gdax.com/#real-time-order-book
 * 1. Send a subscribe message for the product of interest.
 * 2. Queue any messages received over the websocket stream.
 * 3. Make a REST request for the order book snapshot from the REST feed.
 * 4. Playback queued messages, discarding sequence numbers before or equal to the snapshot sequence number.
 * 5. Apply playback messages to the snapshot as needed (see below).
 * 6. After playback is complete, apply real-time stream messages as they arrive.
 */
export class OrderBook<T extends DatabaseOrderBookEntry> { // T is MarketOrder.MarketOrder or Funding.FundingOrder
    protected snapshotReady = false;
    protected initDone = false;
    protected lastUpdate: Date = null;

    // our tree implementation: https://www.npmjs.com/package/bintrees
    // alternative functional (safer for async): https://www.npmjs.com/package/functional-red-black-tree
    // upcoming tree: https://www.npmjs.com/package/binary-type-tree
    protected orders = new RBTreeFixed<T>((a: T, b: T) => {
        return a.rate - b.rate;
    });
    protected orderQueue: QueuedOrder<T>[] = [];
    protected last: number = -1; // the rate of the last trade
    protected seqNr: number = -1;

    constructor() {
    }

    public setSnapshot(orders: T[], seqNr: number, logMsg = true) {
        if (this.snapshotReady === true) {
            logger.error("Multiple order book snapshots received. Initialized seqNr %s, latest seqNr %s - skipping latest", this.getSeqNr(), seqNr)
            return;
        }
        else if (!orders/* || orders.length === 0*/) {
            logger.error("Received invalid order book snapshot with seq nr %s", seqNr)
            return;
        }
        this.initDone = false;
        this.orders.clear(); // should already be empty, but be sure in case we receive multiple snapshots
        orders.forEach((order) => {
            this.orders.insert(order);
        });

        // apply queued order book modifications
        let maxSeqNr = seqNr;
        this.snapshotReady = true;
        this.orderQueue.forEach((modification) => {
            if (modification.seqNr <= seqNr)
                return; // discard messages older than our snapshot
            if (modification.seqNr > maxSeqNr)
                maxSeqNr = modification.seqNr;
            if (modification.modificationType === "add")
                this.addOrder(modification.order, modification.seqNr)
            else if (modification.modificationType === "remove")
                this.removeOrder(modification.order, modification.seqNr)
        })
        this.orderQueue = [];

        this.seqNr = maxSeqNr;
        if (!logMsg)
            return;
        let first = orders.length !== 0 ? orders[0] : null;
        if (first) {
            const currencyStr = first.currencyPair ? first.currencyPair.toString() : Currency.Currency[first.currency];
            logger.info("%s order book snapshot of exchange %s is ready. seqNr %s, orders %s", currencyStr, Currency.Exchange[first.exchange], this.seqNr, this.getOrderCount())
        }
        else
            logger.info("Starting with empty order book snapshot. seqNr %s", this.seqNr) // we don't have an exchange name or currency pair without "first"
    }

    public replaceSnapshot(orders: T[], seqNr: number) {
        this.orders.clear(); // should already be empty, but be sure in case we receive multiple snapshots
        orders.forEach((order) => {
            this.orders.insert(order);
        });
        this.orderQueue = [];
        this.seqNr = seqNr;
        this.lastUpdate = new Date();
    }

    public addOrder(order: T, seqNr: number) {
        if (!order.rate) {
            logger.warn("Can not add invalid order to orderbook", order)
            return;
        }
        /* // TODO add this check. currently exchanges fetch orderbook via REST + Websocket and sometimes order numebrs are inconsistent. seq only used on snapshot
        if (seqNr < this.seqNr) {
            logger.warn("Received order book add with old seqNr. Received %s, current %s - ignoring update", seqNr, this.seqNr)
            return;
        }
        */
        this.seqNr = seqNr;
        this.lastUpdate = new Date();
        if (this.snapshotReady === false) {
            //logger.warn("Received order before orderbook snapshot of exchange %s is ready. Queueing order", Currency.Exchange[order.exchange])
            this.orderQueue.push({order: order, modificationType: "add", seqNr: seqNr});
            return;
        }
        let existing = this.orders.find(order);
        if (existing) { // an order for this rate is already in the book. update the amount
            existing.amount += order.amount;
            existing.marked = false;
        }
        else {
            order.marked = false;
            this.orders.insert(order); // add an order for a new price
        }
    }

    public removeOrder(order: T, seqNr: number) {
        if (!order.rate) {
            logger.warn("Can not remove invalid order from orderbook", order)
            return;
        }
        /*
        if (seqNr < this.seqNr) {
            logger.warn("Received order book add with old seqNr. Received %s, current %s - ignoring update", seqNr, this.seqNr)
            return;
        }
        */
        // TODO if prices move heavily and our snapshot didn't go that deep, it could be that removing orders creates invalid/negative ask amounts?
        this.seqNr = seqNr;
        this.lastUpdate = new Date();
        if (this.snapshotReady === false) {
            //logger.warn("Received order removal before orderbook snapshot of exchange %s is ready. Queueing order", Currency.Exchange[order.exchange])
            this.orderQueue.push({order: order, modificationType: "remove", seqNr: seqNr});
            return;
        }
        let existing = this.orders.find(order);
        if (!existing) {
            // a lot of modifications are outsite of the depth of our snapshot. we should check for the rate if we want to print errors
            // could be a sign that our order book is out of sync if we receive many of those messags
            //logger.warn("Received order book removal for not existing order %s %s: rate %s, amount %s", order.exchange, order.currencyPair.toString(), order.rate, order.amount)
            return;
        }

        /*
        console.log("bid %s, ask %s, last %s", this.getBid(), this.getAsk(), this.getLast())
        console.log("buy orders %s, sell orders %s, buy amount %s (%s BTC), sell amount %s (%s BTC)", this.getBidCount(), this.getAskCount(),
            this.getBidAmount(), this.getBidAmountBase(), this.getAskAmount(), this.getAskAmountBase())
        let amount = 40;
        console.log("sell %s: %s, buy %s: %s", amount, JSON.stringify(this.getAsks(amount)), amount, JSON.stringify(this.getBids(amount)))
        console.log("sell avg %s, buy avg %s", this.getAskAvg(amount), this.getBidAvg(amount))
        */

        existing.amount -= order.amount;
        existing.marked = false; // it's just been updated. don't mark to remove it
        if (existing.amount <= 0)
            this.orders.remove(order);
    }

    public isSnapshotReady() {
        return this.snapshotReady;
    }

    public clear(fullUpdate = false) {
        if (fullUpdate === false) {
            logger.verbose("Resetting order book")
            this.snapshotReady = false;
            this.initDone = false;
        }
        this.orders.clear();
        this.orderQueue = [];
        if (fullUpdate === false) {
            this.last = -1;
            this.seqNr = -1;
        }
    }

    public setLast(last: number) {
        this.last = last;
    }

    public getLast() {
        return this.last;
    }

    public getSeqNr() {
        return this.seqNr;
    }

    /**
     * Returns the highest price somebody wants to buy.
     * @returns {number}
     */
    public getBid() {
        let it = this.orders.lowerBound(this.getMarketOrder()) // >= rate, go down
        let order = it.data();
        if (order && it.prev() !== null)
            return it.data().rate;
        return 0; // no order with rate >= found
    }

    /**
     * Returns the lowest price somebody wants to sell.
     * @returns {number}
     */
    public getAsk() {
        let it = this.orders.upperBound(this.getMarketOrder()) // > rate, go up
        let order = it.data();
        if (order)
            return order.rate;
        return Number.MAX_VALUE; // no order with rate < found
    }

    /**
     * Get an array of amount/rate pairs of bids in the market (we can sell it, <= market price).
     * If there are not enough entries in the order book the sum of all amounts will be less than specified in the "amount" parameter.
     * @param amount the amount we want to buy
     * @returns {Array}
     */
    public getBids(amount: number): OrderBookEntry[] {
        let rates: OrderBookEntry[] = [];
        let it = this.orders.lowerBound(this.getMarketOrder()) // >= rate, go down
        if (!it.data() || it.prev() == null)
            return rates;
        let item;
        let node: T = it.data();
        rates.push({rate: node.rate, amount: Math.min(node.amount, amount), marked: false});
        amount -= node.amount;
        while (item = it.prev() != null && amount > 0)
        {
            node = it.data();
            rates.push({rate: node.rate, amount: Math.min(node.amount, amount), marked: false});
            amount -= node.amount;
        }
        return rates;
    }

    /**
     * Get an array of amount/rate pairs of asks in the market (we can buy it, > market price).
     * If there are not enough entries in the order book the sum of all amounts will be less than specified in the "amount" parameter.
     * @param amount the amount we want to buy
     * @returns {Array}
     */
    public getAsks(amount: number) {
        let rates: OrderBookEntry[] = [];
        let it = this.orders.upperBound(this.getMarketOrder()) // > rate, go up
        if (!it.data())
            return rates;
        let item;
        let node: T = it.data();
        rates.push({rate: node.rate, amount: Math.min(node.amount, amount), marked: false});
        amount -= node.amount;
        while (item = it.next() != null && amount > 0)
        {
            node = it.data();
            rates.push({rate: node.rate, amount: Math.min(node.amount, amount), marked: false});
            amount -= node.amount;
        }
        return rates;
    }

    public getBidAvg(amount: number) {
        let bids = this.getBids(amount);
        return this.getVolumeWeighetAveragePrice(bids);
    }

    public getAskAvg(amount: number) {
        let asks = this.getAsks(amount);
        return this.getVolumeWeighetAveragePrice(asks);
    }

    public getOrderCount() {
        return this.orders.size;
    }

    public getBidCount() {
        let it = this.orders.lowerBound(this.getMarketOrder()) // >= rate, go down
        if (!it.data() || it.prev() == null)
            return 0;
        let item;
        let count = 1;
        while (item = it.prev() != null)
            count++;
        return count;
    }

    public getAskCount() {
        let it = this.orders.upperBound(this.getMarketOrder()) // > rate, go up
        if (!it.data())
            return 0;
        let item;
        let count = 1;
        while (item = it.next() != null)
            count++;
        return count;
    }

    /**
     * Get the amount people are willing to buy (go down)
     * @param {number} maxRate (optional) the rate to start with. Otherwise use the last market rate
     * @param {number} minRate (optional) the rate to end with. Otherwise go through the full orderbook
     * @returns {number}
     */
    public getBidAmount(maxRate: number = 0, minRate: number = 0) {
        let it = this.orders.lowerBound(this.getMarketOrder(maxRate)) // >= rate, go down
        if (!it.data() || it.prev() == null)
            return 0;
        let item;
        let node: T = it.data();
        let amount = node.amount;
        while (item = it.prev() != null)
        {
            node = it.data();
            if (minRate !== 0 && node.rate <= minRate)
                break;
            amount += node.amount;
        }
        return amount;
    }

    public getBidAmountBase(maxRate: number = 0, minRate: number = 0) {
        let it = this.orders.lowerBound(this.getMarketOrder(maxRate)) // >= rate, go down
        if (!it.data() || it.prev() == null)
            return 0;
        let item;
        let node: T = it.data();
        let amount = node.amount * node.rate;
        while (item = it.prev() != null)
        {
            node = it.data();
            if (minRate !== 0 && node.rate <= minRate)
                break;
            amount += node.amount * node.rate;
        }
        return amount;
    }

    /**
     * Get the amount people are willing to sell (go up)
     * @param {number} minRate (optional) the rate to start with. Otherwise use the last market rate
     * @param {number} maxRate (optional) the rate to end with. Otherwise go through the full orderbook
     * @returns {number}
     */
    public getAskAmount(minRate: number = 0, maxRate: number = 0) {
        let it = this.orders.upperBound(this.getMarketOrder(minRate)) // > rate, go up
        if (!it.data())
            return 0;
        let item;
        let node: T = it.data();
        let amount = node.amount;
        while (item = it.next() != null)
        {
            node = it.data();
            if (maxRate !== 0 && node.rate > maxRate)
                break;
            amount += node.amount;
        }
        return amount;
    }

    public getAskAmountBase(minRate: number = 0, maxRate: number = 0) {
        let it = this.orders.upperBound(this.getMarketOrder(minRate)) // > rate, go up
        if (!it.data())
            return 0;
        let item;
        let node: T = it.data();
        let amount = node.amount * node.rate;
        while (item = it.next() != null)
        {
            node = it.data();
            if (maxRate !== 0 && node.rate > maxRate)
                break;
            // TODO poloniex always shows a bit less here. but if we use the current rate the amount in BTC would be even higher.
            // they probably just fetch more orders?
            amount += node.amount * node.rate;
        }
        return amount;
    }

    public getRaiseAmount(percent: number) {
        let currentPrice = this.getLast();
        let targetPrice = currentPrice + currentPrice / 100 * percent;
        // iterate through the book...
        let it = this.orders.upperBound(this.getMarketOrder()) // > rate, go up through asks
        if (!it.data())
            return 0;
        let item;
        let node: T = it.data();
        let amount = node.amount * node.rate;
        let lastPrice = 0;
        let currencyStr = "";
        while (item = it.next() != null)
        {
            node = it.data();
            amount += node.amount * node.rate;
            lastPrice = node.rate;
            if (!currencyStr)
                currencyStr = node.currencyPair ? node.currencyPair.toString() : Currency[node.currency];
            if (node.rate >= targetPrice)
                return amount;
        }
        logger.warn("%s Order book not deep enough (loaded) to compute the cost to raise the price by %s%, lastPrice %s, targetPrice %s", currencyStr, percent, lastPrice, targetPrice);
        return amount;
    }

    public getLowerAmount(percent: number) {
        let currentPrice = this.getLast();
        let targetPrice = currentPrice - currentPrice / 100 * percent;
        let it = this.orders.lowerBound(this.getMarketOrder()) // >= rate, go down through bids
        if (!it.data() || it.prev() == null)
            return 0;
        let item;
        let node: T = it.data();
        let amount = node.amount * node.rate;
        let lastPrice = 0;
        let currencyStr = "";
        while (item = it.prev() != null)
        {
            node = it.data();
            amount += node.amount * node.rate;
            lastPrice = node.rate;
            if (!currencyStr)
                currencyStr = node.currencyPair ? node.currencyPair.toString() : Currency[node.currency];
            if (node.rate <= targetPrice)
                return amount;
        }
        logger.warn("%s Order book not deep enough (loaded) to compute the cost to raise the price by %s%, lastPrice %s, targetPrice %s", currencyStr, percent, lastPrice, targetPrice);
        return amount;
    }

    public getOrderAmount(rate: number, numDecimals = 5) {
        const exp = Math.pow(10, numDecimals);
        rate = Math.floor(rate * exp) / exp; // to be sure the number of decimals match
        let it = this.orders.lowerBound(this.getMarketOrder(rate)) // >= rate, go up
        if (!it.data() || it.next() == null)
            return 0;
        let item;
        let currentRate = Math.floor(it.data().rate * exp) / exp;
        if (currentRate !== rate)
            return 0;
        let amount = it.data().amount;
        while (item = it.next() != null)
        {
            currentRate = Math.floor(it.data().rate * exp) / exp;
            if (currentRate !== rate)
                break;
            amount += it.data().amount;
        }
        return amount;
    }

    public getOrderCountAtRate(rate: number, numDecimals = 5) {
        const exp = Math.pow(10, numDecimals);
        rate = Math.floor(rate * exp) / exp; // to be sure the number of decimals match
        let it = this.orders.lowerBound(this.getMarketOrder(rate)) // >= rate, go up
        if (!it.data() || it.next() == null)
            return 0;
        let currentRate = Math.floor(it.data().rate * exp) / exp;
        if (currentRate !== rate)
            return 0;
        let count = 1;
        while (it.next() != null)
            count++;
        return count;
    }

    /**
     * Mark all orders currently in the book to be removed.
     * Call addOrder() afterwards to update/add existing orders.
     * Then call removeMarked() to remove the rest.
     */
    public markOrders() {
        let it = this.orders.iterator();
        let item;
        while ((item = it.next()) !== null)
            it.data().marked = true;
    }

    public removeMarked() {
        let it = this.orders.iterator();
        let item;
        let removeNodes = [];
        while ((item = it.next()) !== null)
        {
            if (it.data().marked === true) {
                //this.orders.remove(item);
                removeNodes.push(item);
            }
        }
        for (let i = 0; i < removeNodes.length; i++)
            this.orders.remove(removeNodes[i]);
    }

    public isValid() {
        if (/*this.getOrderCount() === 0*/this.getAskCount() === 0 || this.getBidCount() === 0) {
            if (!this.initDone)
                return true; // assume not yet ready
            const expiryMs = Date.now() - nconf.get("serverConfig:orderBookTimeoutSec") * 1000;
            if (!this.lastUpdate || this.lastUpdate.getTime() < expiryMs)
                return false;
            return true;
        }
        if (this.getAsk() != 0 && this.getBid() != 0) {
            this.initDone = true;
            return true;
        }
        return false;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected getMarketOrder(rate: number = 0) {
        let order: T = Object.assign({}, this.orders.min());
        order.rate = rate ? rate : this.last;
        return order;
    }

    protected getVolumeWeighetAveragePrice(orders: OrderBookEntry[]) {
        let sum = 0, vol = 0;
        for (let i = 0; i < orders.length; i++)
        {
            sum += orders[i].rate * orders[i].amount;
            vol += orders[i].amount;
        }
        if (vol === 0)
            return -1; // shouldn't happen. make sure we don't sell/buy for this price
        return sum / vol; // volume weighted average price
    }
}