
// https://github.com/binance-exchange/binance-api-node

import * as utils from "@ekliptor/apputils";
import {
    AbstractExchange,
    CancelOrderResult,
    ExOptions,
    ExRequestParams,
    ExResponse,
    MarginOrderParameters,
    OpenOrder,
    OpenOrders,
    OrderBookUpdate,
    OrderParameters,
    PushApiConnectionType
} from "./AbstractExchange";
import {OrderResult} from "../structs/OrderResult";
import {MarginPosition, MarginPositionList} from "../structs/MarginPosition";
import MarginAccountSummary from "../structs/MarginAccountSummary";
import * as WebSocket from "ws";
import * as request from "request";
import * as db from "../database";
import * as helper from "../utils/helper";
import {MarketOrder, Ticker, Trade, TradeHistory, Currency} from "@ekliptor/bit-models";
import {default as BinanceAPI} from 'binance-api-node';
import {ExternalTickerExchange} from "./ExternalTickerExchange";
import BinanceCcxt from "./BinanceCcxt";
import {CcxtOrderParameters} from "./CcxtExchange";

const logger = utils.logger
    , nconf = utils.nconf;


class LastTradePriceMap extends Map<string, number> { // (local currency string, price)
    constructor() {
        super()
    }
}

export class BinanceCurrencies implements Currency.ExchangeCurrencies, Currency.ExternalExchangeTicker {
    protected exchange: AbstractExchange;

    constructor(exchange: AbstractExchange) {
        this.exchange = exchange;
    }

    public getExchangeName(localCurrencyName: string): string {
        if (localCurrencyName === "BCH")
            return "BCC";
        return localCurrencyName
    }
    public getLocalName(exchangeCurrencyName: string): string {
        if (exchangeCurrencyName === "BCC")
            return "BCH";
        return exchangeCurrencyName
    }

    public getExchangePair(localPair: Currency.CurrencyPair): string {
        let str1 = Currency.Currency[localPair.from]
        let str2 = Currency.Currency[localPair.to]
        if (!str1 || !str2)
            return undefined;
        return str2 + str1 // BTCLTC // pairs are reversed as on other exchanges. str2 before str1
    }
    public getLocalPair(exchangePair: string): Currency.CurrencyPair {
        //let cur1 = Currency.Currency[exchangePair.substr(0, 3)]
        //let cur2 = Currency.Currency[exchangePair.substr(3)]
        // STRATBTC has a 5 and a 3 length currency
        let cur1 = null, cur2 = null;
        const max = Math.max(exchangePair.length, 5);
        for (let i = 3; i < max; i++)
        {
            cur1 = Currency.Currency[exchangePair.substr(0, i)]
            cur2 = Currency.Currency[exchangePair.substr(i)]
            if (cur1 && cur2)
                break;
        }
        if (!cur1 || !cur2)
            return undefined;
        return new Currency.CurrencyPair(cur2, cur1) // pairs are reversed
    }
    public toLocalTicker(exchangeTicker: any): Ticker.Ticker {
        let ticker = new Ticker.Ticker(this.exchange.getExchangeLabel());
        ticker.currencyPair = this.getLocalPair(exchangeTicker.symbol);
        if (!ticker.currencyPair)
            return undefined; // we don't support this pair
        ticker.last = Ticker.Ticker.parseNumber(exchangeTicker.lastPrice);
        ticker.lowestAsk = Ticker.Ticker.parseNumber(exchangeTicker.askPrice);
        ticker.highestBid = Ticker.Ticker.parseNumber(exchangeTicker.bidPrice);
        ticker.percentChange = Ticker.Ticker.parseNumber(exchangeTicker.priceChangePercent);
        ticker.baseVolume = Ticker.Ticker.parseNumber(exchangeTicker.volume);
        ticker.quoteVolume = Ticker.Ticker.parseNumber(exchangeTicker.quoteVolume);
        ticker.isFrozen = ticker.last === 0;
        ticker.high24hr = Ticker.Ticker.parseNumber(exchangeTicker.highPrice);
        ticker.low24hr = Ticker.Ticker.parseNumber(exchangeTicker.lowPrice);
        return ticker;
    }
    public toExternalTicker(exchangeTicker: any): Ticker.ExternalTicker {
        let ticker = new Ticker.ExternalTicker(this.exchange.getExchangeLabel());
        ticker.currencyPair = exchangeTicker.symbol;
        ticker.last = Ticker.Ticker.parseNumber(exchangeTicker.lastPrice);
        ticker.lowestAsk = Ticker.Ticker.parseNumber(exchangeTicker.askPrice);
        ticker.highestBid = Ticker.Ticker.parseNumber(exchangeTicker.bidPrice);
        ticker.percentChange = Ticker.Ticker.parseNumber(exchangeTicker.priceChangePercent);
        ticker.baseVolume = Ticker.Ticker.parseNumber(exchangeTicker.volume);
        ticker.quoteVolume = Ticker.Ticker.parseNumber(exchangeTicker.quoteVolume);
        ticker.isFrozen = ticker.last === 0;
        ticker.high24hr = Ticker.Ticker.parseNumber(exchangeTicker.highPrice);
        ticker.low24hr = Ticker.Ticker.parseNumber(exchangeTicker.lowPrice);
        return ticker;
    }
}

export default class Binance extends AbstractExchange implements ExternalTickerExchange {
    protected apiClient: /*BinanceAPI*/any; // TODO wait for typings update
    protected lastTradePrice = new LastTradePriceMap();
    protected binanceCCxt: BinanceCcxt; // this library updates binance LOT/tick sizes, so use it for buying/selling

    constructor(options: ExOptions) {
        super(options)
        this.publicApiUrl = "https://API";
        this.privateApiUrl = "https://API";
        this.pushApiUrl = "wss://API";
        this.pushApiConnectionType = PushApiConnectionType.WEBSOCKET;
        this.httpKeepConnectionsAlive = true;
        this.dateTimezoneSuffix = "";
        this.exchangeLabel = Currency.Exchange.BINANCE;
        this.minTradingValue = 0.001; // https://support.binance.com/hc/en-us/articles/115000594711-Trading-Rule
        this.fee = 0.001; // https://support.binance.com/hc/en-us/articles/115000429332-Fee-Structure-on-Binance
        this.maxLeverage = 0.0; // now supports margin // TODO ??
        this.currencies = new BinanceCurrencies(this);
        this.webSocketTimeoutMs = nconf.get('serverConfig:websocketTimeoutMs')*2; // small coin markets -> less updates

        this.apiClient = BinanceAPI({
            apiKey: this.apiKey.key,
            apiSecret: this.apiKey.secret
        });
        this.binanceCCxt = new BinanceCcxt(options);
        this.binanceCCxt.setPollTrades(false);
    }

    public async getTicker(): Promise<Ticker.TickerMap> {
        let map = new Ticker.TickerMap()
        let fetchOps = [];
        if (this.currencyPairs.length === 1) {
            let marketPair = this.currencies.getExchangePair(this.currencyPairs[0]);
            try {
                let stats = await this.apiClient.dailyStats({symbol: marketPair});
                const tickerObj = this.currencies.toLocalTicker(stats)
                if (tickerObj)
                    map.set(tickerObj.currencyPair.toString(), tickerObj)
            }
            catch (err) {
                logger.error("Error fetching %s %s ticker stats", this.className, this.currencyPairs[0].toString(), err)
            }
        }
        else {
            try {
                let allStats = await this.apiClient.dailyStats({});
                allStats.forEach((stats) => {
                    const tickerObj = this.currencies.toLocalTicker(stats)
                    if (tickerObj)
                        map.set(tickerObj.currencyPair.toString(), tickerObj)
                });
            }
            catch (err) {
                logger.error("Error fetching all %s ticker stats", this.className, err)
            }
        }
        return map;
    }

    public async getExternalTicker(requiredCurrencies: string[]): Promise<Ticker.ExternalTickerMap> {
        let map = new Ticker.ExternalTickerMap()
        /*
        let fetchOps = [];
        let allPrices = await this.apiClient.prices();
        let exchangePairs: string[] = Object.keys(allPrices);
        exchangePairs = filterCurrencyPairs(exchangePairs, requiredCurrencies);
        exchangePairs.forEach((marketPair) => { // we have to fetch each currency ticker separately - even though their doc says differently
            fetchOps.push((resolve) => {
                this.apiClient.dailyStats({symbol: marketPair}).then((stats) => {
                    if (!Currency.isExternalExchangeTicker(this.currencies))
                        return;
                    const tickerObj = this.currencies.toExternalTicker(stats)
                    if (tickerObj)
                        map.set(tickerObj.currencyPair.toString(), tickerObj)
                    resolve()
                }).catch((err) => {
                    logger.error("Error fetching %s %s ticker stats", this.className, marketPair, err)
                    resolve()
                })
            });
        })
        let asyncPromise = new Promise((resolve, reject) => {
            async.parallelLimit(fetchOps, 3, (err, results) => {
                if (err)
                    return reject(err);
                resolve();
            })
        })
        await asyncPromise;
        */
        try {
            let allStats = await this.apiClient.dailyStats({});
            allStats.forEach((stats) => {
                if (!Currency.isExternalExchangeTicker(this.currencies))
                    return;
                const tickerObj = this.currencies.toExternalTicker(stats)
                if (tickerObj) {
                    const currencyStr = tickerObj.currencyPair.toString();
                    //if (requiredCurrencies.indexOf(currencyStr) !== -1) // we use exchange names here
                        map.set(tickerObj.currencyPair.toString(), tickerObj)
                }
            });
        }
        catch (err) {
            logger.error("Error fetching all %s ticker stats", this.className, err)
        }
        return map;
    }

    public async getBalances(): Promise<Currency.LocalCurrencyList> {
        try {
            let balances = {}
            let accountInfo = await this.apiClient.accountInfo({useServerTime: true});
            accountInfo.balances.forEach((balance) => {
                let currencyStr = this.currencies.getLocalName(balance.asset)
                if (!currencyStr)
                    return; // not supported currency
                balances[currencyStr] = helper.parseFloatVal(balance.free)
            })
            return Currency.fromExchangeList(balances, this.currencies);
        }
        catch (err) {
            throw this.formatInvalidExchangeApiResponse(err);
        }
    }

    public getMarginAccountSummary() {
        return new Promise<MarginAccountSummary>((resolve, reject) => {
            reject({txt: "Margin trading is not supported.", exchange: this.className})
        })
    }

    public async fetchOrderBook(currencyPair: Currency.CurrencyPair, depth: number): Promise<OrderBookUpdate<MarketOrder.MarketOrder>> {
        try {
            const pairStr = this.currencies.getExchangePair(currencyPair)
            let orderBook = await this.apiClient.book({symbol: pairStr}); // "depth" param not supported
            let orders = new OrderBookUpdate<MarketOrder.MarketOrder>(orderBook.lastUpdateId, false);
            ["asks", "bids"].forEach((prop) => {
                orderBook[prop].forEach((o) => {
                    // { price: '0.05411500', quantity: '5.55000000' }
                    const amount = helper.parseFloatVal(o.quantity);
                    const price = helper.parseFloatVal(o.price);
                    let order = MarketOrder.MarketOrder.getOrder(currencyPair, this.getExchangeLabel(), amount, price)
                    order.date = new Date(); // no data provided, set to now
                    orders[prop].push(order)
                })
            })
            return orders;
        }
        catch (err) {
            throw this.formatInvalidExchangeApiResponse(err);
        }
    }

    public importHistory(currencyPair: Currency.CurrencyPair, start: Date, end: Date) {
        return new Promise<void>((resolve, reject) => {
            const pairStr = this.currencies.getExchangePair(currencyPair)
            const startMs = start.getTime();
            const endMs = end.getTime();
            let currentMs = startMs;
            let tradeCount = 0;
            //let stepCount = 1000;
            let stepMs = 60 * utils.constants.MINUTE_IN_SECONDS * 1000; // 1h is max step size
            let queryIntervalMs = 400;
            let onFinish = () => {
                logger.info("Import of %s %s history has finished. Imported %s trades until %s", this.className, currencyPair.toString(), tradeCount, utils.date.toDateTimeStr(new Date(currentMs)))
                let history = new TradeHistory.TradeHistory(currencyPair, this.getExchangeLabel(), start, end);
                if (tradeCount !== 0)
                    TradeHistory.addToHistory(db.get(), history)
                return resolve();
            }

            let importNext = async () => {
                if (currentMs > endMs + stepMs) {
                    return onFinish();
                }
                let retryError = (err) => {
                    logger.warn("Error importing %s trades", this.className, err)
                    const errStr = err ? err.toString() : "";
                    let rateLimitError = false; // TODO error handling
                    if (rateLimitError)
                        queryIntervalMs += 100;
                    setTimeout(importNext.bind(this), rateLimitError ? 60000 : 5000); // retry
                }
                try {
                    let rawTrades = await this.apiClient.aggTrades({
                        symbol: pairStr,
                        startTime: currentMs,
                        endTime: currentMs + stepMs
                    });
                    let trades = [];
                    rawTrades.forEach((rawTrade) => {
                        trades.push(this.fromRawTrade(rawTrade, currencyPair))
                    })
                    tradeCount += trades.length;
                    Trade.storeTrades(db.get(), trades, (err) => {
                        if (err)
                            logger.error("Error storing trades", err)
                        currentMs = trades.length > 0 ? trades[trades.length-1].date.getTime()+1 : currentMs + stepMs;
                        logger.verbose("%s %s import at %s with %s trades", this.className, currencyPair.toString(), utils.date.toDateTimeStr(new Date(currentMs)), tradeCount)
                        setTimeout(importNext.bind(this), queryIntervalMs) // avoid hitting the rate limit -> temporary ban
                    })
                }
                catch (err) {
                    retryError(err);
                }
            }
            importNext();
        })
    }

    public async buy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}): Promise<OrderResult> {
        // call CCXT library for buying/selling to always have the correct lot size
        /*
        let outParams = await this.verifyTradeRequest(currencyPair, rate, amount, params)
        try {
            let buyParams = {
                useServerTime: true,
                symbol: outParams.pairStr,
                side: "BUY",
                quantity: this.getMaxTradeDecimals(amount, currencyPair, true),
                price: this.getMaxTradeDecimals(outParams.rate as number, currencyPair),
                type: outParams.orderType
            }
            let result = await this.apiClient.order(buyParams);
            return OrderResult.fromJson(result, currencyPair, this)
        }
        catch (err) {
            throw this.formatInvalidExchangeApiResponse(err);
        }
         */
        let binanceParams = this.addBinanceBrokerId(params);
        return this.binanceCCxt.buy(currencyPair, rate, amount, binanceParams);
    }

    public async sell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}): Promise<OrderResult> {
        /*
        let outParams = await this.verifyTradeRequest(currencyPair, rate, amount, params)
        try {
            let result = await this.apiClient.order({
                useServerTime: true,
                symbol: outParams.pairStr,
                side: "SELL",
                quantity: this.getMaxTradeDecimals(amount, currencyPair, true),
                price: this.getMaxTradeDecimals(outParams.rate as number, currencyPair),
                type: outParams.orderType
            });
            return OrderResult.fromJson(result, currencyPair, this)
        }
        catch (err) {
            throw this.formatInvalidExchangeApiResponse(err);
        }
         */
        let binanceParams = this.addBinanceBrokerId(params);
        return this.binanceCCxt.sell(currencyPair, rate, amount, binanceParams);
    }

    public async cancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string): Promise<CancelOrderResult> {
        const marketPair = this.currencies.getExchangePair(currencyPair);
        const successResult = {exchangeName: this.className, orderNumber: orderNumber, cancelled: true};
        try {
            let result = await this.apiClient.cancelOrder({
                useServerTime: true,
                symbol: marketPair,
                orderId: orderNumber
            });
            return successResult;
        }
        catch (err) {
            if (err) {
                const errStr = err.toString();
                // https://github.com/binance-exchange/binance-official-api-docs/blob/master/errors.md#messages-for--1010-error_msg_received--2010-new_order_rejected-and--2011-cancel_rejected
                if (errStr.indexOf("UNKNOWN_ORDER") !== -1 || errStr.indexOf("-2011") !== -1)
                return successResult; // already cancelled or filled
            }
            throw this.formatInvalidExchangeApiResponse(err);
        }
    }

    public async getOpenOrders(currencyPair: Currency.CurrencyPair): Promise<OpenOrders> {
        const marketPair = this.currencies.getExchangePair(currencyPair);
        try {
            let result = await this.apiClient.openOrders({
                useServerTime: true,
                symbol: marketPair
            });
            let orders = new OpenOrders(currencyPair, this.className);
            result.forEach((o) => {
                /**
                 * { symbol: 'TRXBTC',
                    orderId: 25958249,
                    clientOrderId: 'jhn1e3pr0sx6trWQHNU8RN',
                    price: '0.00000623',
                    origQty: '350.00000000',
                    executedQty: '0.00000000',
                    status: 'NEW',
                    timeInForce: 'GTC',
                    type: 'LIMIT',
                    side: 'SELL',
                    stopPrice: '0.00000000',
                    icebergQty: '0.00000000',
                    time: 1517420761511,
                    isWorking: true }
                 */
                let orderObj = {
                    orderNumber: o.orderId,
                    type: (o.side === "BUY" ? "buy": "sell") as any, // TODO why do we need this cast?
                    rate: parseFloat(o.price),
                    amount: parseFloat(o.origQty) - parseFloat(o.executedQty), // return the remaining amount
                    total: 0,
                    leverage: 1
                }
                orderObj.total = orderObj.rate * orderObj.amount;
                orders.addOrder(orderObj)
            })
            return orders;
        }
        catch (err) {
            throw this.formatInvalidExchangeApiResponse(err);
        }
    }

    public async moveOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: OrderParameters): Promise<OrderResult> {
        // no API call for it. cancel the order and place it again
        let outParams = await this.verifyTradeRequest(currencyPair, rate, amount, params);
        try {
            let orders = await this.getOpenOrders(currencyPair);
            if (!orders.isOpenOrder(orderNumber))
                return OrderResult.fromJson({message: "Order already filled"}, currencyPair, this);
            let order: OpenOrder = orders.getOrder(orderNumber);
            let cancelResult = await this.cancelOrder(currencyPair, order.orderNumber);
            if (!cancelResult) // can't happen?
                throw this.formatInvalidExchangeApiResponse(cancelResult);

            // now place the (modified) order again
            if (Math.abs(amount) < 0.01) // remaining amount too low: erro -1013 LOT SIZE
                return OrderResult.fromJson({message: "Order already filled (remaining amount too low)"}, currencyPair, this);
            let orderResult: OrderResult;
            if (order.type === "buy")
                orderResult = await this.buy(currencyPair, rate, amount, params)
            else
                orderResult = await this.sell(currencyPair, rate, amount, params)
            return orderResult;
        }
        catch (err) {
            throw this.formatInvalidExchangeApiResponse(err);
        }
    }

    public async marginBuy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters): Promise<OrderResult> {
        /*
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "Margin trading is not supported.", exchange: this.className})
        })*/
        //return this.binanceCCxt.sell(currencyPair, rate, amount, params);
        //return this.binanceCCxt.getApiClient.(currencyPair, rate, amount, params);
        if (this.binanceCCxt.getCurrencies().isSwitchedCurrencyPair() === true)
            amount *= rate;
        let binanceParams = this.addBinanceBrokerId(params);
        let outParams = await this.verifyTradeRequest(currencyPair, rate, amount, binanceParams)
        //return this.binanceCCxt.getApiClient().sapiPostMarginOrder(outParams.pairStr as string, outParams.orderType as any, "buy", Math.abs(amount), outParams.rate as number);
        return this.binanceCCxt.getApiClient().sapiPostMarginOrder({
            symbol: outParams.pairStr as string,
            type: outParams.orderType as any,
            side: "BUY",
            quantity: Math.abs(amount),
            price: outParams.rate as number,
            newClientOrderId: binanceParams.newClientOrderId
        });
    }

    public async marginSell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters): Promise<OrderResult> {
        if (this.binanceCCxt.getCurrencies().isSwitchedCurrencyPair() === true)
            amount /= rate;
        let binanceParams = this.addBinanceBrokerId(params);
        let outParams = await this.verifyTradeRequest(currencyPair, rate, amount, binanceParams)
        return this.binanceCCxt.getApiClient().sapiPostMarginOrder({
            symbol: outParams.pairStr as string,
            type: outParams.orderType as any,
            side: "SELL",
            quantity: Math.abs(amount),
            price: outParams.rate as number,
            newClientOrderId: binanceParams.newClientOrderId
        });
    }

    public marginCancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string): Promise<CancelOrderResult> {
        return this.cancelOrder(currencyPair, orderNumber); // TODO really same?
    }

    public moveMarginOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: MarginOrderParameters): Promise<OrderResult> {
        return this.moveMarginOrder(currencyPair, orderNumber, rate, amount, params); // TODO really same?
    }

    public getAllMarginPositions(): Promise<MarginPositionList> {
        return new Promise<MarginPositionList>((resolve, reject) => {
            reject({txt: "Margin trading is not supported.", exchange: this.className})
        })
    }

    public getMarginPosition(currencyPair: Currency.CurrencyPair): Promise<MarginPosition> {
        return new Promise<MarginPosition>((resolve, reject) => {
            reject({txt: "Margin trading is not supported.", exchange: this.className})
        })
    }

    public closeMarginPosition(currencyPair: Currency.CurrencyPair): Promise<OrderResult> {
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "Margin trading is not supported.", exchange: this.className})
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected publicReq(method: string, params: ExRequestParams = {}) {
        return new Promise<ExResponse>((resolve, reject) => {
            //if (!this.publicApiUrl)
            return reject({txt: "PublicApiUrl must be provided for public exchange request", exchange: this.className})
        })
    }

    protected privateReq(method: string, params: ExRequestParams = {}) {
        return new Promise<ExResponse>((resolve, reject) => {
            this.requestQueue = this.requestQueue.then(() => { // only do 1 request at a time because of nonce
                return new Promise((resolve, reject) => {
                    //if (!this.privateApiUrl || !this.apiKey)
                    return reject({txt: "PrivateApiUrl and apiKey must be provided for private exchange request", exchange: this.className})
                })
            }).then((res) => {
                resolve(res) // forward the result
            }).catch((err) => {
                reject(err) // forward the error
            })
        })
    }

    protected createWebsocketConnection(): WebSocket {
        // TODO error handler not available? also no disconnect event, so we only have our timeout
        // TODO ticker is available here too, but pushed every second = too often?
        let subscribePairs = []
        this.currencyPairs.forEach((pair) => {
            let marketPair = this.currencies.getExchangePair(pair);
            subscribePairs.push(marketPair)
        })
        let fetchOrderbookSnapshot = () => {
            // in case our websocket stream starts before we got the snapshot, old updates before the snapshot will be ignored by seq nr
            this.updateOrderBooks(true).then(() => {
                logger.verbose("%s %s order book snapshots ready", this.orderBook.size, this.className)
            }).catch((err) => {
                logger.error("Error polling %s order book snapshots", this.className, err)
                setTimeout(fetchOrderbookSnapshot.bind(this), 5000); // retry
            })
        }
        fetchOrderbookSnapshot();

        try {
            let cleanDepth = this.apiClient.ws.depth(subscribePairs, (depth) => {
                this.localSeqNr = depth.updateId; // use ids from server
                const localPair = this.currencies.getLocalPair(depth.symbol);
                if (!localPair) {
                    logger.warn("Received %s WebSocket orderbook data for unknown pair %s", this.className, depth.symbol);
                    return;
                }
                this.resetWebsocketTimeout(); // reset it also on orderbook updates as on Binance many users trade minor coins with very few trades

                let orderModifications = [];
                ["bidDepth", "askDepth"].forEach((prop) => {
                    depth[prop].forEach((o) => {
                        // { price: '0.11031700', quantity: '31.71000000' }
                        // quantity can be 0 which means remove the entry from orderbook
                        // otherwise always remove the max amount and add the new quantity
                        orderModifications.push(["o", 0, o.price, Number.MAX_VALUE]) // remove the max amount from bids/asks
                        orderModifications.push(["o", 1, o.price, o.quantity])
                    })
                });
                this.marketStream.write(localPair, orderModifications, this.localSeqNr);
            })
            let cleanTrades = this.apiClient.ws.trades(subscribePairs, (trade) => {
                /**
                 * { eventType: 'aggTrade',
                      eventTime: 1517423771624,
                      symbol: 'TRXBTC',
                      price: '0.00000536',
                      quantity: '3800.00000000',
                      maker: true,
                      tradeId: 9821793 }
                 */
                this.resetWebsocketTimeout();
                const localPair = this.currencies.getLocalPair(trade.symbol);
                if (!localPair) {
                    logger.warn("Received %s WebSocket trade data for unknown pair %s", this.className, trade.symbol);
                    return;
                }
                let tradeObj = this.fromRawTrade(trade, localPair);
                this.marketStream.write(localPair, [tradeObj], this.localSeqNr); // TODO increment localSeqNr? seqNr only used for orderbook either way
            })
            this.websocketCleanupFunction = () => {
                try {
                    cleanDepth(); // clean is sync
                }
                catch (err) {
                    logger.error("Error cleaning up %s orderbook websocket connection", this.className)
                }
                try {
                    cleanTrades();
                }
                catch (err) {
                    logger.error("Error cleaning up %s trade websocket connection", this.className)
                }
                return true;
            }
        }
        catch (err) {
            // unable to catch this crash on connect. we could try to see if we have a connection via ping, but that's an ugly workaround
            // see https://github.com/HyperCubeProject/binance-api-node/issues/24 - fixed since v0.6.0
            /**
             * 2018-02-01 02:21:55 - warn: Uncaught Exception
             2018-02-01 02:21:55 - warn:  Error: getaddrinfo ENOTFOUND stream.binance.com stream.binance.com:9443
             at errnoException (dns.js:55:10)
             at GetAddrInfoReqWrap.onlookup [as oncomplete] (dns.js:97:26)
             */
            logger.error("Error opening %s websocket connection", this.className, err)
            this.closeConnection("Unable to connect")
            return null;
        }
        return this.apiClient.ws;
    }

    protected fromRawTrade(rawTrade: any, currencyPair: Currency.CurrencyPair) {
        let tradeObj = new Trade.Trade();
        tradeObj.tradeID = rawTrade.aggId ? rawTrade.aggId : rawTrade.tradeId;
        tradeObj.date = new Date(rawTrade.timestamp ? rawTrade.timestamp : rawTrade.eventTime); // from ms
        tradeObj.amount = rawTrade.quantity;
        //tradeObj.type = rawTrade.isBuyerMaker == true ? Trade.TradeType.BUY : Trade.TradeType.SELL; // TODO correct?
        tradeObj.type = Trade.TradeType.BUY; // start with buy, updated below
        tradeObj.rate = rawTrade.price;
        tradeObj = Trade.Trade.verifyNewTrade(tradeObj, currencyPair, this.getExchangeLabel(), this.getFee())

        // their API doesn't provide if it's a buy or sell trade. so we store the last trade price locally and compare it
        // technically not correct, but close enough (and probably how they display it on their website too)
        const currencyStr = currencyPair.toString();
        let lastPrice = this.lastTradePrice.get(currencyStr)
        if (lastPrice && lastPrice > tradeObj.rate)
            tradeObj.type = Trade.TradeType.SELL; // price went down = sell
        this.lastTradePrice.set(currencyStr, tradeObj.rate);
        return tradeObj;
    }

    protected verifyTradeRequest(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<ExRequestParams>((resolve, reject) => {
            // TODO move more checks to parent class?
            if (currencyPair) {
                if (this.currencies.getExchangePair(currencyPair) === undefined)
                    return reject({txt: "Currency pair not supported by this exchange", exchange: this.className, pair: currencyPair, permanent: true});
            }
            if (amount > 0 && rate * amount < this.minTradingValue)
                return reject({txt: "Value is below the min trading value", exchange: this.className, value: rate*amount, minTradingValue: this.minTradingValue, permanent: true})

            let outParams: any = {
                dummy: "use-api-client",
                orderType: params.matchBestPrice ? "MARKET" : "LIMIT",
                pairStr: this.currencies.getExchangePair(currencyPair),
                // precision mostly 8 or 6 http://python-binance.readthedocs.io/en/latest/binance.html#binance.client.Client.get_symbol_info
                rate: this.getMaxTradeDecimals(rate, currencyPair)
            }
            resolve(outParams)
        })
    }

    protected getMaxTradeDecimals(value: number, currencyPair: Currency.CurrencyPair, isAmount = false) {
        // https://github.com/binance-exchange/binance-official-api-docs/blob/master/rest-api.md#lot_size
        let shift = 1000000.0; // 6 decimals
        //let stepSize = 0.001; // TODO more?
        //let minAmount = 0.001;
        /*if ()
            shift = 100000000.0; // 8 decimals
        else */if (currencyPair.equals(new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.WAVES)) ||
            currencyPair.equals(new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.EOS)) ||
            currencyPair.equals(new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.ONT)) ||
            // 8 or 7 ?
            currencyPair.equals(new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.XRP)) ||
            currencyPair.equals(new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.IOTA)) ||
            currencyPair.equals(new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.TRX)) ||
            currencyPair.equals(new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.ADA)))
            shift = 10000000.0; // 7 decimals
        let valueFloor = Math.floor(value * shift) / shift;
        /*
        if (isAmount === true) {
            let remainder = Math.floor(((valueFloor - minAmount) % stepSize) * shift) / shift;
            if (remainder > 0.0) {
                valueFloor -= remainder;
                valueFloor = Math.floor(valueFloor * shift) / shift;
            }
        }
        */
        if (isAmount === true)
            valueFloor = Math.floor(valueFloor * 100) / 100;
        return valueFloor;
    }

    protected verifyExchangeResponse(body: string | false, response: request.RequestResponse, method: string) {
        return new Promise<any>((resolve, reject) => {
            return reject({txt: "verifyExchangeResponse is not implemented", exchange: this.className})
        })
    }

    protected formatInvalidExchangeApiResponse(err: any): any {
        if (err) {
            let permanent = true; // TODO check for below min trading balance etc..
            return {
                txt: "Invalid API response",
                // MIN_NOTIONAL -> not enough balance, below min trading value
                // PRICE_FILTER -> below min trading value
                err: err ? JSON.stringify(err) : err, // as err object it's often not passed along
                permanent: permanent
            };
        }
        return {err: "unknown error"};
    }

    protected addBinanceBrokerId(params: CcxtOrderParameters): CcxtOrderParameters {
        if (!params)
            params = {}
        params.newClientOrderId = utils.sprintf("x-%s%s", nconf.get("serverConfig:binanceBrokerID"), utils.getRandomString(20));
        return params;
    }
}
