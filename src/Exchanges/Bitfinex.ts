// official implementation: https://github.com/bitfinexcom/bitfinex-api-node
// client docs: http://bitfinexcom.github.io/bitfinex-api-node/
// API docs: https://bitfinex.readme.io/v2/docs

import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {
    AbstractExchange,
    ExOptions,
    ExApiKey,
    OrderBookUpdate,
    OpenOrders,
    OpenOrder,
    ExRequestParams,
    ExResponse,
    OrderParameters,
    MarginOrderParameters,
    CancelOrderResult,
    PushApiConnectionType,
    AbstractExchangeCurrencies
} from "./AbstractExchange";
import {
    AbstractLendingExchange, ActiveLoan, ExchangeActiveLoanMap, LoanOffers,
    MarginLendingParams
} from "./AbstractLendingExchange";
import {OrderResult} from "../structs/OrderResult";
import {MarginPosition, MarginPositionList} from "../structs/MarginPosition";
import MarginAccountSummary from "../structs/MarginAccountSummary";
import * as autobahn from "autobahn";
import * as WebSocket from "ws";
import * as request from "request";
import * as crypto from "crypto";
import * as querystring from "querystring";
import * as db from "../database";
import * as BFX from "@ekliptor/bitfinex-api-node-seq";
import * as helper from "../utils/helper";
import * as async from "async";

import EventStream from "../Trade/EventStream";
import {Currency, Ticker, Trade, TradeHistory, MarketOrder, Funding} from "@ekliptor/bit-models";
import {MarketAction} from "../Trade/MarketStream";
import {OrderBook} from "../Trade/OrderBook";
import {OfferResult} from "../structs/OfferResult";
import {ExternalTickerExchange, filterCurrencyPairs} from "./ExternalTickerExchange";


export class BitfinexCurrencies extends AbstractExchangeCurrencies implements Currency.ExternalExchangeTicker {
    protected exchange: AbstractExchange;

    constructor(exchange: AbstractExchange) {
        super(exchange);
    }

    public getExchangeName(localCurrencyName: string): string {
        if (localCurrencyName === "DASH")
            return "dsh";
        else if (localCurrencyName === "IOTA")
            return "iot";
        else if (localCurrencyName === "QASH")
            return "qsh";
        else if (localCurrencyName === "MANA")
            return "mna";
        else if (localCurrencyName === "SPANK")
            return "spk";
        if (localCurrencyName === "BCH")
            return "bab";
        return super.getExchangeName(localCurrencyName).toLowerCase();
    }
    public getLocalName(exchangeCurrencyName: string): string {
        let exNameLower = this.removePrefix(exchangeCurrencyName).toLowerCase();
        if (exNameLower === "dsh")
            return "DASH";
        else if (exNameLower === "iot")
            return "IOTA";
        else if (exNameLower === "qsh")
            return "QASH";
        else if (exNameLower === "mna")
            return "MANA";
        else if (exNameLower === "spk")
            return "SPANK";
        else if (exNameLower === "bab")
            return "BCH";
        return exNameLower.toUpperCase();
    }

    public getExchangePair(localPair: Currency.CurrencyPair): string {
        let str1 = this.getExchangeName(Currency.Currency[localPair.from])
        let str2 = this.getExchangeName(Currency.Currency[localPair.to])
        if (!str1 || !str2) // currency pair not supported
            return undefined;
        //return "t" + str2 + str1 // tBTCLTC, no separator, t optional
        return this.getExchangeName(str2).toUpperCase() + this.getExchangeName(str1).toUpperCase() // t only present for trades, mostly optional
    }
    public getLocalPair(exchangePair: string): Currency.CurrencyPair {
        // all currency names have a constant length of 3
        exchangePair = this.removePrefix(exchangePair)
        exchangePair = exchangePair.toUpperCase(); // here they should already be uppercase, only single currencies are display lowercase by bitfinex
        let pair = [exchangePair.substr(0, 3), exchangePair.substr(3)]
        let cur1 = Currency.Currency[this.getLocalName(pair[0])]
        let cur2 = Currency.Currency[this.getLocalName(pair[1])]
        if (!cur1 || !cur2)
            return undefined;
        return new Currency.CurrencyPair(cur2, cur1)
    }
    public toLocalTicker(exchangeTicker: any): Ticker.Ticker {
        /**
         * { BID: 3434.9,
              BID_SIZE: 52.75873311,
              ASK: 3435,
              ASK_SIZE: 4.25380509,
              DAILY_CHANGE: 182,
              DAILY_CHANGE_PERC: 0.0559,
              LAST_PRICE: 3435,
              VOLUME: 18123.84708492,
              HIGH: 3444,
              LOW: 3238 }
         */
        let ticker = new Ticker.Ticker(this.exchange.getExchangeLabel());
        if (!exchangeTicker.BID || !exchangeTicker.ASK) {
            logger.error("Received invalid exchange ticker data from %s", this.exchange.getClassName(), exchangeTicker)
            return undefined;
        }
        //ticker.currencyPair = this.getLocalPair(exchangeTicker[0]);
        //if (!ticker.currencyPair)
            //return undefined; // we don't support this pair
        ticker.last = Ticker.Ticker.parseNumber(exchangeTicker.LAST_PRICE);
        ticker.lowestAsk = Ticker.Ticker.parseNumber(exchangeTicker.ASK);
        ticker.highestBid = Ticker.Ticker.parseNumber(exchangeTicker.BID);
        ticker.percentChange = Ticker.Ticker.parseNumber(exchangeTicker.DAILY_CHANGE_PERC*100);
        ticker.baseVolume = Ticker.Ticker.parseNumber(exchangeTicker.VOLUME);
        ticker.quoteVolume = ticker.baseVolume * ticker.last;
        ticker.isFrozen = false;
        ticker.high24hr = Ticker.Ticker.parseNumber(exchangeTicker.HIGH);
        ticker.low24hr = Ticker.Ticker.parseNumber(exchangeTicker.LOW);
        return ticker;
    }
    public toExternalTicker(exchangeTicker: any): Ticker.ExternalTicker {
        // the data we get via REST v1 API is different than from websocket v2
        let ticker = new Ticker.ExternalTicker(this.exchange.getExchangeLabel());
        if (!exchangeTicker.bid || !exchangeTicker.ask) {
            logger.error("Received invalid exchange ticker data from %s", this.exchange.getClassName(), exchangeTicker)
            return undefined;
        }
        //ticker.currencyPair = this.getLocalPair(exchangeTicker[0]);
        //if (!ticker.currencyPair)
            //return undefined; // we don't support this pair
        ticker.last = Ticker.Ticker.parseNumber(exchangeTicker.last_price);
        ticker.lowestAsk = Ticker.Ticker.parseNumber(exchangeTicker.ask);
        ticker.highestBid = Ticker.Ticker.parseNumber(exchangeTicker.bid);
        //ticker.percentChange = Ticker.Ticker.parseNumber(exchangeTicker.DAILY_CHANGE_PERC*100);
        ticker.percentChange = 0.0; // TODO
        ticker.baseVolume = Ticker.Ticker.parseNumber(exchangeTicker.volume);
        ticker.quoteVolume = ticker.baseVolume * ticker.last;
        ticker.isFrozen = false;
        ticker.high24hr = Ticker.Ticker.parseNumber(exchangeTicker.high);
        ticker.low24hr = Ticker.Ticker.parseNumber(exchangeTicker.low);
        return ticker;
    }

    protected removePrefix(currencyOrPair: string) {
        if (currencyOrPair.length <= 3)
            return currencyOrPair; // be safe
        if (currencyOrPair[0] === "t" || currencyOrPair[0] === "f")
            currencyOrPair = currencyOrPair.substr(1)
        return currencyOrPair;
    }
}

export default class Bitfinex extends AbstractLendingExchange implements ExternalTickerExchange {
    protected currencies: BitfinexCurrencies;
    protected apiClient: any; // TODO wait for typings
    protected apiClientLegacy: any; // their v2 REST API is still very buggy and incomplete

    constructor(options: ExOptions) {
        super(options)
        //this.initApiClient();
        this.publicApiUrl = "";
        this.privateApiUrl = "";
        this.pushApiUrl = "wss://bitfinex-api-client"; // pseudo URL (can't be empty for parent class)
        this.pushApiConnectionType = PushApiConnectionType.WEBSOCKET;
        this.httpKeepConnectionsAlive = false;
        this.dateTimezoneSuffix = "";
        this.exchangeLabel = Currency.Exchange.BITFINEX;
        //this.automaticImports = false; // currently not working (to save server load?)

        // for BTC/ZEC, 0.1 for all others: https://support.bitfinex.com/hc/en-us/articles/115003283709-What-is-the-minimum-trade-order-size-
        // TODO now dynamic via API: https://www.bitfinex.com/posts/226
        this.minTradingValue = 0.01;

        this.fee = 0.002; // TODO use API call to get real fees if we trade high volume
        this.lendingFee = 0.0015;
        this.globalLendingStatsCurrency = Currency.Currency.USD;
        this.maxLeverage = 3.3; // TODO or 2.5 on some currency pairs?
        this.currencies = new BitfinexCurrencies(this);
        this.webSocketTimeoutMs *= 2;

        this.minLendingValue = 50;
        this.minLendingValueCurrency = Currency.Currency.USD;
        this.pollExchangeTicker = nconf.get("lending");
    }

    public repeatFailedTrade(error: any, currencyPair: Currency.CurrencyPair) {
        //if (error && error.err)
            //return false; // API response error
        if (error && error.err && error.err.toString().indexOf("520") !== -1) // HTTP error
            return true;
        return super.repeatFailedTrade(error, currencyPair);
    }

    public getTicker() {
        return new Promise<Ticker.TickerMap>((resolve, reject) => {
            // ticker data is updated via websocket push api
            // their ticker HTTP api only allows fetching 1 currency pair at a time
            setTimeout(() => {
                resolve(this.ticker)
            }, 0)
        })
    }

    public getExternalTicker(requiredCurrencies: string[]) {
        return new Promise<Ticker.ExternalTickerMap>((resolve, reject) => {
            // their ticker HTTP api only allows fetching 1 currency pair at a time
            if (!this.apiClientLegacy)
                this.initApiClient();
            const brest = this.apiClientLegacy.rest // TODO v2 can fetch multiple at once, but not implemented?
            let map = new Ticker.ExternalTickerMap()
            brest.get_symbols((err, symbols) => {
                if (err)
                    return reject(err)
                let fetchOps = [];
                symbols = filterCurrencyPairs(symbols, requiredCurrencies);
                symbols.forEach((symbol) => {
                    fetchOps.push((callback) => {
                        brest.ticker(symbol, (err, result) => {
                            if (err)
                                return callback(err);
                            const tickerObj = this.currencies.toExternalTicker(result)
                            if (tickerObj) {
                                tickerObj.currencyPair = symbol;
                                map.set(symbol, tickerObj)
                            }
                            logger.verbose("%s %s ticker %s/%s loaded", this.className, symbol, map.size, symbols.length)
                            setTimeout(callback.bind(this), 6500); // bitfinex has strong limits
                        })
                    })
                })
                async.parallelLimit(fetchOps, 1, (err, results) => {
                    if (err)
                        return reject(err);
                    resolve(map)
                })
            })
        })
    }

    public getBalances() {
        return this.getBalancesForWallet("exchange")
    }

    public getMarginAccountSummary() {
        return new Promise<MarginAccountSummary>((resolve, reject) => {
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            brest.margin_infos((err, result) => {
                if (err)
                    return reject(err)
                let account = new MarginAccountSummary();
                let margin = result[0];
                //console.log(margin.margin_limits) // should we check for individual currencies? all margin levels are the same
                account.netValue = helper.parseFloatVal(margin.tradable_balance);
                account.pl = helper.parseFloatVal(margin.unrealized_pl);
                account.totalValue = helper.parseFloatVal(margin.net_value);
                margin.lendingFees = 0;
                const marginBalance = helper.parseFloatVal(margin.margin_balance);
                account.currentMargin = marginBalance ? account.totalValue / marginBalance : 100;
                resolve(account)
            })
        })
    }

    public fetchOrderBook(currencyPair: Currency.CurrencyPair, depth: number) {
        return new Promise<OrderBookUpdate<MarketOrder.MarketOrder>>((resolve, reject) => {
            // alternatively just return ws orderbook?
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            let symbol = this.currencies.getExchangePair(currencyPair);
            brest.orderbook(symbol, {
                    limit_bids: depth,
                    limit_asks: depth,
                    group: 1
                },
                (err, result) => {
                    if (err)
                        return reject(err)
                    let seqNrs = [helper.parseFloatVal(result.bids[result.bids.length-1].timestamp), helper.parseFloatVal(result.asks[result.asks.length-1].timestamp)];
                    const seqNr = Math.max(...seqNrs)
                    let orders = new OrderBookUpdate<MarketOrder.MarketOrder>(seqNr, false);
                    ["asks", "bids"].forEach((prop) => {
                        result[prop].forEach((o) => {
                            const amount = helper.parseFloatVal(o.amount);
                            const price = helper.parseFloatVal(o.price);
                            let order = MarketOrder.MarketOrder.getOrder(currencyPair, this.getExchangeLabel(), amount, price)
                            order.date = new Date(helper.parseFloatVal(o.timestamp) * 1000)
                            orders[prop].push(order)
                        })
                    })
                    resolve(orders)
            })
        })
    }

    public importHistory(currencyPair: Currency.CurrencyPair, start: Date, end: Date) {
        return new Promise<void>((resolve, reject) => {
            const pairStr = this.currencies.getExchangePair(currencyPair)
            const startMs = start.getTime();
            const endMs = end.getTime();
            let currentMs = startMs;
            let tradeCount = 0;
            let stepCount = 1000;
            let stepMs = 90 * utils.constants.MINUTE_IN_SECONDS * 1000;
            const initialStepMs = stepMs;
            let queryIntervalMs = 2000;
            const brest = this.apiClient.rest/*(2, {transform: true})*/; // v2
            let symbol = "t" + this.currencies.getExchangePair(currencyPair);
            let onFinish = () => {
                logger.info("Import of %s %s history has finished. Imported %s trades until %s", this.className, currencyPair.toString(), tradeCount, utils.date.toDateTimeStr(new Date(currentMs)))
                let history = new TradeHistory.TradeHistory(currencyPair, this.getExchangeLabel(), start, end);
                if (tradeCount !== 0)
                    TradeHistory.addToHistory(db.get(), history)
                return resolve();
            }
            let importNext = () => {
                if (currentMs > endMs + stepMs) {
                    return onFinish();
                }

                //brest.trades(symbol, (err, result) => { // doesn't support timestamp parameters
                //})
                /*
                let query = querystring.stringify({
                    timestamp: currentSec,
                    limit_trades: stepCount
                })
                brest.make_public_request("trades/" + symbol + "?" + query, (err, result) => { // shows the most recent trades
                */
                // not officially documented, but found here (in zenbot) https://github.com/carlos8f/zenbot/issues/2
                // v2 doc: https://bitfinex.readme.io/v2/reference#rest-public-trades
                let args = {
                    sort: 1, // ascending
                    limit: stepCount, // ignored if end specified?
                    start: currentMs,
                    end: currentMs + stepMs
                }
                let query = querystring.stringify(args);
                let retryError = (err) => {
                    logger.warn("Error importing %s trades", this.className, err)
                    const errStr = err ? err.toString() : "";
                    let rateLimitError = errStr.indexOf("ERR_RATE_LIMIT") !== -1 || errStr.indexOf("ratelimit") !== -1;
                    if (rateLimitError)
                        queryIntervalMs += 200;
                    setTimeout(importNext.bind(this), rateLimitError ? 60000 : 5000); // retry
                }
                brest.makePublicRequest("trades/" + symbol + "/hist?" + query, (err, history) => {
                    if (err || Array.isArray(history) === false) {
                        if (currentMs >= endMs && !err && /*Object.keys(history).length === 0*/history.ID === undefined)
                            return onFinish();
                        else if (typeof history === "object" && history.ID === undefined) {
                            logger.error("Received invalid %s response when importing trades", this.className, history)
                            //return onFinish(); // API parameter error?
                            currentMs = currentMs + stepMs;
                            return setTimeout(importNext.bind(this), queryIntervalMs)
                        }
                        if (!err)
                            currentMs += stepMs; // most likely the exchange was down during that import range
                        return retryError(err ? err : history);
                    }

                    if (history.length >= stepCount) {
                        const lastStepMs = stepMs;
                        if (stepMs <= 30000) {
                            //return reject({txt: "Unable to get small enough timeframe to import all trades"})
                            logger.warn("Unable to get small enough timeframe to import all trades. Trade history will have missing trades during volume spikes")
                        }
                        else {
                            stepMs -= 15 * utils.constants.MINUTE_IN_SECONDS * 1000;
                            if (stepMs <= 30000)
                                stepMs = 30000;
                            if (stepMs < lastStepMs) { // to be sure
                                logger.warn("%s trade history is incomplete, length %s. Retrying with smaller step %s ms", this.className, history.length, stepMs)
                                return setTimeout(importNext.bind(this), queryIntervalMs)
                            }
                        }
                    }
                    else if (history.length === 0) {
                        currentMs += stepMs;
                        if (stepMs < initialStepMs) // check again with a higher step range to be sure we got all
                            stepMs = initialStepMs;
                        logger.warn("Received no trade history. current step ms %s", currentMs)
                        return importNext(); // happens with last range or when the exchange was down (no trades)
                    }
                    if (history.length <= 0.5*stepCount && stepMs < initialStepMs) // increase the time range to fetch again if we get very few trades (time spike is over)
                        stepMs += 1 * utils.constants.MINUTE_IN_SECONDS * 1000; // increase in smaller intervals
                    let trades = [];
                    history.forEach((rawTrade) => {
                        trades.push(this.fromRawTrade(rawTrade, currencyPair))
                    })
                    tradeCount += trades.length;
                    Trade.storeTrades(db.get(), trades, (err) => {
                        if (err)
                            logger.error("Error storing trades", err)
                        const previousMs = currentMs;
                        currentMs = trades.length > 0 ? trades[trades.length-1].date.getTime()+1 : currentMs + stepMs;
                        if (currentMs <= previousMs) {
                            logger.error("Current fetch time range must be bigger than the previous one. Incrementing with default step %s", stepMs);
                            currentMs = previousMs + stepMs;
                        }
                        logger.verbose("%s %s import at %s with %s trades", this.className, currencyPair.toString(), utils.date.toDateTimeStr(new Date(currentMs)), tradeCount)
                        // max 90 reqs per minute, but not true: https://www.bitfinex.com/posts/188
                        setTimeout(importNext.bind(this), queryIntervalMs) // avoid hitting the rate limit -> temporary ban
                    })
                })
            }
            importNext();
        })
    }

    public buy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                const symbol = this.currencies.getExchangePair(currencyPair);
                brest.new_order(symbol, amount.toString(), rate.toString(), "bitfinex", "buy", "exchange " + outParams.orderType, false, this.getPostOnly(params), (err, result) => {
                    let resultInvalid = this.invalidExchangeApiResponse(err, result);
                    if (resultInvalid)
                        return reject(resultInvalid)
                    /**
                     * { id: 3476351918,
                          cid: 25976143510,
                          cid_date: '2017-08-23',
                          gid: null,
                          symbol: 'ltcusd',
                          exchange: 'bitfinex',
                          price: '46.88',
                          avg_execution_price: '0.0',
                          side: 'sell',
                          type: 'exchange limit',
                          timestamp: '1503472376.176477226',
                          is_live: true,
                          is_cancelled: false,
                          is_hidden: false,
                          oco_order: null,
                          was_forced: false,
                          original_amount: '0.1',
                          remaining_amount: '0.1',
                          executed_amount: '0.0',
                          src: 'api',
                          order_id: 3476351918 }
                     */
                    resolve(OrderResult.fromJson(result, currencyPair, this))
                })
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public sell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                const symbol = this.currencies.getExchangePair(currencyPair);
                brest.new_order(symbol, amount.toString(), rate.toString(), "bitfinex", "sell", "exchange " + outParams.orderType, false, this.getPostOnly(params), (err, result) => {
                    let resultInvalid = this.invalidExchangeApiResponse(err, result);
                    if (resultInvalid)
                        return reject(resultInvalid)
                    resolve(OrderResult.fromJson(result, currencyPair, this))
                })
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public cancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            brest.cancel_order(orderNumber, (err) => { // id is unique across all currency pairs // result undefined
                let resultInvalid = this.invalidExchangeApiResponse(err, null);
                if (resultInvalid)
                    return reject(resultInvalid)
                resolve({exchangeName: this.className, orderNumber: orderNumber, cancelled: true})
            })
        })
    }

    public getOpenOrders(currencyPair: Currency.CurrencyPair) {
        return new Promise<OpenOrders>((resolve, reject) => {
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            brest.active_orders((err, result) => {
                let resultInvalid = this.invalidExchangeApiResponse(err, result);
                if (resultInvalid)
                    return reject(resultInvalid)
                const symbol = this.currencies.getExchangePair(currencyPair).toLowerCase();
                let orders = new OpenOrders(currencyPair, this.className);
                result.forEach((o) => {
                    if (o.symbol.toLowerCase() !== symbol)
                        return;
                    let orderObj = {
                        orderNumber: parseFloat(o.id),
                        type: o.side,
                        rate: parseFloat(o.price),
                        amount: parseFloat(o.remaining_amount), // see also original_amount and executed_amount
                        total: 0,
                        leverage: o.type.indexOf("exchange") !== -1 ? 1 : this.maxLeverage
                    }
                    orderObj.total = orderObj.rate * orderObj.amount;
                    orders.addOrder(orderObj)
                })
                resolve(orders)
            })
        })
    }

    public moveOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: OrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            amount = Math.abs(amount);
            if (amount !== 0 && amount < this.minTradingValue)
                return resolve(OrderResult.fromJson({message: "Remaining amount below min trading value can not be moved: " + amount}, currencyPair, this))
            let outParams;
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((oP) => {
                outParams = oP;
                // we don't know if it was a buy or sell order, so retrieve the order first
                return this.getOpenOrders(currencyPair)
            }).then((orders) => {
                const symbol = this.currencies.getExchangePair(currencyPair);
                if (orders.isOpenOrder(orderNumber)) {
                    // exposed API call allow to set postOnly, so we create it ourselves
                    //brest.replace_order(orderNumber, symbol, amount.toString(), rate.toString(), "bitfinex", "sell", "exchange limit"/*, false, postOnly*/, (err, result) => {
                    let order: OpenOrder = orders.getOrder(orderNumber);
                    amount = Math.abs(order.amount);
                    const orderParams = {
                        order_id: typeof orderNumber === "string" ? parseInt(orderNumber) : orderNumber,
                        symbol: symbol,
                        amount: amount.toString(),
                        price: rate.toString(),
                        exchange: "bitfinex",
                        side: order.type,
                        type: order.leverage <= 1 ? "exchange " : "",
                        is_hidden: false,
                        is_postonly: this.getPostOnly(params)
                        //use_remaining: true // easier to use this? but then inconsistent with other exchanges
                    }
                    orderParams.type += params.matchBestPrice ? "market" : "limit"
                    brest.make_request("order/cancel/replace", orderParams, (err, result) => {
                        let resultInvalid = this.invalidExchangeApiResponse(err, result);
                        if (resultInvalid || !result)
                            return reject(resultInvalid)
                        resolve(OrderResult.fromJson(result, currencyPair, this))
                    })
                }
                else
                    resolve(OrderResult.fromJson({message: "Order already filled"}, currencyPair, this))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public marginBuy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                const symbol = this.currencies.getExchangePair(currencyPair);
                brest.new_order(symbol, amount.toString(), rate.toString(), "bitfinex", "buy", outParams.orderType, false, this.getPostOnly(params), (err, result) => {
                    let resultInvalid = this.invalidExchangeApiResponse(err, result);
                    if (resultInvalid)
                        return reject(resultInvalid)
                    resolve(OrderResult.fromJson(result, currencyPair, this))
                })
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public marginSell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                const symbol = this.currencies.getExchangePair(currencyPair);
                brest.new_order(symbol, amount.toString(), rate.toString(), "bitfinex", "sell", outParams.orderType, false, this.getPostOnly(params), (err, result) => {
                    let resultInvalid = this.invalidExchangeApiResponse(err, result);
                    if (resultInvalid)
                        return reject(resultInvalid)
                    resolve(OrderResult.fromJson(result, currencyPair, this))
                })
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public marginCancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return this.cancelOrder(currencyPair, orderNumber); // orderNumbers are unique across all markets
    }

    public moveMarginOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: MarginOrderParameters) {
        return this.moveOrder(currencyPair, orderNumber, rate, amount, params);
    }

    public getAllMarginPositions() {
        return new Promise<MarginPositionList>((resolve, reject) => {
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            brest.active_positions((err, result) => {
                let resultInvalid = this.invalidExchangeApiResponse(err, result);
                if (resultInvalid)
                    return reject(resultInvalid)
                let list = new MarginPositionList();
                result.forEach((pos) => {
                    let currencyPair = this.currencies.getLocalPair(pos.symbol);
                    if (!currencyPair)
                        return; // shouldn't happen
                    let position = new MarginPosition(this.maxLeverage);
                    position.amount = helper.parseFloatVal(pos.amount);
                    position.basePrice = helper.parseFloatVal(pos.base);
                    position.type = position.amount > 0 ? "long" : "short";
                    position.pl = helper.parseFloatVal(pos.pl);
                    list.set(currencyPair.toString(), position)
                })
                resolve(list)
            })
        })
    }

    public getMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<MarginPosition>((resolve, reject) => {
            this.verifyExchangeRequest(currencyPair).then((currencyPairStr) => {
                this.getAllMarginPositions().then((positions) => {
                    resolve(positions.get(currencyPair.toString()))
                }).catch((err) => {
                    reject(err)
                })
            })
        })
    }

    public closeMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<OrderResult>((resolve, reject) => {
            // close the position using a market order (just like on their website)
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            this.verifyExchangeRequest(currencyPair).then((outParams) => {
                return this.getMarginPosition(currencyPair)
            }).then((position) => {
                if (!position)
                    return Promise.reject({txt: "No margin position available to close", exchange: this.getClassName(), pair: currencyPair.toString()})
                const symbol = this.currencies.getExchangePair(currencyPair);
                const amount = Math.abs(position.amount);
                const rate = utils.getRandom(0, 100000); // they say use random for market orders: https://bitfinex.readme.io/v1/reference#rest-auth-new-order
                const orderType = position.type === "short" ? "buy" : "sell";
                // TODO option to try closing with a limit order first? see Kraken
                brest.new_order(symbol, amount.toString(), rate.toString(), "bitfinex", orderType, "market", false, false, (err, result) => {
                    let resultInvalid = this.invalidExchangeApiResponse(err, result);
                    if (resultInvalid)
                        return reject(resultInvalid)
                    resolve(OrderResult.fromJson(result, currencyPair, this))
                })
            }).catch((err) => {
                reject(err)
            })
        })
    }

    // ################################################################
    // ###################### LENDING FUNCTIONS #######################

    public getFundingBalances() {
        return this.getBalancesForWallet("deposit")
    }

    public getActiveLoans() {
        return new Promise<ExchangeActiveLoanMap>((resolve, reject) => {
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            brest.active_credits((err, result) => {
                let resultInvalid = this.invalidExchangeApiResponse(err, result);
                if (resultInvalid)
                    return reject(resultInvalid)
                let loanMap = new ExchangeActiveLoanMap();
                result.forEach((loan) => {
                    const currencyStr = this.currencies.getLocalName(loan.currency);
                    const currency = Currency.Currency[currencyStr];
                    const rate = helper.parseFloatVal(loan.rate) / 365; // bitfinex specifies rate per year, we provide daily rate
                    const created = new Date(helper.parseFloatVal(loan.timestamp) * 1000);
                    const amount = helper.parseFloatVal(loan.amount); // doc outdated, only amount present // == remaining_amount, executed_amount is 0
                    let activeLoan = new ActiveLoan(this.className, loan.id, currency, rate, loan.period, amount, created);
                    loanMap.addLoan(currencyStr, activeLoan)
                })
                resolve(loanMap)
            })
        })
    }

    public placeOffer(currency: Currency.Currency, rate: number, amount: number, params: MarginLendingParams) {
        return new Promise<OfferResult>((resolve, reject) => {
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            this.verifyLendingRequest(currency, amount).then((exchangeCurrency) => {
                amount = Math.floor(amount * 100000000) / 100000000.0; // bitfinex only allows up to 8 decimals
                rate *= 365; // bitfinex specifies rate per year, we provide daily rate
                brest.new_offer(exchangeCurrency, amount.toString(), rate.toString(), params.days, "lend", (err, result) => {
                    let resultInvalid = this.invalidExchangeApiResponse(err, result);
                    if (resultInvalid)
                        return reject(resultInvalid)
                    resolve(OfferResult.fromJson(result, currency, this))
                })
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getAllOffers() {
        return new Promise<LoanOffers>((resolve, reject) => {
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            brest.active_offers((err, result) => {
                let resultInvalid = this.invalidExchangeApiResponse(err, result);
                if (resultInvalid)
                    return reject(resultInvalid)
                let offers = new LoanOffers(this.className);
                result.forEach((off) => {
                    let offer = {
                        offerNumber: off.id,
                        type: off.direction, //"lend"
                        currency: Currency.Currency[this.currencies.getLocalName(off.currency)],
                        rate: off.rate,
                        days: off.period,
                        amount: off.original_amount,
                        remainingAmount: off.remaining_amount,
                        created: new Date(helper.parseFloatVal(off.timestamp)*1000)
                    }
                    offers.addOffer(offer)
                    offer.rate /= 365; // back from yearly to daily (after float conversion when adding)
                })
                resolve(offers)
            })
        })
    }

    public cancelOffer(offerNumber: number | string) {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            brest.cancel_offer(offerNumber, (err, result) => {
                let resultInvalid = this.invalidExchangeApiResponse(err, result);
                if (resultInvalid)
                    return reject(resultInvalid)
                // cancellation is async, works if we get no error. otherwise: Error: Offer could not be cancelled.
                resolve({exchangeName: this.className, cancelled: true, orderNumber: offerNumber})
            })
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
        try {
            //if (this.apiClient && this.apiClient.ws)
            //this.apiClient.ws.removeAllListeners();
            this.initApiClient();
            //let conn: WebSocket = new WebSocket(this.pushApiUrl, this.getWebsocketOptions());
            const bws = this.apiClient.ws/*(2)*/; // TODO proxy/options
            //const marketEventStreamMap = new Map<string, EventStream<any>>(); // (exchange currency name, stream instance)
            // TODO funding different POST API: https://www.bitfinex.com/offers
            // TODO child process to avoid ws crashes. or better just create 1 process to write everyting to DB and then all others read from DB
            // utf8=%E2%9C%93&direction=ASK&currency=LTC&bidrate=-0.004&amount=31.8382251&bidperiod=2&frrdelta=on
            // or use v1 for now: https://bitfinex.readme.io/v1/reference#rest-auth-margin-funding

            // TODO rest crash
            /**
             * 2018-01-17 08:12:51 - warn: Uncaught Exception
             2018-01-17 08:12:51 - warn:  Error: unable to verify the first certificate
             at TLSSocket.onConnectSecure (_tls_wrap.js:1041:34)
             at TLSSocket.emit (events.js:160:13)
             at TLSSocket._finishInit (_tls_wrap.js:638:8)

             wait for fix: https://github.com/nodejs/node/issues/14102 - only with keepAlive connections?
             2018-01-19 00:14:04 - warn: Uncaught Exception
             2018-01-19 00:14:04 - warn:  Error: read ECONNRESET
             at _errnoException (util.js:1003:13)
             at TLSWrap.onread (net.js:620:25)
             */

            bws.on("error", (err) => {
                if (err.event === "auth" && err.status !== "OK") // normally sent as error event instead of auth event
                    return logger.error("Error on %s auth. Private API functions (trading) will not work", this.className, err)
                logger.error("WebSocket error in %s", this.className, err);
                try {
                    bws.close();
                }
                catch (e) {
                    logger.error("Error closing %s websocket connection after error", this.className, e)
                }
                this.closeConnection("WebSocket error")
            })

            bws.on("open", () => {
                bws.auth() // we only use public websocket functions (for now)
                // ws example order: https://gist.github.com/joshuarossi/456a16bd17577a9e7681b6d43880b920
                this.currencyPairs.forEach((pair) => {
                    let marketPair = this.currencies.getExchangePair(pair);
                    bws.subscribeTicker(marketPair)
                    bws.subscribeOrderBook(marketPair)
                    bws.subscribeTrades(marketPair)
                    // bitfinex stream data already is in the correct order (unlike poloniex)
                    //this.marketStream.write(pair, value, seqNr);
                })
                this.fundingCurrencies.forEach((currency) => {
                    const currencyStr = this.currencies.getExchangeName(Currency.Currency[currency]);
                    bws.subscribeFunding(currencyStr); // fBTC or BTC
                    bws.subscribeFundingTrades(currencyStr);
                    this.startLendingOrderBook(currency);
                })

                // load the order book snapsnhot
                let fetchOrderbookSnapshot = () => {
                    this.updateOrderBooks(true).then(() => {
                        logger.verbose("%s %s order book snapshots ready", this.orderBook.size, this.className)
                    }).catch((err) => {
                        logger.error("Error polling %s order book snapshots", this.className, err)
                        setTimeout(fetchOrderbookSnapshot.bind(this), 5000); // retry
                    })
                }
                fetchOrderbookSnapshot();
            })

            bws.on('message', (message) => {
                //console.log('Message:', message) // raw message data. we process them parsed as orderbook events etc...
                this.localSeqNr++;
            })

            bws.on('auth', (message) => {
                if (message.event === "auth" && message.status !== "OK") // normally sent as error event instead of auth event
                    return logger.error("Error on %s auth. Private API functions (trading) will not work", this.className, message)
                logger.info("%s trading API authenticated", this.className)
            })

            bws.on('orderbook', (pair, book) => {
                // see updateBookEntry() in orderbook.js (Bitfinex implementation)
                // when count = 0 then you have to delete the price level, AND
                // - if amount = 1 then remove from bids
                // - if amount = -1 then remove from asks
                let localPair = this.currencies.getLocalPair(pair)
                if (!localPair)
                    return logger.error("Received %s orderbook update for unknown currency pair %s", this.className, pair)
                // [ 'o', 1, '0.09520000', '8.74681417' ] // 1 = add, 0 = remove
                let order = ["o", 1, book.PRICE, book.AMOUNT]
                if (book.COUNT == 0)
                    order = ["o", 0, book.PRICE, Number.MAX_VALUE] // remove the max amount from bids/asks
                this.marketStream.write(localPair, [order], this.localSeqNr);
            })

            bws.on('orderbookFunding', (currency, book) => {
                //console.log(currency, book)
                // snapshot: fBTC [ { RATE: 0.0002131, PERIOD: 30, COUNT: 1, AMOUNT: -88.5959162 }, ... ] // TODO really no need to pull snapshot? see brest.fundingbook()
                // updates come as single objects: fBTC {...}
                let localCurrency = Currency.Currency[this.currencies.getLocalName(currency)]
                if (!Array.isArray(book))
                    book = [book];
                book.forEach((bk) => {
                    let tradeObj = this.fromRawFundingTrade(bk, localCurrency, false) as Funding.FundingOrder;
                    this.marketStream.writeFundingOrderbook(localCurrency, tradeObj, this.localSeqNr);
                })
            })

            bws.on('trade', (pair, trade) => { // trades
                let type = trade[0] // te, then tu about 2 seconds later: http://blog.bitfinex.com/api/websocket-api-update/
                if (type !== "tu")
                    return;
                let rawTrade = trade[1]
                let localPair = this.currencies.getLocalPair(pair)
                this.marketStream.write(localPair, [this.fromRawTrade(rawTrade, localPair)], this.localSeqNr);
                this.resetWebsocketTimeout(); // sometimes the bitfinex websocket stops receiving messages without throwing an error
            })

            bws.on('tradeFunding', (currency, trade) => { // tradesFunding
                // pair = fBTC, snapshot as an array, afterwards single objects
                let type = trade[0];
                if (typeof type === "string") { // for snapshots we just get an array without tu/te updates
                    trade = trade[1];
                    if (type !== "ftu")
                        return;
                }
                //console.log(currency, trade)
                // "amount" can be negative for "sells" too
                let localCurrency = Currency.Currency[this.currencies.getLocalName(currency)]
                if (!Array.isArray(trade))
                    trade = [trade];
                trade.forEach((tr) => {
                    let tradeObj = this.fromRawFundingTrade(tr, localCurrency)
                    this.marketStream.writeFundingTrade(localCurrency, tradeObj, this.localSeqNr);
                })
                this.resetWebsocketTimeout();
            })

            bws.on('ticker', (pair, ticker) => {
                let tickerObj = this.currencies.toLocalTicker(ticker)
                if (!tickerObj)
                    return;
                tickerObj.currencyPair = this.currencies.getLocalPair(pair)
                if (!tickerObj.currencyPair)
                    return; // we don't support this pair (shouldn't be subscribed then)
                let tickerMap = new Ticker.TickerMap()
                tickerMap.set(tickerObj.currencyPair.toString(), tickerObj)
                this.setTickerMap(tickerMap)
            })

            bws.on("close", (event) => {
                let reason = "Unknown error";
                if (event && event.reason)
                    reason = event.reason;
                this.onConnectionClose(reason); // wait for timeout if closed without an error
                logger.error("%s WebSocket connection closed with reason: %s", reason)
            })
            //bws.open();
            return bws; // EventEmitter and not WebSocket, but ok
        }
        catch (e) {
            /**
             * TODO does this catch that? no, still crashes when bitfinex goes down
             * 2017-08-30 07:17:35 - warn: Uncaught Exception
                 2017-08-30 07:17:35 - warn:  Error: unexpected server response (520)
                 at ClientRequest._req.on (/home/bitbrain/nodejs/BitBrain/Sensor3/node_modules/ws/lib/WebSocket.js:656:26)
                 at emitOne (events.js:96:13)
                 at ClientRequest.emit (events.js:191:7)
                 at HTTPParser.parserOnIncomingClient [as onIncoming] (_http_client.js:522:21)
                 at HTTPParser.parserOnHeadersComplete (_http_common.js:99:23)
                 at TLSSocket.socketOnData (_http_client.js:411:20)
                 at emitOne (events.js:96:13)
                 at TLSSocket.emit (events.js:191:7)
                 at readableAddChunk (_stream_readable.js:178:18)
                 at TLSSocket.Readable.push (_stream_readable.js:136:10)
                 at TLSWrap.onread (net.js:561:20)
                 2017-08-30 07:17:35 - warn: Error: unexpected server response (520)
                 at ClientRequest._req.on (/home/bitbrain/nodejs/BitBrain/Sensor3/node_modules/ws/lib/WebSocket.js:656:26)
             */
            logger.error("Exception on creating %s WebSocket connection", this.className, e)
            return null; // this function will get called again after a short timeout
        }
    }

    protected initApiClient() {
        const that = this; // old JS code
        const opts = {
            version: 2,
            transform: true,
            nonceGenerator: function () {
                return that.getNextNonce();
            }
            // ensure increasing nonce: 1. implement only API v2, 2. implement/fork nonceGenerator parameter or 3. use 2 different API keys
            // we use optoin 3
        }
        this.apiClient = new BFX(this.apiKey.key, this.apiKey.secret, opts);
        //this.apiClient = new BFX(Object.assign({apiKey: this.apiKey.key, apiSecret: this.apiKey.secret}, opts));
        //this.apiClient.rest.generateNonce = this.getNextNonce;
        const optsLegacy = {
            version: 1,
            transform: true,
            nonceGenerator: function () {
                return that.getNextNonce();
            }
        }
        this.apiClientLegacy = new BFX(this.apiKey.key2, this.apiKey.secret2, optsLegacy);
        //this.apiClientLegacy = new BFX(Object.assign({apiKey: this.apiKey.key2, apiSecret: this.apiKey.secret2}, optsLegacy));
        //this.apiClientLegacy.rest._nonce = this.getNextNonce;
    }

    protected fetchExchangeTicker() {
        return new Promise<Ticker.TickerMap>((resolve, reject) => {
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            let map = new Ticker.TickerMap();
            let reqOps = [];
            this.fundingCurrencies.forEach((currency) => {
                if (currency === this.minLendingValueCurrency)
                    return;
                const localPair = new Currency.CurrencyPair(this.minLendingValueCurrency, currency);
                if (currency === Currency.Currency.EUR) { // no EUR USD trading
                    reqOps.push((new Promise((resolve, reject) => {
                        let ticker = new Ticker.Ticker(this.getExchangeLabel());
                        ticker.last = nconf.get("serverConfig:euroDollarRate");
                        ticker.lowestAsk = ticker.last;
                        ticker.highestBid = ticker.last;
                        map.set(localPair.toString(), ticker);
                        resolve()
                    })))
                    return;
                }
                reqOps.push(new Promise((resolve, reject) => {
                    let exCurrency = this.currencies.getExchangePair(localPair)
                    brest.ticker(exCurrency, (err, result) => {
                        let resultInvalid = this.invalidExchangeApiResponse(err, result);
                        if (resultInvalid)
                            return reject(resultInvalid)

                        let ticker = new Ticker.Ticker(this.getExchangeLabel());
                        if (!result.bid || !result.ask)
                            return reject({txt: "Received invalid exchange ticker data", exchange: this.getClassName(), data: result})
                        ticker.last = Ticker.Ticker.parseNumber(result.last_price);
                        ticker.lowestAsk = Ticker.Ticker.parseNumber(result.ask);
                        ticker.highestBid = Ticker.Ticker.parseNumber(result.bid);
                        //ticker.percentChange = Ticker.Ticker.parseNumber(exchangeTicker.DAILY_CHANGE_PERC); // only through websocket
                        ticker.baseVolume = Ticker.Ticker.parseNumber(result.volume);
                        ticker.quoteVolume = ticker.baseVolume * ticker.last;
                        ticker.isFrozen = false;
                        ticker.high24hr = Ticker.Ticker.parseNumber(result.high);
                        ticker.low24hr = Ticker.Ticker.parseNumber(result.low);
                        map.set(localPair.toString(), ticker);
                        resolve()
                    })
                }))
            })
            Promise.all(reqOps).then(() => {
                resolve(map)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected getBalancesForWallet(walletType: string) {
        return new Promise<Currency.LocalCurrencyList>((resolve, reject) => {
            /*
            const brest = this.apiClient.rest;
            brest.makeAuthRequest(`/auth/r/wallets`, {foo:1}, (err, result) => {
                console.log(err)
                console.log(result)
            })
            */
            const brest = this.apiClientLegacy.rest/*(1, {transform: true})*/;
            brest.wallet_balances((err, result) => {
                if (err)
                    return reject(err)
                let balances = {}
                let totalLendingBalances = {}
                result.forEach((balance) => {
                    if (balance.type !== walletType) // exchange, trading, deposit
                        return;
                    let currencyStr = this.currencies.getLocalName(balance.currency)
                    if (!currencyStr)
                        return; // not supported currency
                    if (walletType === "deposit")
                        totalLendingBalances[currencyStr] = helper.parseFloatVal(balance.amount);
                    balances[currencyStr] = helper.parseFloatVal(balance.available) // available == amount for exchange? different for lending
                })
                if (walletType === "deposit") // cache it to avoid a 2nd request
                    this.totalLendingBalances = Currency.fromExchangeList(totalLendingBalances, this.currencies)
                resolve(Currency.fromExchangeList(balances, this.currencies))
            })
        })
    }

    protected fromRawTrade(rawTrade: any, currencyPair: Currency.CurrencyPair) {
        let tradeObj = new Trade.Trade();
        tradeObj.tradeID = rawTrade.ID;
        tradeObj.date = new Date(rawTrade.MTS);
        tradeObj.amount = rawTrade.AMOUNT;
        tradeObj.type = tradeObj.amount < 0 ? Trade.TradeType.SELL : Trade.TradeType.BUY;
        tradeObj.amount = Math.abs(tradeObj.amount);
        tradeObj.rate = rawTrade.PRICE;
        tradeObj = Trade.Trade.verifyNewTrade(tradeObj, currencyPair, this.getExchangeLabel(), this.getFee())
        return tradeObj;
    }

    protected fromRawFundingTrade(rawTrade: any, currency: Currency.Currency, isTrade = true) {
        // { RATE: 0.0002131, PERIOD: 30, COUNT: 1, AMOUNT: -88.5959162 }
        let tradeObj = isTrade ? new Funding.FundingTrade() : new Funding.FundingOrder();
        tradeObj.date = new Date(rawTrade.MTS ? rawTrade.MTS : Date.now()); // no date available?
        tradeObj.amount = rawTrade.AMOUNT;
        tradeObj.type = tradeObj.amount < 0 ? Funding.FundingType.OFFER : Funding.FundingType.REQUEST;
        tradeObj.amount = Math.abs(tradeObj.amount);
        tradeObj.rate = rawTrade.RATE;
        tradeObj.days = rawTrade.PERIOD;
        //if (rawTrade.COUNT > 1) // already included
            //tradeObj.amount * rawTrade.COUNT;
        return Funding.FundingAction.verify(tradeObj, currency, this.getExchangeLabel());
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
                orderType: params.matchBestPrice ? "market" : "limit"
            }
            /*
            if (amount > 0)
                outParams.amount = amount;
            if (currencyPair)
                outParams.currencyPair = this.currencies.getExchangePair(currencyPair)
            for (let prop in params)
            {
                if (params[prop])
                    outParams[prop] = 1
            }
            */
            resolve(outParams)
        })
    }

    protected verifyExchangeResponse(body: string | false, response: request.RequestResponse, method: string) {
        return new Promise<any>((resolve, reject) => {
            return reject({txt: "verifyExchangeResponse is not implemented", exchange: this.className})
        })
    }

    protected invalidExchangeApiResponse(err: any, result: any): any {
        if (err) {
            const errorTxt = err.toString().toLowerCase();
            if (errorTxt.indexOf("order could not be cancelled") !== -1)
                return false; // already cancelled/filled
            let permanent = true;
            if (err && err.toString().indexOf("Nonce is too small") !== -1)
                permanent = false;
            return {
                txt: "Invalid API response",
                err: err ? err.toString() : err, // as err object it's often not passed along
                permanent: permanent
            };
        }
        return false;
    }

    /*
    protected submitOrder(symbol, amount, price, exchange, side, type, is_hidden, postOnly, cb) {
        // drop-in replacement for api.new_order() which uses invalid parameters ("post_only" instead of "is_postonly")
        const brest = this.apiClientLegacy.rest;
        if (typeof is_hidden === 'function') {
            cb = is_hidden
            is_hidden = false
        }

        if (typeof postOnly === 'function') {
            cb = postOnly
            postOnly = false
        }

        const params = {
            symbol,
            amount,
            price,
            exchange,
            side,
            type
        }

        if (postOnly) {
            params['is_postonly'] = true
        }
        if (is_hidden) {
            params['is_hidden'] = true
        }
        return brest.make_request('order/new', params, cb)
    }
    */

    protected getPostOnly(params: OrderParameters) {
        // TODO postonly orders mostly get through, but then get cancelled async: {"success":true,"message":"","orderNumber":3558247397,"resultingTrades":{}}
        // we have to extend watchOrder() and implement the API call order_status(). also see kraken
        //return params.postOnly ? true : false;
        return false;
    }
}
