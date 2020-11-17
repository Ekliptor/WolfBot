
// https://github.com/ccxt/ccxt
// https://github.com/ccxt/ccxt/wiki/Manual
// alternative with ws: https://github.com/altangent/ccxws

import * as utils from "@ekliptor/apputils";
import {
    AbstractExchange, AbstractExchangeCurrencies,
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
import * as ccxt from "ccxt";

const logger = utils.logger
    , nconf = utils.nconf;


export interface CcxtOrderParameters extends OrderParameters {
    newClientOrderId?: string;
}
export interface CcxtMarginOrderParameters extends MarginOrderParameters {
    newClientOrderId?: string;
}
export interface CcxtBookPollCallback {
    (currencyPair: Currency.CurrencyPair, actions: /*MarketAction[]*/any[], seqNr: number): void;
}

export class CcxtExchangeCurrencies extends AbstractExchangeCurrencies /*implements Currency.ExternalExchangeTicker*/ {
    protected exchange: AbstractExchange;
    protected switchCurrencyPair = false; // switch USD_BTC to BTC_USD (some exchanges display it the opposite way)

    constructor(exchange: AbstractExchange) {
        super(exchange);
    }

    public setSwitchCurrencyPair(pairSwitch: boolean) {
        this.switchCurrencyPair = pairSwitch;
    }

    public isSwitchedCurrencyPair(): boolean {
        return this.switchCurrencyPair;
    }

    public getExchangeName(localCurrencyName: string): string {
        //if (localCurrencyName === "BCH")
            //return "BCC";
        return super.getExchangeName(localCurrencyName);
    }
    public getLocalName(exchangeCurrencyName: string): string {
        let localCurrencyName = exchangeCurrencyName.toUpperCase();
        if (localCurrencyName === "BCC")
            return "BCH";
        return localCurrencyName;
    }

    public getExchangePair(localPair: Currency.CurrencyPair): string {
        let str1 = this.getExchangeName(Currency.Currency[localPair.from])
        let str2 = this.getExchangeName(Currency.Currency[localPair.to])
        if (!str1 || !str2)
            return undefined;
        //if (str1 === "USD" || str1 === "THB")
            //return str2 + "/" + str1
        if (this.switchCurrencyPair === true)
            return str2 + "/" + str1
        return str1 + "/" + str2 // THB/BTC - always separated by /
    }
    public getLocalPair(exchangePair: string): Currency.CurrencyPair {
        const pairParts = exchangePair.split("/");
        if (pairParts.length !== 2)
            return undefined;
        let cur1 = Currency.Currency[pairParts[0]]
        let cur2 = Currency.Currency[pairParts[1]]
        if (!cur1 || !cur2)
            return undefined;
        //if (cur1 == Currency.Currency.USD || cur1 == Currency.Currency.THB)
            //return new Currency.CurrencyPair(cur1, cur2)
        if (this.switchCurrencyPair === true)
            return new Currency.CurrencyPair(cur1, cur2)
        return new Currency.CurrencyPair(cur2, cur1) // pairs are reversed
    }
    public toLocalTicker(exchangeTicker: any): Ticker.Ticker {
        let ticker = new Ticker.Ticker(this.exchange.getExchangeLabel());
        ticker.currencyPair = this.getLocalPair(exchangeTicker.symbol);
        if (!ticker.currencyPair)
            return undefined; // we don't support this pair
        ticker.last = Ticker.Ticker.parseNumber(exchangeTicker.last);
        ticker.lowestAsk = Ticker.Ticker.parseNumber(exchangeTicker.ask);
        ticker.highestBid = Ticker.Ticker.parseNumber(exchangeTicker.bid);
        if (typeof exchangeTicker.change === "number")
            ticker.percentChange = Ticker.Ticker.parseNumber(exchangeTicker.change); // what about "percentage" ?
        ticker.baseVolume = Ticker.Ticker.parseNumber(exchangeTicker.baseVolume);
        if (typeof exchangeTicker.quoteVolume === "number")
            ticker.quoteVolume = Ticker.Ticker.parseNumber(exchangeTicker.quoteVolume);
        else
            ticker.quoteVolume = ticker.baseVolume * ticker.last;
        ticker.isFrozen = ticker.last === 0;
        if (typeof exchangeTicker.high === "number")
            ticker.high24hr = Ticker.Ticker.parseNumber(exchangeTicker.high);
        if (typeof exchangeTicker.low === "number")
            ticker.low24hr = Ticker.Ticker.parseNumber(exchangeTicker.low);
        return ticker;
    }
    /*
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
    */
}

export abstract class CcxtExchange extends AbstractExchange {
    protected apiClient: ccxt.Exchange;
    protected currencies: CcxtExchangeCurrencies;
    protected pollTrades: boolean = true;
    protected pollCallbackFn: CcxtBookPollCallback;

    constructor(options: ExOptions) {
        super(options)
        this.publicApiUrl = "https://API";
        this.privateApiUrl = "https://API";
        //this.pushApiUrl = "wss://API";
        this.pushApiUrl = null; // only supports rest, don't check for WS timeouts
        //this.pushApiConnectionType = PushApiConnectionType.API_WEBSOCKET;
        this.httpKeepConnectionsAlive = true;
        this.dateTimezoneSuffix = "";
        //this.exchangeLabel = Currency.Exchange.BINANCE; // set in subclass
        this.minTradingValue = 0.001;
        this.fee = 0.001; // https://support.binance.com/hc/en-us/articles/115000429332-Fee-Structure-on-Binance
        this.maxLeverage = 0.0; // no margin trading, currently for all CCXT exchanges
        this.currencies = new CcxtExchangeCurrencies(this); // might be overwritten by child class, but should be needed
        this.webSocketTimeoutMs = nconf.get('serverConfig:websocketTimeoutMs')*2; // small coin markets -> less updates
    }

    public setPollTrades(poll: boolean) {
        this.pollTrades = poll;
    }

    public setOnPoll(callback: CcxtBookPollCallback) {
        // use this to use CCXT exchange to fetch the orderbook
        // can be passed on directly to MarketStream (same params)
        this.pollCallbackFn = callback;
    }

    public getCurrencies() {
        return this.currencies;
    }

    public async getTicker(): Promise<Ticker.TickerMap> {
        let map = new Ticker.TickerMap()
        for (let i = 0; i < this.currencyPairs.length; i++)
        {
            //let ticker = await this.apiClient.fetchTickers(); // faster?
            let exchangePair = this.currencies.getExchangePair(this.currencyPairs[i]);
            if (!exchangePair)
                continue;
            try {
                let ticker = await this.apiClient.fetchTicker(exchangePair);
                const tickerObj = this.currencies.toLocalTicker(ticker)
                if (tickerObj)
                    //map.set(tickerObj.currencyPair.toString(), tickerObj) // must always be: USD_BTC, EUR_BTC - use local pair name
                    map.set(this.currencyPairs[i].toString(), tickerObj)
            }
            catch (err) {
                logger.error("Error fetching %s %s ticker stats", this.className, this.currencyPairs[i].toString(), err)
            }
        }
        return map;
    }

    /*
    public async getExternalTicker(requiredCurrencies: string[]): Promise<Ticker.ExternalTickerMap> {
        let map = new Ticker.ExternalTickerMap()
        // could be fetched by iterating over this.apiClient.markets
        return map;
    }
    */

    public async getBalances(): Promise<Currency.LocalCurrencyList> {
        try {
            let balances = {}
            let exBalances = await this.apiClient.fetchBalance();
            // total, used, free
            for (let cur in exBalances.free)
            {
                let amount = helper.parseFloatVal(exBalances.free[cur]);
                let currencyStr = this.currencies.getLocalName(cur)
                if (!currencyStr)
                    continue; // not supported currency
                balances[currencyStr] = amount;
            }
            return Currency.fromExchangeList(balances, this.currencies);
        }
        catch (err) {
            throw this.formatInvalidExchangeApiResponse(err);
        }
    }

    public getMarginAccountSummary() {
        return new Promise<MarginAccountSummary>((resolve, reject) => {
            reject({txt: "Margin trading is not supported/implemented.", exchange: this.className})
        })
    }

    public async fetchOrderBook(currencyPair: Currency.CurrencyPair, depth: number): Promise<OrderBookUpdate<MarketOrder.MarketOrder>> {
        try {
            const pairStr = this.currencies.getExchangePair(currencyPair)
            let orderBook = await this.apiClient.fetchOrderBook(pairStr);
            let orders = new OrderBookUpdate<MarketOrder.MarketOrder>(++this.localSeqNr, false);
            ["asks", "bids"].forEach((prop) => {
                orderBook[prop].forEach((o) => {
                    // [ [ 121000, 0.01095563 ], // rate, amount
                    const amount = helper.parseFloatVal(o[1]);
                    const price = helper.parseFloatVal(o[0]);
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
            let stepCount = 1000;
            let stepMs = 60 * utils.constants.MINUTE_IN_SECONDS * 1000; // 1h is max step size (binance)
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
                    let rawTrades = await this.apiClient.fetchTrades(pairStr, currentMs, /*currentMs + stepMs*/stepCount);
                    let trades = [];
                    rawTrades.forEach((rawTrade) => {
                        trades.push(this.fromRawTrade(rawTrade, currencyPair))
                    });
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

    public async buy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: CcxtOrderParameters = {}): Promise<OrderResult> {
        let outParams = await this.verifyTradeRequest(currencyPair, rate, amount, params)
        if (this.currencies.isSwitchedCurrencyPair() === true)
            amount *= rate;
        amount = parseFloat(utils.calc.round(amount, 8) + ""); // remove trailing 0
        try {
            let result = await this.apiClient.createOrder(outParams.pairStr as string, outParams.orderType as any, "buy", amount, outParams.rate as number, params as any);
            this.verifyTradeResponse(result, null, "buy");
            return OrderResult.fromJson(result, currencyPair, this)
        }
        catch (err) {
            throw this.formatInvalidExchangeApiResponse(err);
        }
    }

    public async sell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: CcxtOrderParameters = {}): Promise<OrderResult> {
        let outParams = await this.verifyTradeRequest(currencyPair, rate, amount, params)
        if (this.currencies.isSwitchedCurrencyPair() === true) {
            if (Currency.isFiatCurrency(currencyPair.from) === true)// not needed for binance
                amount /= rate;
            //amount *= rate;
        }

        amount = parseFloat(utils.calc.round(amount, 8) + ""); // remove trailing 0
        try {
            let result = await this.apiClient.createOrder(outParams.pairStr as string, outParams.orderType as any, "sell", amount, outParams.rate as number, params as any);
            this.verifyTradeResponse(result, null, "sell");
            return OrderResult.fromJson(result, currencyPair, this)
        }
        catch (err) {
            throw this.formatInvalidExchangeApiResponse(err);
        }
    }

    public async cancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string): Promise<CancelOrderResult> {
        const marketPair = this.currencies.getExchangePair(currencyPair);
        const successResult = {exchangeName: this.className, orderNumber: orderNumber, cancelled: true};
        try {
            const orderNrStr = typeof orderNumber === "string" ? orderNumber : orderNumber.toString();
            let result = await this.apiClient.cancelOrder(orderNrStr, marketPair, {});
            // { success: true, error: null }
            return successResult;
        }
        catch (err) {
            if (err && err.toString().toLowerCase().indexOf("not found") !== -1)
                return successResult; // already cancelled or filled
            throw this.formatInvalidExchangeApiResponse(err);
        }
    }

    public async getOpenOrders(currencyPair: Currency.CurrencyPair): Promise<OpenOrders> {
        const marketPair = this.currencies.getExchangePair(currencyPair);
        try {
            let result = await this.apiClient.fetchOpenOrders(marketPair, undefined, undefined, {});
            let orders = new OpenOrders(currencyPair, this.className);
            for (let i = 0; i < result.length; i++)
            {
                let o = result[i];
                if (o instanceof Promise) // fix for unresolved Promise response
                    o = await o;
                /**
                 * { info:
                   { pairing_id: 1,
                     order_id: 11054309,
                     order_type: 'buy',
                     rate: 2500,
                     amount: 0.08,
                     date: '2019-03-01 19:35:33' },
                  id: 11054309,
                  timestamp: 1551468933000,
                  datetime: '2019-03-01T19:35:33.000Z',
                  symbol: 'BTC/THB',
                  type: 'limit',
                  side: 'buy',
                  price: 2500,
                  amount: 0.08 } }
                 */
                let orderObj = {
                    orderNumber: o.id,
                    type: (o.side === "buy" ? "buy": "sell") as any, // TODO why do we need this cast?
                    rate: typeof o.price === "number" ? o.price : parseFloat(o.price),
                    amount: typeof o.amount === "number" ? o.amount : parseFloat(o.amount),
                    total: 0,
                    leverage: 1
                }
                orderObj.total = orderObj.rate * orderObj.amount;
                orders.addOrder(orderObj)
            }
            return orders;
        }
        catch (err) {
            throw this.formatInvalidExchangeApiResponse(err);
        }
    }

    public async moveOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: CcxtOrderParameters): Promise<OrderResult> {
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
            if (Math.abs(amount) < this.minTradingValue) // remaining amount too low: erro -1013 LOT SIZE
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

    public marginBuy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: CcxtMarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "Margin trading is not supported/implemented.", exchange: this.className})
        })
    }

    public marginSell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: CcxtMarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "Margin trading is not supported/implemented.", exchange: this.className})
        })
    }

    public marginCancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            reject({txt: "Margin trading is not supported/implemented.", exchange: this.className})
        })
    }

    public moveMarginOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: CcxtMarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "Margin trading is not supported/implemented.", exchange: this.className})
        })
    }

    public getAllMarginPositions() {
        // TODO https://github.com/ccxt/ccxt/issues/4834#issuecomment-474329654
        // https://github.com/ccxt/ccxt/issues/4834
        return new Promise<MarginPositionList>((resolve, reject) => {
            reject({txt: "Margin trading is not supported/implemented.", exchange: this.className})
        })
    }

    public getMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<MarginPosition>((resolve, reject) => {
            reject({txt: "Margin trading is not supported/implemented.", exchange: this.className})
        })
    }

    public closeMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "Margin trading is not supported/implemented.", exchange: this.className})
        })
    }

    public getApiClient(): ccxt.Exchange {
        return this.apiClient;
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

    protected startPolling(): void {
        if (this.pollTrades === false)
            return;
        let lastPollTimestamp = new Map<string, number>(); // (currency pair, timestamp)
        const startMs = (Date.now() - nconf.get("serverConfig:fetchTradesMinBack")*60*1000);
        this.currencyPairs.forEach((currencyPair) => {
            lastPollTimestamp.set(currencyPair.toString(), startMs)
        });
        let pollCurrencyTrades = (currencyPair: Currency.CurrencyPair) => {
            return new Promise<Trade.Trade[]>((resolve, reject) => {
                const pairStr = currencyPair.toString();
                this.apiClient.fetchTrades(this.currencies.getExchangePair(currencyPair), lastPollTimestamp.get(pairStr), 1000).then((rawTrades) => {
                    let trades: Trade.Trade[] = [];
                    rawTrades.forEach((rawTrade) => {
                        trades.push(this.fromRawTrade(rawTrade, currencyPair))
                    });
                    if (trades.length !== 0)
                        lastPollTimestamp.set(pairStr, trades[trades.length-1].date.getTime())
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
                    if (typeof this.pollCallbackFn === "function") // this class is used as a relay in another exchange class
                        this.pollCallbackFn(this.currencyPairs[i], tradeResults[i], this.localSeqNr);
                    else
                        this.marketStream.write(this.currencyPairs[i], tradeResults[i], this.localSeqNr);
                }
            }).catch((err) => {
                logger.error("Error polling %s order book and trades", this.className, err)
            }).then(() => {
                schedulePoll() // continue
            });
        }
        let schedulePoll = () => {
            clearTimeout(this.httpPollTimerID); // be sure
            this.httpPollTimerID = setTimeout(() => {
                if (this.pollTrades === false) {
                    logger.warn("Stopped polling trades in %s due to settings change", this.className);
                    return;
                }
                pollBook()
            }, this.httpPollIntervalSec * 1000)
        }
        pollBook();
    }

    protected fromRawTrade(rawTrade: ccxt.Trade, currencyPair: Currency.CurrencyPair) {
        let tradeObj = new Trade.Trade();
        if (/^[0-9]+$./.test(rawTrade.id) === true) // ID is optional, we have own internal IDs
            tradeObj.tradeID = Number.parseInt(rawTrade.id);
        tradeObj.date = new Date(rawTrade.timestamp ? rawTrade.timestamp : rawTrade.datetime); // from ms or ISO as fallback
        tradeObj.amount = rawTrade.amount;
        tradeObj.type = rawTrade.side === "sell" ? Trade.TradeType.SELL : Trade.TradeType.BUY;
        tradeObj.rate = rawTrade.price;
        tradeObj = Trade.Trade.verifyNewTrade(tradeObj, currencyPair, this.getExchangeLabel(), this.getFee());
        return tradeObj;
    }

    protected verifyTradeRequest(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: CcxtOrderParameters = {}) {
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
                orderType: params.matchBestPrice ? "market" : "limit",
                pairStr: this.currencies.getExchangePair(currencyPair),
                // precision mostly 8 or 6 http://python-binance.readthedocs.io/en/latest/binance.html#binance.client.Client.get_symbol_info
                rate: rate
            }
            resolve(outParams)
        })
    }

    protected getProxyUrl(): string {
        return this.proxy.length !== 0 ? this.proxy[utils.getRandomInt(0, this.proxy.length)] : undefined;
    }

    protected getExchangeConfig(): any {
        return {
            /* // can be used for custom proxy per url
            proxy(url: string) {
                return 'https://example.com/?url=' + encodeURIComponent (url)
            }
            */
            proxy: this.getProxyUrl(),
            timeout: nconf.get("serverConfig:httpTimeoutMs"),
            enableRateLimit: true,
            apiKey: this.apiKey.key,
            secret: this.apiKey.secret,
        }
    }

    protected verifyExchangeResponse(body: string | false, response: request.RequestResponse, method: string) {
        return new Promise<any>((resolve, reject) => {
            return reject({txt: "verifyExchangeResponse is not implemented", exchange: this.className})
        })
    }

    /**
     * Verify if the trade response is valid. It will throw an Error if it is not valid.
     * You can overwrite this method in subclasses to check for exchange specific error messages such as "insufficient balance".
     * Your implementation always call the parent method first.
     * @param result
     * @param response
     * @param method
     */
    protected verifyTradeResponse(result: ccxt.Order, response: request.RequestResponse, method: string): boolean {
        if (!result)
            throw new Error(utils.sprintf("Invalid trade response from %s in %s: %s", this.className, method, result));
        return true;
    }

    protected onExchangeReady() {
        if (this.apiClient.fees) {
            const fees = this.apiClient.fees as any;
            if (fees.trading && fees.trading.percentage === true && typeof fees.trading.taker == "number" && fees.trading.taker > 0.0)
                this.fee = fees.trading.taker;
        }
    }

    protected formatInvalidExchangeApiResponse(err: any): any {
        if (err) {
            let permanent = true; // TODO check for below min trading balance etc..
            return {
                txt: "Invalid API response",
                // MIN_NOTIONAL -> not enough balance, below min trading value
                // PRICE_FILTER -> below min trading value
                err: err && typeof err === "object" && typeof err.toString === "function" ? err.toString() : JSON.stringify(err), // as err object it's often not passed along
                permanent: permanent
            };
        }
        return {err: "unknown error"};
    }
}
