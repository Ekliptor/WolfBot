import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as argvFunction from "minimist";
const argv = argvFunction(process.argv.slice(2));
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

export type MultipleCurrencyImportExchange = "Poloniex" | "Bitfinex";
const currencyImportMap = new Map<MultipleCurrencyImportExchange, Currency.CurrencyPair[]>([
    ["Poloniex", [
        new Currency.CurrencyPair(Currency.Currency.USDT, Currency.Currency.BTC),
        new Currency.CurrencyPair(Currency.Currency.USDT, Currency.Currency.ETH),
        new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.ETH),
        new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.LTC),
        new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.DASH),
        new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.XMR),
        new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.DOGE)
    ]],
    ["Bitfinex", [
        new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.BTC),
        new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.ETH),
        new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.LTC),
        new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.BCH),
        new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.XRP),
        new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.EOS),
        new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.IOTA),
        new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.ETH),
        new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.BCH),
        new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.EOS)
    ]]
]);

let scheduleExit = (delayMs = 500, code = 0) => {
    // updates are already run in app.ts on startup. no need to check again. just delay to ensure async log gets written
    setTimeout(() => {
        process.exit(code);
    }, delayMs);
}

let importTrades = () => {
    //let ex = new Poloniex(nconf.get("serverConfig:apiKey:exchange:Poloniex"))
    //let ex = new OKEX(nconf.get("serverConfig:apiKey:exchange:OKEX")[0])
    //let ex = new Kraken(nconf.get("serverConfig:apiKey:exchange:Kraken")[0])
    let ex = new Bitfinex(nconf.get("serverConfig:apiKey:exchange:Bitfinex")[0])

    let pair = new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.BTC)
    //let pair = new Currency.CurrencyPair(Currency.Currency.USDT, Currency.Currency.BTC)
    //let end = new Date();

    //let start = utils.date.dateAdd(end, "day", -60)
    let start = utils.date.parseAsGmt0(nconf.get("serverConfig:backtest:from"))
    let end = utils.date.parseAsGmt0(nconf.get("serverConfig:backtest:to"))
    ex.subscribeToMarkets([pair])

    setTimeout(() => { // Bitfinex needs time to connect
        logger.info("Starting manual import of %s %s trades", ex.getClassName(), pair.toString());
        ex.importHistory(pair, start, end).then(() => {
            logger.info("Imported history")
            scheduleExit();
        }).catch((err) => {
            logger.error("Error importing history", err)
            scheduleExit();
        })
    }, nconf.get("serverConfig:exchangeImportDelayMs"))
}

let importMultipleCurrencyTrades = (exchangeName: MultipleCurrencyImportExchange) => {
    let ex: AbstractExchange = null;
    switch (exchangeName) {
        case "Poloniex":
            ex = new Poloniex(nconf.get("serverConfig:apiKey:exchange:Poloniex"));
            break;
        case "Bitfinex":
            ex = new Bitfinex(nconf.get("serverConfig:apiKey:exchange:Bitfinex")[0])
            break;
        default:
            logger.error("Importing multiple currency pairs from %s is not supported", exchangeName);
            return scheduleExit();
    }
    const exchangePairs = currencyImportMap.get(exchangeName);
    if (exchangePairs === undefined || exchangePairs.length === 0) {
        logger.error("No currency pairs to import found for %s", exchangeName)
        return scheduleExit();
    }

    let subscribe = (pair: Currency.CurrencyPair) => {
        if (exchangeName !== "Bitfinex")
            return;
        ex.unsubscribeFromMarkets();
        ex.subscribeToMarkets([pair])
    }

    let importNextPair = async (i: number) => {
        if (i >= exchangePairs.length) {
            logger.info("Successfully imported %s pairs from %s", exchangePairs.length, exchangeName);
            return scheduleExit();
        }
        const pair = exchangePairs[i];
        subscribe(pair);
        await utils.promiseDelay(nconf.get("serverConfig:exchangeImportDelayMs"));

        let start = utils.date.parseAsGmt0(nconf.get("serverConfig:backtest:from"))
        let end = utils.date.parseAsGmt0(nconf.get("serverConfig:backtest:to"))
        if (argv.days) {
            end = new Date();
            start = utils.date.dateAdd(end, "day", -1*parseInt(argv.days));
        }
        let startStr = utils.getUnixTimeStr(true, start, true);
        let endStr = utils.getUnixTimeStr(true, end, true);
        logger.info("Starting manual import of %s %s trades from %s to %s", ex.getClassName(), pair.toString(), startStr, endStr);
        ex.importHistory(pair, start, end).then(() => {
            logger.info("Imported history")
            importNextPair(++i);
        }).catch((err) => {
            logger.error("Error importing history", err)
            importNextPair(++i); // try to continue with next pair
        })
    }
    setTimeout(() => { // Bitfinex needs time to connect
        importNextPair(0);
    }, nconf.get("serverConfig:exchangeImportDelayMs"));
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
        //importTrades()

        // node --use_strict --max-old-space-size=2096 app.js --config=Noop --exchange=Poloniex --days=2 -p=3849
        importMultipleCurrencyTrades(argv.exchange ? argv.exchange : "Poloniex");

        //replay()
        //getOrderBook();
        //getOpenOrders();
    })
});