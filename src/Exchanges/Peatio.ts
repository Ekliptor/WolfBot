
// https://github.com/rubykube/peatio
// https://demo.openware.com/
// https://gist.github.com/ec/c3ac3364022ca0257dcc80994bc4fe3a
// https://github.com/rubykube/arke/blob/master/lib/arke/exchange/rubykube.rb

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
import * as crypto from "crypto";

const logger = utils.logger
    , nconf = utils.nconf;

export class PeatioCurrencies implements Currency.ExchangeCurrencies {
    protected exchange: AbstractExchange;

    constructor(exchange: AbstractExchange) {
        this.exchange = exchange;
    }

    public getExchangeName(localCurrencyName: string): string {
        return localCurrencyName.toLowerCase()
    }
    public getLocalName(exchangeCurrencyName: string): string {
        return exchangeCurrencyName.toUpperCase()
    }

    public getExchangePair(localPair: Currency.CurrencyPair): string {
        let str1 = Currency.Currency[localPair.from]
        let str2 = Currency.Currency[localPair.to]
        if (!str1 || !str2)
            return undefined;
        return (str2 + str1).toLowerCase(); // ethusd
    }
    public getLocalPair(exchangePair: string): Currency.CurrencyPair {
        // no currency pair separator, some currencies have 3 and some 4 chars
        let cur1 = null, cur2 = null;
        const max = Math.max(exchangePair.length, 5);
        for (let i = 3; i < max; i++)
        {
            cur1 = Currency.Currency[exchangePair.substr(0, i).toUpperCase()]
            cur2 = Currency.Currency[exchangePair.substr(i).toUpperCase()]
            if (cur1 && cur2)
                break;
        }
        if (!cur1 || !cur2)
            return undefined;
        return new Currency.CurrencyPair(cur2, cur1) // pairs are reversed -> USD_ETH
    }
    public toLocalTicker(exchangeTicker: any): Ticker.Ticker {
        let ticker = new Ticker.Ticker(this.exchange.getExchangeLabel());
        ticker.last = Ticker.Ticker.parseNumber(exchangeTicker.last);
        ticker.lowestAsk = Ticker.Ticker.parseNumber(exchangeTicker.sell);
        ticker.highestBid = Ticker.Ticker.parseNumber(exchangeTicker.buy);
        if (exchangeTicker.price_change_percent)
            ticker.percentChange = Ticker.Ticker.parseNumber(exchangeTicker.price_change_percent.replace(/[^0-9]+\./, ""));
        ticker.baseVolume = Ticker.Ticker.parseNumber(exchangeTicker.volume);
        ticker.quoteVolume = ticker.baseVolume * ticker.last;
        //ticker.isFrozen = ticker.last === 0; // since it's currently a demo version values are often 0
        ticker.isFrozen = false;
        ticker.high24hr = Ticker.Ticker.parseNumber(exchangeTicker.high);
        ticker.low24hr = Ticker.Ticker.parseNumber(exchangeTicker.low);
        return ticker;
    }
}

export default class Peatio extends AbstractExchange {
    protected static readonly PING_INTERVAL_MS = 15000;
    //protected apiClient: any;

    constructor(options: ExOptions) {
        super(options)
        this.publicApiUrl = this.apiKey.domain; // https://demo.openware.com/peatio/market/orders
        this.privateApiUrl = this.apiKey.domain;
        const wsDomain = this.apiKey.domain.replace(/^https?/i, "wss");
        //this.pushApiUrl = wsDomain + "api/v2/ranger/public/?stream=global.tickers"; // wss://demo.openware.com/api/v2/ranger/public/?stream=global.tickers
        this.pushApiUrl = wsDomain + "api/v2/ranger/private/?stream=ethusd.trades&stream=ethusd.update&stream=global.tickers&stream=order&stream=trade";
        // wss://demo.openware.com/api/v2/ranger/private/?stream=ethusd.trades&stream=ethusd.update&stream=global.tickers&stream=order&stream=trade
        this.pushApiConnectionType = PushApiConnectionType.WEBSOCKET;
        this.httpKeepConnectionsAlive = true;
        this.dateTimezoneSuffix = "";
        this.exchangeLabel = Currency.Exchange.PEATIO;
        this.minTradingValue = 0.001; // TODO fees and trading value. supply via options in constructor?
        this.fee = 0.001;
        this.maxLeverage = 0.0; // no margin trading
        this.currencies = new PeatioCurrencies(this);
        this.webSocketTimeoutMs = nconf.get('serverConfig:websocketTimeoutMs')*3; // small coin markets -> less updates
    }

    public async getTicker(): Promise<Ticker.TickerMap> {
        // we load trade prices via websocket and return the data here
        // TODO do they have a ticker HTTP api?
        return this.ticker;
    }

    public async getBalances(): Promise<Currency.LocalCurrencyList> {
        // GET https://demo.openware.com/api/v2/peatio/account/balances
        let options = this.getHttpOptions(this.getAuthHeaders());
        this.get(this.privateApiUrl + "api/v2/peatio/account/balances", (body, res) => {
            console.log(res.statusCode, body)
            let balances = {}
        }, options);
        return;

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
        // we get the book via websocket and return it here
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
            reject({txt: "Importing trade history for backtesting is not yet supported on this exchange."}); // TODO what's their HTTP api call for this?
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
        return this.binanceCCxt.buy(currencyPair, rate, amount, params);
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
        return this.binanceCCxt.sell(currencyPair, rate, amount, params);
    }

    public cancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string): Promise<CancelOrderResult> {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            let options = this.getHttpOptions(this.getAuthHeaders());
            const orderUrl = this.privateApiUrl + utils.sprintf("peatio/market/orders/%s/cancel", orderNumber);
            this.post(orderUrl, {}, (body, res) => {
                console.log(body)
            }, options);
        })
    }
        /*const marketPair = this.currencies.getExchangePair(currencyPair);
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
            if (err && err.toString().indexOf("UNKNOWN_ORDER") !== -1)
                return successResult; // already cancelled or filled
            throw this.formatInvalidExchangeApiResponse(err);
        }
    }*/

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

    public marginBuy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "Margin trading is not supported.", exchange: this.className})
        })
    }

    public marginSell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "Margin trading is not supported.", exchange: this.className})
        })
    }

    public marginCancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            reject({txt: "Margin trading is not supported.", exchange: this.className})
        })
    }

    public moveMarginOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "Margin trading is not supported.", exchange: this.className})
        })
    }

    public getAllMarginPositions() {
        return new Promise<MarginPositionList>((resolve, reject) => {
            reject({txt: "Margin trading is not supported.", exchange: this.className})
        })
    }

    public getMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<MarginPosition>((resolve, reject) => {
            reject({txt: "Margin trading is not supported.", exchange: this.className})
        })
    }

    public closeMarginPosition(currencyPair: Currency.CurrencyPair) {
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
        let wsOptions = this.getWebsocketOptions();
        wsOptions.headers = this.getAuthHeaders().headers;
        let conn: WebSocket = new WebSocket(this.pushApiUrl, wsOptions);
        conn.onopen = (e) => {
            logger.info("WebSocket connection to %s established", this.className);
            this.scheduleWebsocketPing(() => { // TODO arke calls this? get '/barong/identity/ping'
                conn.send(JSON.stringify({}));
            }, Peatio.PING_INTERVAL_MS);
        }

        conn.onmessage = (e) => {
            console.log("MSG", e.data)
            let processed = false;
            let json = utils.parseJson(e.data);
            if (json["global.tickers"]) {
                this.processTickerMessage(json["global.tickers"]);
                processed = true;
            }
            if (processed === false)
                processed = this.processOrderbookMessage(json);
            if (json["success"]) {
                logger.verbose("Received success WebSocket message from %s", this.className);
                processed = true;
            }
            if (processed === false)
                logger.warn("Received unknown %s WebSocket message", this.className, json);
        }

        conn.onerror = (err) => {
            logger.error("WebSocket error in %s", this.className, err);
            this.closeConnection("WebSocket error")
        }

        conn.onclose = (event) => {
            let reason = "Unknown error";
            if (event && event.reason)
                reason = event.reason;
            this.onConnectionClose(reason);
        }

        return conn;
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

    protected processTickerMessage(json: any) {
        //let currencyPair = this.currencies.getLocalPair(json)
        this.currencyPairs.forEach((pair) => {
            let exchangePair = this.currencies.getExchangePair(pair);
            let tickerObj = this.currencies.toLocalTicker(json[exchangePair]);
            if (!tickerObj)
                return;
            tickerObj.currencyPair = pair;
            this.ticker.set(pair.toString(), tickerObj);
        });
    }

    protected processOrderbookMessage(json: any): boolean {
        let found = false;
        this.currencyPairs.forEach((pair) => {
            let exchangePair = this.currencies.getExchangePair(pair);
            const key = exchangePair + ".update";
            if (!json[key])
                return;
            ["asks", "bids"].forEach((side) => {
                json[key][side].forEach((rawOrder) => {
                    console.log("ORDER", rawOrder)
                });
            });
        });
        return found;
    }

    protected processTradeMessage(json: any): boolean {
        let found = false;
        return found;
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
                market: this.currencies.getExchangePair(currencyPair),
                //side: // added after
                volume: Math.abs(amount),
                price: rate
            }
            resolve(outParams)
        })
    }

    protected verifyExchangeResponse(body: string | false, response: request.RequestResponse, method: string) {
        return new Promise<any>((resolve, reject) => {
            return reject({txt: "verifyExchangeResponse is not implemented", exchange: this.className})
        })
    }

    protected getAuthHeaders() {
        const nonce = Date.now();
        const sign = crypto.createHmac('SHA256', this.apiKey.secret);
        sign.update(nonce + this.apiKey.key);
        return {
            headers: {
                "X-Auth-Apikey": this.apiKey.key,
                "X-Auth-Nonce": nonce.toString(),
                "X-Auth-Signature": sign.digest('hex'),
                //"Content-Type": "application/json" // shouldn't be needed. actually a HTTP response header
            }
        }
    }

    protected formatInvalidExchangeApiResponse(err: any): any {
        if (err) {
            let permanent = true; // TODO check for below min trading balance etc..
            return {
                txt: "Invalid API response",
                err: err ? JSON.stringify(err) : err, // as err object it's often not passed along
                permanent: permanent
            };
        }
        return {err: "unknown error"};
    }
}