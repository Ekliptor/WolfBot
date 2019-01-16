import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {controller as Controller} from '../src/Controller';
import {AbstractExchange} from "../src/Exchanges/AbstractExchange";
import Poloniex from "../src/Exchanges/Poloniex";
import OKEX from "../src/Exchanges/OKEX";
import Kraken from "../src/Exchanges/Kraken";
import Bitfinex from "../src/Exchanges/Bitfinex";
import Pushover from "../src/Notifications/Pushover";
import Notification from "../src/Notifications/Notification";
import {OrderResult} from "../src/structs/OrderResult";
import {Currency} from "@ekliptor/bit-models";
import {ok} from "assert";
import Bittrex from "../src/Exchanges/Bittrex";
import Binance from "../src/Exchanges/Binance";
import BitMEX from "../src/Exchanges/BitMEX";
import Deribit from "../src/Exchanges/Deribit";

let repeatPoloniexOrder = (order: Promise<OrderResult>) => {
    return new Promise<OrderResult>((resolve, reject) => {
        order.then((orderResult) => {
            resolve(orderResult)
        }).catch((err) => {
            if (err.error && err.error.toLowerCase().indexOf("please try again") !== -1) {
                return;
            }
            reject(err)
        })
    })
}

let buy = () => {
    let polo = new Poloniex(nconf.get("serverConfig:apiKey:exchange:Poloniex")[0])

    //let pair =[Currency.Currency.BTC, Currency.Currency.ETH]
    let pair = new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.ETH)
    let orderParams = {
        //immediateOrCancel: true
        postOnly: true
    }

    polo.buy(pair, 0.13919925, 0.22, orderParams).then((orderResult) => {
    //polo.marginBuy(pair, 0.00021459, 2000, orderParams).then((orderResult) => {
        logger.verbose("Trading done", orderResult)
    }).catch((err) => {
        logger.error("Error trading", err)
    })
    /*
    polo.moveOrder(pair, 305854609378, 0.00506200, 4, orderParams).then((orderResult) => {
        logger.verbose("Moving order done", orderResult)
    }).catch((err) => {
        logger.error("Error trading", err)
    })
    */

    /*
    polo.cancelOrder(288867044944).then((success) => {
    }).catch((err) => {
        logger.error(err)
    })
    */
    /*
    polo.buy(pair, 0.04828000, 10).then((orderResult) => {
        logger.verbose("Bought coins", orderResult)
    }).catch((err) => {
        logger.error("Error trading", err)
    })
    */

    let pairMargin = new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.XRP)
    /*
    polo.getMarginPosition(pairMargin).then((position) => {
        console.log(position)
        logger.verbose("Got positions", position)
    }).catch((err) => {
        logger.error("Error trading", err)
    })
    */

    /*
    polo.closeMarginPosition(pairMargin).then((orderResult) => {
        logger.verbose("Closed positions", orderResult)
    }).catch((err) => {
        logger.error("Error trading", err)
    })
    */
}

let testOkex = async () => {
    let okex = new OKEX(nconf.get("serverConfig:apiKey:exchange:OKEX")[0])
    let pair = new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.BTC)
    //console.log(okex.getCurrencies().getExchangePair(pair))
    okex.subscribeToMarkets([pair])
    const from = new Date("2017-07-14 00:00:00 GMT+0000")

    let orderParams = {
        //immediateOrCancel: true
        //postOnly: true
        matchBestPrice: false
    }

    const leverage = 20;
    const rate = 3445.95;

    //okex.marginBuy(pair, rate, (1*leverage)/rate, orderParams).then((ticker) => {
    //okex.closeMarginPosition(pair).then((ticker) => {
    okex.getBalances().then((info) => {
        console.log(info)
    }).catch((err) => {
        console.error("API ERR", err)
    })
    /*
    okex.moveMarginOrder(pair, 7255279757, 2100.95, 0.09, orderParams).then((ticker) => {
        //okex.closeMarginPosition(pair).then((ticker) => {
        console.log(ticker)
    }).catch((err) => {
        console.error("API ERR", err)
    })
    */
}

let testKraken = () => {
    let kraken = new Kraken(nconf.get("serverConfig:apiKey:exchange:Kraken")[0])
    let pair = new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.ETH)
    //console.log(kraken.getCurrencies().getExchangePair(pair))
    //console.log(kraken.getCurrencies().getLocalPair(kraken.getCurrencies().getExchangePair(pair)))
    //kraken.subscribeToMarkets([pair])

    let orderParams = {
        //immediateOrCancel: true
        //postOnly: true
        //matchBestPrice: false
    }

    kraken.getTicker().then((ticker) => {
        kraken.setTickerMap(ticker)
        //okex.closeMarginPosition(pair).then((ticker) => {
        //console.log(ticker)
        //return kraken.marginSell(pair, 0.014, 1.0, {})
        //return kraken.moveMarginOrder(pair, "OVKM7O-A6ULX-636IN2", 1350, 0.02, {})
        //return kraken.marginCancelOrder(pair, "OXTX7C-AOFC2-V33BXG")
        //return kraken.getAllMarginPositions()
        return kraken.closeMarginPosition(pair)
    }).then((result) => {
        console.log(result)
    }).catch((err) => {
        console.error("API ERR", err)
    })
    /*
    okex.moveMarginOrder(pair, 7255279757, 2100.95, 0.09, orderParams).then((ticker) => {
        //okex.closeMarginPosition(pair).then((ticker) => {
        console.log(ticker)
    }).catch((err) => {
        console.error("API ERR", err)
    })
    */
}

let testBitfinex = () => {
    let bitfinex = new Bitfinex(nconf.get("serverConfig:apiKey:exchange:Bitfinex")[0])
    let pair = new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.LTC)
    //console.log(bitfinex.getCurrencies().getExchangePair(pair))
    //console.log(bitfinex.getCurrencies().getLocalPair(bitfinex.getCurrencies().getExchangePair(pair)))
    bitfinex.subscribeToMarkets([pair])

    let orderParams = {
        //immediateOrCancel: true
        postOnly: false
        //matchBestPrice: false
    }
    let lendingParams = {
        days: 2
    }

    bitfinex.getTicker().then((ticker) => {
        bitfinex.setTickerMap(ticker)
        //const from = new Date(Date.now() - 30*1000)
        //return bitfinex.marginBuy(pair, 29.89, 0.1, orderParams)
        //return bitfinex.getOpenOrders(pair)
        //return bitfinex.moveOrder(pair, 3991068008, 21.915, 0.1, {})
        //return bitfinex.closeMarginPosition(pair)
        //return bitfinex.fetchOrderBook(pair, 10)

        // lending
        //return bitfinex.placeOffer(Currency.Currency.BTC, 0.083, 0.02, lendingParams)
        //return bitfinex.getAllOffers()
        //return bitfinex.cancelOffer(103909996)
        return bitfinex.getExternalTicker(["BTC"])
    }).then((result) => {
        console.log(result)
    }).catch((err) => {
        console.error("API ERR", err)
    })
    /*
    okex.moveMarginOrder(pair, 7255279757, 2100.95, 0.09, orderParams).then((ticker) => {
        //okex.closeMarginPosition(pair).then((ticker) => {
        console.log(ticker)
    }).catch((err) => {
        console.error("API ERR", err)
    })
    */
}

let testPolo = () => {
    let polo = new Poloniex(nconf.get("serverConfig:apiKey:exchange:Poloniex")[0])

    //let pair =[Currency.Currency.BTC, Currency.Currency.ETH]
    let pair = new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.ETH)

    //polo.getActiveLoans().then((balances) => {
    //polo.placeOffer(Currency.Currency.BTC, 0.05, 1, {days: 2}).then((balances) => {
    polo.getAllOffers().then((balances) => {
        console.log(balances)
    }).catch((err) => {
        logger.error("Error trading", err)
    })
}

let testBittrex = () => {
    let bittrex = new Bittrex(nconf.get("serverConfig:apiKey:exchange:Bittrex")[0])
    let params = {}

    //let pair =[Currency.Currency.BTC, Currency.Currency.ETH]
    let pair = new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.ADA)
    bittrex.subscribeToMarkets([pair])

    //bittrex.buy(pair, 0.00004040, 30).then((balances) => {
    bittrex.getOpenOrders(pair).then((balances) => {
    //bittrex.moveOrder(pair, "1f549634-7566-4205-955a-06f5429d699a", 0.000049, 30, params).then((balances) => {
        console.log(balances)
    }).catch((err) => {
        logger.error("Error trading", err)
    })
}

let testBinance = () => {
    let binance = new Binance(nconf.get("serverConfig:apiKey:exchange:Binance")[0])
    let params = {}

    //let pair =[Currency.Currency.BTC, Currency.Currency.ETH]
    let pair = new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.TRX)
    binance.subscribeToMarkets([pair])

    //binance.buy(pair, 0.00004040, 30).then((balances) => {
    //binance.getOpenOrders(pair).then((balances) => {
    //binance.importHistory(pair, new Date(Date.now()-2*utils.constants.HOUR_IN_SECONDS*1000), new Date()).then((balances) => {
    //binance.sell(pair, 0.00000623, 350).then((balances) => {
    binance.getOpenOrders(pair).then((balances) => {
    //binance.moveOrder(pair, 25959783, 0.00000723, 360, params).then((balances) => {
        console.log(balances)
    }).catch((err) => {
        logger.error("Error trading", err)
    })
}

let testBitmex = () => {
    let bitmex = new BitMEX(nconf.get("serverConfig:apiKey:exchange:BitMEX")[0])
    let params = {}

    //let pair =[Currency.Currency.BTC, Currency.Currency.ETH]
    let pair = new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.USD)
    bitmex.subscribeToMarkets([pair])

    //binance.buy(pair, 0.00004040, 30).then((balances) => {
    //binance.getOpenOrders(pair).then((balances) => {
    bitmex.importHistory(pair, new Date(Date.now()-22*utils.constants.HOUR_IN_SECONDS*1000), new Date()).then((test) => {
    //binance.sell(pair, 0.00000623, 350).then((balances) => {
    //bitmex.marginOrder(pair, 9000, 0.001).then((test) => {
    //bitmex.getBalances().then((balances) => {
    //bitmex.marginCancelOrder(pair, "955d5624-5442-8e8a-f4cb-bdc87786adf3").then((test) => {
    //bitmex.marginBuy(pair, 9900, 0.001, params).then((test) => {
        //binance.moveOrder(pair, 25959783, 0.00000723, 360, params).then((balances) => {
        console.log(test)
    }).catch((err) => {
        logger.error("Error trading", err)
    })
}

let testDeribit = async () => {
    let deribit = new Deribit(nconf.get("serverConfig:apiKey:exchange:Deribit")[0])
    let params = {}

    let pair = new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.BTC)
    deribit.subscribeToMarkets([pair]);
    await utils.promiseDelay(1200); // wait til we are connected

    //deribit.getBalances().then((test) => {
    //deribit.getMarginAccountSummary().then((test) => {
    //deribit.importHistory(pair, new Date(Date.now()-2*utils.constants.HOUR_IN_SECONDS*1000), new Date()).then((test) => {
    //deribit.getOpenOrders(pair).then((test) => {
    //deribit.marginSell(pair, 4900, 4, params).then((test) => {
    //deribit.moveMarginOrder(pair, 2028730532, 4999, 4, params).then((test) => {
    //deribit.marginCancelOrder(pair, 1024236179).then((test) => {
    //deribit.getAllMarginPositions().then((test) => {
    deribit.closeMarginPosition(pair).then((test) => {
        //binance.moveOrder(pair, 25959783, 0.00000723, 360, params).then((balances) => {
        console.log(test)
    }).catch((err) => {
        logger.error("Error trading", err)
    })
}

Controller.loadServerConfig(() => {
    utils.file.touch(AbstractExchange.cookieFileName).then(() => {
        //buy()
        //testOkex()
        //testKraken()
        //testBitfinex()
        //testPolo();
        //testBittrex();
        //testBinance();
        testBitmex();
        //testDeribit();
    })
})