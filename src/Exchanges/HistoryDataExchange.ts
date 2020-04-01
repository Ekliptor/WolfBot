
import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractExchange, ExApiKey, OrderBookUpdate, OpenOrders, ExRequestParams, ExResponse, OrderParameters, MarginOrderParameters, CancelOrderResult, PushApiConnectionType} from "./AbstractExchange";
import {OrderResult} from "../structs/OrderResult";
import {MarginPosition, MarginPositionList} from "../structs/MarginPosition";
import MarginAccountSummary from "../structs/MarginAccountSummary";
import {CandleMarketStream} from "../Trade/CandleMarketStream";
import * as request from "request";
import * as db from "../database";
import * as path from "path";

import EventStream from "../Trade/EventStream";
import {Currency, Ticker, Trade, TradeHistory, MarketOrder} from "@ekliptor/bit-models";
import {MarketAction} from "../Trade/MarketStream";
import {CandleMaker} from "../Trade/Candles/CandleMaker";
import {ReadPreference} from "mongodb";

export class HistoryExchangeMap extends Map<string, HistoryDataExchange> { // (exchange name, instance)
    constructor() {
        super()
    }
}

export interface HistoryDataExchangeOptions {
    exchangeName: string;
    exchangeLabel: Currency.Exchange;
}

/**
 * Read exchange data from our database and emit it as a MarketStream.
 * This is used for backtesting instead of the API implementation of an exchange (such as the Poloniex class).
 */
export default class HistoryDataExchange extends AbstractExchange {
    // this number shouldn't have any effect. but in reality it can determine how quickly some of our strategies fire to given ticks.
    // TODO maybe determine this per exchange per currency pair?
    protected static readonly REPLAY_TRADES_PER_CALL = 100;

    protected marketStream: CandleMarketStream;

    protected simulationBalances: Currency.LocalCurrencyList;
    protected simulationMarginPositions: MarginPositionList;
    protected lastOrderNr: number = 0;
    protected lastTradeMin: number = -1;

    constructor(options: HistoryDataExchangeOptions) {
        super({key: "", secret: ""}, true)
        this.publicApiUrl = "";
        this.privateApiUrl = "";
        //this.pushApiUrl = ""; // for autobahn
        this.pushApiUrl = "";
        this.pushApiConnectionType = PushApiConnectionType.WEBSOCKET;
        this.dateTimezoneSuffix = " GMT+0000";
        this.exchangeLabel = options.exchangeLabel;

        const realExchange: AbstractExchange = this.loadModule(path.join(__dirname, options.exchangeName), {}) // no options
        this.minTradingValue = realExchange.getMinTradingBtc(); // for margin positions
        this.fee = realExchange.getFee();
        this.maxLeverage = realExchange.getMaxLeverage();
        this.contractExchange = realExchange.isContractExchange();
        //this.currencies = new HistoryDataCurrencies(this); // history only works with our own (local) currency labels

        this.className = options.exchangeName;
    }

    public getTicker() {
        return new Promise<Ticker.TickerMap>((resolve, reject) => {
            reject({txt: "getTicker() shouldn't be called in HistoryDataExchange"})
        })
    }

    public getBalances() {
        return new Promise<Currency.LocalCurrencyList>((resolve, reject) => {
            this.privateReq("returnBalances").then((balances) => {
                /*
                console.log(balances)
                let from = Currency.fromExchangeList(balances)
                console.log(from)
                console.log(Currency.toExchangeList(from))
                */
                /*
                let pair: Currency.CurrencyPair = [Currency.Currency.BTC, Currency.Currency.LTC]
                let strPair = this.currencies.getExchangePair(pair)
                console.log(strPair)
                console.log(this.currencies.getLocalPair(strPair))
                */
                resolve(Currency.fromExchangeList(balances))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getMarginAccountSummary() {
        return new Promise<MarginAccountSummary>((resolve, reject) => {
            reject({txt: "getMarginAccountSummary() shouldn't be called in HistoryDataExchange"})
        })
    }

    public fetchOrderBook(currencyPair: Currency.CurrencyPair, depth: number) {
        return new Promise<OrderBookUpdate<MarketOrder.MarketOrder>>((resolve, reject) => {
            reject({txt: "fetchOrderBook() shouldn't be called in HistoryDataExchange"})
        })
    }

    public importHistory(currencyPair: Currency.CurrencyPair, start: Date, end: Date) {
        return new Promise<void>((resolve, reject) => {
            reject({txt: "importHistory() can not be called in HistoryDataExchange"})
        })
    }

    public buy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            // TODO slippage for more realistic simulations (if we trade with larger amounts)
            resolve(OrderResult.fromJson({
                orderNumber: this.getNextOrderNr(),
                resultingTrades: []
            }, currencyPair, this))
        })
    }

    public sell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            resolve(OrderResult.fromJson({
                orderNumber: this.getNextOrderNr(),
                resultingTrades: []
            }, currencyPair, this))
        })
    }

    public cancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            resolve({exchangeName: this.className, orderNumber: orderNumber, cancelled: true})
        })
    }

    public getOpenOrders(currencyPair: Currency.CurrencyPair) {
        return new Promise<OpenOrders>((resolve, reject) => {
            //let orders = new OpenOrders(currencyPair, this.className);
            //resolve(orders)
            reject({txt: "getOpenOrders() can not be called in HistoryDataExchange"})
        })
    }

    public moveOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: OrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "moveOrder() can not be called in HistoryDataExchange"})
        })
    }

    public marginBuy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            resolve(OrderResult.fromJson({
                orderNumber: this.getNextOrderNr(),
                resultingTrades: []
            }, currencyPair, this))
        })
    }

    public marginSell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            resolve(OrderResult.fromJson({
                orderNumber: this.getNextOrderNr(),
                resultingTrades: []
            }, currencyPair, this))
        })
    }

    public marginCancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return this.cancelOrder(currencyPair, orderNumber); // our orderNumbers are unique across all markets
    }

    public moveMarginOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: MarginOrderParameters) {
        return this.moveOrder(currencyPair, orderNumber, rate, amount, params);
    }

    public getAllMarginPositions() {
        return new Promise<MarginPositionList>((resolve, reject) => {
            resolve(this.simulationMarginPositions)
        })
    }

    public getMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<MarginPosition>((resolve, reject) => {
            let position = this.simulationMarginPositions.get(currencyPair.toString());
            if (position)
                return resolve(position)
            resolve(new MarginPosition(this.getMaxLeverage()));
        })
    }

    public closeMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<OrderResult>((resolve, reject) => {
            resolve(OrderResult.fromJson({
                orderNumber: this.getNextOrderNr(),
                resultingTrades: []
            }, currencyPair, this))
        })
    }

    // ################################################################
    // #################### Simulation functions ######################

    public setBalances(balances: Currency.LocalCurrencyList) {
        this.simulationBalances = balances;
    }

    public setMarginPositions(list: MarginPositionList) {
        this.simulationMarginPositions = list;
    }

    public replay(currencyPair: Currency.CurrencyPair, start: Date, end: Date): Promise<void> {
        let cachedCandles = CandleMaker.getCachedCandles(currencyPair, this.exchangeLabel);
        if (cachedCandles) {
            logger.info("Using cached 1min candles for %s %s trades", this.className, currencyPair.toString())
            return this.marketStream.writeCandles(currencyPair, cachedCandles);
        }
        return new Promise<void>((resolve, reject) => {
            let count = 0;
            let cb = () => {
                setTimeout(() => { // wait until strategies are done
                    setTimeout(() => {
                        logger.info("Done replaying %s %s %s trades", this.className, currencyPair.toString(), count)
                    }, 10);
                    resolve();
                }, 1000)
            }
            let collection = db.get().collection(Trade.COLLECTION_NAME)
            const pairNr = currencyPair.toNr();
            let cursor = collection.find({
                exchange: this.exchangeLabel,
                currencyPair: pairNr,
                $and: [
                    {date: {$gt: start}},
                    {date: {$lt: end}}
                ]
            })
                .setReadPreference(ReadPreference.SECONDARY_PREFERRED)
                .sort({date: 1});
            let tradeDocs = [];
            let sendTrades = (docs, callback) => {
                // we can trust that our trades from local database already are in the right order
                //let marketEventStream = new EventStream<any>(this.className + "-Market-" + marketPair, this.maxPendingMarketEvents);
                this.marketStream.writeTrades(currencyPair, docs); // TODO this.currencyPairs is not used. ok? backtesting with 1 currency is enough
                // give our streams time to process the trades and fire more events
                // otherwise our candleTicks happen irregularly because tick() gets fired too rapidly and candleTick() is being blocked for a few CPU cycles
                // TODO find a way to poll the promise-queue in ALL AbstractStrategy instances and check if it's really empty before continuing
                //setTimeout(callback.bind(this), 0)
                let doCallback = (count) => { // return to the event loop multiple times to ensure all async actions are being executed
                    if (count > 0)
                        return setTimeout(doCallback.bind(this, --count), 0);
                    setTimeout(callback.bind(this), 0)
                }
                setTimeout(doCallback.bind(this, 1), 0)
            }
            let onFinish = () => {
                if (count % HistoryDataExchange.REPLAY_TRADES_PER_CALL !== 0) { // add the remaining docs
                    sendTrades(tradeDocs, cb);
                    tradeDocs = [];
                }
                else {
                    cb();
                }
            }
            const batchTrades = nconf.get("serverConfig:batchTrades");
            let lastTrade: Trade.Trade = null;
            let that = this;
            let getNextDoc = () => {
                cursor.next(function(err, doc) {
                    if (err) {
                        if (err.message && err.message.indexOf('Cursor not found') !== -1)
                            return getNextDoc(); // doc got deleted while we iterate, shouldn't happen
                        return reject({txt: "Error replaying trades", err: err});
                    }
                    if (doc === null)
                        return onFinish();
                    doc.currencyPair = Currency.CurrencyPair.fromNr(doc.currencyPair);
                    let tradeDoc = Trade.init(doc);
                    if (batchTrades) {
                        // batch consecutive trades at the same rate together to 1 trade. this reduces the number of trades we emit = less overhead/CPU
                        if (!lastTrade)
                            lastTrade = tradeDoc;
                        else if (lastTrade.rate === tradeDoc.rate) {
                            lastTrade.amount += tradeDoc.amount;
                            lastTrade.total = lastTrade.amount * lastTrade.rate;
                            // we can't really update buy/sell, just keep the 1st one
                        }
                        else {
                            tradeDocs.push(lastTrade);
                            count++;
                            lastTrade = tradeDoc; // move to the trade with the new rate and start batching again
                        }
                    }
                    else {
                        tradeDocs.push(tradeDoc);
                        count++;
                    }
                    if (count !== 0 && count % HistoryDataExchange.REPLAY_TRADES_PER_CALL === 0 || tradeDoc.date.getUTCMinutes() !== that.lastTradeMin) {
                        // emit trades every minute (in market time) so that strategies can act on simulation prices closer to real prices
                        that.lastTradeMin = tradeDoc.date.getUTCMinutes();
                        sendTrades(tradeDocs, (err) => {
                            if (err)
                                return reject({txt: "Error replaying trades", err: err}); // abort
                            tradeDocs = [];
                            setTimeout(getNextDoc.bind(this), 0); // clear the stack
                        });
                    }
                    else {
                        if (count % 10 === 0)
                            setTimeout(getNextDoc.bind(this), 0); // clear the stack
                        else
                            getNextDoc();
                    }
                })
            }
            getNextDoc();
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected publicReq(method: string, params: ExRequestParams = {}) {
        return new Promise<ExResponse>((resolve, reject) => {
            reject({txt: "publicReq() shouldn't be called in HistoryDataExchange"})
        })
    }

    protected privateReq(method: string, params: ExRequestParams = {}) {
        return new Promise<ExResponse>((resolve, reject) => {
            reject({txt: "privateReq() shouldn't be called in HistoryDataExchange"})
        })
    }

    protected verifyTradeRequest(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<ExRequestParams>((resolve, reject) => {
            reject({txt: "verifyTradeRequest() shouldn't be called in HistoryDataExchange"})
        })
    }

    protected verifyExchangeResponse(body: string | false, response: request.RequestResponse, method: string) {
        return new Promise<any>((resolve, reject) => {
            reject({txt: "verifyExchangeResponse() shouldn't be called in HistoryDataExchange"})
        })
    }

    protected getNextOrderNr() {
        return ++this.lastOrderNr;
    }
}
