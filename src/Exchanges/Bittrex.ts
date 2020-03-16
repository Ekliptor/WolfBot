
// https://bittrex.com/home/api
// API client: https://github.com/dparlevliet/node.bittrex.api

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
import {OrderResult} from "../structs/OrderResult";
import {MarginPosition, MarginPositionList} from "../structs/MarginPosition";
import MarginAccountSummary from "../structs/MarginAccountSummary";
import * as autobahn from "autobahn";
import * as WebSocket from "ws";
import * as request from "request";
import * as crypto from "crypto";
import * as querystring from "querystring";
import * as db from "../database";
import * as helper from "../utils/helper";

import EventStream from "../Trade/EventStream";
import {Currency, Ticker, Trade, TradeHistory, MarketOrder} from "@ekliptor/bit-models";
import {MarketAction} from "../Trade/MarketStream";
import {OrderBook} from "../Trade/OrderBook";
import {OfferResult} from "../structs/OfferResult";
import * as bittrex from "@ekliptor/node-bittrex-api-fix";
import {ExternalTickerExchange, filterCurrencyPairs, isDesiredCurrencyPair} from "./ExternalTickerExchange";


export class BittrexCurrencies extends AbstractExchangeCurrencies implements Currency.ExternalExchangeTicker {
    protected exchange: AbstractExchange;

    constructor(exchange: AbstractExchange) {
        super(exchange);
    }

    public getExchangeName(localCurrencyName: string): string {
        if (localCurrencyName === "BCH")
            return "BCC";
        return super.getExchangeName(localCurrencyName);
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
        return this.getExchangeName(str1) + "-" + this.getExchangeName(str2) // BTC-LTC
    }
    public getLocalPair(exchangePair: string): Currency.CurrencyPair {
        let pair = exchangePair.split("-")
        let cur1 = Currency.Currency[pair[0]]
        let cur2 = Currency.Currency[pair[1]]
        if (!cur1 || !cur2)
            return undefined;
        return new Currency.CurrencyPair(cur1, cur2)
    }
    public toLocalTicker(exchangeTicker: any): Ticker.Ticker {
        let ticker = new Ticker.Ticker(this.exchange.getExchangeLabel());
        ticker.currencyPair = this.getLocalPair(exchangeTicker.MarketName);
        if (!ticker.currencyPair)
            return undefined; // we don't support this pair
        ticker.last = Ticker.Ticker.parseNumber(exchangeTicker.Last);
        ticker.lowestAsk = Ticker.Ticker.parseNumber(exchangeTicker.Ask);
        ticker.highestBid = Ticker.Ticker.parseNumber(exchangeTicker.Bid);
        const yesterdayRate = Ticker.Ticker.parseNumber(exchangeTicker.Bid);
        const priceDiff = helper.getDiffPercent(ticker.last, yesterdayRate);
        ticker.percentChange = priceDiff;
        ticker.baseVolume = Ticker.Ticker.parseNumber(exchangeTicker.BaseVolume);
        ticker.quoteVolume = Ticker.Ticker.parseNumber(exchangeTicker.Volume);
        ticker.isFrozen = exchangeTicker.OpenBuyOrders === 0 && exchangeTicker.OpenSellOrders === 0;
        ticker.high24hr = 0; // not supported
        ticker.low24hr = 0; // not supported
        return ticker;
    }
    public toExternalTicker(exchangeTicker: any): Ticker.ExternalTicker {
        let ticker = new Ticker.ExternalTicker(this.exchange.getExchangeLabel());
        ticker.currencyPair = exchangeTicker.MarketName;
        ticker.last = Ticker.Ticker.parseNumber(exchangeTicker.Last);
        ticker.lowestAsk = Ticker.Ticker.parseNumber(exchangeTicker.Ask);
        ticker.highestBid = Ticker.Ticker.parseNumber(exchangeTicker.Bid);
        const yesterdayRate = Ticker.Ticker.parseNumber(exchangeTicker.Bid);
        const priceDiff = helper.getDiffPercent(ticker.last, yesterdayRate);
        ticker.percentChange = priceDiff;
        ticker.baseVolume = Ticker.Ticker.parseNumber(exchangeTicker.BaseVolume);
        ticker.quoteVolume = Ticker.Ticker.parseNumber(exchangeTicker.Volume);
        ticker.isFrozen = exchangeTicker.OpenBuyOrders === 0 && exchangeTicker.OpenSellOrders === 0;
        ticker.high24hr = 0; // not supported
        ticker.low24hr = 0; // not supported
        return ticker;
    }
}

export default class Bittrex extends AbstractExchange implements ExternalTickerExchange {
    constructor(options: ExOptions) {
        super(options)
        this.publicApiUrl = "https://API";
        this.privateApiUrl = "https://API";
        this.pushApiUrl = "wss://API";
        this.pushApiConnectionType = PushApiConnectionType.WEBSOCKET;
        this.httpKeepConnectionsAlive = true;
        this.dateTimezoneSuffix = "";
        this.exchangeLabel = Currency.Exchange.BITTREX;
        this.minTradingValue = 0.001; // https://support.bittrex.com/hc/en-us/articles/115003004171-What-are-my-trade-limits-
        this.fee = 0.0025;
        this.maxLeverage = 0.0; // no margin trading
        this.currencies = new BittrexCurrencies(this);
        this.webSocketTimeoutMs = nconf.get('serverConfig:websocketTimeoutMs')*2; // small coin markets -> less updates
    }

    public getTicker() {
        return new Promise<Ticker.TickerMap>((resolve, reject) => {
            // via websocket we only get trades
            /*
                    bittrex.getticker({market: marketPair}, (data, err) => {
                        let resultInvalid = this.invalidExchangeApiResponse(err, data);
                        if (resultInvalid)
                            return reject(resultInvalid)
                         //very sparse ticker, no volume, no 24h change,... marketsummaries has more infos
                         // result: { Bid: 0.00005089, Ask: 0.00005093, Last: 0.00005089 } }
                        console.log(data)
                    })
                    */
            bittrex.getmarketsummaries((data, err) => {
                let resultInvalid = this.invalidExchangeApiResponse(err, data);
                if (resultInvalid)
                    return reject(resultInvalid)
                let map = new Ticker.TickerMap()
                data.result.forEach((market) => {
                    /**
                     * { MarketName: 'BTC-1ST',
                           High: 0.00009095,
                           Low: 0.00006596,
                           Volume: 2657824.08816622,
                           Last: 0.00006698,
                           BaseVolume: 205.15553167,
                           TimeStamp: '2018-01-30T18:23:19.03',
                           Bid: 0.0000665,
                           Ask: 0.00006698,
                           OpenBuyOrders: 277,
                           OpenSellOrders: 5688,
                           PrevDay: 0.00008421,
                           Created: '2017-06-06T01:22:35.727' }
                     */
                    const tickerObj = this.currencies.toLocalTicker(market)
                    if (tickerObj)
                        map.set(tickerObj.currencyPair.toString(), tickerObj)
                })
                resolve(map)
            });
        })
    }

    public getExternalTicker(requiredCurrencies: string[]) {
        return new Promise<Ticker.ExternalTickerMap>((resolve, reject) => {
            bittrex.getmarketsummaries((data, err) => {
                let resultInvalid = this.invalidExchangeApiResponse(err, data);
                if (resultInvalid)
                    return reject(resultInvalid)
                let map = new Ticker.ExternalTickerMap()
                data.result.forEach((market) => {
                    /**
                     * { MarketName: 'BTC-1ST',
                           High: 0.00009095,
                           Low: 0.00006596,
                           Volume: 2657824.08816622,
                           Last: 0.00006698,
                           BaseVolume: 205.15553167,
                           TimeStamp: '2018-01-30T18:23:19.03',
                           Bid: 0.0000665,
                           Ask: 0.00006698,
                           OpenBuyOrders: 277,
                           OpenSellOrders: 5688,
                           PrevDay: 0.00008421,
                           Created: '2017-06-06T01:22:35.727' }
                     */
                    if (!Currency.isExternalExchangeTicker(this.currencies))
                        return;
                    const tickerObj = this.currencies.toExternalTicker(market)
                    if (tickerObj && isDesiredCurrencyPair(tickerObj.currencyPair, requiredCurrencies))
                        map.set(tickerObj.currencyPair.toString(), tickerObj)
                })
                resolve(map)
            });
        })
    }

    public getBalances() {
        return new Promise<Currency.LocalCurrencyList>((resolve, reject) => {
            bittrex.getbalances((data, err) => {
                let resultInvalid = this.invalidExchangeApiResponse(err, data);
                if (resultInvalid)
                    return reject(resultInvalid)
                let balances = {}
                data.result.forEach((balance) => {
                    /**
                     * { Currency: 'LTC',
                           Balance: 0,
                           Available: 0,
                           Pending: 0,
                           CryptoAddress: 'LhR7bS3Zd4zfTxYLowkEt7Ry5fZmMwQCp2' },
                     */
                    let currencyStr = this.currencies.getLocalName(balance.Currency)
                    if (!currencyStr)
                        return; // not supported currency
                    balances[currencyStr] = helper.parseFloatVal(balance.Available)
                })
                resolve(Currency.fromExchangeList(balances, this.currencies))
            });
        })
    }

    public getMarginAccountSummary() {
        return new Promise<MarginAccountSummary>((resolve, reject) => {
            reject({txt: "Margin trading is not supported.", exchange: this.className})
        })
    }

    public fetchOrderBook(currencyPair: Currency.CurrencyPair, depth: number) {
        return new Promise<OrderBookUpdate<MarketOrder.MarketOrder>>((resolve, reject) => {
            const pairStr = this.currencies.getExchangePair(currencyPair)
            bittrex.getorderbook({
                    market: pairStr,
                    type: "both" // "depth" not available here
                },
                (data, err) => {
                    let resultInvalid = this.invalidExchangeApiResponse(err, data);
                    if (resultInvalid)
                        return reject(resultInvalid)
                    this.localSeqNr++;
                    let orders = new OrderBookUpdate<MarketOrder.MarketOrder>(this.localSeqNr, false); // no seq numbers provided
                    ["buy", "sell"].forEach((prop) => {
                        const orderbookSide = prop === "buy" ? "bids" : "asks";
                        data.result[prop].forEach((o) => {
                            // { Quantity: 6.74418456, Rate: 0.10635011 }
                            const amount = helper.parseFloatVal(o.Quantity);
                            const price = helper.parseFloatVal(o.Rate);
                            let order = MarketOrder.MarketOrder.getOrder(currencyPair, this.getExchangeLabel(), amount, price)
                            order.date = new Date(); // no data provided, set to now
                            orders[orderbookSide].push(order)
                        })
                    })
                    resolve(orders)
            });
        })
    }

    public importHistory(currencyPair: Currency.CurrencyPair, start: Date, end: Date) {
        return new Promise<void>((resolve, reject) => {
            const pairStr = this.currencies.getExchangePair(currencyPair)
            logger.warn("%s doesn't support market history imports. Just fetching latest %s data", this.className, currencyPair.toString())
            bittrex.getmarkethistory({market: pairStr}, (data, err) => {
                let resultInvalid = this.invalidExchangeApiResponse(err, data);
                if (resultInvalid)
                    return reject(resultInvalid)
                let trades = [];
                data.result.forEach((hist) => {
                    /**
                     * { Id: 206087270,
                           TimeStamp: '2018-01-30T11:21:27.59',
                           Quantity: 10.23257401,
                           Price: 0.10631,
                           Total: 1.08782494,
                           FillType: 'FILL',
                           OrderType: 'BUY' },
                     */
                    trades.push(this.fromRawTrade(hist, currencyPair))
                })
                Trade.storeTrades(db.get(), trades, (err) => {
                    if (err)
                        logger.error("Error storing trades", err)
                    logger.verbose("%s %s import done with %s trades", this.className, currencyPair.toString(), trades.length)
                    let history = new TradeHistory.TradeHistory(currencyPair, this.getExchangeLabel(), start, end);
                    if (trades.length !== 0)
                        TradeHistory.addToHistory(db.get(), history)
                    resolve()
                })
            });
            return;
        })
    }

    public buy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                bittrex.tradebuy({
                        MarketName: outParams.pairStr,
                        OrderType: outParams.orderType,
                        Quantity: amount,
                        Rate: rate,
                        TimeInEffect: 'GOOD_TIL_CANCELLED', // supported options are 'IMMEDIATE_OR_CANCEL', 'GOOD_TIL_CANCELLED', 'FILL_OR_KILL'
                        ConditionType: 'NONE', // supported options are 'NONE', 'GREATER_THAN', 'LESS_THAN'
                        Target: 0, // used in conjunction with ConditionType
                    },
                    (data, err) => {
                        let resultInvalid = this.invalidExchangeApiResponse(err, data);
                        if (resultInvalid)
                            return reject(resultInvalid)
                        resolve(OrderResult.fromJson(data, currencyPair, this))
                });
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public sell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                bittrex.tradesell({
                        MarketName: outParams.pairStr,
                        OrderType: outParams.orderType,
                        Quantity: amount,
                        Rate: rate,
                        TimeInEffect: 'GOOD_TIL_CANCELLED', // supported options are 'IMMEDIATE_OR_CANCEL', 'GOOD_TIL_CANCELLED', 'FILL_OR_KILL'
                        ConditionType: 'NONE', // supported options are 'NONE', 'GREATER_THAN', 'LESS_THAN'
                        Target: 0, // used in conjunction with ConditionType
                    },
                    (data, err) => {
                        let resultInvalid = this.invalidExchangeApiResponse(err, data);
                        if (resultInvalid)
                            return reject(resultInvalid)
                        /**
                         * data.result: { OrderId: '0eaf6b75-022a-4a5d-ac2e-db22d8ae45a4',
                             MarketName: 'BTC-ADA',
                             MarketCurrency: 'ADA',
                             BuyOrSell: 'Sell',
                             OrderType: 'LIMIT',
                             Quantity: 20,
                             Rate: 0.0000504 } }
                         */
                        resolve(OrderResult.fromJson(data, currencyPair, this))
                    });
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public cancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            //const currencyStr = this.currencies.getExchangePair(currencyPair);
            bittrex.cancel({
                    //MarketName: currencyStr,
                    uuid: orderNumber
                },
                (data, err) => {
                    let resultInvalid = this.invalidExchangeApiResponse(err, data);
                    if (resultInvalid && JSON.stringify(err).indexOf("ORDER_NOT_OPEN") === -1) // otherwise the order has already filled
                        return reject(resultInvalid)
                    resolve({exchangeName: this.className, orderNumber: orderNumber, cancelled: true})
            });
        })
    }

    public getOpenOrders(currencyPair: Currency.CurrencyPair) {
        return new Promise<OpenOrders>((resolve, reject) => {
            const currencyStr = this.currencies.getExchangePair(currencyPair);
            bittrex.getopenorders({
                    market: currencyStr
                },
                (data, err) => {
                    let resultInvalid = this.invalidExchangeApiResponse(err, data);
                    if (resultInvalid)
                        return reject(resultInvalid)
                    let orders = new OpenOrders(currencyPair, this.className);
                    data.result.forEach((o) => {
                        let orderObj = {
                            orderNumber: o.OrderUuid,
                            type: (o.OrderType.indexOf("BUY") !== -1 ? "buy": "sell") as any, // TODO why do we need this cast?
                            rate: parseFloat(o.Limit),
                            amount: parseFloat(o.Quantity),
                            total: 0,
                            leverage: 1
                        }
                        orderObj.total = orderObj.rate * orderObj.amount;
                        orders.addOrder(orderObj)
                    })
                    resolve(orders)
            });
        })
    }

    public moveOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: OrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            // no API call for it. cancel the order and place it again
            let order: OpenOrder;
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                return this.getOpenOrders(currencyPair)
            }).then((orders) => {
                if (!orders.isOpenOrder(orderNumber)) {
                    resolve(OrderResult.fromJson({message: "Order already filled"}, currencyPair, this))
                    return Promise.resolve(true)
                }
                order = orders.getOrder(orderNumber);
                return this.cancelOrder(currencyPair, order.orderNumber)
            }).then((cancelResult) => {
                if (!cancelResult)
                    return Promise.reject(cancelResult)
                if (order.type === "buy")
                    return this.buy(currencyPair, rate, amount, params)
                return this.sell(currencyPair, rate, amount, params)
            }).then((orderResult) => {
                resolve(orderResult)
            }).catch((err) => {
                if (err === true)
                    return;
                reject(err)
            })
        })
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
        this.initApiClient();
        let websocketClient;
        bittrex.websockets.client((client) => {
            // connected - you can do any one-off connection events here
            // Note: Reoccuring events like listen() and subscribe() should be done
            // in onConnect so that they are fired during a reconnection event.
            websocketClient = client;
            AbstractExchange.pushApiConnections.set(this.className, websocketClient); // ensure we get it async
            // onError event only available on client service handlers
            client.serviceHandlers.onerror = (err) => {
                logger.error("%s Websocket error", this.className, err)
            }
        });
        return websocketClient; // TODO returns null? though bittrex docs do it like this too
    }

    protected initApiClient() {
        const that = this; // old API code
        bittrex.options({
            apikey: that.apiKey.key,
            apisecret: that.apiKey.secret,
            websockets: {
                onConnect() {
                    logger.info("%s Websocket connected", that.className)
                    // load the order book snapsnhot
                    let fetchOrderbookSnapshot = () => {
                        that.updateOrderBooks(true).then(() => {
                            logger.verbose("%s %s order book snapshots ready", that.orderBook.size, that.className)
                        }).catch((err) => {
                            logger.error("Error polling %s order book snapshots", that.className, err)
                            setTimeout(fetchOrderbookSnapshot.bind(that), 5000); // retry
                        })
                    }
                    fetchOrderbookSnapshot();

                    let subscribePairs = []
                    that.currencyPairs.forEach((pair) => {
                        let marketPair = that.currencies.getExchangePair(pair);
                        subscribePairs.push(marketPair)
                    })
                    bittrex.websockets.subscribe(subscribePairs, (data, client) => {
                        that.localSeqNr++; // we could use "Nounce" here
                        if (data.M !== 'updateExchangeState')
                            return;
                        that.resetWebsocketTimeout();
                        data.A.forEach((dataFor) => {
                            /**
                             * { MarketName: 'BTC-ETH',
                                  Nounce: 1683617,
                                  Buys:
                                   [ { Type: 0, Rate: 0.1066316, Quantity: 59.6796 },
                                     { Type: 1, Rate: 0.10586603, Quantity: 0 } ],
                                  Sells: [{ Type: 2, Rate: 0.00005094, Quantity: 55385.45744016 }],
                                  Fills: [{ OrderType: 'SELL',
                                       Rate: 0.00005094,
                                       Quantity: 16.61989229,
                                       TimeStamp: '2018-01-30T15:35:45.627' }] }
                             */
                            //console.log('Market Update for '+ dataFor.MarketName, dataFor);
                            let localPair = that.currencies.getLocalPair(dataFor.MarketName);

                            // orderbook
                            let orderModifications = [];
                            ["Buys", "Sells"].forEach((prop) => {
                                dataFor[prop].forEach((o) => {
                                    // update types: https://github.com/n0mad01/node.bittrex.api/issues/23#issuecomment-311090618
                                    // 0 = add
                                    // 1 = remove
                                    // 2 = edit
                                    switch (o.Type)
                                    {
                                        case 0:
                                            orderModifications.push(["o", 1, o.Rate, o.Quantity])
                                            break;
                                        case 1:
                                            orderModifications.push(["o", 0, o.Rate, o.Quantity])
                                            break;
                                        case 2:
                                            orderModifications.push(["o", 0, o.Rate, Number.MAX_VALUE]) // remove the max amount from bids/asks
                                            orderModifications.push(["o", 1, o.Rate, o.Quantity])
                                            break;
                                        default:
                                            logger.error("Received unknown %s orderbook update type %s", that.className, o.Type)
                                    }
                                })
                            });
                            that.marketStream.write(localPair, orderModifications, that.localSeqNr);

                            // trades
                            let trades = []
                            dataFor.Fills.forEach((rawTrade) => {
                                trades.push(that.fromRawTrade(rawTrade, localPair));
                            });
                            that.marketStream.write(localPair, trades, that.localSeqNr);
                        });
                    });
                },
                onDisconnect() {
                    that.closeConnection("WebSocket disconnected") // will reconnect
                }
            }
        });
    }

    protected fromRawTrade(rawTrade: any, currencyPair: Currency.CurrencyPair) {
        let tradeObj = new Trade.Trade();
        tradeObj.tradeID = rawTrade.Id;
        tradeObj.date = new Date(rawTrade.TimeStamp); // from ISO string
        tradeObj.amount = rawTrade.Total ? rawTrade.Total : rawTrade.Quantity; // Quantity is the total amount offered. for "fills" only Quantity is set
        tradeObj.type = rawTrade.OrderType === "SELL" ? Trade.TradeType.SELL : Trade.TradeType.BUY;
        tradeObj.rate = rawTrade.Price ? rawTrade.Price : rawTrade.Rate; // fills use Rate
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
                dummy: "use-api-client",
                orderType: params.matchBestPrice ? "MARKET" : "LIMIT",
                pairStr: this.currencies.getExchangePair(currencyPair)
            }
            resolve(outParams)
        })
    }

    protected verifyExchangeResponse(body: string | false, response: request.RequestResponse, method: string) {
        return new Promise<any>((resolve, reject) => {
            return reject({txt: "verifyExchangeResponse is not implemented", exchange: this.className})
        })
    }

    protected invalidExchangeApiResponse(err: any, data: any): any {
        if (err) {
            let permanent = true; // TODO check for below min trading balance etc..
            return {
                txt: "Invalid API response",
                // {"success":false,"message":"ZERO_OR_NEGATIVE_NOT_ALLOWED","result":null} -> insufficient balance
                err: err, // as err object it's often not passed along
                permanent: permanent
            };
        }
        return false;
    }
}
