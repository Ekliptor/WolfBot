// https://www.okex.com/rest_request.html

import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractExchange, ExOptions, ExApiKey, OrderBookUpdate, OpenOrders, OpenOrder, ExRequestParams, ExResponse, OrderParameters, MarginOrderParameters, CancelOrderResult, PushApiConnectionType} from "./AbstractExchange";
import {AbstractContractExchange} from "./AbstractContractExchange";
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



export class OKEXCurrencies implements Currency.ExchangeCurrencies {
    protected exchange: /*AbstractExchange*/OKEX;

    constructor(exchange: OKEX) {
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
        if (!str1 || !str2) // currency not supported by exchange
            return undefined;
        if (str1 === "USD")
            return str2.toLowerCase() + "_" + str1.toLowerCase()
        return str1.toLowerCase() + "_" + str2.toLowerCase() // reverse the order: BTC_USD -> USD_BTC
    }
    public getLocalPair(exchangePair: string): Currency.CurrencyPair {
        let pair = exchangePair.split("_")
        let cur1 = Currency.Currency[pair[0].toUpperCase()] // reverse the order back
        let cur2 = Currency.Currency[pair[1].toUpperCase()]
        if (!cur1 || !cur2)
            return undefined;
        if (cur2 == Currency.Currency.USD)
            return new Currency.CurrencyPair(cur2, cur1)
        return new Currency.CurrencyPair(cur1, cur2)
    }
    public toLocalTicker(exchangeTicker: any): Ticker.Ticker {
        let ticker = new Ticker.Ticker(this.exchange.getExchangeLabel());
        if (!exchangeTicker || !exchangeTicker.ticker) {
            logger.error("Received invalid exchange ticker data from %s", this.exchange.getClassName(), exchangeTicker)
            return undefined;
        }
        /**
         * { date: '1499608792',
              ticker:
               { buy: 2555.48,
                 coin_vol: 0, // TODO ?
                 contract_id: 20170714013,
                 day_high: 0, // TODO ?
                 day_low: 0,
                 high: 2621.44,
                 last: 2557.73,
                 low: 2534.6,
                 sell: 2559.99,
                 unit_amount: 100,
                 vol: 272042 } }
         */
        exchangeTicker = exchangeTicker.ticker;
        //ticker.currencyPair = this.getLocalPair(exchangeTicker[0]); set on request
        ticker.last = Ticker.Ticker.parseNumber(exchangeTicker.last);
        ticker.lowestAsk = Ticker.Ticker.parseNumber(exchangeTicker.sell);
        ticker.highestBid = Ticker.Ticker.parseNumber(exchangeTicker.buy);
        ticker.percentChange = 0;
        ticker.baseVolume = exchangeTicker.vol; // amount of contracts?
        ticker.quoteVolume = 0;
        ticker.isFrozen = false;
        ticker.high24hr = 0;
        ticker.low24hr = 0;
        return ticker;
    }

    public computeOkexPseudoMargin(forcedLiquidation: number, localPair: Currency.CurrencyPair) {
        // they show a real margin on their Website (different API)
        // but since we don't always trade with all our funds, yet use cross-margin mode, their real margin is a bit too high always too
        let book = this.exchange.getOrderBook().get(localPair.toString())
        if (!book)
            return 1.0;
        // check how close we are to the forced liquidation rate.
        let diff = Math.abs(helper.getDiffPercent(forcedLiquidation, book.getLast()))
        if (diff >= 30)
            return 1.0;
        return diff/100;
    }
    public toMarginAccountSummary(margins: any[]) {
        /**
         * {
            "force_liqu_price": "0.07",
            "holding": [
                {
                    "buy_amount": 1,
                    "buy_available": 0,
                    "buy_price_avg": 422.78,
                    "buy_price_cost": 422.78,
                    "buy_profit_real": -0.00007096,
                    "contract_id": 20141219012,
                    "contract_type": "this_week",
                    "create_date": 1418113356000,
                    "lever_rate": 10,
                    "sell_amount": 0,
                    "sell_available": 0,
                    "sell_price_avg": 0,
                    "sell_price_cost": 0,
                    "sell_profit_real": 0,
                    "symbol": "btc_usd"
                }
            ],
            "result": true
        }
         */
        let summary = new MarginAccountSummary();
        summary.currentMargin = 1.0;
        margins.forEach((margin) => {
            // in cross margin mode holding should only have 1 entry
            // TODO total value etc..
            if (margin.holding.length === 0)
                return; // no (previously) open positions in this market (for this contract time)
            //summary.pl += margin.holding[0].buy_profit_real + margin.holding[0].sell_profit_real; // shows realized p/l, we want the unrealized, use UPL from future_userinfo
            // use combined value of all margin positions (for this currency pair)
            if (this.exchange.getRawBalances())
                summary.pl = this.exchange.getRawBalances().info[margin.holding[0].symbol.substr(0, 3)].profit_unreal;
            const liquidationPrice = parseFloat(margin.force_liqu_price.replaceAll(",", ""));
            let currentMargin = this.computeOkexPseudoMargin(liquidationPrice, this.getLocalPair(margin.holding[0].symbol))
            if (summary.currentMargin > currentMargin)
                summary.currentMargin = currentMargin; // use the smallest value (mostly used for smartphone alerts)
        })
        return summary;
    }
    public getMarginPosition(margin: any, maxLeverage): MarginPosition {
        /**
         * { force_liqu_price: '4,414.65',
                      holding:
                       [ { buy_amount: 0,
                           buy_available: 0,
                           buy_price_avg: 2581.93728661,
                           buy_price_cost: 2581.93728661,
                           buy_profit_real: -0.01146224,
                           contract_id: 20170714013,
                           contract_type: 'this_week',
                           create_date: 1499422055000,
                           lever_rate: 20,
                           sell_amount: 3,
                           sell_available: 3,
                           sell_price_avg: 2558.53,
                           sell_price_cost: 2558.53,
                           sell_profit_real: -0.01412625,
                           symbol: 'btc_usd' } ],
                      result: true }
         */
        if (margin.holding.length === 0 || (margin.holding[0].buy_amount == 0 && margin.holding[0].sell_amount == 0))
            return null; // no position open
        let position = new MarginPosition(maxLeverage);
        if (margin.holding[0].buy_amount != 0) {
            position.amount = margin.holding[0].buy_amount;
            position.type = "long";
        }
        else {
            position.amount = margin.holding[0].sell_amount;
            position.type = "short";
        }
        position.liquidationPrice = parseFloat(margin.force_liqu_price.replaceAll(",", ""));
        // TODO this is in LTC or BTC, better always convert to BTC
        //position.pl = margin.holding[0].buy_profit_real + margin.holding[0].sell_profit_real;
        if (this.exchange.getRawBalances()) // TODO sometimes doesn't show when closing positions. if getBalance() hasn't been called yet
            position.pl = this.exchange.getRawBalances().info[margin.holding[0].symbol.substr(0, 3)].profit_unreal;
        return position;
    }
}

export class FutureContractTypeMap extends Map<string, string> { // (currency, contract type)
    constructor() {
        super()
    }

    public get(key: string) {
        return super.get(this.getKey(key));
    }
    public set(key: string, value: string) {
        return super.set(this.getKey(key), value) as FutureContractTypeMap; // return "this"
    }

    protected getKey(key: string) {
        const fullKey = key;
        if (key.indexOf("_") !== -1)
            key = key.substr(0, 3);
        if (key.toUpperCase().indexOf("USD") !== -1)
            key = fullKey.substr(4);
        return key.toUpperCase();
    }
}

export default class OKEX extends AbstractContractExchange {
    // also update contract value below
    protected static readonly FETCH_CURRENCIES = ["btc", "ltc", "eth", "etc", "bch", "btg", "xrp", "eos"]
    protected static readonly FETCH_PAIRS = ["btc_usd", "ltc_usd", "eth_usd", "etc_usd", "bch_usd", "btg_usd", "xrp_usd", "eos_usd"];
    //protected futureContractType: string = nconf.get("serverConfig:futureContractType");
    protected futureContractType = new FutureContractTypeMap();

    protected currencies: OKEXCurrencies;
    protected rawBalances: any = null; // needed for margin profit

    constructor(options: ExOptions) {
        super(options)
        this.publicApiUrl = "https://www.okex.com/api/v1/";
        this.privateApiUrl = this.publicApiUrl;
        //this.pushApiUrl = "wss://api.poloniex.com"; // for autobahn
        this.pushApiUrl = "wss://real.okex.com:10440/websocket/okcoinapi";
        this.pushApiConnectionType = PushApiConnectionType.WEBSOCKET;
        this.dateTimezoneSuffix = " GMT+0800"; // china, not needed here?
        this.serverTimezoneDiffMin = -480;
        this.exchangeLabel = Currency.Exchange.OKEX;
        //this.minTradingValue = 1.0; // for margin positions, min 1 contract (100 USD with BTC, 10 USD with LTC)
        this.minTradingValue = 0.09; // actually different for LTC and BTC, depending on contract value
        this.fee = 0.003; // only for opening positions
        this.maxLeverage = 20; // 20 or 10
        this.currencies = new OKEXCurrencies(this);
        this.webSocketTimeoutMs = nconf.get('serverConfig:websocketTimeoutMs')*6; // they don't send pings too often

        // TODO store & load last contract type on restart
        OKEX.FETCH_CURRENCIES.forEach((currency) => {
            this.futureContractType.set(currency.toUpperCase(), nconf.get("serverConfig:futureContractType"));
        })
        this.contractValues.set("BTC", 100);
        this.contractValues.set("LTC", 10);
        this.contractValues.set("ETH", 10);
        this.contractValues.set("ETC", 10);
        this.contractValues.set("BCH", 10);
        this.contractValues.set("BTG", 10);
        this.contractValues.set("XRP", 10);
        this.contractValues.set("EOS", 10);
    }

    public getRawBalances() {
        return this.rawBalances;
    }

    public repeatFailedTrade(error: any, currencyPair: Currency.CurrencyPair) {
        // see: https://www.okex.com/ws_request.html
        if (typeof error === "object") {
            /*
            if (error.error_code === 20007) // illegal parameter
                return false;
            else if (error.error_code === 20012) // risk rate bigger than 90% after opening position
                return false;
            */
            if (error.error_code === 20016) { // Close amount bigger than your open positions. the next time we fetch the margin position the amount should be correct
                // check if an open order exists on this error and cancel it. otherwise we might get this error repeatedly if moving the close order fails
                this.getOpenOrders(currencyPair).then((orders) => {
                    let cancelOps = [];
                    orders.orders.forEach((curOrder) => {
                        cancelOps.push(this.cancelOrder(currencyPair, curOrder.orderNumber))
                    })
                    return Promise.all(cancelOps)
                }).then((cancelResults) => {
                    if (cancelResults.length !== 0)
                        logger.verbose("cancelled %s %s %s orders", cancelResults.length, this.className, currencyPair.toString())
                }).catch((err) => {
                    logger.error("Error cancelling open orders %s %s after close error", this.className, currencyPair.toString(), err)
                })
                return true;
            }

            // happens when the difference between index and market price is too high. allow to return a custom timeout in this function and retry afterwards
            if (error.error_code === 20018) { // Order price cannot be more than 103% or less than 97% of the previous minute price
                if (!nconf.get("serverConfig:fallbackContractType"))
                    return false;
                else if (this.futureContractType.get(currencyPair.toString()) === nconf.get("serverConfig:fallbackContractType")) {
                    const msg = utils.sprintf("Can not retry %s %s order error because fallback contract type %s is already in use", this.className, currencyPair.toString(), nconf.get("serverConfig:fallbackContractType"));
                    logger.error(msg)
                    this.futureContractType.set(currencyPair.toString(), nconf.get("serverConfig:futureContractType")); // reset for next time
                    this.sendNotification("Order failed", msg);
                    return false;
                }
                // TODO risky since prices can be a lot different here. but usually aren't...
                this.futureContractType.set(currencyPair.toString(), nconf.get("serverConfig:fallbackContractType")) // spread is usually lower there
                return true; // will get set a new price from AbstractTrader
            }

            if (error.error_code >= 20001) // permanent errors
                return false;
        }
        return super.repeatFailedTrade(error, currencyPair);
    }

    public getTicker() {
        return new Promise<Ticker.TickerMap>((resolve, reject) => {
            let reqOps = []
            const fetchPairs = this.getFetchPairs();
            fetchPairs.forEach((fetchPair) => { // fetch all pairs and return a map
                let params = {
                    symbol: fetchPair,
                    contract_type: this.futureContractType.get(fetchPair)
                }
                reqOps.push(this.publicReq("future_ticker", params))
            })
            Promise.all(reqOps).then((tickerArr) => {
                let map = new Ticker.TickerMap()
                for (let i = 0; i < fetchPairs.length; i++)
                {
                    const localPair = this.currencies.getLocalPair(fetchPairs[i]);
                    let tickerObj = this.currencies.toLocalTicker(tickerArr[i])
                    tickerObj.currencyPair = localPair
                    map.set(localPair.toString(), tickerObj)
                }
                resolve(map)
                //resolve(Ticker.TickerMap.fromJson(ticker.ticker, this.currencies, this.getExchangeLabel()))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getIndexPrice() {
        return new Promise<Ticker.TickerMap>((resolve, reject) => {
            let reqOps = []
            const fetchPairs = this.getFetchPairs();
            fetchPairs.forEach((fetchPair) => { // fetch all pairs and return a map
                let params = {
                    symbol: fetchPair
                }
                reqOps.push(this.publicReq("future_index", params))
            })
            Promise.all(reqOps).then((tickerArr) => {
                let map = new Ticker.TickerMap()
                for (let i = 0; i < fetchPairs.length; i++)
                {
                    const localPair = this.currencies.getLocalPair(fetchPairs[i]);
                    let tickerObj = new Ticker.Ticker(this.exchangeLabel);
                    tickerObj.indexValue = tickerArr[i].future_index;
                    tickerObj.currencyPair = localPair
                    map.set(localPair.toString(), tickerObj)
                }
                resolve(map)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getBalances() {
        return new Promise<Currency.LocalCurrencyList>((resolve, reject) => {
            //reject({txt: "getBalances() is not available in " + this.className})
            let params = {}
            this.privateReq("future_userinfo", params).then((balance) => {
                //console.log(balance)
                /**
                 * { info:
                       { btc:
                          { account_rights: 0.07235068, // account equity
                            keep_deposit: 0,
                            profit_real: -0.09800064,
                            profit_unreal: 0,
                            risk_rate: 10000 },
                         ltc:
                          { account_rights: 1.99743826,
                            keep_deposit: 0,
                            profit_real: -4.02380858,
                            profit_unreal: 0,
                            risk_rate: 10000 } },
                      result: true }
                 */
                this.rawBalances = balance;
                let balances = {}
                this.getFetchCurrencies().forEach((currencyStr) => {
                    if (balance.info[currencyStr] === undefined)
                        return logger.error("Missing currency %s from %s while getting balance", currencyStr, this.className)
                    //let resultList = {}
                    balances[currencyStr] = balance.info[currencyStr].account_rights
                })
                resolve(Currency.fromExchangeList(balances, this.currencies))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getMarginAccountSummary() {
        return new Promise<MarginAccountSummary>((resolve, reject) => {
            // future_userinfo is for the whole account (until delivery)
            let reqOps = []
            const fetchPairs = this.getFetchPairs();
            fetchPairs.forEach((fetchPair) => { // fetch all pairs and return a map
                let params = {
                    symbol: fetchPair,
                    contract_type: this.futureContractType.get(fetchPair)
                }
                reqOps.push(this.privateReq("future_position", params))
            })
            Promise.all(reqOps).then((accountArr) => {
                resolve(this.currencies.toMarginAccountSummary(accountArr))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public fetchOrderBook(currencyPair: Currency.CurrencyPair, depth: number) {
        return new Promise<OrderBookUpdate<MarketOrder.MarketOrder>>((resolve, reject) => {
            const pairStr = this.currencies.getExchangePair(currencyPair)
            this.publicReq("future_depth", {
                symbol: pairStr,
                contract_type: this.futureContractType.get(pairStr)
            }).then((book) => {
                let orders = new OrderBookUpdate<MarketOrder.MarketOrder>(Date.now(), false);
                ["asks", "bids"].forEach((prop) => {
                    book[prop].forEach((o) => {
                        //orders[prop].push({rate: parseFloat(o[0]), amount: parseFloat(o[1])})
                        orders[prop].push(MarketOrder.MarketOrder.getOrder(currencyPair, this.getExchangeLabel(), o[1], o[0]))
                    })
                })
                resolve(orders)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public importHistory(currencyPair: Currency.CurrencyPair, start: Date, end: Date) {
        return new Promise<void>((resolve, reject) => {
            const pairStr = this.currencies.getExchangePair(currencyPair)
            const deliveryDate = utils.getUnixTimeStr(false, end)
            // TODO round "end" to the next friday and then go back according to our contract time
            // for quarterly contracts we use the real start date
            //start = utils.date.dateAdd(end, 'day', -12) // for weekely contracts. TODO figure out their logic here, it's not 1 week from 14 back to 3
            let tradeCount = 0;
            const stepCount = 300; // max from okex
            //let maxTid = 0; // TODO function to determin optimal start TID for our specified import range
            //let maxTid = 1409505654; // BTC
            let maxTid = 537982646; // LTC
            let lastTrade = null;
            let importNext = () => {
                this.privateReq("future_trades_history", {
                    symbol: pairStr,
                    date: deliveryDate, // the delivery date of the futures contract
                    since: maxTid // from the first transaction ID on
                }).then((history) => {
                    let trades = [];
                    history.forEach((poloTrade) => {
                        if (poloTrade.tid > maxTid)
                            maxTid = poloTrade.tid;
                        trades.push(Trade.Trade.fromJson(poloTrade, currencyPair, this.getExchangeLabel(), this.getFee(), this.getDateTimezoneSuffix()))
                    })
                    //console.log(maxTid)
                    tradeCount += trades.length;
                    Trade.storeTrades(db.get(), trades, (err) => {
                        if (err)
                            logger.error("Error storing trades", err)
                        if (trades.length > 0)
                            lastTrade = trades[trades.length-1];
                        logger.verbose("%s %s import at %s with %s trades", this.className, currencyPair.toString(), utils.getUnixTimeStr(true, lastTrade.date), tradeCount)
                        if (history.length >= stepCount)
                            setTimeout(importNext.bind(this), 500); // otherwise okex complains "request frequency too high"
                        else {
                            logger.info("Import of %s %s history has finished. Imported %s trades", this.className, currencyPair.toString(), tradeCount)
                            let history = new TradeHistory.TradeHistory(currencyPair, this.getExchangeLabel(), start, end);
                            if (tradeCount !== 0)
                                TradeHistory.addToHistory(db.get(), history)
                            return resolve();
                        }
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
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "buy() is not available in " + this.className})
        })
    }

    public sell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "sell() is not available in " + this.className})
        })
    }

    public cancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            reject({txt: "cancelOrder() is not available in " + this.className})
        })
    }

    public getOpenOrders(currencyPair: Currency.CurrencyPair) {
        return new Promise<OpenOrders>((resolve, reject) => {
            let outParams = {
                symbol: this.currencies.getExchangePair(currencyPair),
                contract_type: this.futureContractType.get(currencyPair.toString()),
                status: 1, // 1: unfilled  2: filled
                order_id: -1, // alternative to "status"
                current_page: 0,
                page_length: 50
            }
            this.privateReq("future_order_info", outParams).then((result) => {
                let orders = new OpenOrders(currencyPair, this.className);
                result.orders.forEach((o) => {
                    let type: "buy" | "sell" = (o.type === 1 || o.type === 4) ? "buy" : "sell"; // type: order type 1: open long, 2: open short, 3: close long, 4: close short -> buy/sell
                    let orderObj: OpenOrder = {orderNumber: o.order_id, type: type, rate: o.price, amount: o.amount, total: o.price*o.amount, leverage: this.maxLeverage}
                    orderObj.rawType = o.type;
                    orders.addOrder(orderObj)
                })
                resolve(orders)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public moveOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: OrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "moveOrder() is not available in " + this.className})
        })
    }

    public marginBuy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            let outParams;
            // convert coin amount to contracts
            // the amount of contracts getting opened is determined by the exchange: contracts = floor( amount / price * contractValue )
            // their API changed and now accepts the coin amount (will be rounded down to contracts on the server)
            amount = this.getContractAmount(currencyPair, rate, amount);
            //amount = Math.floor(amount * 1000) / 1000;
            //amount *= rate;
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((oP) => {
                outParams = oP;
                outParams.type = 1;
                //outParams.match_price = 1;
                return this.checkReducePosition(currencyPair, outParams)
            }).then((outParams) => {
                return this.privateReq("future_trade", outParams)
            }).then((result) => {
                // { order_id: 7199200432, result: true }
                this.verifyPositionSize(currencyPair, amount)
                resolve(OrderResult.fromJson(result, currencyPair, this))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public marginSell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            let outParams;
            amount = this.getContractAmount(currencyPair, rate, amount);
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((oP) => {
                outParams = oP;
                outParams.type = 2;
                return this.checkReducePosition(currencyPair, outParams)
            }).then((outParams) => {
                return this.privateReq("future_trade", outParams)
            }).then((result) => {
                this.verifyPositionSize(currencyPair, amount)
                resolve(OrderResult.fromJson(result, currencyPair, this))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public marginCancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            let outParams = {
                symbol: this.currencies.getExchangePair(currencyPair),
                contract_type: this.futureContractType.get(currencyPair.toString()),
                order_id: orderNumber
            }
            this.privateReq("future_cancel", outParams).then((result) => {
                resolve({exchangeName: this.className, orderNumber: orderNumber, cancelled: result.result == true})
            }).catch((err) => {
                // check if already filled (or cancelled)
                if (err.error_code === 20015)
                    return resolve({exchangeName: this.className, orderNumber: orderNumber, cancelled: true})
                reject(err)
            })
        })
    }

    public moveMarginOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            // OKEX doesn't have a "move order" function. so we have to cancel the order and place it again
            // they do have a batchOrder function, but each batch entry can fail/succeed independently
            let book = this.orderBook.get(currencyPair.toString())
            if (!book)
                return reject({txt: "No order book available to move order", exchange: this.className, currencyPair: currencyPair.toString()})
            let outParams;
            //amount = this.getContractAmount(currencyPair, rate, amount); // already in contract amount
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((oP) => {
                outParams = oP;
                // we don't know if it was a buy or sell order, so retrieve the order first
                return this.getOpenOrders(currencyPair)
            }).then((orders) => {
                if (orders.isOpenOrder(orderNumber)) {
                    if (rate * amount < this.minTradingValue)
                        return resolve(OrderResult.fromJson({message: "Remaining amount below min trading value can not be moved: " + rate * amount}, currencyPair, this))

                    this.marginCancelOrder(currencyPair, orderNumber).catch((err) => {
                        reject(err) // return the error
                        return Promise.reject(true)
                    }).then((result) => {
                        //outParams.orderNumber = orderNumber;
                        if (!result.cancelled) {
                            reject("Order to move can not be cancelled in " + this.className)
                            return Promise.reject(true)
                        }
                        //outParams.type = rate >= book.getAsk() ? 2 : 1;
                        //outParams.type = orders.getOrder(orderNumber).type === "sell" ? 2 : 1;
                        outParams.type = orders.getOrder(orderNumber).rawType;
                        outParams.amount = orders.getOrder(orderNumber).amount; // might be below min trading value now
                        if (outParams.amount > amount)
                            outParams.amount = this.getContractAmount(currencyPair, rate, outParams.amount / rate);
                        // TODO on okex close long/short orders can be "pending" and therefore moved. but our bot dosn't follow these orders
                        // TODO moving the close order cut the amount in half from 0.4 to 0.2 BTC. how?
                        return this.privateReq("future_trade", outParams)
                    }).then((result) => {
                        //console.log(result)
                        resolve(OrderResult.fromJson(result, currencyPair, this))
                    }).catch((err) => {
                        if (err === true)
                            return;
                        logger.error("Moving order %s in %s failed. Retrying...", currencyPair.toString(), this.className)
                        return this.privateReq("future_trade", outParams)
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
        })
    }

    public getAllMarginPositions() {
        return new Promise<MarginPositionList>((resolve, reject) => {
            // their website uses another call, that is not part of the public API: POST https://www.okex.com/future/refreshFutureFulLPri.do?t=1499635132895
            let reqOps = []
            const fetchPairs = this.getFetchPairs();
            fetchPairs.forEach((fetchPair) => { // fetch all pairs and return a map
                let params = {
                    symbol: fetchPair,
                    contract_type: this.futureContractType.get(fetchPair)
                }
                reqOps.push(this.privateReq("future_position", params))
            })
            Promise.all(reqOps).then((accountArr) => {
                let list = new MarginPositionList();
                for (let i = 0; i < accountArr.length; i++)
                {
                    let position = this.currencies.getMarginPosition(accountArr[i], this.getMaxLeverage());
                    if (position)
                        list.set(this.currencies.getLocalPair(fetchPairs[i]).toString(), position)
                }
                resolve(list)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<MarginPosition>((resolve, reject) => {
            let params = {
                symbol: this.currencies.getExchangePair(currencyPair),
                contract_type: this.futureContractType.get(currencyPair.toString())
            }
            this.privateReq("future_position", params).then((account) => {
                let position = this.currencies.getMarginPosition(account, this.getMaxLeverage());
                resolve(position)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public closeMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<OrderResult>((resolve, reject) => {
            // we don't know if we have to close long or short (or both, though our bot currently doesn't open contradicting positions)
            // get our position for this currency pair first
            let firstPosition: MarginPosition;
            this.verifyExchangeRequest(currencyPair).then((currencyPairStr) => {
                return this.getMarginPosition(currencyPair)
            }).then((position) => {
                if (!position) // TODO sometimes if position amount is too small (< 0.x) we also get the 20016 error. how to handle this?
                    return Promise.reject({txt: "No margin position available to close", exchange: this.getClassName(), pair: currencyPair.toString()})
                firstPosition = position;
                const lastRate = this.orderBook.get(currencyPair.toString()).getLast();
                const offset = nconf.get("serverConfig:closeRatePercentOffset");
                const closeRate = position.type === "short" ? lastRate + lastRate/100*offset : lastRate - lastRate/100*offset;
                let outParams: any = {
                    //price: 0, // use match price
                    price: closeRate,
                    symbol: this.currencies.getExchangePair(currencyPair),
                    lever_rate: this.maxLeverage,
                    contract_type: this.futureContractType.get(currencyPair.toString()),
                    amount: Math.abs(position.amount),
                    //match_price: 1, // match price often fails because it uses the last price at order time
                    match_price: 0,
                    type: position.type === "short" ? 4 : 3
                }
                return this.privateReq("future_trade", outParams)
            }).then((result) => {
                return new Promise<MarginPosition>((resolveSub, rejectSub) => {
                    // check again for a position in the other direction
                    // wait a bit so that the other position can be closed before // TODO api to check for both positions by 2nd parameter
                    setTimeout(() => {
                        // resolve the main function after the timer expired to ensure we don't close a position just opened
                        resolve(OrderResult.fromJson(result, currencyPair, this))
                        this.waitForOpenOrders(currencyPair).then(() => {
                            return this.getMarginPosition(currencyPair)
                        }).then((position) => {
                            resolveSub(position)
                        }).catch((err) => {
                            rejectSub(err)
                        })
                    }, nconf.get("serverConfig:delayPossible2ndPositionCloseSec")*1000)
                })
            }).then((position) => {
                //if (position && position.type !== firstPosition.type) { // shouldn't happen with openOppositePositions disabled, but be safe
                if (position) { // just check again for a position. sometimes the first order doesn't get through on OKEX. why?
                    logger.info("Closing 2nd open margin position for pair %s on %s", currencyPair.toString(), this.getClassName())
                    this.closeMarginPosition(currencyPair).then((orderResult) => {
                        // don't return this response
                        // reset it to default for the next opening, shouln't be needed here
                        this.futureContractType.set(currencyPair.toString(), nconf.get("serverConfig:futureContractType"));
                    }).catch((err) => {
                        logger.error("Error closing 2nd %s open margin position", currencyPair.toString(), err)
                        this.sendNotification("Error closing 2nd open margin position", utils.sprintf("CurrencyPair %s", currencyPair.toString()))
                        if (this.repeatFailedTrade(err, currencyPair)) {
                            this.closeMarginPosition(currencyPair).catch((err) => {
                                logger.error("Error closing 2nd open margin position (repeat)", err)
                                // TODO sometimes close orders don't get filled and wait pending forever
                            })
                        }
                    })
                }
                else
                    this.futureContractType.set(currencyPair.toString(), nconf.get("serverConfig:futureContractType")); // reset it to default for the next opening
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

            params.api_key = this.apiKey.key;
            params = this.signRequest(params) // signature shouldn't be needed for most these requests here
            let query = querystring.stringify(params);
            const urlStr = this.publicApiUrl + method + ".do?" + query;
            let options = {
                cloudscraper: true
            }
            this.get(urlStr, (body, response) => {
                this.verifyExchangeResponse(body, response, method).then((json) => {
                    resolve(json)
                }).catch((err) => {
                    reject(err)
                })
            }, options)
        })
    }

    protected privateReq(method: string, params: ExRequestParams = {}) {
        return new Promise<ExResponse>((resolve, reject) => {
            if (!this.privateApiUrl || !this.apiKey)
                return reject({txt: "PrivateApiUrl and apiKey must be provided for private exchange request", exchange: this.className})

            params.api_key = this.apiKey.key;
            params = this.signRequest(params)
            let options = {
                retry: false, // don't retry
                cloudscraper: true
            }
            const urlStr = this.privateApiUrl + method + ".do";
            this.post(urlStr, params, (body, response) => {
                this.verifyExchangeResponse(body, response, method).then((json) => {
                    resolve(json)
                }).catch((err) => {
                    reject(err)
                })
            }, options)
        })
    }

    protected signRequest(params: ExRequestParams) {
        let data = utils.objects.sortByKey(Object.assign({}, params));
        let signData = Object.assign({}, data);
        signData.secret_key = this.apiKey.secret;
        data.sign = crypto.createHash('md5').update(querystring.stringify(signData), 'utf8').digest('hex').toUpperCase();
        return data;
    }

    protected createConnection(): autobahn.Connection {
        return null;
    }

    protected createWebsocketConnection(): WebSocket {
        let conn: WebSocket = new WebSocket(this.pushApiUrl, this.getWebsocketOptions());
        const marketEventStreamMap = new Map<string, EventStream<any>>(); // (exchange currency name, stream instance)
        //this.localSeqNr = 0; // keep counting upwards

        conn.onopen = (e) => {
            //conn.send(JSON.stringify({event: "addChannel", channel: "ok_sub_futureusd_btc_trade_this_week"}));

            this.updateOrderBooks(false); // we get it through the WebSocket connection
            this.currencyPairs.forEach((pair) => {
                let marketPair = this.currencies.getExchangePair(pair);
                // every market has their own sequence numbers on poloniex. we have to ensure they are piped in order
                let marketEventStream = new EventStream<any>(this.className + "-Market-" + marketPair, this.maxPendingMarketEvents);
                this.openMarketRelays.push(marketEventStream);
                marketEventStreamMap.set(pair.toString(), marketEventStream); // use local pairs here
                marketEventStream.on("value", (value, seqNr) => {
                    this.marketStream.write(pair, value, seqNr);
                })
                const exchangePairParts = marketPair.split("_")
                let channel = utils.sprintf("ok_sub_future_%s_depth_%s_%s", exchangePairParts[0], this.futureContractType.get(marketPair), exchangePairParts[1]); // orders
                conn.send(JSON.stringify({event: "addChannel", channel: channel})); // subscribe to this channel first because it contains a timestamp
                channel = utils.sprintf("ok_sub_future%s_%s_trade_%s", exchangePairParts[1], exchangePairParts[0], this.futureContractType.get(marketPair)); // trades
                conn.send(JSON.stringify({event: "addChannel", channel: channel}));

                this.orderBook.get(pair.toString()).setSnapshot([], this.localSeqNr); // we receive an implicit snapshot with the first response
            })
            //conn.send(JSON.stringify({event: "addChannel", channel: "ok_sub_futureusd_positions"})); // needs apiKey and sign
            this.scheduleWebsocketPing(() => {
                conn.send(JSON.stringify({event: "ping"}));
            }, 30000)
        }

        conn.onmessage = (e) => {
            this.resetWebsocketTimeout(); // timeouts don't work properly for this socket
            this.localSeqNr++;
            //this.localSeqNr = Date.now(); // bad idea because we emit early if nextSeq === lastSeqNr+1
            try {
                if (typeof e.data !== "string")
                    throw new Error("Received data with invalid type " + typeof e.data);
                const msg = JSON.parse(e.data);
                if (!msg[0] || !msg[0].channel || !msg[0].data) {
                    if (msg.event !== "pong")
                        logger.error("Received WebSocket message in unknown format in %s", this.className, msg)
                    return;
                }
                else if (msg[0].channel === "addChannel")
                    return; // confirmation message
                if (msg[0].data.error_code)
                    return logger.error("%s WebSocket API error:", this.className, msg[0].data)

                // global events
                if (msg[0].channel === "ok_sub_futureusd_positions") {
                    //console.log(msg[0].data)
                    return;
                }
                else if (msg[0].channel && msg[0].channel.indexOf("_forecast_price") !== -1) // btc_forecast_price
                    return; // sent without subscribing to it. bug?

                const currencyPair = this.getCurrencyFromChannel(msg[0].channel);
                if (!currencyPair)
                    return;
                let marketEventStream = marketEventStreamMap.get(currencyPair.toString());
                if (!marketEventStream) {
                    logger.error("Received %s market update for currency pair %s we didn't subscribe to: ", currencyPair, this.className, msg[0]);
                    return;
                }
                const actionType = this.getActionTypeFromChannel(msg[0].channel);
                if (msg[0].data && msg[0].data.timestamp) // in bids/asks
                    this.lastServerTimestampMs = msg[0].data.timestamp;

                if (actionType === "trade") {
                    let trades = [];
                    //console.log(new Date(), "<- NOW")
                    msg[0].data.forEach((trade) => {
                        // for trades: [tid, price, amount, time, type, amountbtc] - all strings, type = ask|bid, amountbtc mostly null
                        // to: [ 't', '25969600', 0, '0.09718515', '0.53288249', 1496175981 ]
                        // type 1 = buy, 0 = sell
                        //let date = this.setDateByStr(new Date(), trade[3]);
                        //let timestamp = Math.floor(this.getLocalTimestampMs(date) / 1000);
                        let date = this.setDateByStr(new Date(this.lastServerTimestampMs), trade[3]);
                        let timestamp = Math.floor(date.getTime() / 1000);
                        //console.log(new Date(timestamp*1000), new Date(this.lastServerTimestampMs), new Date())
                        trades.push(["t", trade[0], trade[4] === "ask" ? 1 : 0, trade[1], trade[2], timestamp])
                    })
                    marketEventStream.add(this.localSeqNr, trades);
                }
                else if (actionType === "order") {
                    let orders = [];
                    //console.log(msg[0].data)
                    if (msg[0].data.asks) { // now they sometimes only send ask/bid updates
                        msg[0].data.asks.forEach((order) => {
                            // for orders: [Price, Amount(Contract), Amount(Coin),Cumulant(Coin),Cumulant(Contract)]
                            // [ 'o', 1, '0.09520000', '8.74681417' ] // add 1, remove 0
                            orders.push(["o", order[1] == 0 ? 0 : 1, order[0], order[2]])
                        })
                    }
                    if (msg[0].data.bids) {
                        msg[0].data.bids.forEach((order) => {
                            orders.push(["o", order[1] == 0 ? 0 : 1, order[0], order[2]])
                        })
                    }
                    marketEventStream.add(this.localSeqNr, orders);
                }
                else
                    logger.error("Received unknown action type %s from %s", actionType, this.className)
                //console.log(msg[0].data)
            }
            catch (err) {
                logger.error("Error parsing %s websocket message", this.className, err);
            }
        }

        conn.onerror = (err) => {
            logger.error("WebSocket error in %s", this.className, err);
            this.closeConnection("WebSocket error")
        }

        conn.onclose = (event) => {
            let reason = "Unknown error"; // TODO this happens every 5min. OKEX resets the connection?
            if (event && event.reason)
                reason = event.reason;
            this.onConnectionClose(reason);
        }
        return conn;
    }

    protected getCurrencyFromChannel(channel: string): Currency.CurrencyPair {
        const fetchPairs = this.getFetchPairs();
        for (let i = 0; i < fetchPairs.length; i++)
        {
            let pair = fetchPairs[i].split("_");
            // accept it as soon as both pairs are present. some channels have weird names
            if (channel.indexOf(pair[0]) !== -1 && channel.indexOf(pair[1]) !== -1) {
                let pair = this.currencies.getLocalPair(fetchPairs[i])
                //return new Currency.CurrencyPair(pair.to, pair.from)
                return pair;
            }
        }
        logger.error("Unable to get currency from channel in %s: %s", this.className, channel)
        return null;
    }

    protected getActionTypeFromChannel(channel: string): "trade" | "order" {
        if (channel.indexOf("_trade_") !== -1)
            return "trade";
        if (channel.indexOf("_depth_") !== -1)
            return "order";
        logger.error("Unknown channel type in %s: %s", this.className, channel)
        return null;
    }

    protected checkReducePosition(currencyPair: Currency.CurrencyPair, outParams: ExRequestParams) {
        return new Promise<ExRequestParams>((resolve, reject) => {
            this.getMarginPosition(currencyPair).then((position) => {
                if (!position)
                    return resolve(outParams)
                //outParams.type = position.type === "short" ? 4 : 3;
                // TODO sometimes TakeProfitPartial still opens an opposite position. why?
                if (position.type === "short" && outParams.type === 1)
                    outParams.type = 4; // reduce short position
                else if (position.type === "long" && outParams.type === 2)
                    outParams.type = 3; // reduce long position
                resolve(outParams)
            }).catch((err) => {
                logger.error("Error checking whether to reduce existing position", err)
                resolve(outParams) // continue
            })
        })
    }

    protected verifyPositionSize(currencyPair: Currency.CurrencyPair, amount: number) {
        // TODO sometimes order doesn't get fully executed and just disappears. why? for example order 1.2 BTC -> position 0.3 BTC
        // query positions after order and verify if amount matches? also for close orders
        // TODO doesn't work if we allow opening opposite positions (hedging)
        return new Promise<void>((resolve, reject) => {
            setTimeout(() => {
                this.getMarginPosition(currencyPair).then((position) => {
                    if (!position) {
                        if (amount != 0)
                            logger.error("%s %s position not found. Expected position amount %s", currencyPair.toString(), this.className, amount)
                        return resolve()
                    }

                    const rate = this.ticker.get(currencyPair.toString()).last;
                    let contractAmount = this.getContractAmount(currencyPair, rate, Math.abs(amount) / rate)
                    let diff = Math.abs(helper.getDiffPercent(Math.abs(position.amount), /*contractAmount*/amount))
                    if (diff > 1.0)
                        logger.error("%s %s position has the wrong size. Expected position amount %s (%s contracts), found %s, %s percent", currencyPair.toString(), this.className, amount, contractAmount,
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
            if (amount > 0 && rate * amount < this.minTradingValue)
                return reject({txt: "Value is below the min trading value", exchange: this.className, value: rate*amount, minTradingValue: this.minTradingValue, permanent: true})

            let outParams: any = {
                price: rate,
                contract_type: this.futureContractType.get(currencyPair.toString())
            }
            if (amount != 0) // negative for short sells
                outParams.amount = amount;
            if (currencyPair)
                outParams.symbol = this.currencies.getExchangePair(currencyPair)
            outParams.lever_rate = this.maxLeverage;
            /*
            for (let prop in params)
            {
                if (params[prop])
                    outParams[prop] = 1
            }
            */
            outParams.match_price = params.matchBestPrice ? 1 : 0;
            if (params.matchBestPrice)
                outParams.price = this.orderBook.get(currencyPair.toString()).getLast(); // avoid error 20018 invalid price on fast moving markets
            resolve(outParams)
        })
    }

    protected verifyExchangeResponse(body: string | false, response: request.RequestResponse, method: string) {
        return new Promise<any>((resolve, reject) => {
            if (!body)
                return reject({txt: "Error on exchange request", exchange: this.className, method: method, response: response})
            let json = utils.parseJson(body)
            if (!json)
                return reject({txt: "Received invalid JSON from exchange", exchange: this.className, method: method, body: body})
            if (json.error_code) {
                return reject({txt: "Error on exchange API call", exchange: this.className, method: method, error_code: json.error_code})
            }
            resolve(json)
        })
    }

    protected getFetchPairs() {
        // only fetch data for currencies we are interested in
        let fetchPairs = []
        for (let i = 0; i < this.currencyPairs.length; i++)
        {
            const pairArr = this.currencyPairs[i].toString().split("_");
            for (let u = 0; u < pairArr.length; u++) // should only have 2 entries
            {
                if (pairArr[u] === "USD")
                    continue;
                const pairPos = OKEX.FETCH_PAIRS.indexOf(pairArr[u].toLowerCase() + "_usd");
                if (pairPos !== -1)
                    fetchPairs.push(OKEX.FETCH_PAIRS[pairPos])
                else
                    logger.error("Unable to get %s currency pair %s to fetch", this.className, pairArr[u])

            }
        }
        return fetchPairs;
    }

    protected getFetchCurrencies() {
        // only fetch data for currencies we are interested in
        let fetchCurrencies = []
        for (let i = 0; i < this.currencyPairs.length; i++)
        {
            const pairArr = this.currencyPairs[i].toString().split("_");
            for (let u = 0; u < pairArr.length; u++) // should only have 2 entries
            {
                if (pairArr[u] === "USD")
                    continue;
                const currencyPos = OKEX.FETCH_CURRENCIES.indexOf(pairArr[u].toLowerCase());
                if (currencyPos !== -1)
                    fetchCurrencies.push(OKEX.FETCH_CURRENCIES[currencyPos])
                else
                    logger.error("Unable to get %s currency %s to fetch", this.className, pairArr[u])

            }
        }
        return fetchCurrencies;
    }
}