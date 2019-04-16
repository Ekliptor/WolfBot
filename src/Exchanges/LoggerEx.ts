import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {
    AbstractExchange,
    ExApiKey,
    OrderBookUpdate,
    OpenOrders,
    ExRequestParams,
    ExResponse,
    OrderParameters,
    MarginOrderParameters,
    CancelOrderResult,
    PushApiConnectionType,
    ExOptions
} from "./AbstractExchange";
import {OrderResult} from "../structs/OrderResult";
import {MarginPosition, MarginPositionList} from "../structs/MarginPosition";
import MarginAccountSummary from "../structs/MarginAccountSummary";
import * as request from "request";
import * as db from "../database";
import * as path from "path";
import {Currency, Ticker, Trade, TradeHistory, MarketOrder} from "@ekliptor/bit-models";


/**
 * An exchange that only logs all trades.
 * The purpose of this class is to test strategies in live mode and use it for arbitrage ideas.
 */
export default class LoggerEx extends AbstractExchange {
    //protected marketStream: CandleMarketStream;

    protected lastOrderNr: number = 0;

    constructor(options: ExOptions) {
        super({key: "", secret: ""}, false)
        this.publicApiUrl = "";
        this.privateApiUrl = "";
        //this.pushApiUrl = ""; // for autobahn
        this.pushApiUrl = "";
        this.pushApiConnectionType = PushApiConnectionType.WEBSOCKET;
        this.dateTimezoneSuffix = " GMT+0000";
        this.exchangeLabel = Currency.Exchange.LOGGER;

        this.minTradingValue = 0.0000001;
        this.fee = 0.00001;
        this.maxLeverage = 1.0
        //this.currencies = new LoggerExchangeCurrencies(this); // not needed since we don't send any requests

        this.className = options.exchangeName;
    }

    public getTicker() {
        return new Promise<Ticker.TickerMap>((resolve, reject) => {
            logger.verbose("Fetching %s tickers", this.className);
            let tickerMap = new Ticker.TickerMap();
            reject(tickerMap)
        })
    }

    public getBalances() {
        return new Promise<Currency.LocalCurrencyList>((resolve, reject) => {
            logger.verbose("Fetching %s balances", this.className);
            let balances = {}
            resolve(Currency.fromExchangeList(balances))
        })
    }

    public getMarginAccountSummary() {
        return new Promise<MarginAccountSummary>((resolve, reject) => {
            logger.verbose("Fetching %s margin account summary", this.className);
            let margin = new MarginAccountSummary();
            resolve(margin);
        })
    }

    public fetchOrderBook(currencyPair: Currency.CurrencyPair, depth: number) {
        return new Promise<OrderBookUpdate<MarketOrder.MarketOrder>>((resolve, reject) => {
            logger.verbose("Fetching %s orderbook", this.className);
            resolve(new OrderBookUpdate<MarketOrder.MarketOrder>(++this.localSeqNr));
        })
    }

    public importHistory(currencyPair: Currency.CurrencyPair, start: Date, end: Date) {
        return new Promise<void>((resolve, reject) => {
            reject({txt: "importHistory() can not be called in LoggerExchange"})
        })
    }

    public buy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            logger.info("%s BUY order", this.className);
            resolve(this.getMockOrderResult(currencyPair))
        })
    }

    public sell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            logger.info("%s SELL order", this.className);
            resolve(this.getMockOrderResult(currencyPair))
        })
    }

    public cancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            logger.verbose("Cancelling %s open order", this.className);
            resolve({exchangeName: this.className, orderNumber: orderNumber, cancelled: true})
        })
    }

    public getOpenOrders(currencyPair: Currency.CurrencyPair) {
        return new Promise<OpenOrders>((resolve, reject) => {
            logger.verbose("Fetching %s open orders", this.className);
            let orders = new OpenOrders(currencyPair, this.className); // no open orders
            resolve(orders)
        })
    }

    public moveOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: OrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            logger.verbose("Moving %s order", this.className);
            resolve(this.getMockOrderResult(currencyPair))
        })
    }

    public marginBuy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            logger.info("%s margin BUY order", this.className);
            resolve(this.getMockOrderResult(currencyPair))
        })
    }

    public marginSell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            logger.info("%s margin SELL order", this.className);
            resolve(this.getMockOrderResult(currencyPair))
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
            logger.verbose("Fetching %s all margin positions", this.className);
            resolve(new MarginPositionList())
        })
    }

    public getMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<MarginPosition>((resolve, reject) => {
            logger.verbose("Fetching %s %s margin position", this.className, currencyPair.toString());
            resolve(new MarginPosition(this.getMaxLeverage()));
        })
    }

    public closeMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<OrderResult>((resolve, reject) => {
            logger.info("%s CLOSE %s position order", this.className, currencyPair.toString());
            resolve(this.getMockOrderResult(currencyPair))
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

    protected getMockOrderResult(currencyPair: Currency.CurrencyPair) {
        return OrderResult.fromJson({
            orderNumber: this.getNextOrderNr(),
            resultingTrades: []
        }, currencyPair, this);
    }
}