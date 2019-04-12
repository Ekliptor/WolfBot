
// https://github.com/santacruz123/deribit-ws-nodejs
// https://github.com/deribit/deribit-api-js
// TODO wait for v2 to mature and switch back to websockets https://github.com/askmike/deribit-v2-ws


// https://docs.deribit.com/

import * as utils from "@ekliptor/apputils";
import {
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
import {AbstractContractExchange} from "./AbstractContractExchange";
import {OrderResult} from "../structs/OrderResult";
import {MarginPosition, MarginPositionList} from "../structs/MarginPosition";
import MarginAccountSummary from "../structs/MarginAccountSummary";
import {default as DeribitApi} from "deribit-ws-nodejs";
import * as db from "../database";
import * as helper from "../utils/helper";
import * as request from "request";

import EventStream from "../Trade/EventStream";
import {MarketOrder, Ticker, Trade, TradeHistory, Currency} from "@ekliptor/bit-models";
import {OrderBook} from "../Trade/OrderBook";
import DeribitCcxt from "./DeribitCcxt";

const logger = utils.logger
    , nconf = utils.nconf;


export class DeribitCurrencies implements Currency.ExchangeCurrencies {
    protected exchange: /*AbstractExchange*/Deribit;

    constructor(exchange: Deribit) {
        this.exchange = exchange;
    }

    public getExchangeName(localCurrencyName: string): string {
        return localCurrencyName.toUpperCase() // always uppercase
    }
    public getLocalName(exchangeCurrencyName: string): string {
        return exchangeCurrencyName.toUpperCase()
    }

    public getExchangePair(localPair: Currency.CurrencyPair): string {
        // present in Deribit and DeribitCcxt
        let quoteCurrencyStr = Currency.getCurrencyLabel(localPair.to);
        if (quoteCurrencyStr === "ETH")
            return "ETH";
        else if (quoteCurrencyStr === "BTC")
            return "BTC";
        return "BTC"; // fallback
    }
    public getLocalPair(exchangePair: string): Currency.CurrencyPair {
        // exchamgePair: 'BTC-PERPETUAL'
        if (exchangePair === "ETH-PERPETUAL")
            return new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.ETH);
        else if (exchangePair === "BTC-PERPETUAL")
            return new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.BTC);
        return new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.BTC);
    }
    public toLocalTicker(exchangeTicker: any): Ticker.Ticker {
        return null; // not used for Deribit
    }

    public computePseudoMargin(forcedLiquidation: number, localPair: Currency.CurrencyPair) {
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
    public toMarginAccountSummary(accAndPos: any) {
        let summary = new MarginAccountSummary();
        summary.pl = accAndPos.account.futuresPNL;
        summary.currentMargin = 1.0;
        accAndPos.pos.forEach((position) => {
            if (position.kind !== "future")
                return;
            const liquidationPrice = position.estLiqPrice;
            let currentMargin = this.computePseudoMargin(liquidationPrice, this.getLocalPair(position.instrument));
            if (summary.currentMargin > currentMargin)
                summary.currentMargin = currentMargin; // use the smallest value (mostly used for smartphone alerts)
        })
        return summary;
    }
    public getMarginPosition(margin: any, maxLeverage): MarginPosition {
        /**
         * { instrument: 'BTC-PERPETUAL',
            kind: 'future',
            size: -3,
            amount: -30,
            averagePrice: 3259.494908669,
            direction: 'sell',
            sizeBtc: -0.007492807,
            floatingPl: 0.000011939,
            realizedPl: -3.74e-7,
            estLiqPrice: -2.99,
            markPrice: 4003.84,
            indexPrice: 4008.19,
            maintenanceMargin: 0.000043086,
            initialMargin: 0.000103029,
            settlementPrice: 4010.23,
            delta: -0.007492807,
            openOrderMargin: 0.110771556,
            profitLoss: -0.001711073 }
         */
        if (margin.kind !== "future")
            return null;
        let position = new MarginPosition(Math.min(10, maxLeverage));
        position.amount = Math.abs(margin.amount);
        position.type = margin.direction === "sell" ? "short" : "long";
        position.liquidationPrice = margin.estLiqPrice;
        position.pl = margin.floatingPl;
        return position;
    }
}

export default class Deribit extends AbstractContractExchange {
    protected static contractTypes = new Map<string, string>([ // (currency pair, contract type)
        ["BTC", "BTC-PERPETUAL"],
        ["ETH", "ETH-PERPETUAL"]
    ]);
    protected deribitContractType = 'BTC-PERPETUAL';

    protected currencies: DeribitCurrencies;
    protected websocket: DeribitApi = null;
    protected deribitCcxt: DeribitCcxt = null;
    protected orderbookShapshot: OrderBookUpdate<MarketOrder.MarketOrder> = null;
    protected orderReject: (reason?: any) => void = null;

    constructor(options: ExOptions) {
        super(options)
        this.publicApiUrl = "https://deribit"; // we use API client, but URL can not be empty for parent class
        this.privateApiUrl = this.publicApiUrl;
        this.pushApiUrl = "wss://deribit-api"; // use HTTP polling for now
        this.pushApiConnectionType = PushApiConnectionType.API_WEBSOCKET;
        if (!options || !this.apiKey.key)
            return; // temp instance to check exchange type
        this.exchangeLabel = Currency.Exchange.DERIBIT;
        this.minTradingValue = 1.0; // min value is 1 contract, BTC contract fixed at 10$
        this.fee = 0.00002; // only for opening positions // https://www.deribit.com/main#/pages/information/fees
        this.maxLeverage = 1; // easier to configure with 1
        this.currencies = new DeribitCurrencies(this);
        this.webSocketTimeoutMs = nconf.get('serverConfig:websocketTimeoutMs')*3; // they don't send pings too often
        this.deribitCcxt = new DeribitCcxt(options);
        this.deribitCcxt.setOnPoll((currencyPair: Currency.CurrencyPair, actions: /*MarketAction[]*/any[], seqNr: number) => {
            this.marketStream.write(currencyPair, actions, seqNr);
        });

        this.contractValues.set("BTC", 10);
        this.contractValues.set("ETH", 10);
    }

    public subscribeToMarkets(currencyPairs: Currency.CurrencyPair[]) {
        this.deribitCcxt.subscribeToMarkets(currencyPairs);
        return super.subscribeToMarkets(currencyPairs);
    }

    public repeatFailedTrade(error: any, currencyPair: Currency.CurrencyPair) {
        return super.repeatFailedTrade(error, currencyPair);
    }

    public getTicker() {
        return new Promise<Ticker.TickerMap>((resolve, reject) => {
            // ticker data is updated via websocket push api
            setTimeout(() => {
                resolve(this.ticker)
            }, 0)
        })
    }

    public getIndexPrice() {
        return new Promise<Ticker.TickerMap>((resolve, reject) => {
            // ticker data is updated via websocket push api
            setTimeout(() => {
                resolve(this.ticker)
            }, 0)
        })
    }

    public getBalances() {
        return new Promise<Currency.LocalCurrencyList>((resolve, reject) => {
            this.websocket.action("account").then((account) => {
                /**
                 * { equity: 9.999945589,
                      maintenanceMargin: 0.000052637,
                      initialMargin: 0.000112135,
                      availableFunds: 9.999833454,
                      balance: 9.999996165,
                      marginBalance: 9.99994559,
                      SUPL: -0.00005031,
                      SRPL: -2.7e-7,
                      PNL: -0.00005031,
                      optionsPNL: 0,
                      optionsSUPL: 0,
                      optionsSRPL: 0,
                      optionsD: 0,
                      optionsG: 0,
                      optionsV: 0,
                      optionsTh: 0,
                      futuresPNL: -0.00005031,
                      futuresSUPL: -0.00005031,
                      futuresSRPL: -2.7e-7,
                      deltaTotal: -0.0092,
                      sessionFunding: 0,
                      depositAddress: '2N2sq9oA9rnvwHwKS3U1kwF8BsbHkSEQ5ZE' }
                 */
                let balances = {}
                balances["BTC"] = account.equity;
                resolve(Currency.fromExchangeList(balances, this.currencies))
            })
        })
    }

    public getMarginAccountSummary() {
        return new Promise<MarginAccountSummary>((resolve, reject) => {
            this.websocket.action("account").then(async (account) => {
                let positions = await this.websocket.action("positions");
                resolve(this.currencies.toMarginAccountSummary({account: account, pos: positions}));
            });
        })
    }

    public fetchOrderBook(currencyPair: Currency.CurrencyPair, depth: number) {
        /*
        return new Promise<OrderBookUpdate<MarketOrder.MarketOrder>>((resolve, reject) => {
            resolve(this.orderbookShapshot)
        })
         */
        return this.deribitCcxt.fetchOrderBook(currencyPair, depth);
    }

    public importHistory(currencyPair: Currency.CurrencyPair, start: Date, end: Date) {
        return new Promise<void>((resolve, reject) => {
            //const pairStr = this.currencies.getExchangePair(currencyPair);
            let tradeCount = 0;
            let lastTrade: Trade.Trade = null;
            let currentMs = start.getTime();
            logger.verbose("Starting %s trades import", this.className);
            let importNext = () => {
                this.websocket.action("getlasttrades", {
                    //sort: "asc", // deprecated, always from old to new
                    instrument: this.getContractForCurrencyPair(currencyPair),
                    count: 1000, // max
                    startTimestamp: currentMs,
                    //endTimestamp: end.getTime(), // allow going beyong a little
                    includeOld: true
                }).then((history) => {
                    let trades = [];
                    history.forEach((dTrade) => {
                        let tradeObj = new Trade.Trade();
                        tradeObj.date = new Date(dTrade.timeStamp);
                        tradeObj.type = dTrade.direction === "buy" ? Trade.TradeType.BUY : Trade.TradeType.SELL;
                        tradeObj.amount = dTrade.amount;
                        tradeObj.rate = dTrade.price;
                        tradeObj.tradeID = dTrade.tradeId;
                        tradeObj = Trade.Trade.verifyNewTrade(tradeObj, currencyPair, this.getExchangeLabel(), this.getFee());
                        trades.push(tradeObj);
                    });
                    tradeCount += trades.length;
                    Trade.storeTrades(db.get(), trades, (err) => {
                        if (err)
                            logger.error("Error storing trades", err)
                        if (trades.length > 0) {
                            lastTrade = trades[trades.length - 1];
                            currentMs = lastTrade.date.getTime();
                        }
                        logger.verbose("%s %s import at %s with %s trades", this.className, currencyPair.toString(), utils.getUnixTimeStr(true, lastTrade.date), tradeCount)
                        if (currentMs < end.getTime())
                            setTimeout(importNext.bind(this), 500);
                        else {
                            logger.info("Import of %s %s history has finished. Imported %s trades", this.className, currencyPair.toString(), tradeCount)
                            let history = new TradeHistory.TradeHistory(currencyPair, this.getExchangeLabel(), start, end);
                            if (tradeCount !== 0)
                                TradeHistory.addToHistory(db.get(), history)
                            return resolve();
                        }
                    });
                });
            }
            importNext();
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
            this.websocket.action("getopenorders", {
                instrument: this.getContractForCurrencyPair(currencyPair)
            }).then((exOrders) => {
                let orders = new OpenOrders(currencyPair, this.className);
                exOrders.forEach((o) => {
                    let type: "buy" | "sell" = o.direction === "buy" ? "buy" : "sell";
                    let orderObj: OpenOrder = {orderNumber: o.orderId, type: type, rate: o.price, amount: o.amount, total: o.price*o.amount, leverage: this.maxLeverage}
                    orders.addOrder(orderObj);
                });
                resolve(orders);
            });
        })
    }

    public moveOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: OrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "moveOrder() is not available in " + this.className + ". Most likely you forgot to enable marginTrading"})
        })
    }

    public marginBuy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        /*
        return new Promise<OrderResult>((resolve, reject) => {
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                return this.marginOrder(currencyPair, rate, amount, "buy", outParams);
            }).then((result) => {
                resolve(result);
            }).catch((err) => {
                reject(err)
            });
        })
         */
        return this.deribitCcxt.buy(currencyPair, rate, amount, params);
    }

    public marginSell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        /*
        return new Promise<OrderResult>((resolve, reject) => {
            amount = Math.abs(amount);
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                return this.marginOrder(currencyPair, rate, amount, "sell", outParams);
            }).then((result) => {
                resolve(result);
            }).catch((err) => {
                reject(err)
            });
        })
         */
        return this.deribitCcxt.sell(currencyPair, rate, amount, params);
    }

    public marginCancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        /*
        return new Promise<CancelOrderResult>((resolve, reject) => {
            this.orderReject = reject;
            this.websocket.action("cancel", {orderId: orderNumber}).then((result) => {
                // can be cancelled multiple times. always same response
                this.orderReject = null;
                resolve({exchangeName: this.className, orderNumber: orderNumber, cancelled: result.order && result.order.orderId > 0})
            });
        })
         */
        return this.deribitCcxt.cancelOrder(currencyPair, orderNumber);
    }

    public moveMarginOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            // Deribit doesn't have a "move order" function. so we have to cancel the order and place it again
            amount = Math.abs(amount);
            this.getOpenOrders(currencyPair).then((orders) => {
                if (orders.isOpenOrder(orderNumber) === true) {
                    this.marginCancelOrder(currencyPair, orderNumber).then((result) => {
                        if(!result.cancelled)
                            return Promise.reject({err: "cancelling order to move it failed"});
                        let order = orders.getOrder(orderNumber);
                        let submitOrder = order.type === "buy" ? this.marginBuy(currencyPair,  rate, amount, params) : this.marginSell(currencyPair,  rate, amount, params);
                        submitOrder.then((orderResult) => {
                            resolve(orderResult);
                        }).catch((err) => {
                            reject(err);
                        });
                    });
                }
                else
                    resolve(OrderResult.fromJson({message: "Order already filled"}, currencyPair, this))
            }).catch((err) => {
                reject(err);
            });
        })
    }

    public getAllMarginPositions() {
        return new Promise<MarginPositionList>((resolve, reject) => {
            this.orderReject = reject;
            this.websocket.action("positions").then((result) => {
                this.orderReject = null;
                let list = new MarginPositionList();
                result.forEach((pos) => {
                    const pair = this.currencies.getLocalPair(pos.instrument);
                    let position = this.currencies.getMarginPosition(pos, this.getMaxLeverage());
                    if (position) {
                        const ticker = this.ticker.get(pair.toString());
                        if (ticker)
                            position.pl *= ticker.last;
                        list.set(pair.toString(), position);
                    }
                });
                resolve(list);
            });
        })
    }

    public getMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<MarginPosition>((resolve, reject) => {
            // they only offer an API call to get all positions
            this.getAllMarginPositions().then((positions) => {
                resolve(positions.get(currencyPair.toString()));
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public closeMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<OrderResult>((resolve, reject) => {
            // they don't offer a close API call. get the position and issue a market buy/sell
            this.getMarginPosition(currencyPair).then((position) => {
                if (!position) {
                    let result = new OrderResult("Position already closed");
                    result.success = true;
                    return Promise.resolve(result);
                }
                let orderParams: MarginOrderParameters = {matchBestPrice: true}; // use market order, rate doesn't matter
                let rate = this.orderBook.get(currencyPair.toString()).getLast();
                if (rate <= 0.0)
                    rate = 1.0; // shouldn't happen, ignored either way
                if (position.type === "long")
                    return this.marginSell(currencyPair, rate, position.amount, orderParams);
                else
                    return this.marginBuy(currencyPair, rate, position.amount, orderParams);
            }).then((result) => {
                resolve(result);
            }).catch((err) => {
                reject(err)
            })
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected marginOrder(currencyPair: Currency.CurrencyPair, rate: number, amount: number, side: "buy" | "sell", outParams: ExRequestParams) {
        return new Promise<OrderResult>((resolve, reject) => {
            this.orderReject = reject; // when passing invalid params, deribit API only fires the error in the constructor
            this.websocket.action(side, outParams).then((result) => {
                /**
                 * { order:
                           { orderId: 2007403797,
                             type: 'limit',
                             instrument: 'BTC-PERPETUAL',
                             direction: 'buy',
                             price: 3100,
                             label: '',
                             amount: 10,
                             quantity: 1,
                             filledQuantity: 0,
                             filledAmount: 0,
                             avgPrice: 0,
                             commission: 0,
                             created: 1544759965013,
                             lastUpdate: 1544759965013,
                             state: 'open',
                             postOnly: false,
                             api: true,
                             max_show: 1,
                             maxShowAmount: 10,
                             adv: false },
                          trades: [] }
                 */
                this.orderReject = null;
                let orderResult = new OrderResult();
                if (result.order && result.order.orderId > 0) {
                    orderResult.success = true;
                    orderResult.orderNumber = result.order.orderId;
                    if (Array.isArray(result.trades) === true) {
                        let trades = [];
                        result.trades.forEach((trade) => {
                            let tradeObj = new Trade.Trade();
                            tradeObj.date = new Date(); // no timestamp provided from server
                            tradeObj.type = Trade.TradeType.BUY;
                            tradeObj.amount = trade.quantity;
                            tradeObj.rate = trade.price;
                            tradeObj.tradeID = trade.tradeSeq;
                            tradeObj = Trade.Trade.verifyNewTrade(tradeObj, currencyPair, this.getExchangeLabel(), this.getFee());
                            trades.push(tradeObj);
                        });
                        orderResult.resultingTrades.set(currencyPair.toString(), trades);
                    }
                }
                else
                    orderResult.success = false;
                resolve(orderResult)
            });
        })
    }

    protected createApiWebsocketConnection(): DeribitApi {
        const marketEventStreamMap = new Map<string, EventStream<any>>(); // (exchange currency name, stream instance)
        this.localSeqNr = 0; // keep counting upwards
        if (this.websocket === null)
            this.createWebsocket();
        this.websocket.connected.then(() => {
            this.updateOrderBooks(false); // we get it through the WebSocket connection
            this.currencyPairs.forEach((pair) => {
                let marketPair = this.currencies.getExchangePair(pair);
                // every market has their own sequence numbers on poloniex. we have to ensure they are piped in order
                let marketEventStream = new EventStream<any>(this.className + "-Market-" + marketPair, this.maxPendingMarketEvents);
                this.openMarketRelays.push(marketEventStream);
                marketEventStreamMap.set(pair.toString(), marketEventStream); // use local pairs here
                marketEventStream.on("value", (value, seqNr) => {
                    //this.marketStream.write(pair, value, seqNr); // currently not used in favor of CCXT
                });

                this.orderBook.get(pair.toString()).setSnapshot([], this.localSeqNr, false); // we receive an implicit snapshot with the first response

                let tickerObj = new Ticker.Ticker(this.exchangeLabel);
                tickerObj.indexValue = 0.0; // updated below on trades feed
                tickerObj.currencyPair = pair;
                this.ticker.set(pair.toString(), tickerObj);
            })

            //this.websocket.hook('trade', ['BTC-28SEP18','BTC-28DEC18'], (err) => {
            this.websocket.hook('trade', [...this.getSubscribedContractTypes(), 'index'], (data) => {
                this.resetWebsocketTimeout();
                this.localSeqNr++;
                if (data.tradeId) {
                    const currencyPair = this.currencies.getLocalPair(data.instrument);
                    let marketEventStream = marketEventStreamMap.get(currencyPair.toString());
                    if (!marketEventStream) {
                        logger.error("Received %s trade update for currency pair %s we didn't subscribe to: ", currencyPair, this.className, data);
                        return;
                    }
                    let trades = [];
                    // for trades: [tid, price, amount, time, type, amountbtc] - all strings, type = ask|bid, amountbtc mostly null
                    // to: [ 't', '25969600', 0, '0.09718515', '0.53288249', 1496175981 ]
                    // type 1 = buy, 0 = sell
                    //let timestamp = Math.floor(this.getLocalTimestampMs(date) / 1000);
                    /**
                     * { quantity: 500,
                          amount: 5000,
                          tradeId: 2671769,
                          instrument: 'BTC-PERPETUAL',
                          timeStamp: 1544746026802,
                          price: 3241,
                          direction: 'sell',
                          orderId: 0,
                          matchingId: 0,
                          tradeSeq: 631228,
                          tickDirection: 2,
                          indexPrice: 3248.79,
                          state: 'closed',
                          label: '',
                          me: '' }
                     */
                    trades.push(["t", data.tradeId, data.direction == "sell" ? 0 : 1, data.price, data.amount, data.timeStamp])
                    marketEventStream.add(this.localSeqNr, trades);
                    if (data.indexPrice)
                        this.ticker.get(currencyPair.toString()).indexValue = data.indexPrice;
                }
                else
                    logger.warn("Received unknown %s trade data: %s", this.className, data);
            });
            this.websocket.hook('order_book', this.getSubscribedContractTypes(), (data) => {
                this.resetWebsocketTimeout();
                this.localSeqNr++;
                if (typeof data.state !== "string")
                    return; // not needed, we get updates with the new book
                const currencyPair = this.currencies.getLocalPair(data.instrument);
                let marketEventStream = marketEventStreamMap.get(currencyPair.toString());
                if (!marketEventStream) {
                    logger.error("Received %s orderbook update for currency pair %s we didn't subscribe to: ", currencyPair, this.className, data);
                    return;
                }
                this.orderbookShapshot = new OrderBookUpdate<MarketOrder.MarketOrder>(Date.now(), false);
                ["bids", "asks"].forEach((side) => {
                    const exchangeOrders = data[side];
                    //const sideNr = side === "bids" ? 1 : 0;
                    exchangeOrders.forEach((order) => {
                        /**
                         * { quantity: 244,
                           amount: 2440,
                           price: 3271,
                           cm: 244,
                           cm_amount: 2440 }
                         */
                        //orders.push(["o", 1, order[0], order[2]]); // 1 for add
                        this.orderbookShapshot[side].push(MarketOrder.MarketOrder.getOrder(currencyPair, this.getExchangeLabel(), order.amount, order.price));
                    });
                });
                //marketEventStream.add(this.localSeqNr, orders);
                this.orderBook.get(currencyPair.toString()).replaceSnapshot(this.orderbookShapshot["bids"].concat(this.orderbookShapshot["asks"]), this.localSeqNr);
                const tickerObj = this.ticker.get(currencyPair.toString());
                tickerObj.last = data.last;
                tickerObj.lowestAsk = data.low;
                tickerObj.highestBid = data.high;
                // data.mark ?
            });
        });
        return this.websocket;
    }

    protected closeApiWebsocketConnection() {
        try {
            this.websocket.disconnect();
        }
        catch (err) {
            logger.error("Error disconnecting %s websocket connection", this.className, err);
        }
        //this.createWebsocket(); // API error when re-using it
        this.websocket = null;
    }

    protected createWebsocket() {
        this.websocket = new DeribitApi({
            key: this.apiKey.key,
            secret: this.apiKey.secret,
            testnet: this.apiKey.testnet === true,
            message: (msg) => {
                if (msg && ((Array.isArray(msg) === true && msg.length !== 0) || Object.keys(msg).length !== 0))
                    logger.verbose("%s message: ", this.className, msg);
            },
            error: (err) => {
                logger.error("%s error: %s", this.className, err);
                if (this.orderReject !== null) {
                    this.orderReject(err);
                    this.orderReject = null;
                }
                const errorMsg = err ? err.toString() : "";
                if (!errorMsg || (errorMsg.indexOf("authorization_required") === -1 && errorMsg.indexOf("invalid") === -1 && errorMsg.indexOf("order") === -1
                    && errorMsg.indexOf("not_enough_funds") === -1))
                    this.closeConnection("WebSocket error");
            },

            // see documentation for possible events // events not coming through here
            /*
            trade: (trade) => {
                logger.verbose("%s trade: %s", this.className, trade);
            }, */
        });
    }

    protected verifyTradeRequest(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<ExRequestParams>((resolve, reject) => {
            if (currencyPair) {
                if (this.currencies.getExchangePair(currencyPair) === undefined)
                    return reject({txt: "Currency pair not supported by this exchange", exchange: this.className, pair: currencyPair, permanent: true});
            }
            if (amount > 0 && rate * amount < this.minTradingValue)
                return reject({txt: "Value is below the min trading value", exchange: this.className, value: rate*amount, minTradingValue: this.minTradingValue, permanent: true})

            let outParams: any = {
                instrument: this.getContractForCurrencyPair(currencyPair),
                quantity: this.getContractAmount(currencyPair, rate, amount),
                type: params.matchBestPrice === true ? "market" : "limit",
                price: rate
            }
            if (params.fillOrKill === true)
                outParams.time_in_force = "fill_or_kill";
            else if (params.immediateOrCancel === true)
                outParams.time_in_force = "immediate_or_cancel";
            outParams.post_only = params.postOnly === true;
            resolve(outParams)
        })
    }

    protected getContractForCurrencyPair(currencyPair: Currency.CurrencyPair) {
        const pairStr = Currency.getCurrencyLabel(currencyPair.to);
        let type = Deribit.contractTypes.get(pairStr);
        if (type === undefined) {
            logger.error("Unable to get %s contract type for %s - returning default", this.className, currencyPair.toString());
            return this.deribitContractType;
        }
        return type;
    }

    protected getSubscribedContractTypes(): string[] {
        let types = [];
        for (let i = 0; i < this.currencyPairs.length; i++)
        {
            let type = this.getContractForCurrencyPair(this.currencyPairs[i]);
            if (types.indexOf(type) === -1) // check shouldn't be needed
                types.push(type);
        }
        return types;
    }

    protected privateReq(method: string, params: ExRequestParams): Promise<ExResponse> {
        return undefined; // not used here
    }

    protected publicReq(method: string, params: ExRequestParams): Promise<ExResponse> {
        return undefined; // not used here
    }

    protected verifyExchangeResponse(body: string | false, response: request.RequestResponse, method: string): Promise<ExResponse> {
        return undefined; // not used here
    }
}