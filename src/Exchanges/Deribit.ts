
// https://github.com/santacruz123/deribit-ws-nodejs
// https://github.com/deribit/deribit-api-js
// wait for v2 to mature and switch back to websockets https://github.com/askmike/deribit-v2-ws


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
//import {default as DeribitApi} from "deribit-ws-nodejs";
import * as db from "../database";
import * as helper from "../utils/helper";
import * as request from "request";

import EventStream from "../Trade/EventStream";
import {MarketOrder, Ticker, Trade, TradeHistory, Currency} from "@ekliptor/bit-models";
import {OrderBook} from "../Trade/OrderBook";
//import DeribitCcxt from "./DeribitCcxt";
import * as deribit2 from "deribit-v2-ws";

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
        /**
         * { timestamp: 1555050970616,
              stats: { volume: 125196.028196, low: 159.28, high: 171.91 },
              state: 'open',
              settlement_price: 164.18,
              open_interest: 21728805,
              min_price: 161.91,
              max_price: 168.52,
              mark_price: 165.22,
              last_price: 165.43,
              instrument_name: 'ETH-PERPETUAL',
              index_price: 164.32,
              funding_8h: 0.001234,
              current_funding: 0.004727,
              best_bid_price: 165.18,
              best_bid_amount: 8,
              best_ask_price: 165.35,
              best_ask_amount: 992 }
         */
        let ticker = new Ticker.Ticker(this.exchange.getExchangeLabel());
        return ticker; // not used for deribit, done via ws
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
        accAndPos.accounts.forEach((acc) => {
            summary.pl += acc.result.futures_session_upl;
        });
        summary.currentMargin = 1.0;
        accAndPos.positions.forEach((posGlobal) => {
            posGlobal.result.forEach((position) => {
                if (position.kind !== "future")
                    return;
                // TODO add netValue and more
                const liquidationPrice = position.estimated_liquidation_price;
                let currentMargin = this.computePseudoMargin(liquidationPrice, this.getLocalPair(position.instrument_name));
                if (summary.currentMargin > currentMargin)
                    summary.currentMargin = currentMargin; // use the smallest value (mostly used for smartphone alerts)
            });
        });
        return summary;
    }
    public getMarginPosition(margin: any, maxLeverage): MarginPosition {
        /**
         * {
              "average_price": 0,
              "delta": 0,
              "direction": "buy",
              "estimated_liquidation_price": 0,
              "floating_profit_loss": 0,
              "index_price": 3555.86,
              "initial_margin": 0,
              "instrument_name": "BTC-PERPETUAL",
              "kind": "future",
              "maintenance_margin": 0,
              "mark_price": 3556.62,
              "open_orders_margin": 0.000165889,
              "realized_profit_loss": 0,
              "settlement_price": 3555.44,
              "size": 0,
              "size_currency": 0,
              "total_profit_loss": 0
          }
         */
        if (!margin || margin.kind !== "future")
            return null;
        let position = new MarginPosition(Math.min(10, maxLeverage));
        position.type = margin.direction === "sell" ? "short" : "long";
        position.amount = Math.abs(margin.size_currency); // base currency, better than size
        position.contracts = margin.size;
        if (position.type === "short")
            position.amount *= -1;
        position.liquidationPrice = margin.estimated_liquidation_price;
        position.pl = margin.floating_profit_loss;
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
    protected websocket: any = null;
    //protected deribitCcxt: DeribitCcxt = null;
    protected orderbookShapshot: OrderBookUpdate<MarketOrder.MarketOrder> = null;
    //protected orderReject: (reason?: any) => void = null;

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
        /*
        this.deribitCcxt = new DeribitCcxt(options);
        this.deribitCcxt.setOnPoll((currencyPair: Currency.CurrencyPair, actions: /*MarketAction[]***any[], seqNr: number) => {
            this.marketStream.write(currencyPair, actions, seqNr);
        });
        */
        this.createWebsocket();

        this.contractValues.set("BTC", 10);
        this.contractValues.set("ETH", 1);
    }

    public subscribeToMarkets(currencyPairs: Currency.CurrencyPair[]) {
        //this.deribitCcxt.subscribeToMarkets(currencyPairs);
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
            this.getRawAccounts().then((accounts: any[]) => {
                /**
                 * { jsonrpc: '2.0',
                      id: 1555052157422,
                      result:
                       { username: 'Ekliptor',
                         type: 'main',
                         total_pl: 1.30666385,
                         tfa_enabled: false,
                         system_name: 'Ekliptor',
                         session_upl: -0.0118869,
                         session_rpl: 0.00001111,
                         session_funding: -0.00039103,
                         portfolio_margining_enabled: false,
                         options_vega: 0,
                         options_theta: 0,
                         options_session_upl: 0,
                         options_session_rpl: 0,
                         options_pl: 0,
                         options_gamma: 0,
                         options_delta: 0,
                         margin_balance: 11.72927255,
                         maintenance_margin: 0.01832508,
                         initial_margin: 0.03151381,
                         id: 3591,
                         futures_session_upl: -0.0118869,
                         futures_session_rpl: 0.00001111,
                         futures_pl: 1.30666385,
                         equity: 11.72927255,
                         email: 'danielw.home@yandex.com',
                         deposit_address: '2N2sq9oA9rnvwHwKS3U1kwF8BsbHkSEQ5ZE',
                         delta_total: 3.1032,
                         currency: 'BTC',
                         balance: 11.74114833,
                         available_withdrawal_funds: 11.69775874,
                         available_funds: 11.69775874 },
                      usIn: 1555052160810576,
                      usOut: 1555052160811058,
                      usDiff: 482,
                      testnet: true,
                      requestedAt: 1555052160791,
                      receivedAt: 1555052160820 }
                 */
                let balances = {}
                accounts.forEach((account) => {
                    balances[this.currencies.getLocalName(account.result.currency)] = account.result.equity;
                });
                resolve(Currency.fromExchangeList(balances, this.currencies))
            }).catch((err) => {
                reject({txt: "Error getting balances", err: err});
            })
        })
    }

    public getMarginAccountSummary() {
        return new Promise<MarginAccountSummary>((resolve, reject) => {
            // Deribit has 2 different margin accounts for BTC & ETH (different collateral etc..) so this call doesn't make a lot of sense here
            this.getRawAccounts().then(async (accounts) => {
                let positions = await this.getRawPositions();
                let summary = this.currencies.toMarginAccountSummary({accounts: accounts, positions: positions});
                resolve(summary);
            }).catch((err) => {
                reject({txt: "Error getting margin account summary", err: err});
            });
        })
    }

    public fetchOrderBook(currencyPair: Currency.CurrencyPair, depth: number) {
        return new Promise<OrderBookUpdate<MarketOrder.MarketOrder>>((resolve, reject) => {
            resolve(this.orderbookShapshot)
        })
    }

    public importHistory(currencyPair: Currency.CurrencyPair, start: Date, end: Date) {
        return new Promise<void>((resolve, reject) => {
            //const pairStr = this.currencies.getExchangePair(currencyPair);
            let tradeCount = 0;
            let lastTrade: Trade.Trade = null;
            let currentMs = start.getTime();
            const endMs = end.getTime();
            logger.verbose("Starting %s trades import", this.className);
            let importNext = () => {
                this.websocket.request("public/get_last_trades_by_instrument_and_time", {
                    instrument_name: this.getContractForCurrencyPair(currencyPair),
                    start_timestamp: currentMs,
                    end_timestamp: endMs,
                    count: 100, // max
                    include_old: true,
                    sorting: "asc"
                }).then((data) => {
                    if (!data.result) {
                        logger.error("Error importing %s %s trade history", this.className, currencyPair.toString());
                        return resolve();
                    }
                    const history = data.result.trades;
                    /**
                     * { trade_seq: 74027,
                          trade_id: 'ETH-184404',
                          timestamp: 1555046750057,
                          tick_direction: 1,
                          price: 163.65,
                          instrument_name: 'ETH-PERPETUAL',
                          index_price: 163.45,
                          direction: 'sell',
                          amount: 10 }
                     */
                    let trades = [];
                    history.forEach((dTrade) => {
                        let tradeObj = this.fromRawTrade(dTrade, currencyPair);
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
                        if (currentMs < end.getTime() && data.result.has_more === true)
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
            this.websocket.request("private/get_open_orders_by_currency", {
                currency: this.currencies.getExchangeName(Currency.getCurrencyLabel(currencyPair.to)),
                kind: "future",
                type: "all"
            }).then((data) => {
                if (!data || !data.result)
                    return Promise.reject({txt: "Error trading", res: data});
                let orders = new OpenOrders(currencyPair, this.className);
                data.result.forEach((o) => {
                    let type: "buy" | "sell" = o.direction === "buy" ? "buy" : "sell";
                    let orderObj: OpenOrder = {
                        orderNumber: o.order_id,
                        type: type,
                        rate: o.price,
                        amount: o.amount,
                        total: o.price*o.amount,
                        leverage: this.maxLeverage
                    }
                    orders.addOrder(orderObj);
                });
                resolve(orders);
            }).catch((err) => {
                reject(err);
            });
        })
    }

    public moveOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: OrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            reject({txt: "moveOrder() is not available in " + this.className + ". Most likely you forgot to enable marginTrading"})
        })
    }

    public marginBuy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                return this.marginOrder(currencyPair, rate, amount, "buy", outParams);
            }).then((result) => {
                resolve(result)
            }).catch((err) => {
                reject(err);
            });
        })
    }

    public marginSell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                return this.marginOrder(currencyPair, rate, amount, "sell", outParams);
            }).then((result) => {
                resolve(result)
            }).catch((err) => {
                reject(err);
            });
        })
    }

    public marginCancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            this.websocket.request("private/cancel", {order_id: orderNumber}).then((data) => {
                if (!data || !data.result) {
                    if (data && data.error && data.error.code === 11044) // not_open_order = already cancelled
                        return resolve({exchangeName: this.className, orderNumber: orderNumber, cancelled: true});
                    return reject({txt: "Error cancelling order", res: data});
                }
                resolve({exchangeName: this.className, orderNumber: orderNumber, cancelled: data.result.order_id != ""})
            });
        })
    }

    public moveMarginOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            // Deribit doesn't have a "move order" function. so we have to cancel the order and place it again
            // TODO API v2 now has /private/edit
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
            this.getRawPositions().then((datAllCurrencies) => {
                let list = new MarginPositionList();
                datAllCurrencies.forEach((data) => {
                    data.result.forEach((pos) => {
                        const pair = this.currencies.getLocalPair(pos.instrument_name);
                        let position = this.currencies.getMarginPosition(pos, this.getMaxLeverage());
                        if (position) {
                            list.set(pair.toString(), this.computeMarginPosition(position, pair));
                        }
                    });
                });
                resolve(list);
            }).catch((err) => {
                reject(err);
            });
        })
    }

    public getMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<MarginPosition>((resolve, reject) => {
            let timerID = setTimeout(() => { // fix for not returning anything if there is no position
                resolve(null);
            }, /*this.webSocketTimeoutMs*/5000);

            this.websocket.request("private/get_position", {
                instrument_name: this.getContractForCurrencyPair(currencyPair),
                kind: "future"
            }).then((data) => {
                clearTimeout(timerID);
                if (!data || !data.result)
                    return Promise.reject({txt: "Error getting margin position", res: data});
                let position = this.currencies.getMarginPosition(data.result, this.getMaxLeverage());
                resolve(this.computeMarginPosition(position, currencyPair));
            }).catch((err) => {
                clearTimeout(timerID);
                reject(err)
            })
        })
    }

    public closeMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<OrderResult>((resolve, reject) => {
            this.websocket.request("private/close_position", {
                instrument_name: this.getContractForCurrencyPair(currencyPair),
                type: "market",
                //price: 123
            }).then(async (data) => {
                let result = new OrderResult();
                if (!data || !data.result) {
                    if (data.error && data.error.code === 11094) { // internal_server_error happens when it doesn't exist -> wtf
                        let openPos = this.computeMarginPosition(await this.getMarginPosition(currencyPair), currencyPair);
                        if (!openPos) {
                            result.success = true;
                            result.message = "already closed";
                            return resolve(result);
                        }
                    }
                    return Promise.reject({txt: "Error closing margin position", res: data});
                }
                result.success = data.result.order && data.result.order.order_id ? true : false;
                if (data.result.order.order_id)
                    result.orderNumber = data.result.order.order_id;
                resolve(result);
            }).catch((err) => {
                reject(err)
            });
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected marginOrder(currencyPair: Currency.CurrencyPair, rate: number, amount: number, side: "buy" | "sell", outParams: ExRequestParams) {
        return new Promise<OrderResult>((resolve, reject) => {
            //this.orderReject = reject; // when passing invalid params, deribit API only fires the error in the constructor
            this.websocket.request("private/" + side, outParams).then((data) => {
                if (!data || !data.result)
                    return reject({txt: "Error trading", res: data});
                /**
                 * { order:
                      { time_in_force: 'good_til_cancelled',
                        reduce_only: false,
                        profit_loss: 0,
                        price: 120,
                        post_only: false,
                        order_type: 'limit',
                        order_state: 'open',
                        order_id: 'ETH-115960694',
                        max_show: 4,
                        last_update_timestamp: 1555054694632,
                        label: '',
                        is_liquidation: false,
                        instrument_name: 'ETH-PERPETUAL',
                        filled_amount: 0,
                        direction: 'buy',
                        creation_timestamp: 1555054694632,
                        commission: 0,
                        average_price: 0,
                        api: true,
                        amount: 4 } }
                 */
                let orderResult = new OrderResult();
                if (data.result && data.result.order && data.result.order.order_id) {
                    orderResult.success = true;
                    orderResult.orderNumber = data.result.order.order_id;
                    if (Array.isArray(data.result.trades) === true) {
                        let trades = [];
                        data.result.trades.forEach((trade) => {
                            let tradeObj = this.fromRawTrade(trade, currencyPair);
                            trades.push(tradeObj);
                        });
                        orderResult.resultingTrades.set(currencyPair.toString(), trades);
                    }
                }
                else
                    orderResult.success = false;
                resolve(orderResult)
            }).catch((err) => {
                reject(err);
            });
        })
    }

    protected createApiWebsocketConnection(): any {
        this.localSeqNr = 0; // keep counting upwards
        //if (this.websocket === null)
            //this.createWebsocket();
        this.updateOrderBooks(false); // we get it through the WebSocket connection
        this.createApiWebsocketConnectionDelayed();

        return this.websocket;
    }

    protected async createApiWebsocketConnectionDelayed(): Promise<void> {
        const marketEventStreamMap = new Map<string, EventStream<any>>(); // (exchange currency name, stream instance)
        await utils.promiseDelay(2500); // TODO wait til their API has a "connected" event
        this.currencyPairs.forEach((pair) => {
            let marketPair = this.currencies.getExchangePair(pair);
            // every market has their own sequence numbers on poloniex. we have to ensure they are piped in order
            let marketEventStream = new EventStream<any>(this.className + "-Market-" + marketPair, this.maxPendingMarketEvents);
            this.openMarketRelays.push(marketEventStream);
            marketEventStreamMap.set(pair.toString(), marketEventStream); // use local pairs here
            marketEventStream.on("value", (value, seqNr) => {
                this.marketStream.write(pair, value, seqNr); // currently not used in favor of CCXT
            });

            this.orderBook.get(pair.toString()).setSnapshot([], this.localSeqNr, false); // we receive an implicit snapshot with the first response

            let tickerObj = new Ticker.Ticker(this.exchangeLabel);
            tickerObj.indexValue = 0.0; // updated below on trades feed
            tickerObj.currencyPair = pair;
            this.ticker.set(pair.toString(), tickerObj);

            const tradesFeed = utils.sprintf("trades.%s.100ms", this.getContractForCurrencyPair(pair));
            this.websocket.subscribe("public", tradesFeed, (data: any[]) => {
                this.resetWebsocketTimeout();
                this.localSeqNr++;
                let trades = [];
                data.forEach((trade) => {
                    //let tradeObj = this.fromRawTrade(trade, pair);
                    // for trades: [tid, price, amount, time, type, amountbtc] - all strings, type = ask|bid, amountbtc mostly null
                    // to: [ 't', '25969600', 0, '0.09718515', '0.53288249', 1496175981 ]
                    // type 1 = buy, 0 = sell
                    trades.push(["t", trade.trade_id.replace(/[^-9]+/i, ""), trade.direction == "sell" ? 0 : 1, trade.price, trade.amount, trade.timestamp]);
                });
                marketEventStream.add(this.localSeqNr, trades);
            }).then((data) => {
                //console.log("INIT TRADES", data)
            }).catch((err) => {
                logger.error("Error subscribing to %s %s trades", this.className, pair.toString(), err);
            });

            const tickerFeed = utils.sprintf("ticker.%s.100ms", this.getContractForCurrencyPair(pair));
            this.websocket.subscribe("public", tickerFeed, (data: any) => {
                let ticker = this.ticker.get(pair.toString());
                if (!ticker) {
                    logger.warn("Received %s ticker update for currency pair %s we didn't subscribe to", this.className, pair.toString());
                    return;
                }
                ticker.last = data.last_price;
                ticker.highestBid = data.best_bid_price;
                ticker.lowestAsk = data.best_ask_price;
                ticker.low24hr = data.stats.low;
                ticker.high24hr = data.stats.high;
                ticker.isFrozen = data.state !== "open";
                ticker.indexValue = data.index_price;
            });

            const orderbookFeed = utils.sprintf("book.%s.none.20.100ms", this.getContractForCurrencyPair(pair));
            this.websocket.subscribe("public", orderbookFeed, (data: any) => {
                this.resetWebsocketTimeout();
                this.localSeqNr++;

                //const currencyPair = this.currencies.getLocalPair(data.instrument_name);
                const currencyPair = pair;
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
                        // [price, amount]
                        //orders.push(["o", 1, order[0], order[2]]); // 1 for add
                        this.orderbookShapshot[side].push(MarketOrder.MarketOrder.getOrder(currencyPair, this.getExchangeLabel(), order[1], order[0]));
                    });
                });
                this.orderBook.get(currencyPair.toString()).replaceSnapshot(this.orderbookShapshot["bids"].concat(this.orderbookShapshot["asks"]), this.localSeqNr);
            });
        });
    }

    protected closeApiWebsocketConnection() {
        try {
            if (typeof this.websocket.disconnect === "function") // doesn't exist yet in v2
                this.websocket.disconnect();
        }
        catch (err) {
            logger.error("Error disconnecting %s websocket connection", this.className, err);
        }
        //this.createWebsocket(); // API error when re-using it
        this.websocket = null;
    }

    protected async createWebsocket(): Promise<void> {
        this.websocket = deribit2; // function
        try {
            await this.websocket.connect();
            await this.websocket.authenticate(this.apiKey.key, this.apiKey.secret);
        }
        catch (err) {
            logger.error("Error connecting to %s WebSocket", this.className, err);
        }
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
                instrument_name: this.getContractForCurrencyPair(currencyPair),
                //amount: this.getContractAmount(currencyPair, rate, amount),
                amount: this.toTickSize(currencyPair, Math.abs(amount)),
                type: params.matchBestPrice === true ? "market" : "limit",
            }
            if (params.matchBestPrice !== true)
                outParams.price = rate;
            if (outParams.amount < 1)
                outParams.amount = 1;
            if (params.fillOrKill === true)
                outParams.time_in_force = "fill_or_kill";
            else if (params.immediateOrCancel === true)
                outParams.time_in_force = "immediate_or_cancel";
            outParams.post_only = params.postOnly === true;
            resolve(outParams)
        })
    }

    protected toTickSize(currencyPair: Currency.CurrencyPair, rate: number) {
        let contractValue = this.contractValues.get(Currency.getCurrencyLabel(currencyPair.to));
        if (contractValue === undefined)
            contractValue = 10; // shouln't happen
        rate = utils.calc.roundTo(rate, 10);
        if (rate < contractValue)
            rate = contractValue;
        return rate;
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

    protected fromRawTrade(rawTrade: any, currencyPair: Currency.CurrencyPair): Trade.Trade {
        let tradeObj = new Trade.Trade();
        tradeObj.date = new Date(rawTrade.timestamp ? rawTrade.timestamp : rawTrade.timeStamp);
        tradeObj.type = rawTrade.direction === "buy" ? Trade.TradeType.BUY : Trade.TradeType.SELL;
        tradeObj.amount = rawTrade.amount;
        tradeObj.rate = rawTrade.price;
        tradeObj.tradeID = rawTrade.trade_id ? rawTrade.trade_id.replace(/[^-9]+/i, "") : rawTrade.tradeId;
        tradeObj = Trade.Trade.verifyNewTrade(tradeObj, currencyPair, this.getExchangeLabel(), this.getFee());
        return tradeObj;
    }

    protected getRawAccounts(): Promise<any[]> {
        let reqOps = [];
        this.currencyPairs.forEach((pair) => {
            reqOps.push(this.websocket.request("private/get_account_summary", {
                currency: this.currencies.getExchangeName(Currency.getCurrencyLabel(pair.to)),
                extended: true
            }));
        });
        return Promise.all(reqOps);
    }

    protected getRawPositions(): Promise<any[]> {
        let reqOps = [];
        this.currencyPairs.forEach((pair) => {
            reqOps.push(this.websocket.request("private/get_positions", {
                currency: this.currencies.getExchangeName(Currency.getCurrencyLabel(pair.to)),
                kind: "future"
            }));
        });
        return Promise.all(reqOps);
    }

    protected computeMarginPosition(position: MarginPosition, pair: Currency.CurrencyPair) {
        if (position) {
            const ticker = this.ticker.get(pair.toString());
            if (ticker)
                position.pl *= ticker.last;
        }
        return position;
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