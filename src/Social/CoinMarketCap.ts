import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Candle, Currency, Order, Ticker, SocialAction, CoinMarketInfo} from "@ekliptor/bit-models";
import * as helper from "../utils/helper";
import * as db from "../database";
import * as querystring from "querystring";
import {AbstractNotification} from "../Notifications/AbstractNotification";
import Notification from "../Notifications/Notification";


export interface CoinMarketCapApiStatus {
    timestamp: string; // "2018-06-02T22:51:28.209Z"
    error_code: number;
    error_message: string;
    elapsed: number;
    credit_count: number;
}
export interface CoinMarketCapCurrencyData {
    id: number;
    name: string;
    symbol: string;
    slug: string;
    circulating_supply: number;
    total_supply: number;
    max_supply: number;
    date_added: string;
    num_market_pairs: number;
    cmc_rank: number;
    last_updated: string;
    quote: {
        [quoteCurrency: string]: { // USD default
            price: number;
            volume_24h: number;
            percent_change_1h: number;
            percent_change_24h: number;
            percent_change_7d: number;
            market_cap: number;
            last_updated: string;
        }
    }
}
export interface CoinMarketCapTicker {
    /* old ticker
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
    */
    data: {
        [currencyID: string]: CoinMarketCapCurrencyData; // key is the same as id number below
    }
    status: CoinMarketCapApiStatus;
}
export interface CoinMarketCapList {
    data: CoinMarketCapCurrencyData[];
    status: CoinMarketCapApiStatus;
}

export interface CoinMarketCapOptions {
    apiKey: string;
}
export class CoinMarketCapListOptions { // https://pro.coinmarketcap.com/api/v1#operation/getV1CryptocurrencyListingsLatest
    public start = 1;
    public limit = 400;
    public convert = "USD";
    public sort = "market_cap";
    public sort_dir = "desc";
    public cryptocurrency_type = "all";
    constructor() {
    }
}

export class CoinMarketCap {
    protected options: CoinMarketCapOptions;
    protected notifier: AbstractNotification;
    protected lastNotification: Date = null;

    constructor(options: CoinMarketCapOptions) {
        this.options = options;
        this.notifier = AbstractNotification.getInstance(true);
    }

    public listCurrencies(options: CoinMarketCapListOptions = new CoinMarketCapListOptions()) {
        return new Promise<CoinMarketCapList>((resolve, reject) => {
            const url = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?" + querystring.stringify(options);
            utils.getPageCode(url, (body, response) => {
                if (body === false)
                    return reject({txt: "Error crawling CoinMarketCap ticker", options: options, err: response})
                let json = utils.parseJson(body);
                if (this.isInvalidResponse(json) === true) {
                    this.notifyError(url, json);
                    return reject({txt: "Received invalid ticker data JSON from CoinMarketCap", options: options, body: body})
                }
                resolve(json);
            }, this.getHttpOptions())
        })
    }

    /**
     * Get market data of a currency.
     * @param {Currency} currency
     * @param {string} quoteCurrencies
     * @returns {Promise<CoinMarketCapTicker>}
     */
    public async getCurrencyTicker(currency: Currency.Currency, quoteCurrencies = "USD"): Promise<CoinMarketCapTicker> {
        // their pro API now allows us to fetch data by currency symbol too
        let ticker = await this.getLatestData({
            symbol: this.currencyToCoinMarketCapSymbol(currency),
            convert: quoteCurrencies
        });
        return ticker;
    }

    /**
     * Get market data for multiple currencies at once.
     * @param {Currency[]} currencies
     * @param {string} quoteCurrencies
     * @returns {Promise<CoinMarketCapTicker>}
     */
    public async getCurrencyTickers(currencies: Currency.Currency[], quoteCurrencies = "USD"): Promise<CoinMarketCapTicker> {
        // their pro API now allows us to fetch data by currency symbol too
        let ticker = await this.getLatestData({
            symbol: currencies.filter(c => this.isSupported(c)).map(c => this.currencyToCoinMarketCapSymbol(c)).join(","),
            convert: quoteCurrencies
        });
        return ticker;
    }

    /**
     * Get market data of a currency by CoinMarketCap ID
     * @param {number} currencyID
     * @param {string} quoteCurrencies a comma separated list of currencies to convert the data to
     * @returns {Promise<CoinMarketCapTicker>}
     */
    public async getCurrencyTickerById(currencyID: number, quoteCurrencies = "USD"): Promise<CoinMarketCapTicker> {
        let ticker = await this.getLatestData({
            id: currencyID,
            convert: quoteCurrencies
        });
        return ticker;
    }

    public currencyToCoinMarketCapSymbol(currency: Currency.Currency) {
        let label = Currency.getCurrencyLabel(currency);
        switch (label)
        {
            case "IOTA":        return "MIOTA";
            case "STR":         return "XLM";
            case "QTM":         return "QTUM";
            case "BYTM":        return "BTM";
            case "PAC":         return "$PAC"; // $PAC and PAC not working on API
            case "YYW":         return "YOYOW";
            //case "BSV":         return "BCHSV";
            case "TWOGIVE":     return "2GIVE";
            case "GXS":        	return "GXC";
            case "GLD":        	return "GLC";
            case "WAX":        	return "WAXP";
            case "NEOS":        return "NEO";
        }
        return label;
    }

    public currencyFromCoinMarketCapSymbol(currencyStr: string): Currency.Currency {
        switch (currencyStr)
        {
            case "NEO":     return Currency.Currency.NEO;
            case "VEN":     return Currency.Currency.VET;
            case "MIOTA":   return Currency.Currency.IOTA;
            case "QTUM":    return Currency.Currency.QTM;
            case "BTM":     return Currency.Currency.BYTM;
            case "$PAC":    return Currency.Currency.PAC;
            case "YOYOW":   return Currency.Currency.YYW;
            //case "BCHSV":   return Currency.Currency.BSV;
            case "2GIVE":   return Currency.Currency.TWOGIVE;
            case "GXC":     return Currency.Currency.GXS;
            case "GLC":     return Currency.Currency.GLD;
            case "WAXP":     return Currency.Currency.WAX;
            case "NEO":     return Currency.Currency.NEO; // NEOS also exists
            default:
                let currency = Currency.Currency[currencyStr];
                if (currency)
                    return currency;
                let currencyAlternative = Currency.getAlternativSymbol(currencyStr)
                if (currencyAlternative) {
                    currency = Currency.Currency[currencyAlternative];
                    if (currency)
                        return currency;
                }
                logger.warn("Unable to convert CoinMarketCap currency (not supported?) %s", currencyStr)
                return 0;
        }
    }

    protected isSupported(currency: Currency.Currency) {
        if (!currency || currency === Currency.Currency.PAC || currency === Currency.Currency.USD || currency === Currency.Currency.EUR ||
            currency === Currency.Currency.JPY || currency === Currency.Currency.GBP || currency === Currency.Currency.ALL || currency === Currency.Currency.FTH ||
            currency === Currency.Currency.ETHOS)
            return false;
        return true;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected getLatestData(queryParams: any) {
        return new Promise<CoinMarketCapTicker>((resolve, reject) => {
            //const url = utils.sprintf("https://api.coinmarketcap.com/v2/ticker/%s/", currencyID)
            const currencyID = queryParams.id ? queryParams.id : queryParams.symbol;
            const url = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?" + querystring.stringify(queryParams);
            utils.getPageCode(url, (body, response) => {
                // TODO send notification on "Invalid values for" error?
                if (body === false)
                    return reject({txt: "Error crawling CoinMarketCap ticker", currencyID: currencyID, err: response})
                let json = utils.parseJson(body);
                if (this.isInvalidResponse(json) === true) {
                    this.notifyError(url, json);
                    return reject({txt: "Received invalid ticker data JSON from CoinMarketCap", currencyID: currencyID, body: body})
                }
                resolve(json);
            }, this.getHttpOptions())
        })
    }

    protected isInvalidResponse(json: any) {
        if (!json || !json.data || (typeof json.status === "object" && json.status !== null && json.status.error_code !== 0))
            return true;
        return false;
    }

    protected getHttpOptions() {
        return {
            cloudscraper: true,
            timeout: nconf.get("serverConfig:crawlPricesHttpTimeoutSec")*1000,
            userAgent: nconf.get("projectName") + " Bot", // must be specified or else their API times out. CF custom protection settings?
            headers: {
                "X-CMC_PRO_API_KEY": this.options.apiKey
            }
        }
    }

    protected notifyError(urlStr: string, json: any) {
        let headline = "CoinMarketCap API error";
        logger.error(headline);
        logger.error(urlStr);
        logger.error(json);
        if (!nconf.get("serverConfig:notifyCoinMarketApiErrors"))
            return;
        const pauseMs = nconf.get('serverConfig:notificationPauseMin') * utils.constants.MINUTE_IN_SECONDS * 1000;
        if (this.lastNotification && this.lastNotification.getTime() + pauseMs > Date.now()) // lastNotification per bot? we only monitor 1 instance per bot
            return;

        let cmcStatus: CoinMarketCapApiStatus = null;
        if (json.status && json.status.timestamp)
            cmcStatus = json.status;
        let message = utils.sprintf("URL: %s\nRes: %s", urlStr, JSON.stringify(json));
        if (cmcStatus !== null)
            message = JSON.stringify(cmcStatus); // URL can be too long
        let notification = new Notification(headline, message, false);
        this.notifier.send(notification).then(() => {
        }).catch((err) => {
            logger.error("Error sending %s notification", "CoinMarketCap", err)
        });
        this.lastNotification = new Date();
    }
}
