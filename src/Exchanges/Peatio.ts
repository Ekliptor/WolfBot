
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
        let exchangeName = localCurrencyName.toLowerCase();
        if (nconf.get("arbitrage") === true) { // for development
            if (exchangeName === "usdt")
                exchangeName = "usd";
            else if (exchangeName === "eth")
                exchangeName = "fth";
        }
        return exchangeName;
    }
    public getLocalName(exchangeCurrencyName: string): string {
        let localName = exchangeCurrencyName.toUpperCase();
        if (nconf.get("arbitrage") === true) { // for development
            if (localName === "USD")
                localName = "USDT";
            else if (localName === "FTH")
                localName = "ETH";
        }
        return localName;
    }

    public getExchangePair(localPair: Currency.CurrencyPair): string {
        let str1 = Currency.Currency[localPair.from]
        let str2 = Currency.Currency[localPair.to]
        if (!str1 || !str2)
            return undefined;
        return this.getExchangeName(str2) + this.getExchangeName(str1); // ethusd
    }
    public getLocalPair(exchangePair: string): Currency.CurrencyPair {
        // no currency pair separator, some currencies have 3 and some 4 chars
        let cur1 = null, cur2 = null;
        const max = Math.max(exchangePair.length, 5);
        for (let i = 3; i < max; i++)
        {
            const curStr1 = this.getLocalName(exchangePair.substr(0, i));
            const curStr2 = this.getLocalName(exchangePair.substr(i));
            cur1 = Currency.Currency[curStr1]
            cur2 = Currency.Currency[curStr2]
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
    protected currencies: PeatioCurrencies;
    protected orderbookSnapshot = new OrderBookUpdate<MarketOrder.MarketOrder>(Date.now(), false);
    //protected apiClient: any;
    protected lastTradeID: number = -1;

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
        return new Promise<Currency.LocalCurrencyList>((resolve, reject) => {
            let options = this.getHttpOptions(this.getAuthHeaders());
            this.get(this.privateApiUrl + "api/v2/peatio/account/balances", (body, res) => {
                let json = utils.parseJson(body);
                if (body === false || json === null)
                    return reject({txt: "Invalid response for exchange balances", err: res});
                let balances = {}
                json.forEach((balance) => { // {"currency":"eth","balance":"0.0","locked":"0.0"}
                    if (!balance.currency)
                        return;
                    let currencyStr = this.currencies.getLocalName(balance.currency);
                    if (!currencyStr)
                        return;
                    balances[currencyStr] = helper.parseFloatVal(balance.balance);
                });
                resolve(Currency.fromExchangeList(balances, this.currencies));
            }, options);
        })
    }

    public getMarginAccountSummary() {
        return new Promise<MarginAccountSummary>((resolve, reject) => {
            reject({txt: "Margin trading is not supported.", exchange: this.className})
        })
    }

    public async fetchOrderBook(currencyPair: Currency.CurrencyPair, depth: number): Promise<OrderBookUpdate<MarketOrder.MarketOrder>> {
        // we get the book via websocket and return it here
        return new Promise<OrderBookUpdate<MarketOrder.MarketOrder>>((resolve, reject) => {
            resolve(this.orderbookSnapshot)
        })
    }

    public importHistory(currencyPair: Currency.CurrencyPair, start: Date, end: Date) {
        return new Promise<void>((resolve, reject) => {
            reject({txt: "Importing trade history for backtesting is not yet supported on this exchange."}); // TODO what's their HTTP api call for this?
        })
    }

    public async buy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}): Promise<OrderResult> {
        return this.submitOrder(currencyPair, rate, amount, params, "buy");
    }

    public async sell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}): Promise<OrderResult> {
        return this.submitOrder(currencyPair, rate, amount, params, "sell");
    }

    public cancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string): Promise<CancelOrderResult> {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            let options = this.getHttpOptions(this.getAuthHeaders());
            const orderUrl = this.privateApiUrl + utils.sprintf("api/v2/peatio/market/orders/%s/cancel", orderNumber);
            this.post(orderUrl, {}, (body, res) => {
                let json = utils.parseJson(body);
                if (body === false || json === null) // res.statusCode 403 most likely means rate limit hit
                    return reject({txt: "Invalid response cancelling order", err: res});
                // just returns the order
                const cancelResult = {exchangeName: this.className, orderNumber: orderNumber, cancelled: json.state === "wait" || json.state === "cancel"};
                resolve(cancelResult);
            }, options);
        })
    }

    public async getOpenOrders(currencyPair: Currency.CurrencyPair): Promise<OpenOrders> {
        return new Promise<OpenOrders>((resolve, reject) => {
            const marketPair = this.currencies.getExchangePair(currencyPair);
            let options = this.getHttpOptions(this.getAuthHeaders());
            const orderUrl = this.privateApiUrl + utils.sprintf("api/v2/peatio/market/orders?market=%s&state=wait", marketPair);
            this.get(orderUrl, (body, res) => {
                // [{"id":8,"side":"buy","ord_type":"limit","price":"101.0","avg_price":"0.0","state":"wait","market":"ethusd","created_at":"2019-04-21T14:11:42+02:00","updated_at":"2019-04-21T14:11:42+02:00","origin_volume":"2.3",
                //  "remaining_volume":"2.3","executed_volume":"0.0","trades_count":0}, ... ]
                let json = utils.parseJson(body);
                if (body === false || json === null)
                    return reject({txt: "Invalid response for open orders", err: res});
                // just returns the order
                let orders = new OpenOrders(currencyPair, this.className);
                json.forEach((o) => {
                    let orderObj = {
                        orderNumber: o.id,
                        type: (o.side === "buy" ? "buy": "sell") as any,
                        rate: parseFloat(o.price),
                        amount: parseFloat(o.remaining_volume), // return the remaining amount
                        total: 0,
                        leverage: 1
                    }
                    orderObj.total = orderObj.rate * orderObj.amount;
                    orders.addOrder(orderObj);
                });
                resolve(orders);
            }, options);
        });
    }

    public async moveOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: OrderParameters): Promise<OrderResult> {
        // no API call for it. cancel the order and place it again
        try {
            let outParams = await this.verifyTradeRequest(currencyPair, rate, amount, params);
            let orders = await this.getOpenOrders(currencyPair);
            if (!orders.isOpenOrder(orderNumber))
                return OrderResult.fromJson({message: "Order already filled"}, currencyPair, this);
            let order: OpenOrder = orders.getOrder(orderNumber);
            let cancelResult = await this.cancelOrder(currencyPair, order.orderNumber);
            if (!cancelResult) // can't happen?
                throw this.formatInvalidExchangeApiResponse(cancelResult);

            // now place the (modified) order again
            if (Math.abs(amount) < 0.01) // also checked in verifyTradeRequest()
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
            this.scheduleWebsocketPing(() => { // TODO arke bot calls this? get '/barong/identity/ping'
                conn.send(JSON.stringify({}));
            }, Peatio.PING_INTERVAL_MS);
        }

        conn.onmessage = (e) => {
            //console.log("MSG", e.data)
            this.localSeqNr++;
            this.resetWebsocketTimeout();
            let processed = false;
            let json = utils.parseJson(e.data);
            if (json["global.tickers"]) {
                this.processTickerMessage(json["global.tickers"]);
                processed = true;
            }
            if (json["order"]) {
                // {"order":{"id":5,"at":1555840562,"market":"ethusd","kind":"bid","price":"100.0","state":"pending","remaining_volume":"2.22","origin_volume":"2.22"}}
                //logger.verbose("Received single order from %s", this.className); // we only process the full book
                processed = true;
            }
            if (json["trade"]) {
                this.processTradeMessage(json["trade"]);
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
    }

    protected processTickerMessage(json: any) {
        //let currencyPair = this.currencies.getLocalPair(json)
        this.currencyPairs.forEach((pair) => {
            let exchangePair = this.currencies.getExchangePair(pair);
            if (!exchangePair || json[exchangePair] === undefined)
                return;
            let tickerObj = this.currencies.toLocalTicker(json[exchangePair]);
            if (!tickerObj)
                return;
            tickerObj.currencyPair = pair;
            this.ticker.set(pair.toString(), tickerObj);
        });
    }

    protected processOrderbookMessage(json: any): boolean {
        let found = false; // TODO it mostly sends ethusd, but fth is never sent
        this.currencyPairs.forEach((pair) => {
            let exchangePair = this.currencies.getExchangePair(pair);
            const key = exchangePair + ".update";
            if (!json[key])
                return;
            found = true;
            //let orderModifications = [];
            this.orderbookSnapshot = new OrderBookUpdate<MarketOrder.MarketOrder>(Date.now(), false);
            ["asks", "bids"].forEach((side) => {
                json[key][side].forEach((rawOrder) => {
                    // [ '101.0', '2.3' ] <- [price, amount]
                    // quantity can be 0 which means remove the entry from orderbook
                    // otherwise always remove the max amount and add the new quantity
                    if (Array.isArray(rawOrder) === false || rawOrder.length !== 2)
                        return logger.error("Received invalid orderbook update from %s:", this.className, rawOrder);
                    //orderModifications.push(["o", 0, rawOrder[0], Number.MAX_VALUE]) // remove the max amount from bids/asks
                    //orderModifications.push(["o", 1, rawOrder[0], rawOrder[1]])
                    this.orderbookSnapshot[side].push(MarketOrder.MarketOrder.getOrder(pair, this.getExchangeLabel(), rawOrder[1], rawOrder[0]));
                });
            });
            this.orderBook.get(pair.toString()).replaceSnapshot(this.orderbookSnapshot["bids"].concat(this.orderbookSnapshot["asks"]), this.localSeqNr);
            //this.marketStream.write(pair, orderModifications, this.localSeqNr);
        });
        if (found === false) { // they send updates for other books we didn't subscribe to as well
            for (let key in json)
            {
                if (key.match("\.update$") !== null) {
                    found = true;
                    break;
                }
            }
        }
        return found;
    }

    protected processTradeMessage(json: any): boolean {
        // {"trade":{"id":3,"kind":"ask","at":1555849043,"price":"101.0","volume":"0.1","ask_id":10,"bid_id":9,"market":"fthusd"}}
        let currencyPair = this.currencies.getLocalPair(json.market);
        if (!currencyPair) {
            logger.warn("Received %s trade for unknown currency pair %s", this.className, json.market);
            return false;
        }
        if (this.lastTradeID === json.id)
            return; // they send trades multiple times
        this.lastTradeID = json.id;
        let tradeObj = this.fromRawTrade(json, currencyPair);
        this.marketStream.write(currencyPair, [tradeObj], this.localSeqNr);
        return true; // found
    }

    protected fromRawTrade(rawTrade: any, currencyPair: Currency.CurrencyPair) {
        let tradeObj = new Trade.Trade();
        tradeObj.tradeID = rawTrade.id;
        tradeObj.date = new Date(rawTrade.at * 1000); // from sec
        tradeObj.amount = rawTrade.volume;
        tradeObj.type = rawTrade.kind === "ask" ? Trade.TradeType.SELL : Trade.TradeType.BUY;
        tradeObj.rate = rawTrade.price;
        tradeObj = Trade.Trade.verifyNewTrade(tradeObj, currencyPair, this.getExchangeLabel(), this.getFee())
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

    protected submitOrder(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters, side: "buy" | "sell"): Promise<OrderResult> {
        return new Promise<OrderResult>((resolve, reject) => {
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                let options = this.getHttpOptions(this.getAuthHeaders());
                outParams.side = side;
                this.post(this.privateApiUrl + "api/v2/peatio/market/orders", outParams, (body, res) => {
                    let json = utils.parseJson(body);
                    if (body === false || json === null)
                        return reject({txt: "Invalid order response", err: res});
                    /**
                     * {"id":5,
                     * "side":"buy",
                     * "ord_type":"limit",
                     * "price":"100.0",
                     * "avg_price":"0.0",
                     * "state":"pending",
                     * "market":"ethusd",
                     * "created_at":"2019-04-21T11:56:02+02:00",
                     * "updated_at":"2019-04-21T11:56:02+02:00",
                     * "origin_volume":"2.22",
                     * "remaining_volume":"2.22",
                     * "executed_volume":"0.0",
                     * "trades_count":0}
                     */
                    if (Array.isArray(json.errors) === true && json.errors.length !== 0)
                        return Promise.reject(json.errors); // {"errors":["market.account.insufficient_balance"]}

                    let orderResult = OrderResult.fromJson(json, currencyPair, this);
                    resolve(orderResult)
                }, options);
            }).catch((err) => {
                throw this.formatInvalidExchangeApiResponse(err);
            })
        })
    }

    protected formatInvalidExchangeApiResponse(err: any): any {
        if (err) {
            let permanent = true; // TODO check for below min trading balance etc..
            return {
                txt: "Invalid API response",
                err: err && typeof err.toString === "function" ? err.toString() : JSON.stringify(err), // as err object it's often not passed along
                permanent: permanent
            };
        }
        return {err: "unknown error"};
    }
}