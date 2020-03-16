// https://github.com/nothingisdead/npm-kraken-api/blob/master/kraken.js
// https://www.kraken.com/help/api
// fees, available leverages & margin call levels: https://www.kraken.com/en-us/help/fees

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
    ExchangePairMap,
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
import KrakenCcxt from "./KrakenCcxt";

export class KrakenCurrencies extends AbstractExchangeCurrencies {
    protected exchange: AbstractExchange;

    constructor(exchange: AbstractExchange) {
        super(exchange);
    }

    public getExchangeName(localCurrencyName: string): string {
        if (localCurrencyName === "BTC")
            return "XBT";
        // TODO conversion to add X and Z?
        return super.getExchangeName(localCurrencyName);
    }
    public getLocalName(exchangeCurrencyName: string): string {
        if (exchangeCurrencyName === "XBT" || exchangeCurrencyName === "XXBT")
            return "BTC";
        //let pairs = this.exchange.getExchangePairs();
        if (exchangeCurrencyName.match("^(X|Z)") !== null/* && pairs.get(exchangeCurrencyName)*/) {
            //return pairs.get(exchangeCurrencyName).altName
            let localTest = Currency.Currency[exchangeCurrencyName.substr(1)]
            return localTest ? exchangeCurrencyName.substr(1) : exchangeCurrencyName;
        }
        return exchangeCurrencyName
    }

    public getExchangePair(localPair: Currency.CurrencyPair): string {
        let str1 = this.getExchangeName(Currency.Currency[localPair.from])
        let str2 = this.getExchangeName(Currency.Currency[localPair.to])
        if (!str1 || !str2) // our pair is not supported by this exchange
            return undefined;
        return str2 + str1 // BTCLTC, reverse prices USD_BTC is named BTC_USD (but prices are in USD)
    }
    public getLocalPair(exchangePair: string): Currency.CurrencyPair {
        //let pair = exchangePair.split("_")
        // they don't use any separator for the currency pair (DASHEUR). try the first 3 or 4 letters to find a valid currency
        let cur1 = null, cur2 = null;
        for (let i = 3; i <= 4; i++)
        {
            cur1 = exchangePair.substr(0, i)
            cur1 = Currency.Currency[this.getLocalName(cur1)]
            if (!cur1)
                continue;
            cur2 = exchangePair.substr(i)
            cur2 = Currency.Currency[this.getLocalName(cur2)]
            break;
        }
        if (!cur1 || !cur2)
            return undefined; // this exchange pair is not supported by our bot
        return new Currency.CurrencyPair(cur2, cur1) // reverse back
    }
    public toLocalTicker(exchangeTicker: any): Ticker.Ticker {
        let ticker = new Ticker.Ticker(this.exchange.getExchangeLabel());
        const pair = Object.keys(exchangeTicker)[0];
        if (Object.keys(exchangeTicker[pair]).length < 5) {
            logger.error("Received invalid exchange ticker data from %s", this.exchange.getClassName(), exchangeTicker)
            return undefined;
        }
        /**
         * { BCHEUR:
              { a: [Object],
                b: [Object],
                c: [Object],
                v: [Object],
                p: [Object],
                t: [Object],
                l: [Object],
                h: [Object],
                o: '398.358400' }
         */
        ticker.currencyPair = this.getLocalPair(pair);
        if (!ticker.currencyPair)
            return undefined; // we don't support this pair
        ticker.last = Ticker.Ticker.parseNumber(exchangeTicker[pair].c[0]);
        ticker.lowestAsk = Ticker.Ticker.parseNumber(exchangeTicker[pair].a[0]);
        ticker.highestBid = Ticker.Ticker.parseNumber(exchangeTicker[pair].b[0]);
        ticker.high24hr = Ticker.Ticker.parseNumber(exchangeTicker[pair].h[1]);
        ticker.low24hr = Ticker.Ticker.parseNumber(exchangeTicker[pair].l[1]);
        const close24hr = (ticker.high24hr + ticker.low24hr) / 2;
        ticker.percentChange = helper.getDiffPercent(ticker.last, close24hr);
        ticker.baseVolume = Ticker.Ticker.parseNumber(exchangeTicker[pair].v[1]);
        ticker.quoteVolume = ticker.baseVolume * ticker.last;
        ticker.isFrozen = false;
        return ticker;
    }
    public getMarginPosition(margin: any, maxLeverage): MarginPosition {
        /**
         * { ordertxid: 'OETUOI-TSL5U-UXLGSS',
              posstatus: 'open',
              pair: 'XXBTZUSD',
              time: 1502306367.0783,
              type: 'buy',
              ordertype: 'limit',
              cost: '66.72000',
              fee: '0.18014',
              vol: '0.02000000',
              vol_closed: '0.00000000',
              margin: '13.34400',
              value: '66.827',
              net: '+0.1077',
              terms: '0.0100% per 4 hours',
              rollovertm: '1502320767',
              misc: '',
              oflags: '' }
         */
        let position = new MarginPosition(maxLeverage);
        position.type = margin.type === "buy" ? "long" : "short";
        position.amount = helper.parseFloatVal(margin.vol) - helper.parseFloatVal(margin.vol_closed); // or margin.value is in base currency
        if (position.amount < this.exchange.getMinTradingBtc())
            return undefined; // sometimes kraken leaves 0.001 open (also when trading on their website)
        if (position.type === "short" && position.amount > 0)
            position.amount *= -1;
        position.pl = helper.parseFloatVal(margin.net);
        return position;
    }
}

export default class Kraken extends AbstractExchange {
    protected currencies: KrakenCurrencies;
    protected krakenCcxt: KrakenCcxt;

    constructor(options: ExOptions) {
        super(options)
        this.publicApiUrl = "https://api.kraken.com/0/public/";
        this.privateApiUrl = "https://api.kraken.com/0/private/";
        this.dateTimezoneSuffix = " GMT+0000"; // not used here
        this.httpPollIntervalSec = this.httpPollIntervalSec * 2.5; // Kraken is very slow
        this.exchangeLabel = Currency.Exchange.KRAKEN;
        this.minTradingValue = 0.02; // 0.04 // different per currency: https://support.kraken.com/hc/en-us/articles/205893708-What-is-the-minimum-order-size-
        this.fee = 0.0026; // TODO find API call to get actual fees (if we trade higher volumes)
        this.maxLeverage = 5.0;
        this.currencies = new KrakenCurrencies(this);

        this.krakenCcxt = new KrakenCcxt(options);
        this.krakenCcxt.setPollTrades(false);
    }

    public repeatFailedTrade(error: any, currencyPair: Currency.CurrencyPair) {
        // see https://www.kraken.com/help/api#add-standard-order
        if (error.error && error.error.length !== 0) {
            const errStr = error.error.toString();
            if (errStr.indexOf("Invalid arguments") !== -1 || errStr.indexOf("Invalid request") !== -1 || errStr.indexOf("EOrder") !== -1)
                return false;
            return true;
        }
        return super.repeatFailedTrade(error, currencyPair);
    }

    public getTicker() {
        return new Promise<Ticker.TickerMap>((resolve, reject) => {
            let exchangePairs: ExchangePairMap;
            this.loadExchangePairs().then((pairs) => {
                exchangePairs = pairs;
                let params = {
                    pair: pairs.getKeyArray().join(",")
                }
                return this.publicReq("Ticker", params)
            }).then((ticker) => {
                let map = new Ticker.TickerMap()
                for (let pair in ticker.result)
                {
                    let pairObj = {}
                    pairObj[pair] = ticker.result[pair]
                    let tickerObj = this.currencies.toLocalTicker(pairObj)
                    if (tickerObj) {
                        map.set(tickerObj.currencyPair.toString(), tickerObj)
                        continue;
                    }
                    // sometimes they have strange names (XXBTZUSD instead of XBTUSD). try the alt name
                    // we can query for the alt name too, but the result will always use the primary name, so we have to remember primary names
                    pairObj = {}
                    let altname = exchangePairs.get(pair).altName
                    pairObj[altname] = ticker.result[pair]
                    tickerObj = this.currencies.toLocalTicker(pairObj)
                    if (tickerObj)
                        map.set(tickerObj.currencyPair.toString(), tickerObj)
                }
                resolve(map)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getBalances() {
        return new Promise<Currency.LocalCurrencyList>((resolve, reject) => {
            // TradeBalance is an account summary, used for margin positions
            this.privateReq("Balance").then((balance) => {
                let balances = {}
                for (let pair in balance.result)
                {
                    let localName = this.currencies.getLocalName(pair)
                    if (localName === undefined)
                        continue;
                    balances[localName.toString()] = balance.result[pair]
                }
                resolve(Currency.fromExchangeList(balances)) // { '1': 0.07235068, '2': 1.99743826 }
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getMarginAccountSummary() {
        return new Promise<MarginAccountSummary>((resolve, reject) => {
            this.privateReq("TradeBalance").then((account) => {
                account = account.result
                let margin = new MarginAccountSummary();
                margin.netValue = helper.parseFloatVal(account.tb); // what is eb? all currencies != tradable
                margin.pl = helper.parseFloatVal(account.n);
                margin.totalValue = helper.parseFloatVal(account.v);
                margin.lendingFees = 0; // constant values, see fees doc
                margin.currentMargin = account.ml ? helper.parseFloatVal(account.ml) / 100 : 1.0;
                resolve(margin)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public fetchOrderBook(currencyPair: Currency.CurrencyPair, depth: number) {
        /*
        return new Promise<OrderBookUpdate<MarketOrder.MarketOrder>>((resolve, reject) => {
            const pairStr = this.currencies.getExchangePair(currencyPair)
            // they also have a call for recent spread data: https://api.kraken.com/0/public/Spread?pair=XBTUSD
            // but there is no info if this order was added or removed. so hot to process it? we just fetch the complete order book again
            this.publicReq("Depth", {
                pair: pairStr,
                count: depth
            }).then((book) => {
                let currencyKey = Object.keys(book.result)[0] // different name, for example: XXBTZUSD
                let orders = new OrderBookUpdate<MarketOrder.MarketOrder>(++this.localSeqNr, false);
                ["asks", "bids"].forEach((prop) => {
                    book.result[currencyKey][prop].forEach((o) => {
                        //orders[prop].push({rate: parseFloat(o[0]), amount: parseFloat(o[1])})
                        orders[prop].push(MarketOrder.MarketOrder.getOrder(currencyPair, this.getExchangeLabel(), o[1], o[0]))
                    })
                })
                resolve(orders)
            }).catch((err) => {
                reject(err)
            })
        })
         */
        return this.krakenCcxt.fetchOrderBook(currencyPair, depth);
    }

    public importHistory(currencyPair: Currency.CurrencyPair, start: Date, end: Date) {
        return new Promise<void>((resolve, reject) => {
            const pairStr = this.currencies.getExchangePair(currencyPair)
            const startMs = start.getTime();
            const endMs = end.getTime();
            let currentMs = startMs * 1000000;
            let tradeCount = 0;
            let onFinishImport = () => {
                logger.info("Import of %s %s history has finished. Imported %s trades", this.className, currencyPair.toString(), tradeCount)
                let history = new TradeHistory.TradeHistory(currencyPair, this.getExchangeLabel(), start, end);
                if (tradeCount !== 0)
                    TradeHistory.addToHistory(db.get(), history)
                resolve();
            }
            let importNext = () => {
                if (currentMs > endMs * 1000000) {
                    return onFinishImport()
                }
                this.publicReq("Trades", {
                    pair: pairStr,
                    since: currentMs
                }).then((history) => {
                    let currencyKey = Object.keys(history.result)[0] // different name, for example: XXBTZUSD
                    let trades = [];
                    history.result[currencyKey].forEach((krakenTrade) => {
                        trades.push(Trade.Trade.fromJson(krakenTrade, currencyPair, this.getExchangeLabel(), this.getFee(), this.getDateTimezoneSuffix()))
                    })
                    currentMs = helper.parseFloatVal(history.result.last)
                    tradeCount += trades.length;
                    Trade.storeTrades(db.get(), trades, (err) => {
                        if (err)
                            logger.error("Error storing trades", err)
                        logger.verbose("%s %s import at %s with %s trades", this.className, currencyPair.toString(), utils.date.toDateTimeStr(new Date(currentMs / 1000000)), tradeCount)
                        if (trades.length < 1000) {
                            // less than max results -> we are done
                            return onFinishImport()
                        }
                        importNext()
                    })
                }).catch((err) => {
                    logger.warn("Error importing %s trades", this.className, err)
                    setTimeout(importNext.bind(this), 5000); // retry
                })
            }
            importNext();
        })
    }

    public buy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        // call CCXT library for buying/selling to always have the correct minimum order size
        /*
        return new Promise<OrderResult>((resolve, reject) => {
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                outParams.type = "buy"
                return this.privateReq("AddOrder", outParams)
            }).then((result) => {
                resolve(OrderResult.fromJson(result.result, currencyPair, this))
            }).catch((err) => {
                reject(err)
            })
        })
         */
        return this.krakenCcxt.buy(currencyPair, rate, amount, params);
    }

    public sell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        /*
        return new Promise<OrderResult>((resolve, reject) => {
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                outParams.type = "sell"
                return this.privateReq("AddOrder", outParams)
            }).then((result) => {
                resolve(OrderResult.fromJson(result.result, currencyPair, this))
            }).catch((err) => {
                reject(err)
            })
        })
         */
        return this.krakenCcxt.sell(currencyPair, rate, amount, params);
    }

    public cancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        /*
        return new Promise<CancelOrderResult>((resolve, reject) => {
            let outParams = {
                txid: orderNumber
            }
            this.privateReq("CancelOrder", outParams).then((result) => {
                resolve({exchangeName: this.className, orderNumber: orderNumber, cancelled: /*!result.result.error******true}) // errors already caught in res
            }).catch((err) => {
                // check if already filled (or cancelled)
                if (!err.error || err.error.length === 0)
                    return resolve({exchangeName: this.className, orderNumber: orderNumber, cancelled: true})
                reject(err)
            })
        })*/
        return this.krakenCcxt.cancelOrder(currencyPair, orderNumber);
    }

    public getOpenOrders(currencyPair: Currency.CurrencyPair) {
        /*
        return new Promise<OpenOrders>((resolve, reject) => {
            let outParams = {
            }
            // TODO kraken orders sometimes get incorrectly set to filled from RealTimeOrderTracker. how? as a workaround set an order timeout
            this.privateReq("OpenOrders", outParams).then((result) => {
                let orders = new OpenOrders(currencyPair, this.className);
                // returns for all currency pairs. we have to filter here
                for (let id in result.result.open)
                {
                    let order = result.result.open[id]
                    let localPair = this.currencies.getLocalPair(order.descr.pair)
                    if (!localPair.equals(currencyPair))
                        continue;
                    let orderObj = {
                        orderNumber: id,
                        type: order.descr.type,
                        rate: helper.parseFloatVal(order.descr.price),
                        amount: helper.parseFloatVal(order.vol),
                        total: 0,
                        leverage: order.descr.leverage ? order.descr.leverage : 0
                    }
                    if (orderObj.leverage)
                        orderObj.leverage = helper.parseFloatVal(orderObj.leverage.toString().replaceAll(":1", "")) // replace 5:1 to 5.0
                    orderObj.total = orderObj.rate * orderObj.amount;
                    orders.addOrder(orderObj)
                }
                resolve(orders)
            }).catch((err) => {
                reject(err)
            })
        })*/
        return this.krakenCcxt.getOpenOrders(currencyPair);
    }

    public moveOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: OrderParameters) {
        /**
         * TODO bug
         * 2017-09-05 01:36:12 - error: Moving order BTC_ETH in Kraken failed. Retrying...
         2017-09-05 01:36:12 - error: Moving order BTC_ETH in Kraken failed. Order has been cancelled
         2017-09-05 01:36:12 - error: Error moving BTC_ETH order on Kraken {"txt":"Error on exchange API call","exchange":"Kraken","method":"AddOrder","error":["EGeneral:Invalid arguments:volume"]}
         */
        /*
        return new Promise<OrderResult>((resolve, reject) => {
            // kraken doesn't have a "move order" function. so we have to cancel the order and place it again
            let outParams;
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((oP) => {
                outParams = oP;
                // we don't know if it was a buy or sell order, so retrieve the order first
                return this.getOpenOrders(currencyPair)
            }).then((orders) => {
                if (orders.isOpenOrder(orderNumber)) {
                    let orderObj = orders.getOrder(orderNumber);
                    if (orderObj.amount < this.minTradingValue)
                        return resolve(OrderResult.fromJson({message: "Remaining amount below min trading value can not be moved: " + amount}, currencyPair, this))

                    this.cancelOrder(currencyPair, orderNumber).catch((err) => {
                        reject(err) // return the error
                        return Promise.reject(true)
                    }).then((result) => {
                        //outParams.orderNumber = orderNumber;
                        if (!result.cancelled) {
                            reject("Order to move can not be cancelled in " + this.className)
                            return Promise.reject(true)
                        }
                        outParams.type = orderObj.type;
                        //outParams.amount = orderObj.amount; // might be below min trading value now
                        outParams.volume = helper.roundDecimals(orderObj.amount, 6);
                        if (orderObj.leverage > 1.0)
                            outParams.leverage = orderObj.leverage + ":1";
                        return this.privateReq("AddOrder", outParams)
                    }).then((result) => {
                        //console.log(result)
                        resolve(OrderResult.fromJson(result.result, currencyPair, this))
                    }).catch((err) => {
                        if (err === true)
                            return;
                        logger.error("Moving order %s in %s failed. Retrying...", currencyPair.toString(), this.className)
                        return this.privateReq("AddOrder", outParams)
                    }).catch((err) => {
                        logger.error("Moving order %s in %s failed. Order has been cancelled", currencyPair.toString(), this.className)
                        reject(err)
                    })
                }
                else
                    resolve(OrderResult.fromJson({message: "Order already filled"}, currencyPair, this))
            }).catch((err) => {
                reject(err)
            })
        })*/
        return this.krakenCcxt.moveOrder(currencyPair, orderNumber, rate, amount, params);
    }

    public marginBuy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => { // TODO add ccxt support for margin trading
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                outParams.type = "buy"
                outParams.leverage = this.maxLeverage + ":1";
                return this.privateReq("AddOrder", outParams)
            }).then((result) => {
                resolve(OrderResult.fromJson(result.result, currencyPair, this))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public marginSell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                outParams.type = "sell"
                outParams.leverage = this.maxLeverage + ":1";
                return this.privateReq("AddOrder", outParams)
            }).then((result) => {
                resolve(OrderResult.fromJson(result.result, currencyPair, this))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public marginCancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return this.cancelOrder(currencyPair, orderNumber); // on poloniex orderNumbers are unique across all markets
    }

    public moveMarginOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: MarginOrderParameters) {
        return this.moveOrder(currencyPair, orderNumber, rate, amount, params);
    }

    public getAllMarginPositions() {
        return new Promise<MarginPositionList>((resolve, reject) => {
            let outParams = {
                docalcs: true
            }
            this.privateReq("OpenPositions", outParams).then((result) => {
                let list = new MarginPositionList();
                for (let id in result.result)
                {
                    let pos = result.result[id]
                    let localPair = this.currencies.getLocalPair(pos.pair)
                    let position = this.currencies.getMarginPosition(pos, this.maxLeverage)
                    if (position) {
                        let existingPos = list.get(localPair.toString());
                        if (existingPos)
                            position.combine(existingPos)
                        list.set(localPair.toString(), position)
                    }
                }
                resolve(list)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<MarginPosition>((resolve, reject) => {
            let outParams = {
                docalcs: true
            }
            this.privateReq("OpenPositions", outParams).then((result) => {
                let list = new MarginPositionList();
                for (let id in result.result)
                {
                    let pos = result.result[id]
                    let localPair = this.currencies.getLocalPair(pos.pair)
                    if (!localPair.equals(currencyPair))
                        continue;
                    let position = this.currencies.getMarginPosition(pos, this.maxLeverage)
                    if (position) {
                        let existingPos = list.get(localPair.toString());
                        if (existingPos)
                            position.combine(existingPos)
                        list.set(localPair.toString(), position)
                    }
                }
                resolve(list.get(currencyPair.toString())) // returned the combined margin position for this currency
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public closeMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<OrderResult>((resolve, reject) => {
            // closing a margin position on kraken is done by an opposite trade (buy/sell) with the same amount
            this.nextCloseMarketOrder = true; // always use a market order to be sure it gets through for now
            let marginPosition: MarginPosition;
            this.verifyExchangeRequest(currencyPair).then((currencyPairStr) => {
                return this.getMarginPosition(currencyPair)
            }).then((position) => {
                marginPosition = position;
                if (!position)
                    return Promise.reject({
                        txt: "No margin position available to close",
                        exchange: this.getClassName(),
                        pair: currencyPair.toString()
                    })
                // volume in quote currency is not available for leveraged orders
                let closeRate = this.getTickerMap().get(currencyPair.toString()).last;
                let amount = Math.abs(marginPosition.amount);
                return this.verifyTradeRequest(currencyPair, closeRate, amount, {}) // don't use postOnly, we want to ensure it closes
            }).then((outParams) => {
                outParams.type = marginPosition.type === "short" ? "buy" : "sell"
                outParams.leverage = this.maxLeverage;
                if (this.nextCloseMarketOrder) {
                    outParams.ordertype = "market";
                    this.nextCloseMarketOrder = false;
                }
                return this.privateReq("AddOrder", outParams)
            }).then((result) => {
                resolve(OrderResult.fromJson(result.result, currencyPair, this))
                // TODO sometimes only half gets executed. why? base currency is correct. just check again
                this.verifyPositionSize(currencyPair, 0)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected publicReq(method: string, params: ExRequestParams = {}) {
        return new Promise<ExResponse>((resolve, reject) => {
            if (!this.publicApiUrl)
                return reject({txt: "PublicApiUrl must be provided for public exchange request", exchange: this.className})

            let data = {
            }
            data = Object.assign(data, params);
            let query = querystring.stringify(data);
            const urlStr = this.publicApiUrl + method + "?" + query;
            this.get(urlStr, (body, response) => {
                this.verifyExchangeResponse(body, response, method).then((json) => {
                    resolve(json)
                }).catch((err) => {
                    reject(err)
                })
            })
        })
    }

    protected privateReq(method: string, params: ExRequestParams = {}) {
        return new Promise<ExResponse>((resolve, reject) => {
            this.requestQueue = this.requestQueue.then(() => { // only do 1 request at a time because of nonce
                return new Promise((resolve, reject) => {
                    if (!this.privateApiUrl || !this.apiKey)
                        return reject({txt: "PrivateApiUrl and apiKey must be provided for private exchange request", exchange: this.className})

                    const fullUrl = this.privateApiUrl + method;
                    const urlObj = utils.parseUrl(fullUrl)
                    let data = {
                        "nonce": this.getNextNonce()
                    }
                    data = Object.assign(data, params);
                    let query = querystring.stringify(data);
                    let options = {
                        headers: {
                            "API-Key": this.apiKey.key,
                            //"API-Sign": crypto.createHmac('sha512', this.apiKey.secret).update(query).digest('hex')
                            "API-Sign": this.signRequest(urlObj.path, query, this.apiKey.secret, data.nonce)
                        },
                        retry: false // don't retry failed post requests because nonce will be too low
                    }
                    this.post(fullUrl, data, (body, response) => {
                        this.verifyExchangeResponse(body, response, method).then((json) => {
                            resolve(json)
                        }).catch((err) => {
                            reject(err)
                        })
                    }, options)
                })
            }).then((res) => {
                resolve(res) // forward the result
            }).catch((err) => {
                reject(err) // forward the error
            })
        })
    }

    protected signRequest(path, message, secret, nonce) {
        //const message       = querystring.stringify(request);
        const secret_buffer = new Buffer(secret, 'base64');
        const hash          = crypto.createHash('sha256');
        const hmac          = crypto.createHmac('sha512', secret_buffer);
        const hash_digest   = hash.update(nonce + message).digest('latin1');
        const hmac_digest   = hmac.update(path + hash_digest, 'latin1').digest('base64');

        return hmac_digest;
    }

    protected startPolling(): void {
        // TODO verify imported trade timeframes and pause trading if kraken permanently lags
        /**
         * 2017-08-19 21:22:58: CLOSE KRAKEN USD_ETH, amount: 3.40136054, p/l: -8.2402 USD, WaveSurfer, reason: Closing long position, last price: 291.05643
         2017-08-19 23:30:25: SELL KRAKEN USD_ETH, amount: 3.44658667805327, WaveSurfer, reason: Pattern HIGH reached, down breakout happening, last price: 291.01041
         * close + open within 10min on 2h interval because of lags. and trading at bad/wrong rates
         */
        let lastPollTimestamp = new Map<string, number>(); // (currency pair, timestamp)
        const startMs = (Date.now() - nconf.get("serverConfig:fetchTradesMinBack")*60*1000) * 1000000;
        this.currencyPairs.forEach((currencyPair) => {
            lastPollTimestamp.set(currencyPair.toString(), startMs)
        })
        let pollCurrencyTrades = (currencyPair: Currency.CurrencyPair) => {
            return new Promise<Trade.Trade[]>((resolve, reject) => {
                const pairStr = currencyPair.toString();
                this.publicReq("Trades", {
                    pair: this.currencies.getExchangePair(currencyPair),
                    since: lastPollTimestamp.get(pairStr)
                }).then((history) => {
                    let currencyKey = Object.keys(history.result)[0] // different name, for example: XXBTZUSD
                    let trades = [];
                    history.result[currencyKey].forEach((krakenTrade) => {
                        trades.push(Trade.Trade.fromJson(krakenTrade, currencyPair, this.getExchangeLabel(), this.getFee(), this.getDateTimezoneSuffix()))
                    })
                    lastPollTimestamp.set(pairStr, helper.parseFloatVal(history.result.last))
                    resolve(trades)
                }).catch((err) => {
                    reject(err)
                })
            })
        }
        let pollBook = () => {
            this.updateOrderBooks(true).then(() => {
                let pollOps = this.currencyPairs.map((currencyPair) => {
                    return pollCurrencyTrades(currencyPair)
                })
                return Promise.all(pollOps)
            }).then((tradeResults) => {
                for (let i = 0; i < tradeResults.length; i++)
                {
                    // trades are already in order
                    this.marketStream.write(this.currencyPairs[i], tradeResults[i], this.localSeqNr);
                }
                schedulePoll()
            }).catch((err) => {
                logger.error("Error polling %s order book and trades", this.className, err)
                schedulePoll() // continue
            })
        }
        let schedulePoll = () => {
            clearTimeout(this.httpPollTimerID); // be sure
            this.httpPollTimerID = setTimeout(() => {
                pollBook()
            }, this.httpPollIntervalSec * 1000)
        }
        pollBook();
    }

    protected loadExchangePairs() {
        return new Promise<ExchangePairMap>((resolve, reject) => {
            if (this.exchangePairs.size !== 0)
                return resolve(this.exchangePairs)
            this.publicReq("AssetPairs").then((pairs) => {
                const pairArr = Object.keys(pairs.result);
                this.exchangePairs.clear();
                pairArr.forEach((pair) => {
                    this.exchangePairs.set(pair, {
                        name: pair,
                        altName: pairs.result[pair].altname
                    })
                })
                resolve(this.exchangePairs)
            }).catch((err) => {
                reject({txt: "Error getting exchange pairs", exchange: this.className, err: err})
            })
        })
    }

    protected verifyPositionSize(currencyPair: Currency.CurrencyPair, amount: number) {
        return new Promise<void>((resolve, reject) => {
            setTimeout(() => {
                this.getMarginPosition(currencyPair).then((position) => {
                    if (!position) {
                        if (amount != 0)
                            logger.error("%s %s position not found. Expected position amount %s", currencyPair.toString(), this.className, amount)
                        return resolve()
                    }
                    else if (amount === 0 && Math.abs(position.amount) >= this.minTradingValue) { // sometimes there's a tiny position left after closing
                        this.getOpenOrders(currencyPair).then((orders) => {
                            if (orders.orders.length !== 0) {
                                // wait until the open order is filled/moved/cancelled
                                setTimeout(this.verifyPositionSize.bind(this, currencyPair, amount), 8000)
                            }
                            else {
                                // will retry until it has been closed
                                logger.error("Closing %s %s position failed (or was incomplete). Remaining amount %s. Retrying...", currencyPair.toString(), this.className, position.amount)
                                this.nextCloseMarketOrder = true; // doesn't get tracked in RealTimeOrderTracker. add 2nd parameter to post a market order
                                this.closeMarginPosition(currencyPair)
                            }
                            resolve()
                        }).catch((err) => {
                            logger.error("Error getting open orders when verifying position size", err)
                            resolve()
                        })
                        return
                    }

                    let diff = Math.abs(helper.getDiffPercent(Math.abs(position.amount), amount))
                    if (diff > 1.0)
                        logger.error("%s %s position has the wrong size. Expected position amount %s, found %s, %s percent", currencyPair.toString(), this.className, amount,
                            position.amount, Math.floor(diff))
                    resolve()
                }).catch((err) => {
                    logger.error("Error verifying existing position", err)
                    resolve() // continue
                })
            }, nconf.get("serverConfig:delayVerificationOrderSec") * 1000)
        })
    }

    protected verifyTradeRequest(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<ExRequestParams>((resolve, reject) => {
            // TODO move more checks to parent class?
            if (currencyPair) {
                if (this.currencies.getExchangePair(currencyPair) === undefined)
                    return reject({txt: "Currency pair not supported by this exchange", exchange: this.className, pair: currencyPair, permanent: true});
            }
            if (amount > 0 && /*rate * */amount < this.minTradingValue)
                return reject({txt: "Value is below the min trading value", exchange: this.className, value: amount, minTradingValue: this.minTradingValue, permanent: true})

            // use CCXT to round max decimals
            const ccxtExchange = this.krakenCcxt.getApiClient();
            const ccxtCurrencies = this.krakenCcxt.getCurrencies();
            let outParams: any = {
                ordertype: params.matchBestPrice ? "market" : "limit",
                //price: helper.roundDecimals(rate, 6),
                price: ccxtExchange.priceToPrecision(ccxtCurrencies.getExchangePair(currencyPair), rate),
                expiretm: Math.floor(Date.now()/1000 + 45*utils.constants.MINUTE_IN_SECONDS), // TODO remove after moveOrder() works properly
                trading_agreement: "agree"
            }
            if (amount > 0) // TODO EGeneral:Invalid arguments:volume when amount is too low? with ETH
                outParams.volume = helper.roundDecimals(amount, 6);
            if (currencyPair)
                outParams.pair = this.currencies.getExchangePair(currencyPair)

            // TODO postOnly orders can get cancelled if not filling: https://www.kraken.com/u/trade#tab=orders&otxid=OFGBD7-L5IDO-734OIC
            // info:  {"success":true,"message":"sell 11.49610282 ETHXBT @ limit 0.086986 with 5:1 leverage","orderNumber":["OFGBD7-L5IDO-734OIC"],"resultingTrades":{}}
            // how can we track this? we have to either check our positions or check completed/cancelled orders (easier?)
            // including cancelled orders in getOpenOrders() makes problems when we try to move them
            // an optional function resubmitCancelledOrder() called from order tracker seems the best coice?
            // also check for "Insufficient Margin" on cancelled orders, don't repeat them
            // "insufficient margin" errors are sometimes also just order timeouts, kraken very buggy: https://www.kraken.com/u/trade#tab=orders&otxid=OFRHG7-UGF3V-6CXQLX
            // or when we don't have enough money of that currency
            //if (params.postOnly)
                //outParams.oflags = "post";
            resolve(outParams)
        })
    }

    protected verifyExchangeResponse(body: string | false, response: request.RequestResponse, method: string) {
        return new Promise<any>((resolve, reject) => {
            if (!body)
                return reject({txt: "Error on exchange request", exchange: this.className, method: method, response: response})
            let json = utils.parseJson(body)
            // TODO add syncStrategyPosition() functino to RealTimeTrader
            if (!json)
                // set permanent. on kraken trades often get executed and we still get CF HTML
                return reject({txt: "Received invalid JSON from exchange", exchange: this.className, method: method, body: body, permanent: true})
            if (json.error && json.error.length !== 0) {
                const errorStr = json.error.toString();
                if (errorStr.indexOf("Unknown order") !== -1) // order already cancelled
                    return resolve(json)
                // Unable to fill order completely. <- TODO reject might cause problems in app logic if we trade on multiple exchanges ?
                return reject({txt: "Error on exchange API call", exchange: this.className, method: method, error: json.error})
            }
            resolve(json)
        })
    }
}
