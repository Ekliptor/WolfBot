import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as autobahn from "autobahn";
//import {W3CWebSocket} from "websocket"; // replace by ws
//const WebSocket = require('websocket').w3cwebsocket; // not (yet) in typings
import * as WebSocket from "ws";
import * as request from "request";
import * as url from "url";
import * as HttpsProxyAgent from "https-proxy-agent";
import * as EventEmitter from 'events';
import {OrderResult} from "../structs/OrderResult";
import {MarginPosition, MarginPositionList} from "../structs/MarginPosition";
import MarginAccountSummary from "../structs/MarginAccountSummary";

import EventStream from "../Trade/EventStream";
import {MarketStream, MarketAction} from "../Trade/MarketStream";
import {CandleMarketStream} from "../Trade/CandleMarketStream";
import {OrderBook} from "../Trade/OrderBook";
import {Currency, Ticker, Trade, MarketOrder} from "@ekliptor/bit-models";
import * as _ from "lodash";
import * as path from "path";
import * as async from "async";
import {PendingOrder} from "../Trade/AbstractOrderTracker";
import {AbstractNotification} from "../Notifications/AbstractNotification";
import Notification from "../Notifications/Notification";

export interface ExOptions {
    [key: string]: any;
}
export interface ExApiKey {
    key: string;
    secret: string;
    key2?: string;
    secret2?: string;
}

export interface ExRequestParams {
    [key: string]: string | number | boolean;
}
/*
export interface ExResponse {

}
*/
export type ExResponse = any; // TODO

export interface ExchangePair {
    name: string;
    altName: string;
}

export class ExchangePairMap extends Map<string, ExchangePair> { // (currency pair, ExchangePair)
    constructor() {
        super()
    }
    public getKeyArray() {
        let keys: string[] = []
        for (let pair of this)
            keys.push(pair[0])
        return keys;
    }
}

export class OrderBookUpdate<T> {
    public static readonly ASK_BID_DIFF = 0.00000001;

    public asks: MarketOrder.MarketOrder[] = [];
    public bids: MarketOrder.MarketOrder[] = [];
    public readonly isFrozen: boolean;
    public readonly seqNr: number;

    constructor(seqNr: number, isFrozen = false) {
        this.seqNr = seqNr;
        this.isFrozen = isFrozen;
    }

    public getAll(): MarketOrder.MarketOrder[] {
        return this.asks.concat(this.bids);
    }

    public getAsk() {
        let asks = this.asks.map(x => x.rate)
        return Math.min(...asks)
    }

    public getBid() {
        let bids = this.bids.map(x => x.rate)
        return Math.max(...bids)
    }

    /*
    public setSeqNr(seqNr: number) {
        if (this.seqNr && this.seqNr > 0 && this.seqNr !== seqNr)
            return logger.error("Can not change seq number of orderbook. Already set %s, update %s", this.seqNr, seqNr)
        this.seqNr = seqNr;
    }
    */
}

export interface OpenOrder {
    orderNumber: number | string;
    type: "buy" | "sell"; // "close" is always filled immediately
    rawType?: any; // for exchanges where we have to differentiate between "openShort" and "closeLong"
    rate: number;
    amount: number;
    total: number; // rate * amount
    leverage: number; // 0 or 1 = no leverage
}
export class OpenOrders {
    public readonly currencyPair;
    public readonly exchangeName: string;
    public orders: OpenOrder[] = [];

    constructor(currencyPair: Currency.CurrencyPair, exchangeName: string) {
        this.currencyPair = currencyPair;
        this.exchangeName = exchangeName;
    }

    public addOrder(order: OpenOrder) {
        ["rate", "amount", "total"].forEach((prop) => {
            if (typeof order[prop] === "string") {
                order[prop] = parseFloat(order[prop]);
                if (order[prop] === Number.NaN)
                    order[prop] = 0;
            }
        });
        if (order.total === undefined || order.total === 0)
            order.total = order.amount * order.rate;
        this.orders.push(order)
    }

    public isOpenOrder(orderNumber: number | string) {
        for (let i = 0; i < this.orders.length; i++)
        {
            if (this.orders[i].orderNumber == orderNumber)
                return true;
        }
        return false;
    }

    public getOrder(orderNumber: number | string): OpenOrder {
        for (let i = 0; i < this.orders.length; i++)
        {
            if (this.orders[i].orderNumber == orderNumber)
                return this.orders[i];
        }
        return null;
    }
}

export interface OrderParameters {
    // TODO add warnings/checks for other exchanges if those parameters are supported
    fillOrKill?: boolean;
    immediateOrCancel?: boolean; // only on non-margin on poloniex
    postOnly?: boolean; // only on non-margin on poloniex
    matchBestPrice?: boolean; // from OKEX, market order

    marginOrder?: boolean; // for internal use of the bot (if some min/max values change for margin)
}
export interface MarginOrderParameters extends OrderParameters {
    lendingRate?: number; // the max lending rate
}
export interface CancelOrderResult {
    exchangeName: string;
    cancelled: boolean;
    orderNumber: number | string;
}

export class ExchangeMap extends Map<string, AbstractExchange> { // (exchange name, instance)
    constructor() {
        super()
    }
}

export enum PushApiConnectionType {
    AUTOBAHN = 1,
    WEBSOCKET = 2
}

export abstract class AbstractExchange {
    // TODO fix crash (no stacktrace) in poloniex (and others?) when they are down for a longer time > 10min. out of memory repeating calls?
    public static readonly DEFAULT_MAKER_FEE = 0.0015;
    public static readonly cookieFileName = path.join(utils.appDir, "temp", "cookies.json");

    // TODO keep track of tradable balance. currently the config value is assumed to always work
    protected className: string;

    protected maxCallsPerSec = 6; // from poloniex, true for most? // TODO implement check if we do many requests
    protected minTradingValue = 0.0001; // rate * amount // from poloniex
    protected minTradingValueMargin = 0.0001; // default is the same as minTradingValue
    protected apiKey: ExApiKey;
    protected proxy: string[] = [];
    protected marginNotification: number = 0;
    protected publicApiUrl = "";
    protected privateApiUrl = "";
    protected pushApiUrl = "";
    protected httpKeepConnectionsAlive = true;
    protected pushApiConnectionType: PushApiConnectionType = PushApiConnectionType.WEBSOCKET;
    protected dateTimezoneSuffix = ""; // used if dates from the API come as strings. for example " GMT+0000"
    protected serverTimezoneDiffMin = 0; // see getTimezoneOffset()
    protected httpPollIntervalSec = nconf.get("serverConfig:httpPollIntervalSec");
    protected exchangeLabel: Currency.Exchange;
    protected fee = 0.0025;
    protected maxLeverage = 0; // 0 = no margin trading, 2.5 = 40% maintentance margin
    protected currencies: Currency.ExchangeCurrencies = null;
    // static map to keep streams open. not needed anymore since we cache exchange instances in ExChangeController
    protected static pushApiConnections = new Map<string, autobahn.Connection | WebSocket>(); // (className, instance)
    protected requestCount = 0;
    protected lastNonce = 0;
    protected cookieJar = utils.getNewCookieJar(AbstractExchange.cookieFileName); // cookies help against DDOS protection (CloudFlare) even on APIs
    protected requestQueue = Promise.resolve();
    protected currencyPairs: Currency.CurrencyPair[] = []; // the currency pairs we are interested in on this exchange
    protected ticker = new Ticker.TickerMap();
    protected orderBook = new Map<string, OrderBook<MarketOrder.MarketOrder>>(); // (currency pair, orders)
    protected contractExchange = false; // can also be true for HistoryDataExchanges, which is no child class if AbstractContractExchange
    protected exchangePairs = new ExchangePairMap(); // (currency pair, not used yet) // a map to dynamically load available pairs on startup
    //protected forceReload = false; // bad because there are other references to this object
    protected automaticImports = true; // set to false if we can't call import() with the desired date (API not supporting dates, for example contract numbers for futures)

    //protected marketEventStream: EventStream<MarketAction>;
    protected openMarketRelays: EventStream<MarketAction>[] = [];
    protected maxPendingMarketEvents = 10;
    protected marketStream: MarketStream;

    // measure response times in ms to exchange. if responseTimeRecent is way above responseTimeAvg it means dangerously high trade volumes
    // -> panic sells -> possible crash ahead
    protected responseTimesRecent: number[] = [];
    protected responseTimesAvg: number[] = [];
    protected responseTimeRecent = 0;
    protected responseTimeAvg = 0;
    protected webSocketTimeoutMs: number = nconf.get('serverConfig:websocketTimeoutMs');
    protected websocketTimeoutTimerID: NodeJS.Timer = null;
    protected websocketPingTimerID: NodeJS.Timer = null;
    protected websocketCleanupFunction: () => boolean = null;
    protected httpPollTimerID: NodeJS.Timer = null;
    protected localSeqNr = 0; // some APIs don't provide seqNrs
    protected lastServerTimestampMs = Date.now(); // to easier sync the clock, comes from some WebSocket APIs. assume now (better than 0) at start
    protected nextCloseMarketOrder = false; // force the next close to be a market order (instead of a limit order). useful to ensure it gets closed
    protected notifier: AbstractNotification;
    protected lastNotification: Date = null;

    constructor(options: ExOptions, useCandleMarketStream = false) {
        this.className = this.constructor.name;
        this.apiKey = {key: options.key, secret: options.secret}
        if (options.key2 && options.secret2) {
            this.apiKey.key2 = options.key2;
            this.apiKey.secret2 = options.secret2;
        }
        if (options.proxy)
            this.proxy = options.proxy;
        if (options.marginNotification)
            this.marginNotification = parseFloat(options.marginNotification);

        // instances stays the same throughout the session. on WebSocket reconnects just the underlying socket & EventStream gets replaced
        this.marketStream = useCandleMarketStream ? new CandleMarketStream(this) : new MarketStream(this);
        this.marketStream.on("trades", (currencyPair: Currency.CurrencyPair, trades: Trade.Trade[]) => {
            let book = this.orderBook.get(currencyPair.toString());
            if (book) // order book not available in HistoryDataExchange
                book.setLast(trades[trades.length-1].rate);
        })
        //setTimeout(this.openConnection.bind(this), 0); // has to be called after the child constructor finishes initializing
        setTimeout(() => {
            this.minTradingValueMargin = this.minTradingValue;
        }, 0)

        const notificationClass = nconf.get('serverConfig:notificationMethod');
        const notificationOpts = nconf.get("serverConfig:apiKey:notify:" + notificationClass);
        const modulePath = path.join(__dirname, "..", "Notifications", notificationClass)
        this.notifier = this.loadModule(modulePath, notificationOpts)
        if (!this.notifier) {
            logger.error("Error loading %s in %s", notificationClass, this.className)
            return;
        }
    }

    public subscribeToMarkets(currencyPairs: Currency.CurrencyPair[]) {
        this.currencyPairs = currencyPairs;
        this.orderBook.clear();
        this.currencyPairs.forEach((pair) => {
            this.orderBook.set(pair.toString(), new OrderBook<MarketOrder.MarketOrder>())
        })
        this.openConnection();
        this.startPolling();
    }

    public getClassName() {
        return this.className;
    }

    public getMarginNotification() {
        return this.marginNotification;
    }

    public getMinTradingBtc() {
        return this.minTradingValue;
    }

    public getDateTimezoneSuffix() {
        return this.dateTimezoneSuffix;
    }

    public getExchangeLabel() {
        return this.exchangeLabel;
    }

    public getFee() {
        return this.fee;
    }

    public getCurrencies() {
        return this.currencies;
    }

    public getMaxLeverage() {
        return this.maxLeverage;
    }

    public marginTradingSupport() {
        return this.maxLeverage !== 0; // should be > 1
    }

    public getTickerMap() {
        return this.ticker;
    }

    public setTickerMap(tickerMap: Ticker.TickerMap) {
        //this.ticker = tickerMap; // update existing ticker objects because we pass references around (to strategies...)
        for (let ticker of tickerMap)
        {
            let existingTicker = this.ticker.get(ticker[0]);
            if (existingTicker)
                Object.assign(existingTicker, ticker[1]);
            else
                this.ticker.set(ticker[0], ticker[1]);
        }
    }

    public getTickerData(currencyPair: Currency.CurrencyPair) {
        return this.ticker.get(currencyPair.toString());
    }

    public getMarketStream() {
        return this.marketStream;
    }

    public getOrderBook() {
        return this.orderBook;
    }

    public isContractExchange() {
        return this.contractExchange;
    }

    public getExchangePairs() {
        return this.exchangePairs;
    }

    public supportsAutomaticImports() {
        return this.automaticImports;
    }

    /*
    public getForceReload() {
        return this.forceReload;
    }
    */

    // gerneral exchange API functions
    public abstract getTicker(): Promise<Ticker.TickerMap>;
    public abstract getBalances(): Promise<Currency.LocalCurrencyList>;
    public abstract getMarginAccountSummary(): Promise<MarginAccountSummary>;
    public abstract fetchOrderBook(currencyPair: Currency.CurrencyPair, depth: number): Promise<OrderBookUpdate<MarketOrder.MarketOrder>>;
    public abstract importHistory(currencyPair: Currency.CurrencyPair, start: Date, end: Date): Promise<void>;

    // trading API functions
    public abstract buy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params?: OrderParameters): Promise<OrderResult>;
    public abstract sell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params?: OrderParameters): Promise<OrderResult>;
    public abstract cancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string): Promise<CancelOrderResult>;
    public abstract getOpenOrders(currencyPair: Currency.CurrencyPair): Promise<OpenOrders>;
    public abstract moveOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: OrderParameters): Promise<OrderResult>;
    // TODO for exchange and *2.5 for margin trading
    //public abstract getTradableBalances(): Promise<TradableBalances>;

    // margin trading API functions
    public abstract marginBuy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params?: MarginOrderParameters): Promise<OrderResult>;
    public abstract marginSell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params?: MarginOrderParameters): Promise<OrderResult>;
    public abstract marginCancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string): Promise<CancelOrderResult>;
    public abstract moveMarginOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: MarginOrderParameters): Promise<OrderResult>;
    // make sure it fails if we can't retrieve 1 or more margin positions (otherwise RealTimeTrader will assume closed and change positions)
    public abstract getAllMarginPositions(): Promise<MarginPositionList>;
    public abstract getMarginPosition(currencyPair: Currency.CurrencyPair): Promise<MarginPosition>;
    public abstract closeMarginPosition(currencyPair: Currency.CurrencyPair): Promise<OrderResult>;

    public cancelPendingOrder(pendingOrder: PendingOrder) {
        if (pendingOrder.order.marginOrder)
            return this.marginCancelOrder(pendingOrder.order.currencyPair, pendingOrder.order.orderID);
        return this.cancelOrder(pendingOrder.order.currencyPair, pendingOrder.order.orderID);
    }

    public movePendingOrder(pendingOrder: PendingOrder) {
        // don't set the amount again in here because we don't want to change the amount that needs to be filled (order might already be partially filled)
        if (pendingOrder.order.marginOrder)
            return this.moveMarginOrder(pendingOrder.order.currencyPair, pendingOrder.order.orderID, pendingOrder.order.rate, /*pendingOrder.order.amount*/0, pendingOrder.orderParameters);
        return this.moveOrder(pendingOrder.order.currencyPair, pendingOrder.order.orderID, pendingOrder.order.rate, /*pendingOrder.order.amount*/0, pendingOrder.orderParameters);
    }

    public repeatFailedTrade(error: any, currencyPair: Currency.CurrencyPair) {
        // our custom errors
        //if (error && typeof error.txt === "string")
            //return false;
        if (error && error.permanent === true)
            return false;

        if (!error || !error.error || typeof error.error !== "string")
            return true; // shouldn't happen, shouldn't fail

        const errorLower = error.error.toLowerCase();
        // insufficient collateral, Not enough BTC <- poloniex
        // Margin trading is not enabled for this market.
        if (errorLower.indexOf("insufficient") !== -1 || errorLower.indexOf("not enough") !== -1 || errorLower.indexOf("margin trading is not enabled") !== -1)
            return false;
        if (errorLower.indexOf("minimum size") !== -1)
            return false;

        if (errorLower.indexOf("place post-only order") !== -1 || // postOnly: Unable to place post-only order at this price
            errorLower.indexOf("nonce") !== -1)
            return true;
        return true;
    }

    public getOrderTimeoutSec(postOnly = false) {
        return postOnly ? nconf.get('serverConfig:orderMakerAdjustSec') : nconf.get('serverConfig:orderTimeoutSec');
    }

    /**
     * functions will always return true if they can convert it. doesn't mean it is supported by the exchange
    public isSupportedCurrency(currency: Currency.Currency) {
        const currencyStr = this.currencies.getExchangeName(Currency.getCurrencyLabel(currency))
        return currencyStr !== undefined;
    }

    public isSupportedCurrencyPair(currencyPair: Currency.CurrencyPair) {
        const pairStr = this.currencies.getExchangePair(currencyPair)
        return pairStr !== undefined;
    }
     */

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected abstract publicReq(method: string, params: ExRequestParams): Promise<ExResponse>; // usually GET

    protected abstract privateReq(method: string, params: ExRequestParams): Promise<ExResponse>; // usually POST

    protected get(address, callback, options: any = {}): request.Request {
        ++this.requestCount;
        if (nconf.get("logExchangeRequests"))
            logger.verbose("GET: %s", address)
        if (this.proxy.length !== 0 && !options.proxy)
            options.proxy = this.proxy[utils.getRandomInt(0, this.proxy.length)]
        // TODO detect >You are being rate limited< and change IP via proxy or other CF errors instead of json
        const reqStart = Date.now();
        return utils.getPageCode(address, (body, response) => {
            this.addResponseTime(reqStart);
            callback(body, response);
        }, this.getHttpOptions(options))
    }

    protected post(address, data, callback, options: any = {}): request.Request {
        ++this.requestCount;
        if (nconf.get("logExchangeRequests")) {
            logger.verbose("POST: %s", address)
            logger.verbose(data)
        }
        if (options.urlencoded === undefined)
            options.urlencoded = true
        if (this.proxy.length !== 0 && !options.proxy)
            options.proxy = this.proxy[utils.getRandomInt(0, this.proxy.length)]
        const reqStart = Date.now();
        return utils.postData(address, data, (body, response) => {
            this.addResponseTime(reqStart);
            callback(body, response);
        }, this.getHttpOptions(options))
    }

    protected getHttpOptions(options: any = {}) {
        if (options.cookieJar === undefined)
            options.cookieJar = this.cookieJar;
        if (options.timeout === undefined)
            options.timeout = nconf.get('serverConfig:httpTimeoutMs')
        //if (options.cloudscraper === undefined) // poloniex API sometimes gets blocked too. but then trading is almost impossible either way
            //options.cloudscraper = true;
        options.forever = this.httpKeepConnectionsAlive; // keep connections alive
        return options;
    }

    protected addResponseTime(reqStart: number) {
        const rtt = Date.now() - reqStart;
        this.responseTimesRecent.push(rtt);
        this.responseTimesAvg.push(rtt);
        if (this.responseTimesAvg.length < nconf.get('serverConfig:keepResponseTimes:avg'))
            return;
        let getAvg = (timeArr, maxEleents) => {
            if (timeArr.length > maxEleents)
                timeArr.splice(0, timeArr.length - maxEleents);
            let sum = _.reduce<number, number>(timeArr, (total, n) => {
                return total + n;
            });
            return sum / timeArr.length;
        }
        this.responseTimeRecent = getAvg(this.responseTimesRecent, nconf.get('serverConfig:keepResponseTimes:recent'));
        this.responseTimeAvg = getAvg(this.responseTimesAvg, nconf.get('serverConfig:keepResponseTimes:avg'));
        if (this.responseTimeRecent > this.responseTimeAvg * nconf.get('serverConfig:keepResponseTimes:lowFactor'))
            logger.error("%s is overloaded. recent response time (ms) %s, avg %s", this.className, this.responseTimeRecent, this.responseTimeAvg) // TODO send event?
    }

    protected openConnection(): void {
        // our exchanges get called every 5 sec from process() to check news
        // but the push api connection has to be a static variable because we keep it open all the time
        if (!this.pushApiUrl)
            return;
        if (AbstractExchange.pushApiConnections.has(this.className))
            return; // already connected
        logger.verbose("Opening Websocket connection in %s to %s", this.className, this.pushApiUrl)
        let connection = this.pushApiConnectionType === PushApiConnectionType.AUTOBAHN ? this.createConnection() : this.createWebsocketConnection();
        if (connection)
            AbstractExchange.pushApiConnections.set(this.className, connection);
        this.resetWebsocketTimeout();
    }

    protected createConnection(): autobahn.Connection {
        // overwrite this in the subclass and return the connection
        return null;
    }

    protected createWebsocketConnection(): WebSocket {
        // overwrite this in the subclass and return the connection
        return null;
    }

    protected getWebsocketOptions() {
        let wsOptions: WebSocket.ClientOptions = {}
        if (this.proxy.length === 0)
            return wsOptions;
        // create an instance of the `HttpsProxyAgent` class with the proxy server information
        let options = url.parse(this.proxy[utils.getRandomInt(0, this.proxy.length)]);
        wsOptions.agent = new HttpsProxyAgent(options);
        return wsOptions;
    }

    protected onConnectionClose(reason: string): void {
        logger.warn("Websocket connection to %s closed: Reason: %s", this.className, reason);
        clearTimeout(this.websocketTimeoutTimerID);
        clearTimeout(this.websocketPingTimerID);
        AbstractExchange.pushApiConnections.delete(this.className); // remove it so that a reconnect can happen
        this.openMarketRelays.forEach((stream) => {
            stream.close(); // stop forwarding events. new EventStream instances will be used for the next connection
        })
        this.openMarketRelays = [];
        for (let book of this.orderBook)
            this.orderBook.get(book[0]).clear(); // keep references to the orderbook
        setTimeout(this.openConnection.bind(this), 2500);
        //this.forceReload = true;
        // TODO if it takes us mutlipe tries to reconnect (exchange overloaded for many minutes) our trades list is incomplete
        // add a feature to auto import missing trades or suspend trading for candleSize * numberOfCandles of the longest strategy
    }

    protected closeConnection(reason) {
        let socket = AbstractExchange.pushApiConnections.get(this.className);
        try {
            if (!socket)
                logger.error("No socket available to close WebSocket connection to %s", this.className)
            else {
                if (socket instanceof WebSocket)
                    socket.close();
                //else if (socket instanceof autobahn.Connection)
                    //socket.close();
                else if (typeof socket.close === "function")
                    socket.close(); // bitfinex and other APIs // TODO already done in BF class on error. but shouldn't matter?
                else
                    logger.error("Unanble to close unknown WebSocket connection from %s", this.className)
                if (socket instanceof EventEmitter/*typeof socket.removeAllListeners === "function"*/)
                    socket.removeAllListeners()
            }
            if (typeof this.websocketCleanupFunction === "function") {
                if (this.websocketCleanupFunction() === false)
                    logger.error("Error in %s websocket cleanup", this.className)
            }
        }
        catch (err) {
            logger.error("Error closing timed out WebSocket connection", err);
        }
        this.onConnectionClose(reason);
    }

    protected resetWebsocketTimeout() {
        clearTimeout(this.websocketTimeoutTimerID);
        this.websocketTimeoutTimerID = setTimeout(() => {
            this.closeConnection("Connection timed out");
        }, this.webSocketTimeoutMs)

        // reopen the connection if we have an invalid order book (happened with OKEX)
        for (let book of this.orderBook)
        {
            if (!book[1].isValid()) { // TODO only if exchange is known to have problems with orderbook updates
                book[1].clear(); // clear it immediately to avoid endless loop
                this.closeConnection(utils.sprintf("%s %s order book is invalid", this.className, book[0]))
                break;
            }
        }
    }

    protected scheduleWebsocketPing(pingFunction: () => void, pingIntervalMs: number) {
        this.websocketPingTimerID = setTimeout(() => {
            pingFunction();
            this.scheduleWebsocketPing(pingFunction, pingIntervalMs)
        }, pingIntervalMs)
    }

    protected startPolling(): void {
        // if the market has no push api via WebSocket we have to poll with http requests and setTimeout()
        // don't implement both!
    }

    /**
     * Call this after initiating a WebSocket connection to get the current order book state.
     * @param fetchHTTP. set to false if the initial order book state can be obtained via WebSocket as well
     * @returns {Promise<void>}
     */
    protected updateOrderBooks(fetchHTTP: boolean) {
        return new Promise<void>((resolve, reject) => {
            for (let book of this.orderBook)
            {
                if (!fetchHTTP) // otherwise done below
                    //this.orderBook.set(book[0], new OrderBook<MarketOrder.MarketOrder>()); // start with a new order book on every new connection
                    this.orderBook.get(book[0]).clear(); // keep references to the orderbook
            }
            if (!fetchHTTP)
                return resolve();

            setTimeout(() => { // delay it to make sure we receive WebSocket updates before we get the snapshot
                let updates = []
                this.currencyPairs.forEach((pair) => {
                    updates.push((resolve) => {
                        this.fetchOrderBook(pair, nconf.get("serverConfig:orderBookUpdateDepth")).then((book) => {
                            let orderBook: OrderBook<MarketOrder.MarketOrder> = this.orderBook.get(pair.toString());
                            let wasEmpty = orderBook.getBidCount() === 0;
                            orderBook.clear(); // we forced a (re)load
                            orderBook.setSnapshot(book.getAll(), book.seqNr, wasEmpty)
                            orderBook.setLast(book.getAsk() - OrderBookUpdate.ASK_BID_DIFF) // last order != last trade, but ok to start with
                            resolve();
                        }).catch((err) => {
                            logger.error("Error updating %s orderbook in %s", pair.toString(), this.className, err)
                            resolve();
                        })
                    })
                })
                async.parallelLimit(updates, 1, (err, results: Array<void>) => {
                    logger.verbose("Updated %s order books in %s", this.currencyPairs.length, this.className)
                    resolve();
                })
            }, 1000);
        })
    }

    protected waitForOpenOrders(currencyPair: Currency.CurrencyPair) {
        return new Promise<void>((resolve, reject) => {
            const timeout = Date.now() + this.getOrderTimeoutSec()*1000;
            let checkOrders = () => {
                this.getOpenOrders(currencyPair).then((orders) => {
                    if (orders.orders.length === 0)
                        return resolve(); // all orders filled
                    else if (Date.now() > timeout) {
                        logger.error("%s %s order didn't get executed or moved in time", this.className, currencyPair.toString())
                        return resolve();
                    }
                    setTimeout(checkOrders.bind(this), nconf.get("serverConfig:waitOrdersRepeatingCheckSec")*1000)
                }).catch((err) => {
                    logger.error("Error waiting for open orders of %s", currencyPair.toString(), err)
                    setTimeout(checkOrders.bind(this), nconf.get("serverConfig:waitOrdersRepeatingCheckSec")*1000)
                })
            }
            checkOrders();
            //setTimeout(resolve.bind(this), this.getOrderTimeoutSec()*1000); // promise will only fire once
        })
    }

    protected abstract verifyTradeRequest(currencyPair: Currency.CurrencyPair, rate: number, amount: number): Promise<ExRequestParams>;
    protected abstract verifyExchangeResponse(body: string | false, response: request.RequestResponse, method: string): Promise<ExResponse>;

    protected verifyExchangeRequest(currencyPair: Currency.CurrencyPair) {
        return new Promise<string>((resolve, reject) => {
            const pairStr = this.currencies.getExchangePair(currencyPair)
            if (pairStr === undefined)
                return reject({txt: "Currency pair not supported by this exchange", exchange: this.className, pair: currencyPair});
            resolve(pairStr)
        })
    }

    protected getNextNonce() {
        let next = Date.now()
        // nonces have to be strictly increasing (on poloniex)
        // increasing by 1 is not enough because simultaneous requests can arrive out of order
        // we only do 1 request in parallel
        // TODO if we run 2 processes simultaneously we still can get nonce problems, using Database would be async
        if (next <= this.lastNonce)
            //next = this.lastNonce  + nconf.get('exchangeNonceDiff') + 1;
            next = ++this.lastNonce;
        this.lastNonce = next
        return next
    }

    /*
    protected getServerDate() {
        let date = new Date();
        let msDate = date.getTime() - date.getTimezoneOffset()*60000 + this.serverTimezoneDiffMin*60000;
        return new Date(msDate);
    }

    protected toLocalDate(dateExpr) {
        let date = new Date(dateExpr);
        let localDate = new Date();
        let ms = date.getTime() + localDate.getTimezoneOffset()*60000 - this.serverTimezoneDiffMin*60000;
        return new Date(ms);
    }

    protected getLocalTimestampMs(date: Date) {
        let localDate = new Date();
        return date.getTime() - localDate.getTimezoneOffset()*60000 + this.serverTimezoneDiffMin*60000
    }
    */

    protected setDateByStr(date: Date, str: string) {
        const originalDate = new Date(date);
        let strParts = str.split(":");
        if (strParts.length === 3) { // else unknown format
            date.setHours(parseInt(strParts[0])) // values are local, not UTC
            date.setMinutes(parseInt(strParts[1]))
            date.setSeconds(parseInt(strParts[2]))
            let localDate = new Date(); // from getServerDate(), fix the non-UTC hours we received
            let ms = date.getTime() - localDate.getTimezoneOffset()*60000 + this.serverTimezoneDiffMin*60000;
            date = new Date(ms)
            if (date.getDate() !== originalDate.getDate()) {
                // can happen after modifying hours if our server and exchange are in different timezones
                // also copy year and month in case they wrap too
                date.setFullYear(originalDate.getFullYear(), originalDate.getMonth(), originalDate.getDate())
            }
            if (date.getTime() > Date.now()+3000) { // add some offset or else the comparison gives false positives on a connection with fast pings
                logger.warn("Received date from %s is greater than now: %s - resetting to now", this.className, utils.getUnixTimeStr(true, date))
                date = new Date()
            }
        }
        return date;
    }

    protected sendNotification(headline: string, text: string = "-", requireConfirmation = true) {
        // note that pushover won't accept empty message text
        const pauseMs = nconf.get('serverConfig:notificationPauseMin') * utils.constants.MINUTE_IN_SECONDS * 1000;
        if (this.lastNotification && this.lastNotification.getTime() + pauseMs > Date.now())
            return;
        headline = this.className + ": " + headline;
        let notification = new Notification(headline, text, requireConfirmation);
        this.notifier.send(notification).then(() => {
        }).catch((err) => {
            logger.error("Error sending %s notification", this.className, err)
        });
        this.lastNotification = new Date();
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
            logger.error('failed to load module: ' + modulePath, e)
            return null
        }
    }
}

// force loading dynamic imports for TypeScript
import "./Bitfinex";
import "./Bittrex";
import "./GDAX";
import "./HistoryDataExchange";
import "./Kraken";
import "./OKCoin";
import "./OKEX";
import "./Poloniex";
import {ClientOptions} from "ws";