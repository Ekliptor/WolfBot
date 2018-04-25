let config = module.exports
export = config;

const now = new Date()
config.config = {
    "debug": false,
    "projectName": "Sensor",
    "projectNameLong": "WolfBot",
    "protocol": "https://",
    "port": 8234,
    "tlsPort": 8235,
    "httpsOnly": true,              // redirect http to https (if protocol config is https)
    "serverDataDir": "./src/server/data/",
    "logfile": "logfile.log",
    "deleteOldLog": true,
    "jsonLog": false,
    "apiKeys" : { // leeave empty to disable API keys (public access)
        "KKASdh32j4hAHSD3wf23": true // set to false to disable a key
    },
    "updateUrl": "https://stnodecrawl:Asn2SDFhk3hklSDFl3r@staydown.co/updater/Sensor.json",

    "mongoUrl": "mongodb://Brain:bkjHADKJh3wl4lASLd7ow5@localhost:27017/bitbrain",
    "mongoTimeoutSec": 5*60,
    "searchHosts": ['localhost:9200'],
    "mongoMaxKeyStrLen": 800, // max 1024 bytes for WiredTiger
    "httpTimeoutSec": 10, // for our own webserver

    "tempDir": "./temp/",
    "fullTempDir": "", // set on every start. use this to get the fully resolved path
    "lastParamsFile": "LastParams.txt",

    "proxy": "http://zordon4d20:8uTJi4TsGyi86oU@frankfurt.perfect-privacy.com:8080",
    "proxyAuth" : "http://zordon4d20:8uTJi4TsGyi86oU@DOMAIN:8080",
    "ipCheckUrl" : "https://staydown.co/checkip",

    "logExchangeRequests": false,
    "logStrategyRequests": false,
    "defaultExchanges": ["Poloniex"],
    "tradesDir": "trades",
    "backfindDir": "backfind", // subdir of tradesDir
    "maxParallelBacktests": 8, // 5 // 16 for server with 12 cores
    "evolutionDeleteTradeFiles": true,
    "abortBacktestEarlyBalancePercent": 60, // abort if portfolio value lost more than this in %
    "traders": ["realTime", "realTimePaper", "notifier"],

    "pushoverAppToken": "au4vvvebuhpii382td1dk13c6v95sj",

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
    },

    "data": {
        "maxPredictionOffPercent": 2.0,
        "maxShowHistoryTrades": 9000,
        "backtestStartAgoDays": 31,
        "backtestEndAgoDays": 1,
        "minifyResourcesUiDevIntervalMs": 1000
    }
}