import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {controller as Controller} from '../src/Controller';
import {AbstractExchange} from "../src/Exchanges/AbstractExchange";
import Poloniex from "../src/Exchanges/Poloniex";
import Pushover from "../src/Notifications/Pushover";
import Notification from "../src/Notifications/Notification";
import {Currency} from "@ekliptor/bit-models";
import Bitfinex from "../src/Exchanges/Bitfinex";

let checkMargin = () => {
    let polo = new Poloniex(nconf.get("serverConfig:apiKey:exchange:Poloniex"))
    let marginTxt = "";
    //polo.getTicker()
    //polo.getBalances()
    polo.getMarginAccountSummary().then((account) => {
        //console.log(Currency.toExchange(2, null)) // prints LTC
        //console.log(Currency.fromExchange("LTC", null)) // prints 2

        let pushover = new Pushover(nconf.get("serverConfig:apiKey:notify:Pushover"))

        const margin = account.currentMargin
        if (margin !== Number.NaN)
            marginTxt = "Current margin is: " + (margin * 100).toFixed(2) + "%";
        if (margin < 0.26) {
            let notification = new Notification("Margin very low", marginTxt, true)
            return pushover.send(notification)
        }
    }).then(() => {
        logger.verbose("Checked margin: " + marginTxt)
    }).catch((err) => {
        logger.error("Error checking margin", err)
    })

    setTimeout(() => {
        checkMargin()
    }, 120 * 1000)
}

let checkPortfolio = async () => {
    let ex = new Bitfinex(nconf.get("serverConfig:apiKey:exchange:Bitfinex")[0])
    let pair = new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.BTC)
    ex.subscribeToMarkets([pair])

    await utils.promiseDelay(1000); // wait for ws connection
    //ex.getMarginAccountSummary().then((account) => {
    ex.getAllMarginPositions().then((account) => {
        console.log(account)
    }).catch((err) => {
        logger.error("Error getting margin account", err);
    })
}

Controller.loadServerConfig(() => {
    checkPortfolio();
})