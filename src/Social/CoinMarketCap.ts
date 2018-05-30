import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Candle, Currency, Order, Ticker, SocialAction, CoinMarketInfo} from "@ekliptor/bit-models";
import * as helper from "../utils/helper";
import * as db from "../database";


export interface CoinMarketCapListEntry {
    // TODO
}
export interface CoinMarketCapList {
    data: CoinMarketCapListEntry[];
}
export interface CoinMarketCapTicker {
    data: {
        id: number;
        name: string;
        symbol: string;
        website_slug: string;
        rank: number;
        circulating_supply: number;
        total_supply: number;
        max_supply: number;
        quotes: {
            [currency: string]: {
                price: number;
                volume_24h: number;
                market_cap: number;
                percent_change_1h: number;
                percent_change_24h: number;
                percent_change_7d: number;
            }
        },
        last_updated: number;
    }
    metadata: {
        timestamp: number;
        error: string;
    }
}

export class CoinMarketCap {
    constructor() {
    }

    public listCurrencies() {
        return new Promise<CoinMarketCapList>((resolve, reject) => {
            reject("listCurrencies() is not implemented yet") // TODO
        })
    }

    public getCurrencyTicker(currency: Currency.Currency) {
        return new Promise<CoinMarketCapTicker>((resolve, reject) => {
            reject("getCurrencyTicker() is not implemented yet") // TODO convert to currencyID and call getCurrencyTickerById() (load them on startup)
        })
    }

    public getCurrencyTickerById(currencyID: number) {
        return new Promise<CoinMarketCapTicker>((resolve, reject) => {
            const url = utils.sprintf("https://api.coinmarketcap.com/v2/ticker/%s/", currencyID)
            utils.getPageCode(url, (body, response) => {
                if (body === false)
                    return reject({txt: "Error crawling CoinMarketCap ticker", currencyID: currencyID, err: response})
                let json = utils.parseJson(body);
                if (!json || !json.data)
                    return reject({txt: "Received invalid ticker data JSON from CoinMarketCap", currencyID: currencyID, body: body})
                resolve(json);
            }, CoinMarketCap.getHttpOptions())
        })
    }

    public static getHttpOptions() {
        return {
            cloudscraper: true,
            timeout: nconf.get("serverConfig:crawlPricesHttpTimeoutSec")*1000,
            userAgent: nconf.get("projectName") + " Bot" // must be specified or else their API times out. CF custom protection settings?
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}