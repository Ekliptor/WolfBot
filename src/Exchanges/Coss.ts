
// official API https://api.coss.io/v1/spec

import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {MarketOrder, Ticker, Trade, TradeHistory, Currency} from "@ekliptor/bit-models";
import {CcxtExchange} from "./CcxtExchange";
import {ExOptions, OpenOrders, OrderParameters} from "./AbstractExchange";
import * as ccxt from "ccxt";
import {OrderResult} from "../structs/OrderResult";
import * as request from "request";


export default class Coss extends CcxtExchange {
    constructor(options: ExOptions) {
        super(options);
        this.exchangeLabel = Currency.Exchange.COSS;
        this.minTradingValue = 0.001;
        this.fee = 0.0025; // https://www.coss.io/c/fees
        this.currencies.setSwitchCurrencyPair(true);
        let config = this.getExchangeConfig();
        config.password = this.apiKey.passphrase;
        this.apiClient = new ccxt.coss(config);
        this.apiClient.loadMarkets().then(() => {
            this.onExchangeReady();
        }).catch((err) => {
            logger.error("Error loading %s markets", this.className, err);
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected verifyTradeResponse(result: ccxt.Order, response: request.RequestResponse, method: string): boolean {
        if (super.verifyTradeResponse(result, response, method) === false)
            return false; // might throw an error in parent
        if (result && result.info && result.info.error) { // {"info":{"error":"406004","error_description":"Not enough balance"},"symbol":"ETH/USD"}
            throw new Error(utils.sprintf("Received %s %s trade error: %s", this.className, method, JSON.stringify(result.info)));
        }
        return true;
    }
}
