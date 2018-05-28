// node --use_strict --max-old-space-size=2096 app.js
// parameters: --bundle, --debug (debug, otherwise use config value), -pPORT
// -t: run a specific (test) script

// --config: the name of the config file under /config/ to run a specific trading strategy
// --trader (optional): the name of the trader to use. defaults to "RealTimeTrader", alterantives: Backtester|TradeNotifier
// --paper (optional): run in paper trading mode only (simulation). applies only to some traders
// --update (optional): update only. exit the app after update or of there is no update available
// --noTalib (optional): disable the use of TA-LIB (difficult installation on windows)
// --debug (optional): print verbose debug output for developers
// --uiDev (optional): reload HTML templates and JavaScript every second from disk

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

require('source-map-support').install();
import * as utils from '@ekliptor/apputils';
const nconf = utils.nconf;
//const appRoot = require('app-root-path')
//import logger = require('./src/utils/Logger')
import * as logger from "./src/utils/Logger";
//const argv = require('minimist')(process.argv.slice(2))
import * as argvFunction from "minimist";
const argv = argvFunction(process.argv.slice(2));
if (argv.debug === true)
    nconf.set('debug', true);
if (argv.p) {
    nconf.set('port', argv.p)
    nconf.set('tlsPort', argv.p + 1)
}
else if (argv.t) { // allow a main and test instance run together
    nconf.set('port', nconf.get('port') + 2)
    nconf.set('tlsPort', nconf.get('tlsPort') + 2)
}
if (!argv.trader)
    nconf.set('trader', 'RealTimeTrader')
if (argv.paper)
    nconf.set('tradeMode', 1)
// TODO for better command line interface: https://www.npmjs.com/package/commander
if (process.env.IS_CHILD) {
    nconf.set('port', 0) // we run multiple processes, let NodeJS choose free ports
    nconf.set('tlsPort', 0)
}
nconf.set("uiDev", argv.uiDev === true);

if (argv.train || argv.predict)
    nconf.set("ai", true);
else if (argv.lending)
    nconf.set("lending", true);
else if (argv.arbitrage)
    nconf.set("arbitrage", true);
else if (argv.social) {
    nconf.set("social", true);
    //nconf.set("httpsOnly", false); // disable for telegram POST API // TODO create a certificate with a valid domain name for chrome
}

import * as http from "http";
import * as https from "https";
const dispatcher = utils.dispatcher
import * as fs from "fs";
import * as os from "os"; // for hostname
import * as path from "path";
//import * as httpShutdown from "http-shutdown";
import {controller as Controller} from "./src/Controller";
import * as updateHandler from './src/updateHandler';

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
    if (req.url.match(/\.(ts|js\.map)(\?.*)?$/i) !== null) { // prevent access to typescript files
        res.writeHead(404, {'Content-Type': 'text/plain; charset=UTF-8'})
        res.end('Not found: ' + req.url)
        return;
    }
    chain.next(req, res, chain);
});

dispatcher.onPost('/state/', (req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json; charset=UTF-8'})
    if (checkPostAuth(req.formFields, res) === false)
        return
    let output = Controller.getStatus()
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

dispatcher.onPost('/login/', (req, res) => {
    //if (checkPostAuth(req.formFields, res) === false) // allowed without API key
        //return
    Controller.login(req, res)
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
let server = http.createServer(handleRequest)
server.setTimeout(nconf.get("httpTimeoutSec") * 1000, null)
//httpShutdown(server)
server.listen(nconf.get('port'), () => {
    logger.info('Server ist listening on %s%s:%s ', 'http://', os.hostname(), nconf.get('port')) // TODO why is our tail() cutting the last char of first line?
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
        logger.info('Server ist listening on %s%s:%s', nconf.get('protocol'), os.hostname(), nconf.get('tlsPort'))
    });
    mainServer = httpsServer;
}

updateHandler.runUpdater(() => { // will restart the app or fire this callback
    if (argv.update) {
        process.exit(1);
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