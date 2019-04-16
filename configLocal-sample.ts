// exported keys in here must be exactly the same as they are written on nconf object (except "root")

import {Currency} from "@ekliptor/bit-models";
import {nconf} from "@ekliptor/apputils";

const root = {
    "apiKeys" : { // leeave empty to disable API keys (public access)
        "JFSDFHl340udfnsf23SF234": true // set to false to disable a key
    },
    "updateUrl": "",
    // put your MongoDB connection URL in here: mongodb://user:password@host:port/database
    "mongoUrl": "",
    "searchHosts": [], // elasticsearch host:port - currently not used

    // proxy config. only needed if the exchange you want to trade on isn't accessible from your IP
    "proxy": "", // http://user:password@host:port
    "proxyAuth" : "", // http://user:password@DOMAIN:port <- domain is a constant replaced by the app
    "ipCheckUrl" : "" // a URL returning JSON: {ip: "my.ip"}
}

const DEFAULT_MARGIN_NOTIFICATION = 0.26
const DEFAULT_EXCHANGE_PROXY = [] // an array of proxy strings. chosen randomly

class ServerConfig {
    // place any config from bit-models/serverConfig.ts in here to overwrite it with app-specific values

    public notificationMethod = "NoNotificationService" // name of the notification class ("Pushover")
    public adminNotificationMethod = "NoNotificationService"

    // place all keys here. we don't run user specific configurations to keep the design simpler. each user has his own bot instance
    public apiKey = {
        // a class with the exact same name has to exist under /Exchanges/ resp /Notifications/
        exchange: {
            // remove an exchange here to disable trading on it
            // marginNotification,proxy are optional. leave empty to disable it
            Poloniex: [{
                key: "",
                secret: "",
                marginNotification: DEFAULT_MARGIN_NOTIFICATION
            }],
            OKEX: [{
                key: "",
                secret: "",
                passphrase: "",
                marginNotification: 0.03,
                proxy: DEFAULT_EXCHANGE_PROXY
            }],
            Kraken: [{
                key: "",
                secret: "",
                marginNotification: 0.75
            }],
            // we need to 2 keys per array entry on bitfinex because we use API v2 and v1 currently
            Bitfinex: [{
                key: "",
                secret: "",
                key2: "",
                secret2: "",
                marginNotification: 0.22 // min margin 0.13
            }],
            Bittrex: [{
                key: "",
                secret: "",
                marginNotification: 0.5
            }],
            Binance: [{
                key: "",
                secret: "",
                marginNotification: 0.5
            }],
            BitMEX: [{
                key: "",
                secret: "",
                marginNotification: 0.03,
                testnet: false
            }],
            Deribit: [{
                key: "",
                secret: "",
                marginNotification: 0.03,
                testnet: false
            }],
            CoinbasePro: [{
                key: "",
                secret: "",
                passphrase: "",
                marginNotification: 0.5
            }],
            Bitstamp: [{
                key: "",
                secret: "",
                passphrase: "",
                marginNotification: 0.5
            }],
            CexIo: [{
                key: "",
                secret: "",
                passphrase: "",
                marginNotification: 0.5
            }],
            Cobinhood: [{
                key: "",
                secret: "",
                marginNotification: 0.5
            }],
            Gemini: [{
                key: "",
                secret: "",
                marginNotification: 0.5
            }],
            HitBTC: [{
                key: "",
                secret: "",
                marginNotification: 0.5
            }],
            Huobi: [{
                key: "",
                secret: "",
                marginNotification: 0.5
            }],
            KuCoin: [{
                key: "",
                secret: "",
                passphrase: "",
                marginNotification: 0.5
            }],
            Nova: [{
                key: "",
                secret: "",
                marginNotification: 0.5
            }],
            BitForex: [{
                key: "",
                secret: "",
                marginNotification: 0.5
            }],
            FCoin: [{
                key: "",
                secret: "",
                marginNotification: 0.5
            }],
            Bibox: [{
                key: "",
                secret: "",
                marginNotification: 0.5
            }],
            BxCo: [{
                key: "",
                secret: "",
                marginNotification: 0.5
            }],
            Liquid: [{
                key: "",
                secret: "",
                marginNotification: 0.5
            }],
            YoBit: [{
                key: "",
                secret: "",
                marginNotification: 0.5
            }],
            Peatio: [{
                key: "",
                secret: "",
                domain: "",
                marginNotification: 0.5
            }],
            LoggerEx: [{
                key: "",
                secret: "",
                marginNotification: 0.5
            }],
        },
        notify: {
            Pushover: {
                appToken: "",
                receiver: ""
            }
        }
    }

    public twitterApi = {
        consumerKey: '',
        consumerSecret: '',
        // we can get additional queries by removing this (limit per app instead of per user)
        accessTokenKey: '',
        accessTokenSecret: ''
    }

    public backtest = {
        from: "2017-08-01 00:00:00",
        to: "2017-09-04 00:00:00",

        startBalance: 1.0, // for every coin (leveraged *2.5 when margin trading)
        slippage: 0.0, // in %, for example 0.05%
        cacheCandles: false,
        walk: true // Walk Forward Analysis: load previously optimized parameters and continue optimizing on them
    }
}

// premium config
let orverrides = () => {
}

const serverConfig = new ServerConfig();
let tradingViewAccount = {
    email: "",
    password: ""
}

export {root, serverConfig, orverrides, tradingViewAccount}


export type MultipleCurrencyImportExchange = "Poloniex" | "Bitfinex";
export const currencyImportMap = new Map<MultipleCurrencyImportExchange, Currency.CurrencyPair[]>([
]);