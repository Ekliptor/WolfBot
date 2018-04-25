import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {controller as Controller} from '../src/Controller';
import {AbstractExchange} from "../src/Exchanges/AbstractExchange";
import Poloniex from "../src/Exchanges/Poloniex";
import HistoryDataExchange from "../src/Exchanges/HistoryDataExchange";
import Pushover from "../src/Notifications/Pushover";
import Notification from "../src/Notifications/Notification";
import {OrderResult} from "../src/structs/OrderResult";
import {Currency} from "@ekliptor/bit-models";
import OKEX from "../src/Exchanges/OKEX";
import Kraken from "../src/Exchanges/Kraken";
import Bitfinex from "../src/Exchanges/Bitfinex";

let importTrades = () => {
    //let ex = new Poloniex(nconf.get("serverConfig:apiKey:exchange:Poloniex"))
    let ex = new OKEX(nconf.get("serverConfig:apiKey:exchange:OKEX")[0])
    //let ex = new Kraken(nconf.get("serverConfig:apiKey:exchange:Kraken")[0])
    //let ex = new Bitfinex(nconf.get("serverConfig:apiKey:exchange:Bitfinex")[0])

    let pair = new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.BTC)
    //let end = new Date();

    //let start = utils.date.dateAdd(end, "day", -60)
    let start = utils.date.parseAsGmt0(nconf.get("serverConfig:backtest:from"))
    let end = utils.date.parseAsGmt0(nconf.get("serverConfig:backtest:to"))
    //ex.subscribeToMarkets([pair])

    setTimeout(() => { // Bitfinex needs time to connect
        ex.importHistory(pair, start, end).then(() => {
            logger.info("Imported history")
        }).catch((err) => {
            logger.error("Error importing history", err)
        })
    }, nconf.get("serverConfig:exchangeImportDelayMs"))
}

let replay = () => {
    let history = new HistoryDataExchange({exchangeName: "Poloniex", exchangeLabel: Currency.Exchange.POLONIEX})
    let pair = new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.ETH)
    // TODO set balances
    let now = new Date();
    let start = utils.date.dateAdd(now, "day", -2)
    let end = utils.date.dateAdd(now, "day", -1)
    history.replay(pair, start, end)
}

let getOrderBook = () => {
    let polo = new Poloniex(nconf.get("serverConfig:apiKey:exchange:Poloniex"))

    let pair = new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.LTC)
    polo.fetchOrderBook(pair, 50).then((book) => {
        console.log(book)
        console.log("bid %s, ask %s", book.getBid(), book.getAsk())
        //logger.info("Imported history")
    }).catch((err) => {
        logger.error("Error getting order book", err)
    })
}

let getOpenOrders = () => {
    let polo = new Poloniex(nconf.get("serverConfig:apiKey:exchange:Poloniex"))

    let pair = new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.LTC)
    polo.getOpenOrders(pair).then((orders) => {
        console.log(orders)
        //logger.info("Imported history")
    }).catch((err) => {
        logger.error("Error getting open orders", err)
    })
}

Controller.loadServerConfig(() => {
    utils.file.touch(AbstractExchange.cookieFileName).then(() => {
        importTrades()
        //replay()
        //getOrderBook();
        //getOpenOrders();
    })
})