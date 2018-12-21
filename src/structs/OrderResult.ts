import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade} from "@ekliptor/bit-models";
import {AbstractExchange} from "../Exchanges/AbstractExchange";

/*
export class OrderTrade { // consolidated with Trade in bit-models
    amount: number = 0;
    date: Date;
    rate: number;
    total: number;
    tradeID: number;
    type: "buy" | "sell";

    constructor() {
    }
}
*/

export class OrderModification {
    type: "bid" | "ask";
    rate: number;
    amount?: number; // not present on orderBookRemove action
}

export class TradeList extends Map<string, Trade.Trade[]> { // (currency pair, trades)
    constructor() {
        super()
    }
}

export class OrderResult {
    //"success":1,"message":"Margin order placed.","orderNumber":"154407998","resultingTrades":{"BTC_DASH":[{"amount":"1.00000000","date":"2015-05-10 22:47:05","rate":"0.01383692","total":"0.01383692","tradeID":"1213556","type":"buy"}]}
    // "orderNumber":31226040,"resultingTrades":[{"amount":"338.8732","date":"2014-10-18 23:03:21","rate":"0.00000173","total":"0.00058625","tradeID":"16164","type":"buy"}]

    success: boolean = true; // only used with margin trading (on poloniex)
    message: string = ""; // only used with margin trading (on poloniex)
    orderNumber: number | string = 0;
    resultingTrades : TradeList = new TradeList();

    constructor(message = "") {
        this.message = message;
    }

    public static fromJson(json, currencyPair: Currency.CurrencyPair, exchange: AbstractExchange) {
        let result = new OrderResult();
        if (!json)
            return result;
        result.success = json.success == 0 || json.result === false ? false : true; // default true if parameter is missing
        result.message = "";
        if (json.message)
            result.message = json.message;
        else if (typeof json.descr === "object") { // Kraken
            result.message = json.descr.order;
            if (json.descr.close)
                result.message += " - " + json.descr.close;
        }

        if (json.orderNumber)
            result.orderNumber = typeof json.orderNumber === "number" ? json.orderNumber : parseInt(json.orderNumber);
        else if (json.txid) // Kraken
            result.orderNumber = json.txid; // its a (hex?) string with dashes
        else if (json.id)
            result.orderNumber = json.id;
        else if (json.order_id) // OKEX
            result.orderNumber = json.order_id;
        else if (json.result && json.result.OrderId) // Bittrex
            result.orderNumber = json.result.OrderId;
        else if (json.orderId) // Binance
            result.orderNumber = json.orderId;
        if (result.orderNumber === Number.NaN || !result.orderNumber) {
            logger.warn("Missing order number in order result json:", json)
            result.orderNumber = 0;
        }

        if (Array.isArray(json.resultingTrades)) {
            let trades = []
            json.resultingTrades.forEach((trade) => {
                trades.push(Trade.Trade.fromJson(trade, currencyPair, exchange.getExchangeLabel(), exchange.getFee(), exchange.getDateTimezoneSuffix()))
            })
            result.resultingTrades.set(currencyPair.toString(), trades);
        }
        else {
            // margin trading (on poloniex)
            // TODO when can this happen that a trade results in multiple currency pairs? when all margin positions are forced to close?
            for (let prop in json.resultingTrades)
            {
                let pair = exchange.getCurrencies().getLocalPair(prop);
                if (pair === undefined) { // impossible?
                    logger.error("Order on %s resulted in a trade of unsupported currenc pairs %s", exchange.getClassName(), prop);
                    continue;
                }
                let trades = []
                json.resultingTrades[prop].forEach((trade) => {
                    trades.push(Trade.Trade.fromJson(trade, currencyPair, exchange.getExchangeLabel(), exchange.getFee(), exchange.getDateTimezoneSuffix()))
                })
                result.resultingTrades.set(pair.toString(), trades);
            }
        }
        return result;
    }
}