import * as Currency from "@ekliptor/bit-models/build/models/base/Currency";

let config = module.exports
export = config;

const now = new Date()
config.config = {
    "debug": false,
    "projectName": "Sensor",
    "projectNameLong": "WolfBot",
    "protocol": "https://",
    "port": 8331,
    "tlsPort": 8332,
    "portDef": 8331,
    "tlsPortDef": 8332,
    "httpsOnly": true,              // redirect http to https (if protocol config is https)
    "serverDataDir": "./src/server/data/",
    "logfile": "logfile.log",
    "deleteOldLog": true,
    "jsonLog": false,
    "apiKeys" : { // leeave empty to disable API keys (public access)
    },
    "updateUrl": "",

    // put your MongoDB connection URL in here: mongodb://user:password@host:port/database
    "mongoUrl": "",
    "mongoTimeoutSec": 5*60,
    "searchHosts": [''], // elasticsearch host:port
    "mongoMaxKeyStrLen": 800, // max 1024 bytes for WiredTiger
    "httpTimeoutSec": 10, // for our own webserver
    "localAddress": "", // bind outgoing requests to a specific local IP
    "projectUrl": "https://wolfbot.org",
    "preferredCrawlerIPs": [],

    "tempDir": "./temp/",
    "fullTempDir": "", // set on every start. use this to get the fully resolved path
    "lastParamsFile": "LastParams.txt",

    // proxy config. only needed if the exchange you want to trade on isn't accessible from your IP
    // also see DEFAULT_EXCHANGE_PROXY in serverConfig.ts
    "proxy": "", // http://user:password@host:port
    "proxyAuth" : "", // http://user:password@DOMAIN:port <- domain is a constant replaced by the app
    "ipCheckUrl" : "", // a URL returning JSON: {ip: "my.ip."}

    "logExchangeRequests": false,
    "logStrategyRequests": false,
    "defaultExchanges": ["Poloniex"],
    "tradesDir": "trades",
    "backfindDir": "backfind", // subdir of tradesDir
    "maxParallelBacktests": 8, // 5 // 16 for server with 12 cores
    "evolutionDeleteTradeFiles": true,
    "abortBacktestEarlyBalancePercent": 60, // abort if portfolio value lost more than this in %
    "traders": ["realTime", "realTimePaper", "notifier"],

    "maxEventListeners": 120,

    // web UI config (similar to express app config)
    "host": "localhost",
    "pathRoot": "/",
    "defaultLang": "en",
    "defaultLocale": "en-US",
    "sessionName": "SID",
    "successMsgRemoveSec": 6,

    // JS stuff
    "multiselect": {
        "maxSelect": 3
    },

    // for functions.js
    "removeDownloadFrameSec": 10,
    "timezoneDiffMin": now.getTimezoneOffset(), // PHP: date('I') == 1 ? -120 : -60
    "maxLoadRetries": 10,
    "cookieLifeDays": 365,
    "sessionLifeDays": 30, // we don't have sessions (yet)

    // URLs
    "path": {
        // path keys must be identical to controller view names (except first letter lowercase), see renderView() in index.ts
        "home": "/",
        "status": "/status",
        "strategies": "/strategies",
        "lending": "/lending",
        "social": "/social",
        "coinMarket": "/coinMarket",
        "tradeHistory": "/history",
        "oracle": "/oracle",
        "config": "/config",
        "scripts": "/scripts",
        "backtesting": "/backtest"
    },

    "cachingMin": {
        "staticFiles": 1440,
        "proxyDefaultCache": 60
    },

    "data": {
        "maxPredictionOffPercent": 2.0,
        "maxShowHistoryTrades": 9000,
        "backtestStartAgoDays": 32,
        "backtestEndAgoDays": 2,
        "minifyResourcesUiDevIntervalMs": 1000
    }
}