import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {MarketOrder, Ticker, Trade, TradeHistory, Currency} from "@ekliptor/bit-models";
import {CcxtExchange, CcxtOrderParameters} from "./CcxtExchange";
import {ExOptions, OpenOrders, OrderParameters} from "./AbstractExchange";
import * as ccxt from "ccxt";
import * as crypto from "crypto";
import {OrderResult} from "../structs/OrderResult";

interface CcxtHeaders {
    [key: string]: string;
}
class KuKoinCcxt extends ccxt.kucoin {
    constructor(config?: {[key in keyof ccxt.Exchange]?: ccxt.Exchange[key]}) {
        super(config);
    }

    public setHeaders(headers: CcxtHeaders): CcxtHeaders {
        // https://github.com/ccxt/ccxt/blob/master/js/base/Exchange.js#L465

        if (headers["KC-API-PARTNER"] === undefined)
            return headers; // no partner program enabled

        headers["KC-API-PARTNER-SIGN"] = crypto.createHash('sha256')
            .update(Date.now().toString() + headers["KC-API-PARTNER"] + this.apiKey, 'utf8')
            .digest('base64');
        return headers;
    }
}

export default class KuCoin extends CcxtExchange {
    protected static readonly PARTNER_ID = "dfdce34c-7d83-4424-a0bc-0150ffe57809";

    constructor(options: ExOptions) {
        super(options);
        this.exchangeLabel = Currency.Exchange.KUCOIN;
        this.minTradingValue = 0.001;
        this.fee = 0.001;
        this.currencies.setSwitchCurrencyPair(true);
        let config = this.getExchangeConfig();
        config.password = this.apiKey.passphrase;
        config.headers = {
            // Tag: Wolf  Private key: dfdce34c-7d83-4424-a0bc-0150ffe57809
            "KC-API-PARTNER": KuCoin.PARTNER_ID,
            /*"KC-API-PARTNER-SIGN"() { ... } // available with https://github.com/ccxt/ccxt/issues/7176
            }*/
        }
        //this.apiClient = new ccxt.kucoin(config);
        this.apiClient = new KuKoinCcxt(config);
        this.apiClient.loadMarkets().then(() => {
            this.onExchangeReady();
        }).catch((err) => {
            logger.error("Error loading %s markets", this.className, err);
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

}
