// https://www.okex.com/rest_request.html
// https://www.okex.com/docs/en/
// official API client: https://github.com/okcoin-okex/okex-api-v3-node-sdk

import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractExchange, ExOptions, ExApiKey, OrderBookUpdate, OpenOrders, OpenOrder, ExRequestParams, ExResponse, OrderParameters, MarginOrderParameters, CancelOrderResult, PushApiConnectionType} from "./AbstractExchange";
import {AbstractContractExchange} from "./AbstractContractExchange";
import {OrderResult} from "../structs/OrderResult";
import {MarginPosition, MarginPositionList} from "../structs/MarginPosition";
import MarginAccountSummary from "../structs/MarginAccountSummary";
import * as request from "request";
import * as db from "../database";
import * as helper from "../utils/helper";
//import * as pako from "pako";
import EventStream from "../Trade/EventStream";
import {Currency, Ticker, Trade, TradeHistory, MarketOrder} from "@ekliptor/bit-models";
import {MarketAction} from "../Trade/MarketStream";
import {OrderBook} from "../Trade/OrderBook";
import * as okexApi from "@okfe/okex-node";



const OKEX_TIMEZONE_SUFFIX = " GMT+0800";

export class OKEXCurrencies implements Currency.ExchangeCurrencies {
    protected exchange: /*AbstractExchange*/OKEX;

    constructor(exchange: OKEX) {
        this.exchange = exchange;
    }

    public getExchangeName(localCurrencyName: string): string {
        return localCurrencyName.toUpperCase()
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
            return str2.toUpperCase() + "_" + str1.toUpperCase()
        return str1.toUpperCase() + "_" + str2.toUpperCase() // reverse the order: BTC_USD -> USD_BTC
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
        if (!exchangeTicker || !exchangeTicker.instrument_id) {
            logger.error("Received invalid exchange ticker data from %s", this.exchange.getClassName(), exchangeTicker)
            return undefined;
        }
        /**
         * { instrument_id: 'BTC-USD-190628',
                last: '4096.8',
                best_bid: '4096.79',
                best_ask: '4096.8',
                high_24h: '4108',
                low_24h: '4027.89',
                volume_24h: '2399064',
                timestamp: '2019-04-01T14:25:24.124Z' }
         */
        //ticker.currencyPair = this.getLocalPair(exchangeTicker[0]); set on request
        ticker.last = Ticker.Ticker.parseNumber(exchangeTicker.last);
        ticker.lowestAsk = Ticker.Ticker.parseNumber(exchangeTicker.best_ask);
        ticker.highestBid = Ticker.Ticker.parseNumber(exchangeTicker.best_bid);
        ticker.baseVolume = exchangeTicker.volume_24h; // amount of contracts?
        ticker.quoteVolume = 0;
        ticker.isFrozen = false;
        ticker.high24hr = Ticker.Ticker.parseNumber(exchangeTicker.high_24h);
        ticker.low24hr = Ticker.Ticker.parseNumber(exchangeTicker.low_24h);
        //const priceDiff = helper.getDiffPercent(ticker.last, yesterdayRate);
        // pseudo value to not have 0 in case a strategy checks if price increasing (normally strategies use raw trades + candles, not ticker)
        const median = (ticker.high24hr + ticker.low24hr) / 2.0;
        ticker.percentChange = ticker.last > median ? 1.0 : -1.0;
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
        let summary = new MarginAccountSummary();
        summary.currentMargin = 1.0;
        const balances = this.exchange.getRawBalances();
        margins.forEach((margin) => {
            // TODO add total value etc...
            // in cross margin mode holding should only have 1 entry
            if (margin.holding.length === 0)
                return; // no (previously) open positions in this market (for this contract time)
            let accountBalance = balances ? balances.get(margin.pair) : null;
            //summary.pl += margin.holding[0].buy_profit_real + margin.holding[0].sell_profit_real; // shows realized p/l, we want the unrealized, use UPL from future_userinfo
            // use combined value of all margin positions (for this currency pair)
            if (accountBalance)
                summary.pl = helper.parseFloatVal(accountBalance.unrealized_pnl.replaceAll(",", ""));
            const liquidationPrice = helper.parseFloatVal(margin.holding[0].liquidation_price.replaceAll(",", ""));
            let currentMargin = this.computeOkexPseudoMargin(liquidationPrice, margin.pair);
            if (summary.currentMargin > currentMargin)
                summary.currentMargin = currentMargin; // use the smallest value (mostly used for smartphone alerts)
        })
        return summary;
    }
    public getMarginPosition(margin: any, maxLeverage): MarginPosition {
        /**
         * { result: true,
                holding:
                 [ { long_qty: '2',
                     long_avail_qty: '2',
                     long_avg_cost: '141.76499982',
                     long_settlement_price: '141.76499982',
                     realised_pnl: '-0.00003527',
                     short_qty: '0',
                     short_avail_qty: '0',
                     short_avg_cost: '0',
                     short_settlement_price: '0',
                     liquidation_price: '110.195',
                     instrument_id: 'ETH-USD-190628',
                     leverage: '20',
                     created_at: '2019-04-01T19:07:36.000Z',
                     updated_at: '2019-04-01T21:14:50.000Z',
                     margin_mode: 'crossed' } ],
                margin_mode: 'crossed' }
         */
        if (margin.holding.length === 0 || (margin.holding[0].long_qty == 0 && margin.holding[0].short_qty == 0))
            return null; // no position open
        let position = new MarginPosition(maxLeverage);
        if (margin.holding[0].long_qty != 0) {
            position.amount = margin.holding[0].long_qty;
            position.type = "long";
        }
        else {
            position.amount = margin.holding[0].short_qty;
            position.type = "short";
        }
        position.liquidationPrice = helper.parseFloatVal(margin.holding[0].liquidation_price.replaceAll(",", ""));
        // TODO this is in LTC or BTC, better always convert to base currency
        const balances = this.exchange.getRawBalances();
        if (balances && balances.has(margin.pair) === true) {
            const balance = balances.get(margin.pair);
            position.pl = helper.parseFloatVal(balance.unrealized_pnl.replaceAll(",", ""));
        }
        return position;
    }
}

type OkexContractAlias = "this_week" | "next_week" | "quarter";

class OKEXInstrument {
    public instrument_id: string; // unique ID, BTC-USD-190405
    public underlying_index: string; // BTC
    public quote_currency: string; // USD
    public tick_size: number; // 0.01
    public contract_val: number; // 100
    public listing: Date; // 2019-03-22
    public delivery: Date; // 2019-04-05
    public trade_increment: number; // 1
    public alias: OkexContractAlias;

    constructor() {
    }
    public validate() {
        if (typeof this.tick_size === "string")
            this.tick_size = parseFloat(this.tick_size || "0");
        if (typeof this.contract_val === "string")
            this.contract_val = parseFloat(this.contract_val || "100");
        if (typeof this.listing === "string")
            this.listing = new Date(this.listing + OKEX_TIMEZONE_SUFFIX);
        if (typeof this.delivery === "string")
            this.delivery = new Date(this.delivery + OKEX_TIMEZONE_SUFFIX);
        if (typeof this.trade_increment === "string")
            this.trade_increment = parseFloat(this.trade_increment || "1");
    }
}

class OKEXContracts extends Map <string, OKEXInstrument> { // (currency, instrument)
    constructor() {
        super()
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
    protected static readonly FETCH_CURRENCIES = ["BTC", "LTC", "ETH", "ETC", "BCH", "XRP", "EOS", "BSV"]
    protected static readonly FETCH_PAIRS = ["USD_BTC", "USD_LTC", "USD_ETH", "USD_ETC", "USD_BCH", "USD_XRP", "USD_EOS", "USD_BSV"];
    protected static readonly RELOAD_CONTRACT_TYPES_H = 8;
    //protected futureContractType: string = nconf.get("serverConfig:futureContractType");
    protected futureContractType = new FutureContractTypeMap();
    protected contractTypes = new OKEXContracts();
    protected wssClient: okexApi.V3WebsocketClient;
    protected pClient: /*okexApi.PublicClient*/any; // TODO wait for typings
    protected authClient: /*okexApi.AuthenticatedClient*/any;

    protected currencies: OKEXCurrencies;
    protected rawBalances = new Map<string, any>(); // (currency pair, balance) // needed for margin profit
    protected lastLoadedContractTypes = new Date(0);

    constructor(options: ExOptions) {
        super(options)
        this.publicApiUrl = "https://www.okex.com/api/"; // url values here are not used, we use internal defaults of the official API client
        this.privateApiUrl = this.publicApiUrl;
        this.pushApiUrl = "wss://real.okex.com:10442/ws/v3";
        this.pushApiConnectionType = PushApiConnectionType.API_WEBSOCKET;
        this.dateTimezoneSuffix = OKEX_TIMEZONE_SUFFIX; // china, not needed here?
        this.serverTimezoneDiffMin = -480;
        this.exchangeLabel = Currency.Exchange.OKEX;
        //this.minTradingValue = 1.0; // for margin positions, min 1 contract (100 USD with BTC, 10 USD with LTC)
        this.minTradingValue = 0.09; // actually different for LTC and BTC, depending on contract value
        this.fee = 0.003; // only for opening positions // https://www.okex.com/pages/products/fees.html
        this.maxLeverage = 20; // 20 or 10
        this.currencies = new OKEXCurrencies(this);
        this.webSocketTimeoutMs = nconf.get('serverConfig:websocketTimeoutMs')*6; // they don't send pings too often

        this.pClient = okexApi.PublicClient();
        this.authClient = okexApi.AuthenticatedClient(this.apiKey.key, this.apiKey.secret, this.apiKey.passphrase);

        // TODO store & load last contract type on restart
        OKEX.FETCH_CURRENCIES.forEach((currency) => {
            this.futureContractType.set(currency.toUpperCase(), nconf.get("serverConfig:futureContractType"));
        })
        this.contractValues.set("BTC", 100);
        this.contractValues.set("LTC", 10);
        this.contractValues.set("ETH", 10);
        this.contractValues.set("ETC", 10);
        this.contractValues.set("BCH", 10);
        this.contractValues.set("XRP", 10);
        this.contractValues.set("EOS", 10);
        this.contractValues.set("BSV", 10);
        this.loadContractTypes();
    }

    public getRawBalances() {
        return this.rawBalances;
    }

    public repeatFailedTrade(error: any, currencyPair: Currency.CurrencyPair) {
        // TODO improve error handling for new api
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
            /*
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
            */

            if (error.error_code >= 20001) // permanent errors
                return false;
        }
        return super.repeatFailedTrade(error, currencyPair);
    }

    public getTicker() {
        return new Promise<Ticker.TickerMap>((resolve, reject) => {
            let reqOps = []
            const fetchPairs = this.getFetchPairs();
            let map = new Ticker.TickerMap();
            this.loadContractTypes().then(() => {
                fetchPairs.forEach((fetchPair) => {
                    let instrument = this.contractTypes.get(fetchPair);
                    if (instrument === undefined) {
                        logger.warn("No instrument ID available for pair %s in %s", fetchPair, this.className);
                        return;
                    }
                    reqOps.push(this.pClient.futures().getTicker(instrument.instrument_id));
                });
                return Promise.all(reqOps);
            }).then((tickers) => {
                for (let i = 0; i < fetchPairs.length; i++)
                {
                    const localPair = this.currencies.getLocalPair(fetchPairs[i]);
                    let tickerObj = this.currencies.toLocalTicker(tickers[i]);
                    if (!tickerObj)
                        continue;
                    tickerObj.currencyPair = localPair
                    map.set(localPair.toString(), tickerObj)
                }
                resolve(map);
            }).catch((err) => {
                logger.error("Error fetching %s tickers", this.className, err);
                resolve(map);
            });
        })
    }

    public getIndexPrice() {
        return new Promise<Ticker.TickerMap>((resolve, reject) => {
            let reqOps = []
            const fetchPairs = this.getFetchPairs();
            let map = new Ticker.TickerMap();
            this.loadContractTypes().then(() => {
                fetchPairs.forEach((fetchPair) => {
                    let instrument = this.contractTypes.get(fetchPair);
                    if (instrument === undefined) {
                        logger.warn("No instrument ID available for pair %s in %s", fetchPair, this.className);
                        return;
                    }
                    reqOps.push(this.pClient.futures().getIndex(instrument.instrument_id));
                });
                return Promise.all(reqOps);
            }).then((tickers) => {
                for (let i = 0; i < fetchPairs.length; i++)
                {
                    const localPair = this.currencies.getLocalPair(fetchPairs[i]);
                    let tickerObj = new Ticker.Ticker(this.exchangeLabel);
                    tickerObj.indexValue = tickers[i].index;
                    tickerObj.currencyPair = localPair;
                    map.set(localPair.toString(), tickerObj)
                }
                resolve(map);
            }).catch((err) => {
                logger.error("Error fetching %s future index prices", this.className, err);
                resolve(map);
            });
        })
    }

    public getBalances() {
        return new Promise<Currency.LocalCurrencyList>((resolve, reject) => {
            /*
            this.authClient.account().getWallet("").then((balance: any[]) => { // get all currencies // shows 0 after money is moved into futures account
                /**
                 * { balance: 0.0422543,
                        available: 0.0422543,
                        currency: 'ETH',
                        hold: 0 }
                 ******
                this.rawBalances = balance;
                let balances = {}
                let fetchCurrencies = this.getFetchCurrencies();
                for (let i = 0; i < balance.length; i++)
                {
                    const currencyPos = fetchCurrencies.indexOf(balance[i].currency);
                    if (currencyPos === -1)
                        continue;
                    const currencyStr = fetchCurrencies[currencyPos];
                    balances[currencyStr] = balance[i].balance; // or use available?
                }
                resolve(Currency.fromExchangeList(balances, this.currencies))
            }).catch((err) => {
                reject(err)
            });
            */
            let reqOps = []
            const fetchCurrencies = this.getFetchCurrencies();
            fetchCurrencies.forEach((fetchCurrency) => { // fetch all pairs and return a map
                reqOps.push(this.authClient.futures().getAccounts(fetchCurrency));
                //this.authClient.futures().getAccounts(instrument_id)
            });
            Promise.all(reqOps).then((accountArr) => {
                /** getAccounts()
                 * { equity: '0.00000041',
                        margin: '0',
                        realized_pnl: '0',
                        unrealized_pnl: '0',
                        margin_ratio: '10000',
                        margin_mode: 'crossed',
                        total_avail_balance: '0.00000041',
                        margin_frozen: '0',
                        margin_for_unfilled: '0' }
                 */
                let balances = {}
                for (let i = 0; i < fetchCurrencies.length; i++)
                {
                    const currencyStr = fetchCurrencies[i];
                    this.rawBalances.set(currencyStr, accountArr[i]);
                    balances[currencyStr] = helper.parseFloatVal(accountArr[i].total_avail_balance); // is this total?
                }
                resolve(Currency.fromExchangeList(balances, this.currencies))
            }).catch((err) => {
                reject(err)
            });
        })
    }

    public getMarginAccountSummary() {
        return new Promise<MarginAccountSummary>((resolve, reject) => {
            let reqOps = []
            const fetchPairs = this.getFetchPairs();
            this.loadContractTypes().then(() => {
                fetchPairs.forEach((fetchPair) => { // fetch all pairs and return a map
                    let contract = this.contractTypes.get(fetchPair);
                    reqOps.push(this.authClient.futures().getPosition(contract.instrument_id));
                });
                return Promise.all(reqOps);
            }).then((positions: any[]) => {
                /**
                 * { result: true,
                        holding:
                         [ { long_qty: '0',
                             long_avail_qty: '0',
                             long_avg_cost: '0',
                             long_settlement_price: '0',
                             realised_pnl: '0',
                             short_qty: '0',
                             short_avail_qty: '0',
                             short_avg_cost: '0',
                             short_settlement_price: '0',
                             liquidation_price: '0',
                             instrument_id: 'ETH-USD-190628',
                             leverage: '10',
                             created_at: '1970-01-01T00:00:00.000Z',
                             updated_at: '1970-01-01T00:00:00.000Z',
                             margin_mode: 'crossed' } ] }
                 */
                // add pair to it for easier processing
                for (let i = 0; i < fetchPairs.length; i++)
                    positions[i].pair = fetchPairs[i];
                resolve(this.currencies.toMarginAccountSummary(positions))
            }).catch((err) => {
                reject(err)
            });
        })
    }

    public fetchOrderBook(currencyPair: Currency.CurrencyPair, depth: number) {
        return new Promise<OrderBookUpdate<MarketOrder.MarketOrder>>((resolve, reject) => {
            const pairStr = currencyPair.toString();
            this.loadContractTypes().then(() => {
                const instrument = this.contractTypes.get(pairStr);
                if (instrument === undefined)
                    return Promise.reject({txt: "Instrument for currency pair doesn't exist", currencyPair: pairStr});
                return this.pClient.futures().getBook(instrument.instrument_id, {size: 200});
            }).then((book) => {
                // https://www.okex.com/docs/en/#futures-data
                // [ 142.452, 22, 0, 1 ], -> [price, size of price ( == amount??), number liquidation orders, number orders]
                let orders = new OrderBookUpdate<MarketOrder.MarketOrder>(Date.now(), false);
                ["asks", "bids"].forEach((prop) => {
                    book[prop].forEach((o) => {
                        orders[prop].push(MarketOrder.MarketOrder.getOrder(currencyPair, this.getExchangeLabel(), o[1], o[0]))
                    });
                })
                resolve(orders)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public importHistory(currencyPair: Currency.CurrencyPair, start: Date, end: Date) {
        return new Promise<void>((resolve, reject) => {
            const pairStr = currencyPair.toString();
            this.loadContractTypes().then(() => {
                const instrument = this.contractTypes.get(pairStr);
                if (instrument === undefined)
                    return Promise.reject({txt: "Instrument for currency pair doesn't exist", currencyPair: pairStr});

                //const deliveryDate = utils.getUnixTimeStr(false, end)
                let tradeCount = 0;
                let currentPage = 1;
                const stepCount = 100; // max for new okex
                let lastTrade = null;
                let importNext = () => {
                    // TODO this api call doesn't give lots of history. find a better one?
                    this.pClient.futures().getTrades(instrument.instrument_id, {
                        from: currentPage,
                        to: currentPage+1,
                        limit: stepCount
                    }).then((history) => {
                        currentPage++;
                        let trades = [];
                        history.forEach((rawTrade) => {
                            trades.push(this.fromRawTrade(rawTrade, currencyPair));
                        });
                        tradeCount += trades.length;
                        Trade.storeTrades(db.get(), trades, (err) => {
                            if (err)
                                logger.error("Error storing trades", err)
                            if (trades.length > 0)
                                lastTrade = trades[trades.length-1];
                            logger.verbose("%s %s import at %s with %s trades", this.className, currencyPair.toString(), utils.getUnixTimeStr(true, lastTrade.date), tradeCount)
                            if (history.length >= stepCount) // continue importing if we received max results
                                setTimeout(importNext.bind(this), 500); // otherwise okex complains "request frequency too high"
                            else {
                                logger.info("Import of %s %s history has finished. Imported %s trades", this.className, currencyPair.toString(), tradeCount)
                                let history = new TradeHistory.TradeHistory(currencyPair, this.getExchangeLabel(), start, end);
                                if (tradeCount !== 0)
                                    TradeHistory.addToHistory(db.get(), history);
                                return resolve();
                            }
                        })
                    }).catch((err) => {
                        // {"code":30036,"message":"no result"} // TODO this error is only internal. how to return it?
                        if (err && err.code === 30036)
                            return resolve();
                        logger.warn("Error importing %s trades", this.className, err)
                        setTimeout(importNext.bind(this), 5000); // retry
                    })
                }
                importNext();
            }).catch((err) => {
                reject({txt: "permanent error importing trades", err: err});
            })
        })
    }

    public buy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "buy() is not available in " + this.className + ". Most likely you forgot to enable marginTrading"})
        })
    }

    public sell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "sell() is not available in " + this.className + ". Most likely you forgot to enable marginTrading"})
        })
    }

    public cancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            reject({txt: "cancelOrder() is not available in " + this.className + ". Most likely you forgot to enable marginTrading"})
        })
    }

    public getOpenOrders(currencyPair: Currency.CurrencyPair) {
        return new Promise<OpenOrders>((resolve, reject) => {
            const pairStr = currencyPair.toString();
            this.loadContractTypes().then(() => {
                const instrument = this.contractTypes.get(pairStr);
                if (instrument === undefined)
                    return Promise.reject({txt: "Instrument for currency pair doesn't exist", currencyPair: pairStr});
                // Order Status （-1 canceled; 0: pending, 1: partially filled, 2: fully filled, 6: open (pending partially + fully filled), 7: completed (canceled + fully filled))
                return this.authClient.futures().getOrders(instrument.instrument_id, {status: 6});
            }).then((rawOrders) => {
                let orders = new OpenOrders(currencyPair, this.className);
                // Type (1: open long 2: open short 3: close long 4: close short)
                // Order Status （-1 canceled; 0: pending, 1: partially filled, 2: fully filled)
                rawOrders.order_info.forEach((o) => {
                    let type: "buy" | "sell" = (o.type === 1 || o.type === 4) ? "buy" : "sell";
                    const amount = helper.parseFloatVal(o.size);
                    const rate = helper.parseFloatVal(o.price);
                    let orderObj: OpenOrder = {
                        orderNumber: o.order_id, // keep numeric string
                        type: type,
                        rate: rate,
                        amount: amount, // contracts as int
                        total: rate*amount,
                        leverage: this.maxLeverage
                    }
                    orderObj.rawType = helper.parseFloatVal(o.type); // int
                    orders.addOrder(orderObj)
                });
                resolve(orders);
            }).catch((err) => {
                reject(err)
            });
        })
    }

    public moveOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: OrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "moveOrder() is not available in " + this.className + ". Most likely you forgot to enable marginTrading"})
        })
    }

    public marginBuy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>(async (resolve, reject) => {
            const pairStr = currencyPair.toString();
            await this.loadContractTypes();
            const instrument = this.contractTypes.get(pairStr);
            if (instrument === undefined)
                return Promise.reject({txt: "Instrument for currency pair doesn't exist", currencyPair: pairStr});
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((orderParams) => {
                orderParams.instrument_id = instrument.instrument_id;
                orderParams.type = 1;
                return this.authClient.futures().postOrder(orderParams);
            }).then((result) => {
                this.verifyPositionSize(currencyPair, amount)
                resolve(OrderResult.fromJson(result, currencyPair, this))
            }).catch((err) => {
                reject(err)
            });
        })
    }

    public marginSell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>(async (resolve, reject) => {
            const pairStr = currencyPair.toString();
            await this.loadContractTypes();
            const instrument = this.contractTypes.get(pairStr);
            if (instrument === undefined)
                return Promise.reject({txt: "Instrument for currency pair doesn't exist", currencyPair: pairStr});
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((orderParams) => {
                orderParams.instrument_id = instrument.instrument_id;
                orderParams.type = 2;
                return this.authClient.futures().postOrder(orderParams);
            }).then((result) => {
                this.verifyPositionSize(currencyPair, amount)
                resolve(OrderResult.fromJson(result, currencyPair, this))
            }).catch((err) => {
                reject(err)
            });
        })
    }

    public marginCancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return new Promise<CancelOrderResult>(async (resolve, reject) => {
            const pairStr = currencyPair.toString();
            await this.loadContractTypes();
            const instrument = this.contractTypes.get(pairStr);
            if (instrument === undefined)
                return Promise.reject({txt: "Instrument for currency pair doesn't exist", currencyPair: pairStr});
            this.authClient.futures().cancelOrder(instrument.instrument_id, orderNumber).then((result) => {
                // check if already filled (or cancelled)
                if (result && result.error_code == 32004)
                    return resolve({exchangeName: this.className, orderNumber: orderNumber, cancelled: true})
                resolve({exchangeName: this.className, orderNumber: orderNumber, cancelled: result.result == true})
            }).catch((err) => {
                reject(err)
            });
        })
    }

    public moveMarginOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>(async (resolve, reject) => {
            // OKEX doesn't have a "move order" function. so we have to cancel the order and place it again
            // they do have a batchOrder function, but each batch entry can fail/succeed independently
            const pairStr = currencyPair.toString();
            await this.loadContractTypes();
            const instrument = this.contractTypes.get(pairStr);
            if (instrument === undefined)
                return Promise.reject({txt: "Instrument for currency pair doesn't exist", currencyPair: pairStr});
            let outParams: ExRequestParams;
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((oP) => {
                // we don't know if it was a buy or sell order, so retrieve the order first
                outParams = oP;
                return this.getOpenOrders(currencyPair);
            }).then((orders) => {
                if (orders.isOpenOrder(orderNumber)) {
                    if (rate * amount < this.minTradingValue)
                        return resolve(OrderResult.fromJson({message: "Remaining amount below min trading value can not be moved: " + rate * amount}, currencyPair, this))

                    this.marginCancelOrder(currencyPair, orderNumber).catch((err) => {
                        reject(err) // return the error
                        return Promise.reject(true)
                    }).then((result) => {
                        if (!result.cancelled) {
                            reject("Order to move can not be cancelled in " + this.className)
                            return Promise.reject(true)
                        }
                        outParams.instrument_id = instrument.instrument_id;
                        outParams.type = orders.getOrder(orderNumber).rawType;
                        outParams.amount = orders.getOrder(orderNumber).amount; // might be below min trading value now
                        if (outParams.amount > amount)
                            outParams.amount = this.getContractAmount(currencyPair, rate, outParams.amount / rate);
                        return this.authClient.futures().postOrder(outParams);
                    }).then((result) => {
                        //console.log("ORDER MOVED", result)
                        resolve(OrderResult.fromJson(result, currencyPair, this))
                    }).catch((err) => {
                        if (err === true)
                            return; // already resolved
                        logger.error("Moving order %s in %s failed. Order has been cancelled", currencyPair.toString(), this.className)
                        reject(err)
                    });
                }
                else
                    resolve(OrderResult.fromJson({message: "Order already filled"}, currencyPair, this))
            }).catch((err) => {
                reject(err)
            });
        })
    }

    public getAllMarginPositions() {
        return new Promise<MarginPositionList>(async (resolve, reject) => {
            let reqOps = []
            const fetchPairs = this.getFetchPairs();
            await this.loadContractTypes();
            fetchPairs.forEach((fetchPair) => {
                let contract = this.contractTypes.get(fetchPair);
                if (contract === undefined)
                    return logger.error("Instrument for currency pair doesn't exist: %s", fetchPair);
                reqOps.push(this.authClient.futures().getPosition(contract.instrument_id));
            });
            Promise.all(reqOps).then((accountArr) => {
                let list = new MarginPositionList();
                // add pair to it for easier processing
                for (let i = 0; i < fetchPairs.length; i++)
                {
                    accountArr[i].pair = fetchPairs[i];
                    let position = this.currencies.getMarginPosition(accountArr[i], this.getMaxLeverage());
                    if (position) {
                        let coinAmount = this.contractsToCurrency(Currency.CurrencyPair.fromString(fetchPairs[i]), position.amount);
                        if (coinAmount > 0.0)
                            position.amount = coinAmount;
                        list.set(this.currencies.getLocalPair(fetchPairs[i]).toString(), position);
                    }
                }
                resolve(list);
            }).catch((err) => {
                reject(err)
            });
        })
    }

    public getMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<MarginPosition>(async (resolve, reject) => {
            await this.loadContractTypes();
            const pairStr = currencyPair.toString();
            let contract = this.contractTypes.get(pairStr);
            if (contract === undefined)
                return reject({txt: "Instrument for currency pair doesn't exist", currencyPair: pairStr});
            this.authClient.futures().getPosition(contract.instrument_id).then((account) => {
                let position = this.currencies.getMarginPosition(account, this.getMaxLeverage());
                if (!position)
                    return resolve(null);
                let coinAmount = this.contractsToCurrency(currencyPair, position.amount);
                if (coinAmount > 0.0)
                    position.amount = coinAmount;
                resolve(position);
            }).catch((err) => {
                reject(err)
            });
        })
    }

    public closeMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<OrderResult>(async (resolve, reject) => {
            // we don't know if we have to close long or short (or both, though our bot currently doesn't open contradicting positions)
            // get our position for this currency pair first
            await this.loadContractTypes();
            const pairStr = currencyPair.toString();
            let contract = this.contractTypes.get(pairStr);
            if (contract === undefined)
                return reject({txt: "Instrument for currency pair doesn't exist", currencyPair: pairStr});
            let firstPosition: MarginPosition;
            this.verifyExchangeRequest(currencyPair).then((currencyPairStr) => {
                return this.getMarginPosition(currencyPair);
            }).then((position) => {
                if (!position)
                    return Promise.reject({txt: "No margin position available to close", exchange: this.getClassName(), pair: currencyPair.toString()})
                firstPosition = position;
                const orderBook = this.orderBook.get(currencyPair.toString());
                if (!orderBook)
                    return Promise.reject({txt: "Orderbook not found to find rate to close margin position", exchange: this.getClassName(), pair: currencyPair.toString()})
                const lastRate = orderBook.getLast();
                const offset = nconf.get("serverConfig:closeRatePercentOffset");
                const closeRate = position.type === "short" ? lastRate + lastRate/100*offset : lastRate - lastRate/100*offset;
                let orderParams: any = {
                    price: closeRate,
                    size: this.getContractAmount(currencyPair, closeRate, Math.abs(position.amount)),
                    order_type: 0, // 0: Normal limit order (Unfilled and 0 represent normal limit order) 1: Post only 2: Fill Or Kill 3: Immediatel Or Cancel
                    leverage: this.maxLeverage,
                    match_price: 1, // must now be 1 with v3 API - also safer to close sooner
                    instrument_id: contract.instrument_id,
                    type: position.type === "short" ? 4 : 3
                }
                return this.authClient.futures().postOrder(orderParams);
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
            });
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected publicReq(method: string, params: ExRequestParams = {}) {
        return new Promise<ExResponse>((resolve, reject) => {
            reject({txt: "publicReq function is not implemented, please use the API client", exchange: this.className})
        })
    }

    protected privateReq(method: string, params: ExRequestParams = {}) {
        return new Promise<ExResponse>((resolve, reject) => {
            reject({txt: "privateReq function is not implemented, please use the API client", exchange: this.className})
        })
    }

    /*
    protected signRequest(method: string, headers) {
        // https://www.okex.com/docs/en/#summary-yan-zheng
        console.log(headers) // code 405 not listed https://www.okex.com/docs/en/#change-README - likely wrong signature
        // sign=CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(timestamp + 'GET' + '/users/self/verify', secretKey))
        let signData = headers["OK-ACCESS-TIMESTAMP"] + "POST" + method;
        headers["OK-ACCESS-SIGN"] = crypto.createHmac('sha256', this.apiKey.secret).update(signData, 'utf8').digest('base64');
    }
    */

    protected createApiWebsocketConnection(): any {
        this.wssClient = new okexApi.V3WebsocketClient();
        const marketEventStreamMap = new Map<string, EventStream<any>>(); // (exchange currency name, stream instance)
        //this.localSeqNr = 0; // keep counting upwards
        this.wssClient.on("open", (data) => {
            this.wssClient.login(this.apiKey.key, this.apiKey.secret, this.apiKey.passphrase);
            this.updateOrderBooks(false); // we get it through the WebSocket connection
            this.currencyPairs.forEach((pair) => {
                let marketPair = this.currencies.getExchangePair(pair);
                // every market has their own sequence numbers on poloniex. we have to ensure they are piped in order
                let marketEventStream = new EventStream<any>(this.className + "-Market-" + marketPair, this.maxPendingMarketEvents);
                this.openMarketRelays.push(marketEventStream);
                marketEventStreamMap.set(pair.toString(), marketEventStream); // use local pairs here
                marketEventStream.on("value", (value, seqNr) => {
                    this.marketStream.write(pair, value, seqNr);
                });
                let contract = this.contractTypes.get(pair.toString());
                if (contract === undefined)
                    return logger.error("Instrument for currency pair doesn't exist: %s", pair.toString());
                this.wssClient.subscribe('futures/depth:' + contract.instrument_id);
                this.wssClient.subscribe('futures/trade:' + contract.instrument_id);
                //this.wssClient.subscribe('futures/ticker:' + contract.instrument_id); // currently done via HTTP

                this.orderBook.get(pair.toString()).setSnapshot([], this.localSeqNr); // we receive an implicit snapshot with the first response
            });
        });
        this.wssClient.on("error", (err) => {
            logger.error("WebSocket error in %s", this.className, err);
            this.closeConnection("WebSocket error")
        });
        this.wssClient.on("close", () => {
            this.onConnectionClose("connection closed");
        });
        this.wssClient.on("message", (data) => {
            this.resetWebsocketTimeout();
            this.localSeqNr++;
            let json = utils.parseJson(data);
            if (json === null) {
                logger.error("Received invalid JSON from %s websocket connection", this.className, data);
                return;
            }
            try {
                const eventType = json.event;
                if (!eventType)
                    return this.processWebSocketTableMessage(json, marketEventStreamMap);
                switch (eventType) {
                    case "login":
                    case "subscribe":
                        break;
                    default:
                        logger.verbose("Received unknown %s WebSocket event type %s", this.className, eventType);
                }
            }
            catch (err) {
                logger.error("Error parsing %s websocket message", this.className, err);
            }
        });

        this.wssClient.connect();
        return this.wssClient;
    }

    protected processWebSocketTableMessage(marketData: any, marketEventStreamMap: Map<string, EventStream<any>>) {
        if (!marketData || typeof marketData !== "object")
            return logger.warn("Received invalid WebSocket market data from %s", this.className, marketData);
        switch (marketData.table) {
            case "futures/depth": {
                // marketData.action: 'partial' <- first, then 'update'
                marketData.data.forEach((book) => {
                    const currencyPair = this.getCurrencyFromInstrumentID(book.instrument_id);
                    if (!currencyPair)
                        return;
                    let marketEventStream = marketEventStreamMap.get(currencyPair.toString());
                    if (!marketEventStream) {
                        logger.error("Received %s market order update for currency pair %s we didn't subscribe to: ", currencyPair, this.className, marketData);
                        return;
                    }
                    if (book.timestamp) // in bids/asks
                        this.lastServerTimestampMs = new Date(book.timestamp/* + OKEX_TIMEZONE_SUFFIX*/).getTime();

                    // https://www.okex.com/docs/en/#futures_ws-depth
                    let orders = [];
                    if (book.asks) { // now they sometimes only send ask/bid updates
                        book.asks.forEach((order) => {
                            // now they don't remove anymore, they overwrite
                            orders.push(["o", 0, order[0], Number.MAX_VALUE]) // remove the max amount from bids/asks
                            // [ 142.452, 22, 0, 1 ], -> [price, size of price ( == amount??), number liquidation orders, number orders]
                            orders.push(["o", 1, order[0], order[1]])
                        })
                    }
                    if (book.bids) {
                        book.bids.forEach((order) => {
                            orders.push(["o", 1, order[0], order[1]])
                        })
                    }
                    marketEventStream.add(this.localSeqNr, orders);
                });
                break;
            }
            case "futures/trade": {
                //console.log(marketData)
                //let trades = [];
                let tradeMap = new Trade.TradeAggregateMap(); // each message should only contain 1 currency pair, but to be sure we use a map
                marketData.data.forEach((rawTrade) => {
                    const currencyPair = this.getCurrencyFromInstrumentID(rawTrade.instrument_id);
                    if (!currencyPair)
                        return;
                    const pairStr = currencyPair.toString();
                    let marketEventStream = marketEventStreamMap.get(pairStr);
                    if (!marketEventStream) {
                        logger.error("Received %s market trade update for currency pair %s we didn't subscribe to: ", currencyPair, this.className, marketData);
                        return;
                    }
                    tradeMap.addTrade(pairStr, this.fromRawTrade(rawTrade, currencyPair));
                });
                for (let tr of tradeMap)
                {
                    let marketEventStream = marketEventStreamMap.get(tr[0]);
                    marketEventStream.add(this.localSeqNr, tr[1]);
                }
                break;
            }
            default:
                logger.verbose("Received %s WebSocket market data for unknown table %s", this.className, marketData.table);
        }
    }

    protected getCurrencyFromInstrumentID(instrumentID: string): Currency.CurrencyPair {
        const fetchPairs = this.getFetchPairs();
        const instrumentIdParts = (instrumentID || "").split("-");
        if (instrumentIdParts.length < 3) {
            logger.error("%s future contract instrument ID format changed. Can not parse %s", this.className, instrumentID);
            return null;
        }
        for (let i = 0; i < fetchPairs.length; i++)
        {
            // look for: instrument_id: 'ETH-USD-190628'
            let pair = fetchPairs[i].split("_");
            if (pair[0].toUpperCase() === instrumentIdParts[1].toUpperCase() && pair[1].toUpperCase() === instrumentIdParts[0]) {
                return Currency.CurrencyPair.fromString(fetchPairs[i]);
            }
        }
        logger.error("Unable to get currency from instrument ID in %s: %s", this.className, instrumentID);
        return null;
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
            if (amount != 0 && rate * Math.abs(amount) < this.minTradingValue)
                return reject({txt: "Value is below the min trading value", exchange: this.className, value: rate*amount, minTradingValue: this.minTradingValue, permanent: true})

            let outParams: any = {
                price: rate,
                size: this.getContractAmount(currencyPair, rate, amount),
                order_type: 0, // 0: Normal limit order (Unfilled and 0 represent normal limit order) 1: Post only 2: Fill Or Kill 3: Immediatel Or Cancel
                leverage: this.maxLeverage
            }
            //if (currencyPair)
                //outParams.symbol = this.currencies.getExchangePair(currencyPair)
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

    protected fromRawTrade(rawTrade: any, currencyPair: Currency.CurrencyPair): Trade.Trade {
        let tradeObj = new Trade.Trade();
        if (/^[0-9]+$./.test(rawTrade.trade_id) === true) // ID is optional, we have own internal IDs
            tradeObj.tradeID = Number.parseInt(rawTrade.trade_id);
        tradeObj.date = new Date(rawTrade.timestamp); // from ISO date
        tradeObj.amount = helper.parseFloatVal(rawTrade.qty); // integer as number of contracts
        let coinAmount = this.contractsToCurrency(currencyPair, tradeObj.amount);
        if (coinAmount > 0.0)
            tradeObj.amount = coinAmount;
        tradeObj.type = rawTrade.side === "sell" ? Trade.TradeType.SELL : Trade.TradeType.BUY;
        tradeObj.rate = helper.parseFloatVal(rawTrade.price);
        tradeObj = Trade.Trade.verifyNewTrade(tradeObj, currencyPair, this.getExchangeLabel(), this.getFee());
        return tradeObj;
    }

    protected contractsToCurrency(currencyPair: Currency.CurrencyPair, contracts: number) { // quote currency (ETH, LTC,...)
        const pairStr = currencyPair.toString();
        const orderBook = this.orderBook.get(pairStr);
        if (!orderBook)
            return 0.0;
        const lastRate = orderBook.getLast();
        if (lastRate > 0.0) {
            //return contracts /= 133; // convert from contracts to coin
            return this.getBaseCurrencyAmount(currencyPair, lastRate, contracts);
        }
        return 0.0;
    }

    protected getFetchPairs(): string[] {
        // only fetch data for currencies we are interested in
        let fetchPairs = []
        for (let i = 0; i < this.currencyPairs.length; i++)
        {
            const pairArr = this.currencyPairs[i].toString().split("_");
            for (let u = 0; u < pairArr.length; u++) // should only have 2 entries
            {
                if (pairArr[u] === "USD")
                    continue;
                const pairPos = OKEX.FETCH_PAIRS.indexOf("USD_" + pairArr[u].toUpperCase());
                if (pairPos !== -1)
                    fetchPairs.push(OKEX.FETCH_PAIRS[pairPos])
                else
                    logger.error("Unable to get %s currency pair %s to fetch", this.className, pairArr[u])

            }
        }
        return fetchPairs;
    }

    protected getFetchCurrencies(): string[] {
        // only fetch data for currencies we are interested in
        let fetchCurrencies = []
        for (let i = 0; i < this.currencyPairs.length; i++)
        {
            const pairArr = this.currencyPairs[i].toString().split("_");
            for (let u = 0; u < pairArr.length; u++) // should only have 2 entries
            {
                if (pairArr[u] === "USD")
                    continue;
                const currencyPos = OKEX.FETCH_CURRENCIES.indexOf(pairArr[u].toUpperCase());
                if (currencyPos !== -1)
                    fetchCurrencies.push(OKEX.FETCH_CURRENCIES[currencyPos])
                else
                    logger.error("Unable to get %s currency %s to fetch", this.className, pairArr[u])

            }
        }
        return fetchCurrencies;
    }

    protected loadContractTypes() {
        return new Promise<void>((resolve, reject) => {
            this.pClient.futures().getInstruments().then((contracts) => {
                if (this.lastLoadedContractTypes.getTime() + OKEX.RELOAD_CONTRACT_TYPES_H*utils.constants.HOUR_IN_SECONDS*1000 > Date.now())
                    return resolve();
                contracts.forEach((contract) => {
                    let instrument: OKEXInstrument = Object.assign(new OKEXInstrument(), contract);
                    instrument.validate();
                    const currencyPairKey = this.currencies.getLocalName(instrument.quote_currency) + "_" + this.currencies.getLocalName(instrument.underlying_index);
                    let existing = this.contractTypes.get(currencyPairKey);
                    // TODO option to choose contract duration, use same map with different key
                    // for now just take the longest one, which also takes care of new contracts
                    if (existing === undefined || existing.delivery.getTime() < instrument.delivery.getTime())
                        this.contractTypes.set(currencyPairKey, instrument);
                });
                this.lastLoadedContractTypes = new Date();
                resolve();
            }).catch((err) => {
                logger.error("Error loading %s contracts", this.className, err);
                resolve(); // will get retried
            });
        });
    }
}