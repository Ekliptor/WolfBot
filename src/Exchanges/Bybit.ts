import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {MarketOrder, Ticker, Trade, TradeHistory, Currency} from "@ekliptor/bit-models";
import {CcxtExchange} from "./CcxtExchange";
import {ExOptions, OpenOrders, OrderParameters} from "./AbstractExchange";
import * as ccxt from "ccxt";


export default class Bybit extends CcxtExchange {
    constructor(options: ExOptions) {
        super(options);
        this.exchangeLabel = Currency.Exchange.BYBIT;
        this.minTradingValue = 0.001;
        this.fee = 0.0025;
        this.currencies.setSwitchCurrencyPair(true);
        let config = this.getExchangeConfig();
        //config.uid = this.apiKey.passphrase;
        config.headers = {
            tag: "wolfbot"
        }
        this.apiClient = new ccxt.bybit(config);
        this.apiClient.loadMarkets().then(() => {
            this.onExchangeReady();
        }).catch((err) => {
            logger.error("Error loading %s markets", this.className, err);
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

}
