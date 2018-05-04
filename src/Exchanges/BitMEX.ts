
// https://www.bitmex.com/app/apiOverview
// https://github.com/BitMEX/api-connectors/tree/master/official-ws/nodejs
// TODO not yet implemented. differs a lot from other exchanges


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
import * as BitMEXClient from "bitmex-realtime-api";

import EventStream from "../Trade/EventStream";
import {Currency, Ticker, Trade, TradeHistory, MarketOrder} from "@ekliptor/bit-models";
import {MarketAction} from "../Trade/MarketStream";
import {OrderBook} from "../Trade/OrderBook";



export class BitMEXCurrencies implements Currency.ExchangeCurrencies {
    protected exchange: /*AbstractExchange*/BitMEX;

    constructor(exchange: BitMEX) {
        this.exchange = exchange;
    }

    public getExchangeName(localCurrencyName: string): string {
        if (localCurrencyName === "BTC")
            return "XBT";
        return localCurrencyName
    }
    public getLocalName(exchangeCurrencyName: string): string {
        if (exchangeCurrencyName === "XBT" || exchangeCurrencyName === "XBt")
            return "BTC";
        return exchangeCurrencyName
    }

    public getExchangePair(localPair: Currency.CurrencyPair): string {
        let str1 = Currency.Currency[localPair.from]
        let str2 = Currency.Currency[localPair.to]
        if (!str1 || !str2) // currency not supported by exchange
            return undefined;
        str1 = this.getExchangeName(str1);
        str2 = this.getExchangeName(str2);
        if (str1 === "USD")
            return str2 + str1
        return str1 + str2 // reverse the order: BTC_USD -> XBTUSD
    }
    public getLocalPair(exchangePair: string): Currency.CurrencyPair {
        // DASH has 4 chars, other currencies 3. no separator
        let pair = exchangePair.split("_")
        let cur1 = Currency.Currency[pair[0]] // reverse the order back
        let cur2 = Currency.Currency[pair[1]]
        if (!cur1 || !cur2)
            return undefined;
        if (cur2 == Currency.Currency.USD)
            return new Currency.CurrencyPair(cur2, cur1)
        return new Currency.CurrencyPair(cur1, cur2)
    }
    public toLocalTicker(exchangeTicker: any): Ticker.Ticker {
        let ticker = new Ticker.Ticker(this.exchange.getExchangeLabel());
        if (!exchangeTicker || !exchangeTicker.length) {
            logger.error("Received invalid exchange ticker data from %s", this.exchange.getClassName(), exchangeTicker)
            return undefined;
        }

        exchangeTicker = exchangeTicker[0];

        //ticker.currencyPair = this.getLocalPair(exchangeTicker[0]); set on request
        ticker.last = exchangeTicker.lastPrice;
        ticker.lowestAsk = exchangeTicker.askPrice;
        ticker.highestBid = exchangeTicker.bidPrice;
        ticker.percentChange = 0;
        ticker.baseVolume = exchangeTicker.volume24h; // amount of contracts?
        ticker.quoteVolume = 0;
        ticker.isFrozen = false;
        ticker.high24hr = exchangeTicker.highPrice;
        ticker.low24hr = exchangeTicker.lowPrice;
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
            //if (this.exchange.getRawBalances())
                //summary.pl = this.exchange.getRawBalances().info[margin.holding[0].symbol.substr(0, 3)].profit_unreal;
            const liquidationPrice = parseFloat(margin.force_liqu_price.replaceAll(",", ""));
            let currentMargin = this.computeOkexPseudoMargin(liquidationPrice, this.getLocalPair(margin.holding[0].symbol))
            if (summary.currentMargin > currentMargin)
                summary.currentMargin = currentMargin; // use the smallest value (mostly used for smartphone alerts)
        })
        return summary;
    }
    public getMarginPosition(margin: any, maxLeverage): MarginPosition {
        if (margin.simpleQty == 0)
            return null;

        let position = new MarginPosition(maxLeverage);
        if (margin.simpleQty >= 0) {
            position.amount = margin.simpleQty;
            position.type = "long";
        }
        else {
            position.amount = margin.simpleQty;
            position.type = "short";
        }

        position.liquidationPrice = margin.liquidationPrice

        //position.pl = TODO!!!!! unrealisedPnl?

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

export default class BitMEX extends AbstractContractExchange {
    // also update contract value below
    protected static readonly FETCH_CURRENCIES = ["btc", "ltc", "eth", "etc", "bch", "btg", "xrp", "eos"]
    protected static readonly FETCH_PAIRS = ["btc_usd", "ltc_usd", "eth_usd", "etc_usd", "bch_usd", "btg_usd", "xrp_usd", "eos_usd"];
    //protected futureContractType: string = nconf.get("serverConfig:futureContractType");
    protected futureContractType = new FutureContractTypeMap();

    protected currencies: BitMEXCurrencies;
    protected apiClient: any = null; // TODO wait for typings
    protected orderbookShapshot = new OrderBookUpdate<MarketOrder.MarketOrder>(Date.now(), false);

    protected restApiPath: string;

    constructor(options: ExOptions) {
        super(options)
        this.publicApiUrl = "https://testnet.bitmex.com"; // TODO: set www instead of testnet for real operation
        this.privateApiUrl = this.publicApiUrl;
        this.restApiPath = "/api/v1"
        //this.pushApiUrl = ""; // for autobahn
        this.pushApiUrl = "wss://apiclient";
        this.pushApiConnectionType = PushApiConnectionType.WEBSOCKET;
        this.dateTimezoneSuffix = "";
        this.serverTimezoneDiffMin = 0;
        this.exchangeLabel = Currency.Exchange.BITMEX;
        //this.minTradingValue = 1.0; // for margin positions, min 1 contract (100 USD with BTC, 10 USD with LTC)
        this.minTradingValue = 0.09; // actually different for LTC and BTC, depending on contract value
        this.fee = 0.003; // only for opening positions
        this.maxLeverage = 20; // 2 - 100
        this.currencies = new BitMEXCurrencies(this);
        this.webSocketTimeoutMs = nconf.get('serverConfig:websocketTimeoutMs')*6; // they don't send pings too often
        this.httpKeepConnectionsAlive = true; // they have full support for it. allegedly as fast as websockets
        this.apiClient = new BitMEXClient({
            testnet: true,
            apiKeyID: this.apiKey.key,
            apiKeySecret: this.apiKey.secret,
            maxTableLen: 10000  // the maximum number of table elements to keep in memory (FIFO queue)
        });

        /*
        this.futureContractType.set("LTC", nconf.get("serverConfig:futureContractType")); // TODO ?
        this.contractValues.set("BTC", 100);
        this.contractValues.set("LTC", 10);
        this.contractValues.set("ETH", 10);
        this.contractValues.set("ETC", 10);
        this.contractValues.set("BCH", 10);
        this.contractValues.set("BTG", 10);
        this.contractValues.set("XRP", 10);
        this.contractValues.set("EOS", 10);
        */
    }

    public repeatFailedTrade(error: any, currencyPair: Currency.CurrencyPair) {
        // TODO
        return super.repeatFailedTrade(error, currencyPair);
    }

    public getTicker() {
        // https://www.bitmex.com/api/v1/quote/?symbol=XBT
        return new Promise<Ticker.TickerMap>((resolve, reject) => {
            // ticker data is updated via websocket push api
            // their ticker HTTP api only allows fetching 1 currency pair at a time
            setTimeout(() => {
                resolve(this.ticker)
            }, 0)
        })
    }

    public getIndexPrice() {
        return new Promise<Ticker.TickerMap>((resolve, reject) => {
            // TODO index price is displayed on their website, transmitted via websockets, but no api available?
            setTimeout(() => {
                resolve(this.ticker)
            }, 0)
        })
    }

    public satoshi2BTC(sato) {
        return sato/100000000.0
    }

    public getBalances() {
        return new Promise<Currency.LocalCurrencyList>((resolve, reject) => {
            // /user/wallet only holds XBT
            let params = {
                currency: "XBt" // BitMEX wallet only holds XBT
            }
            this.privateReq("GET /user/walletSummary", params).then((balance) => {
                //console.log(balance)
                let balances = {}
                // TODO: is that right dow e want it in satoshi
                balances["BTC"] = this.satoshi2BTC(balance[2].walletBalance)
                resolve(Currency.fromExchangeList(balances, this.currencies))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getMarginAccountSummary() {
        return new Promise<MarginAccountSummary>((resolve, reject) => {
            // /user/margin
            let params = {
                currency: "XBt" // BitMEX wallet only holds XBT
            }
            this.privateReq("GET /user/margin", params).then((margin) => {
                //console.log(margin)
                let account = new MarginAccountSummary()
                account.currentMargin  = 1.0 - margin.marginUsedPcnt
                account.pl = this.satoshi2BTC(margin.unrealisedProfit)
                account.netValue = account.totalValue = this.satoshi2BTC(margin.availableMargin)
                console.log(account)
                resolve(account)

            }).catch((err) => {
                reject(err)
            })
        })
    }

    public fetchOrderBook(currencyPair: Currency.CurrencyPair, depth: number) {
        return new Promise<OrderBookUpdate<MarketOrder.MarketOrder>>((resolve, reject) => {
            resolve(this.orderbookShapshot)
        })
    }

    public importHistory(currencyPair: Currency.CurrencyPair, start: Date, end: Date) {
        return new Promise<void>((resolve, reject) => {
            let marketPair = this.currencies.getExchangePair(currencyPair);

            let offset = 0;
            const count = 500;
            let importNext = () => {

                let outParams = {
                    symbol: marketPair,
                    startTime: utils.getUnixTimeStr(true, start),
                    endTime: utils.getUnixTimeStr(true, end),
                    count: count, // note 500 is max, 100 is default
                    start: offset
                }
                this.privateReq("GET /trade", outParams).then((history) => {

                    let trades = [];
                    history.forEach((rawTrade) => {

                        let tradeObj = new Trade.Trade();
                        tradeObj.date = new Date(rawTrade.timestamp);
                        tradeObj.type = rawTrade.side == "Sell" ? Trade.TradeType.SELL : Trade.TradeType.BUY;
                        tradeObj.amount = Math.abs(rawTrade.size); // todo: is teh unit right?
                        tradeObj.rate = rawTrade.price;
                        tradeObj.tradeID = Math.floor(tradeObj.date.getTime() * tradeObj.amount)

                        tradeObj = Trade.Trade.verifyNewTrade(tradeObj, currencyPair, this.getExchangeLabel(), this.getFee())

                        trades.push(tradeObj)
                    })

                    Trade.storeTrades(db.get(), trades, (err) => {
                        if (err)
                            logger.error("Error storing trades", err)
                    })

                    if(history.length >= count) {
                        offset += count;
                        setTimeout(importNext.bind(this), 3000) // avoid hitting the rate limit -> temporary ban
                    }
                    else {
                        resolve();
                    }
                }).catch((err) => {
                    reject(err)
                })
            };
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

            let marketPair = this.currencies.getExchangePair(currencyPair);

            let outParams = {
                symbol: marketPair,
            }
            this.privateReq("GET /order", outParams).then((result) => {
                let orders = new OpenOrders(currencyPair, this.className);
                result.forEach((o) => {
                    if (o.ordStatus == "Canceled" || o.ordStatus == "Filled") {
                        return;
                    }

                    let type: "buy" | "sell" = o.side == "Buy" ? "buy" : "sell"; // type: order type 1: open long, 2: open short, 3: close long, 4: close short -> buy/sell
                    let orderObj: OpenOrder = {
                        orderNumber: o.orderID,
                        type: type,
                        rate: o.price,
                        amount: o.simpleOrderQty, // todo: is that right?
                        total: o.price*o.amount,
                        leverage: this.maxLeverage
                    }
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
        return this.marginOrder(currencyPair, rate, amount, params);
    }

    public marginSell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        return this.marginOrder(currencyPair, rate, -amount, params);
    }

    private marginOrder(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((oP) => {

                let marketPair = this.currencies.getExchangePair(currencyPair);

                let outParams: any = {
                    'symbol': marketPair, //"XBTUSD",
                    'ordType': params && params.matchBestPrice ?  "Market" : "Limit", // limit is default
                    // 'side': "Buy" / "Sell", can be ommited if orderQty or simpleOrderQty is present positive value means buy negative measns sell
                    //orderQty: amount, this would require amount = this.getContractAmount(currencyPair, rate, amount);
                    simpleOrderQty: amount
                }
                if(params && params.fillOrKill) {
                    outParams.execInst = "AllOrNone"
                }
                if (outParams.ordType == "Limit") {
                    outParams.price = rate
                }

                return this.privateReq("POST /order", outParams)
            }).then((response) => {
                //this.verifyPositionSize(currencyPair, amount)

                let result = new OrderResult()
                result.success = response.ordStatus == "Filled"
                result.orderNumber = response.orderID
                resolve(result)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public marginCancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            let params = {
                orderID: orderNumber
            }
            this.privateReq("DELETE /order", params).then((result) => {
                resolve({exchangeName: this.className, orderNumber: orderNumber, cancelled: result[0].ordStatus=="Canceled"})
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public moveMarginOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            amount = Math.abs(amount);
            // todo: re enable this???
            //if (amount !== 0 && amount < this.minTradingValue)
            //    return resolve(OrderResult.fromJson({message: "Remaining amount below min trading value can not be moved: " + amount}, currencyPair, this))
            let outParams;
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((oP) => {
                outParams = oP;
                // we don't know if it was a buy or sell order, so retrieve the order first
                return this.getOpenOrders(currencyPair)
            }).then((orders) => {
                const symbol = this.currencies.getExchangePair(currencyPair);
                if (orders.isOpenOrder(orderNumber)) {
                    return this.marginCancelOrder(currencyPair, orderNumber).then((result)=>{
                        if(!result.cancelled) {
                            return Promise.reject({err: "not failed"})
                        }
                        return this.marginOrder(currencyPair,  rate, amount, params)
                    })
                }
                else
                    return Promise.resolve(OrderResult.fromJson({message: "Order already filled"}, currencyPair, this))
            }).then((result) => {
                resolve(result)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getAllMarginPositions() {
        return new Promise<MarginPositionList>((resolve, reject) => {
            let params = { }
            this.privateReq("GET /position", params).then((positions) => {
                let list = new MarginPositionList();
                for (let i = 0; i < positions.length; i++)
                {
                    for (let j = 0; j < this.currencyPairs.length; j++)
                    {
                        let marketPair = this.currencies.getExchangePair(this.currencyPairs[j]);
                        if(marketPair == positions[i].symbol) {
                            let position = this.currencies.getMarginPosition(positions[i], this.getMaxLeverage());
                            if (position)
                                list.set(this.currencyPairs[j].toString(), position)
                            break;
                        }
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
            let marketPair = this.currencies.getExchangePair(currencyPair);

            let params = {
                filter: {
                    symbol: marketPair
                }
            }
            this.privateReq("GET /position", params).then((positions) => {
                let position = this.currencies.getMarginPosition(positions[0], this.getMaxLeverage());
                resolve(position)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public closeMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<OrderResult>((resolve, reject) => {

            let marketPair = this.currencies.getExchangePair(currencyPair);

            let outParams = {
                'symbol': marketPair, //"XBTUSD",
                'execInst': 'Close',
            }

            this.privateReq("POST /order", outParams).then((response) => {
                //this.verifyPositionSize(currencyPair, amount)

                let result = new OrderResult()
                result.success = response.ordStatus == "Filled"
                result.orderNumber = response.orderID
                resolve(result)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected publicReq(method: string, params: ExRequestParams = {}) {
        return this.myReq(this.publicApiUrl, method, params);
    }

    protected privateReq(method: string, params: ExRequestParams = {}) {
        return this.myReq(this.privateApiUrl, method, params);
    }

    protected myReq(base_url: string, method: string, params: ExRequestParams = {}) {
        return new Promise<ExResponse>((resolve, reject) => {
            if (!base_url || !this.apiKey)
                return reject({txt: "PrivateApiUrl and apiKey must be provided for private exchange request", exchange: this.className})

            let verb_method = method.split(" ");

            let verb = verb_method[0]
            let path = this.restApiPath + verb_method[1]
            let data = '';
            if(verb == "GET") {
                path += "?" + querystring.stringify(params);
            }
            else if(verb == "POST") {
                data = JSON.stringify(params);
            }else if(verb == "DELETE") {
                data = querystring.stringify(params);
            }

            let options: any = {
                retry: false, // don't retry
                headers: this.signRequest(verb, path, data),
                cloudscraper: true
            }

            const urlStr = base_url + path;
            if(verb == "GET") {
                this.get(urlStr, (body, response) => {
                    this.verifyExchangeResponse(body, response, method).then((json) => {
                        resolve(json)
                    }).catch((err) => {
                        reject(err)
                    })
                }, options)
            }
            else if(verb == "POST" || verb == "DELETE") {
                if (verb == "DELETE") {
                    options.method = "DELETE"
                }
                else {
                    options.postJson = true
                }
                this.post(urlStr, params, (body, response) => {
                    this.verifyExchangeResponse(body, response, method).then((json) => {
                        resolve(json)
                    }).catch((err) => {
                        reject(err)
                    })
                }, options)
            }
        })
    }

    protected signRequest(verb, path, data = '') {
        let expires = Math.floor(Date.now() / 1000) + 100;
        let raw = verb + path + expires + data;

        let secret_buffer = new Buffer(this.apiKey.secret);
        let hmac = crypto.createHmac('sha256', secret_buffer);
        let signature = hmac.update(raw, 'latin1').digest('hex');

        let headers = {
          'api-expires': expires,
          'api-key': this.apiKey.key,
          'api-signature': signature
        }
        return headers;
    }

    protected createConnection(): autobahn.Connection {
        return null;
    }

    protected createWebsocketConnection(): WebSocket {
        try {
            const marketEventStreamMap = new Map<string, EventStream<any>>(); // (exchange currency name, stream instance)

            //let conn: WebSocket = new WebSocket(this.pushApiUrl, this.getWebsocketOptions());
            const bws = this.apiClient.socket/*(2)*/; // TODO proxy/options

            this.apiClient.on("error", (err) => {
                logger.error("WebSocket error in %s", this.className, err);
                this.closeConnection("WebSocket error")
            })

            this.apiClient.on('open', () => {
                logger.verbose("%s WS Connection opened", this.className)
            });

            this.apiClient.on('initialize', () => {
                logger.verbose('%s Client initialized, data is flowing.', this.className)

                let lastTradeID = "";

                this.currencyPairs.forEach((pair) => {
                    const currencyPair = pair;
                    if (!currencyPair)
                        return;

                    let orderBook: OrderBook<MarketOrder.MarketOrder> = this.orderBook.get(pair.toString());
                    orderBook.setSnapshot([], this.localSeqNr, true);

                    let marketPair = this.currencies.getExchangePair(currencyPair);

                    let marketEventStream = new EventStream<any>(this.className + "-Market-" + marketPair, this.maxPendingMarketEvents);
                    this.openMarketRelays.push(marketEventStream);
                    marketEventStreamMap.set(pair.toString(), marketEventStream); // use local pairs here

                    marketEventStream.on("value", (value, seqNr) => {
                         this.marketStream.write(pair, value, seqNr);
                    })

                    this.apiClient.addStream(marketPair, 'trade', (data, symbol, tableName) => {
                        // we get maxTableLen newest results, if the table is full it behaves like a FIFO, so we need to detect whats new
                        //console.log("got trades: " + data.length);
                        this.resetWebsocketTimeout();

                        if (!data.length || data.length <= 0) {
                            return
                        }

                        let marketEventStream = marketEventStreamMap.get(currencyPair.toString());
                        if (!marketEventStream) {
                            logger.error("Received market update for currency pair we didn't subscribe to:", currencyPair);
                            return;
                        }

                        let newIndex = 0;
                        for (let i=data.length-1; i >= 0; i--) {
                            let trade = data[i];
                            if (trade.trdMatchID == lastTradeID) {
                                newIndex = i+1;
                                break;
                            }
                        }
                        lastTradeID = data[data.length-1].trdMatchID;

                        let trades = [];
                        for (let i=newIndex; i < data.length; i++) {
                            let trade = data[i];

                            let date = this.setDateByStr(new Date(this.lastServerTimestampMs), trade.timestamp);
                            let timestamp = Math.floor(date.getTime() / 1000);
                            // todo: order.size to coin
                            trades.push(["t", trade.trdMatchID, trade.side == "Buy" ? 1 : 0, trade.price, trade.size, timestamp])
                        }

                        if(trades.length > 0) {
                            this.localSeqNr++;
                            marketEventStream.add(this.localSeqNr, trades);
                        }
                    });

                    this.apiClient.addStream(marketPair, 'orderBookL2', (data, symbol, tableName)=> {
                        // we get maxTableLen newest results, if the table is full it behaves like a FIFO, so we need to detect whats new
                        this.resetWebsocketTimeout();

                        if (!data.length || data.length <= 0) {
                            return
                        }

                        let orders = [];

                        this.orderbookShapshot = new OrderBookUpdate<MarketOrder.MarketOrder>(Date.now(), false);

                        data.forEach((order) => {
                            // for orders: [Price, Amount(Contract), Amount(Coin),Cumulant(Coin),Cumulant(Contract)]
                            // [ 'o', 1, '0.09520000', '8.74681417' ] // add 1, remove 0
                            // todo: order.size to coin
                            orders.push(["of", 1, order.price, order.size])

                            let prop = order == "Sell" ? "asks" : "bids";
                            this.orderbookShapshot[prop].push(MarketOrder.MarketOrder.getOrder(currencyPair, this.getExchangeLabel(), order.size, order.price))
                        })

                        //this.localSeqNr++; // only increment for trades
                        //this.marketStream.write(currencyPair, orders, this.localSeqNr);
                        orderBook.replaceSnapshot(this.orderbookShapshot["bids"].concat(this.orderbookShapshot["asks"]), this.localSeqNr);

                    });

                    this.apiClient.addStream(marketPair, 'instrument', (data, symbol, tableName)=> {
                      // we get maxTableLen newest results, if the table is full it behaves like a FIFO, so we need to detect whats new
                      //console.log("got orders: " + data.length);
                        let tickerObj = this.currencies.toLocalTicker(data)
                        if (!tickerObj)
                            return;
                        tickerObj.currencyPair = currencyPair
                        if (!tickerObj.currencyPair)
                            return; // we don't support this pair (shouldn't be subscribed then)
                        let tickerMap = new Ticker.TickerMap()
                        tickerMap.set(tickerObj.currencyPair.toString(), tickerObj)
                        this.setTickerMap(tickerMap)
                    });
                })

            });

            this.apiClient.on('close', () => {
                logger.info('%s Connection closed.', this.className)
                this.closeConnection("Connection closed");
            });

            this.apiClient.on('end', () => {
                logger.info('%s Connection ended.', this.className)
                this.closeConnection("Connection ended");
            });

            return bws; // EventEmitter and not WebSocket, but ok
        }
        catch (e) {
            logger.error("Exception on creating %s WebSocket connection", this.className, e)
            return null; // this function will get called again after a short timeout
        }
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
            let json = typeof(body) == "string" ? utils.parseJson(body) : body;
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
                const pairPos = BitMEX.FETCH_PAIRS.indexOf(pairArr[u].toLowerCase() + "_usd");
                if (pairPos !== -1)
                    fetchPairs.push(BitMEX.FETCH_PAIRS[pairPos])
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
                const currencyPos = BitMEX.FETCH_CURRENCIES.indexOf(pairArr[u].toLowerCase());
                if (currencyPos !== -1)
                    fetchCurrencies.push(BitMEX.FETCH_CURRENCIES[currencyPos])
                else
                    logger.error("Unable to get %s currency %s to fetch", this.className, pairArr[u])

            }
        }
        return fetchCurrencies;
    }
}