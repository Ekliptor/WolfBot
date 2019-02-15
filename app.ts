// node --use_strict --max-old-space-size=2096 app.js
// parameters: --bundle, --debug (debug, otherwise use config value), -pPORT
// -t: run a specific (test) script
// --exchange: the exchange name for importing trades (with -t=import)
// --days: the history in number of last days to import (with -t=import)

// --config: the name of the config file under /config/ to run a specific trading strategy
// --trader (optional): the name of the trader to use. defaults to "RealTimeTrader", alterantives: Backtester|TradeNotifier
// --paper (optional): run in paper trading mode only (simulation). applies only to some traders
// --update (optional): update only. exit the app after update or of there is no update available
// --noTalib (optional): disable the use of TA-LIB (difficult installation on windows)
// --noUpdate (optional): disable the auto updater to download & install the latest version of this software
// --noBrowser (optional): disable the browser module used for crawling data
// --debug (optional): print verbose debug output for developers
// --uiDev (optional): reload HTML templates and JavaScript every second from disk
// --monitor (optional): only monitor a bot instance in the same parent folder
// --bitmex (optional): read full BitMEX WebSocket stream just as their website does it

// AI config
// --config: the name of the AI config file under /config/machine-learning/ to run find the optimal parameters
// --train: train the network on history data
// --predict: predict prices in live mode (shown on website)

// Lending config
// --config: the name of the Lending config file under /config/lending/ to set interest rates etc.
// --lending: use lending bot

// Arbitrage config
// --config: the name of the arbitrage config file under /config/arbitrage/
// --arbitrage: use arbitrage trading mode

// Social Crawler config
// --config: the name of the crawler config file under /config/social/ to define which sites to crawl
// --social: use the social crawler
// -c: social crawler class name - only run this class (useful for debugging). "Price" to crawl price data
// --instance: instance number (starting at 1) to distribute social crawling across nodes

// Updater config
// --update: only update to latest version. exit after update (or if we are already running the latest version)

require('source-map-support').install();
import * as utils from '@ekliptor/apputils';
const nconf = utils.nconf;
//const appRoot = require('app-root-path')
//import logger = require('./src/utils/Logger')
import * as logger from "./src/utils/Logger";
//const argv = require('minimist')(process.argv.slice(2))
import * as argvFunction from "minimist";
const argv = argvFunction(process.argv.slice(2));
nconf.set('debug', argv.debug === true);
if (argv.p) {
    nconf.set('port', argv.p)
    nconf.set('tlsPort', argv.p + 1)
}
else if (argv.t) { // allow a main and test instance run together
    nconf.set('port', (nconf.get('port') ? nconf.get('port') : 4000) + 2)
    nconf.set('tlsPort', (nconf.get('tlsPort') ? nconf.get('tlsPort') : 4000) + 4)
}
if (!nconf.get('port'))
    nconf.set('port', nconf.get('portDef'))
if (!nconf.get('tlsPort'))
    nconf.set('tlsPort', nconf.get('tlsPortDef'))
if (!argv.trader)
    nconf.set('trader', 'RealTimeTrader')
nconf.set('tradeMode', argv.paper ? 1 : 0);
// TODO for better command line interface: https://www.npmjs.com/package/commander
if (process.env.IS_CHILD) {
    nconf.set('port', 0) // we run multiple processes, let NodeJS choose free ports
    nconf.set('tlsPort', 0)
}
nconf.set("uiDev", argv.uiDev === true);
if (argv.config !== undefined && typeof argv.config !== "string")
    argv.config = argv.config.toString();
if (argv.noBrowser)
    logger.info("***DISCOUNT*** Having trouble setting up WolfBot on your local machine? Try the cloud version at https://wolfbot.org with a 30% discount with this code: gitsource7393");

nconf.set("ai", argv.train === true || argv.predict === true);
nconf.set("lending", argv.lending === true);
nconf.set("arbitrage", argv.arbitrage === true);
nconf.set("social", argv.social === true);
//nconf.set("httpsOnly", false); // disable for telegram POST API // TODO create a certificate with a valid domain name for chrome for social JS

import * as http from "http";
import * as https from "https";
const dispatcher = utils.dispatcher
import * as fs from "fs";
import * as os from "os"; // for hostname
import * as path from "path";
//import * as httpShutdown from "http-shutdown";
import {controller as Controller} from "./src/Controller";
const updateHandler = argv.noUpdate === true ? null : require("./src/updateHandler");
import * as helper from "./src/utils/helper";

//dispatcher.setStatic("./js/")
if (!nconf.get("debug") && nconf.get("cachingMin:staticFiles") > 0) {
    let expires = nconf.get("cachingMin:staticFiles") * 60
    dispatcher.setStaticHeaders([{name: "Pragma", value: "public"},
        {name: "Cache-Control", value: "public, max-age=" + expires}]);
}

let checkPostAuth = (request, res) => {
    request = utils.getJsonPostData(request)
    if (request == null)
        return false
    return checkAuth(request.apiKey, res)
}
let checkAuth = (apiKey, res) => {
    if (!nconf.get('apiKeys'))
        return
    let keys = nconf.get('apiKeys')
    if (!apiKey || keys[apiKey] !== true) {
        let output = {
            error: true,
            errorTxt: 'Invalid api key. Please add a parameter "apiKey" to your GET/POST request.'
        }
        res.end(JSON.stringify(output))
        return false
    }
    return true
}

dispatcher.beforeFilter(/\//, (req, res, chain) => { //any url
    //console.log("Before filter %s", req.url);
    if (!nconf.get("debug") && req.url.match(/\.(ts|js\.map)(\?.*)?$/i) !== null) { // prevent access to typescript files
        res.writeHead(404, {'Content-Type': 'text/plain; charset=UTF-8'})
        res.end('Not found: ' + req.url)
        return;
    }
    chain.next(req, res, chain);
});

dispatcher.onPost('/state/', async (req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json; charset=UTF-8'})
    if (checkPostAuth(req.formFields, res) === false)
        return
    let output = await Controller.getStatus(req)
    res.end(utils.EJSON.stringify(output))
})

dispatcher.onPost('/telegram/', (req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json; charset=UTF-8', 'Access-Control-Allow-Origin': '*'})
    if (checkPostAuth(req.formFields, res) === false)
        return
    let json = utils.getJsonPostData(req.formFields)
    if (json && json.message)
        Controller.addTelegramMessage(json.message)
    res.end(JSON.stringify({ok: 1}))
})

dispatcher.onPost('/test/', (req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json; charset=UTF-8'})
    if (checkPostAuth(req.formFields, res) === false)
        return
    let output = {error: false}
    res.end(JSON.stringify(output))
})

dispatcher.onGet('/dl/', (req, res) => {
    if (checkAuth(req.params.apiKey, res) === false)
        return
    Controller.sendFile(req, res)
})

dispatcher.onGet(new RegExp('^/js/libs/tv/.+$'), (req, res) => {
    Controller.proxyRequest(req, res) // no auth check for now
})

dispatcher.onPost('/login/', (req, res) => {
    //if (checkPostAuth(req.formFields, res) === false) // allowed without API key
        //return
    Controller.login(req, res)
})

dispatcher.onPost('/tradebook/', (req, res) => {
    if (checkPostAuth(req.formFields, res) === false) {
        if (!req.params || checkAuth(req.params.apiKey, res) === false)
            return
    }
    Controller.getTradebook(req, res)
})

dispatcher.setStaticDirname(path.join(utils.appDir, "public"))
dispatcher.setStatic(".") // the whole directory under url path /public // must be added after get requests if we use "." == / root URL

const indexPage = fs.readFileSync(path.join(utils.appDir, "public", "index.html"))
dispatcher.onError((req, res) => {
    if (req.method !== "GET" || req.url.indexOf("?") !== -1 || req.url.indexOf(".") !== -1) {
        res.writeHead(404, {'Content-Type': 'text/plain; charset=UTF-8'})
        res.end('Not found: ' + req.url)
    }
    else
        res.end(indexPage) // send all routes to the client. the client will show 404
})

// start the HTTP server
let handleRequest = (request, response) => {
    try {
        logger.debug('Request: ' + request.url)
        if (nconf.get('httpsOnly') === true && nconf.get('protocol') === 'https://') {
            if (!request.headers.host) {
                response.writeHead(400, {'Content-Type': 'text/plain; charset=UTF-8'})
                return response.end('bad request')
            }
            let urlParts = utils.parseUrl(request.headers.host);
            let redirect = 'https://' + urlParts.hostname + ':' + nconf.get('tlsPort') // browsers won't display port 443
            response.writeHead(301, {'Location': redirect + request.url})
            response.end()
            return
        }
        dispatcher.dispatch(request, response)
    } catch(error) {
        logger.error(error)
    }
}
let startPath = "/index.html";
if (helper.getFirstApiKey())
    startPath += "?apiKey=" + helper.getFirstApiKey();
let server = http.createServer(handleRequest)
server.setTimeout(nconf.get("httpTimeoutSec") * 1000, null)
//httpShutdown(server)
server.listen(nconf.get('port'), () => {
    logger.info('Server is listening on %s%s:%s%s ', 'http://', os.hostname(), nconf.get('port'), startPath) // TODO why is our tail() cutting the last char of first line?
})
let mainServer: http.Server | https.Server = server; // might get overwritten by the https server below

// start the HTTPS server
if (nconf.get('protocol') === 'https://') {
    let handleSecureRequest = (request, response) => {
        try {
            logger.debug('Secure request: ' + request.url)
            dispatcher.dispatch(request, response)
        } catch(error) {
            logger.error(error)
        }
    }
    let credentials = {
        key: fs.readFileSync(path.join(utils.appDir, nconf.get('serverDataDir'), nconf.get('projectName') + '.key')).toString(),
        cert: fs.readFileSync(path.join(utils.appDir, nconf.get('serverDataDir'), nconf.get('projectName') + '.crt')).toString()
    }
    let httpsServer = https.createServer(credentials, handleSecureRequest)
    server.setTimeout(nconf.get("httpTimeoutSec") * 1000, null)
    //httpShutdown(httpsServer)
    httpsServer.listen(nconf.get('tlsPort'), () => {
        logger.info('Server is listening on %s%s:%s%s', nconf.get('protocol'), os.hostname(), nconf.get('tlsPort'), startPath)
    });
    mainServer = httpsServer;
}

if (updateHandler !== null) {
    updateHandler.runUpdater(() => { // will restart the app or fire this callback
        if (argv.update) {
            process.exit(0);
            return;
        }
        Controller.start(mainServer)
        /*
        // TODO "connecting" forever issue not fixed with timeout. no, the http server doesn't respond. connection not initiated
        setTimeout(() => {
            mainServer.shutdown()
            console.log("SHUTDOWN")
            setTimeout(() => {
                mainServer.listen(nconf.get('tlsPort'), () => {
                    logger.info('Server ist listening on %s%s:%s', nconf.get('protocol'), os.hostname(), nconf.get('tlsPort'))
                })
            }, 4000)
        }, 5000)
        */
    })
}
else
    Controller.start(mainServer)
