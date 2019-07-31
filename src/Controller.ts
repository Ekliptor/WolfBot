import * as utils from "@ekliptor/apputils";
const logger = utils.logger
const nconf = utils.nconf
import * as db from'./database';
const argv = require('minimist')(process.argv.slice(2));
import AbstractController from './AbstractController';
import NotificationController from './NotificationController';
import ExchangeController from './ExchangeController';
import TradeAdvisor from './TradeAdvisor';
import {LendingAdvisor} from './Lending/LendingAdvisor';
import {SocialController} from "./Social/SocialController";
import MarginChecker from './MarginChecker';
import {LoginController} from "./LoginController";
import InstanceChecker from './InstanceChecker';
//import * as updateHandler from './updateHandler';
const updateHandler = argv.noUpdate === true ? null : require("./updateHandler");
import {SystemMessage, serverConfig, Process} from "@ekliptor/bit-models";
import * as minify from "./minify";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as https from "https";
import WebSocketController from './WebSocketController';
import {ServerSocket} from "./WebSocket/ServerSocket";
import{FileResponder} from "./Web/FileResponder";
import{HttpProxy} from "./Web/HttpProxy";
import {TaLib, TaLibParams, TaLibResult} from "./Indicators/TaLib";
import {Brain} from "./AI/Brain";
import {WebErrorCode} from "./Web/errorCodes";
import {JsonResponse} from "./Web/JsonResponse";


export class Controller extends AbstractController { // TODO implement graceful shutdown api command (stop & delete tasks)
    protected exchangeConntroller: ExchangeController = null;
    protected notificationController: NotificationController;
    protected tradeAdvisor: TradeAdvisor = null;
    protected lendingAdvisor: LendingAdvisor = null;
    protected socialController: SocialController = null;
    protected brain: Brain = null;
    protected marginChecker: MarginChecker = null;
    protected instanceChecker: InstanceChecker = null;
    protected loginController: LoginController = null;

    protected webServer: http.Server | https.Server = null;
    protected serverSocket: ServerSocket = null;
    protected websocketController: WebSocketController = null;
    protected fileResponder = new FileResponder();
    protected httpProxy = new HttpProxy();

    protected lastUpdateCheck = new Date(); // set to now. we just check at start before loading the Controller class
    protected lastConfigLoad = new Date(0); // load immediately on startup
    protected isRunning = false;

    constructor() {
        super()
        if (nconf.get('mongoUrl') === undefined)
            nconf.add('controllerDefaults', {type: 'literal', store: require(__dirname + '/../config.js').config})

        process.on('uncaughtException', (err) => {
            if (!this.handleDatabaseConnectionError(err))
                this.log('Uncaught Exception', err, err.stack)
        })
        process.on('unhandledRejection', (err) => {
            if (!this.handleDatabaseConnectionError(err))
                this.log('Unhandled Rejection', err, err.stack)
        })
        process.on('exit', (code) => {
            // http://www.oracle.com/technetwork/articles/servers-storage-dev/oom-killer-1911807.html
            // sometimes SIGSEGV = seg fault
            logger.info("Main process exited with code " + code); // database connection is most likely already closed
        });
        TaLib.checkTaLibSupport(); // just print the error, continue without technical indicators for now
        if (nconf.get("ai") === true)
            Brain.firstStart(argv.train)
        this.loadLocalConfig();
    }

    /*static */log(subject, ...errorArgs) {
        try {
            let params = []
            for (let i = 0; i < arguments.length; i++) {
                if (typeof arguments[i] !== 'function')
                    logger.warn(arguments[i])
                params.push(arguments[i])
            }
            let New = SystemMessage.SystemMessage(db.get()) // hope it is not a connection/database error
            new New(subject, ...params.slice(1))
        }
        catch (e) {
            logger.error('Error logging to database', e)
        }
    }

    start(webServer: http.Server | https.Server, runProcess = true) {
        this.webServer = webServer;
        if (!this.webServer)
            throw new Error("Unable to start app without web server. Please ensure you have permission to listen on your specified port.");
        return new Promise<void>((resolve, reject) => {
            // database
            this.connect(() => {
                // run unit test (wait for db connection and other callbacks)
                setTimeout(() => {
                    let updateDb = async () => {
                        // write something to db...
                        await require('../tests/init/init.js').run();
                        if (!runProcess)
                            return;
                        this.process((scheduleAgain) => {
                            if (scheduleAgain !== false)
                                this.scheduleProcessRepeating()
                        })
                    }
                    if (typeof argv.t === 'string') { // use the -t=filename as parameter to run this file on startup
                        const test = require('../tests/' + argv.t + '.js');
                        if (typeof test.run === 'function')
                            test.run(() => {
                                updateDb()
                            });
                    }
                    else
                        updateDb()
                }, 200);
            })
            this.ensureTempDir().then(() => {
                return this.minifyResources();
            }).then(() => {
                return new Promise<void>((resolve, reject) => {
                    //const wsPort = nconf.get('protocol') === 'https://' ? nconf.get('tlsPort') : nconf.get('port') // listen on the same port as the http server
                    if (this.webServer)
                        this.serverSocket = new ServerSocket({server: this.webServer}); // callback only fired when we create a new http server
                    setTimeout(resolve, 0);
                })
            }).then(() => {
                return this.writeStartParametersFile();
            }).then(() => {
                resolve()
                if (nconf.get("uiDev")) {
                    setInterval(() => {
                        this.minifyResources()
                    }, nconf.get("data:minifyResourcesUiDevIntervalMs"))
                }
            }).catch((err) => {
                logger.error("Controller startup error", err);
                reject(err)
            })
        })
    }

    minifyResources() {
        return new Promise<void>((resolve, reject) => {
            if (process.env.IS_CHILD)
                return resolve()
            fs.readFile(path.join(utils.appDir, 'package.json'), 'utf8', (err, data) => {
                let json = utils.parseJson(data)
                let version = json.version ? json.version : utils.getRandomString(10) // force reload on every app restart (or stat a file and read the timestamp?)
                nconf.set('version', version);
                // TODO add version of included files as query string in index.html to reload cache
                let minifyOptions = {
                    copyFiles: [
                        path.join(utils.appDir, 'node_modules', 'i18next', 'i18next.min.js'),
                        path.join(utils.appDir, 'node_modules', 'i18next-xhr-backend', 'i18nextXHRBackend.min.js'),
                        path.join(utils.appDir, 'node_modules', 'eventemitter2', 'lib', 'eventemitter2.js'),
                        path.join(utils.appDir, 'node_modules', 'chart.js', 'dist', 'Chart.bundle.js'),
                        path.join(utils.appDir, 'node_modules', 'datatables.net', 'js', 'jquery.dataTables.js'),
                        path.join(utils.appDir, 'node_modules', 'datatables.net-bs', 'js', 'dataTables.bootstrap.js'),

                        // browser utils
                        path.join(utils.appDir, 'node_modules', '@ekliptor', 'browserutils', 'src', 'js', 'functions.js'),
                        path.join(utils.appDir, 'node_modules', '@ekliptor', 'browserutils', 'src', 'js', 'helper.js'),
                        path.join(utils.appDir, 'node_modules', '@ekliptor', 'browserutils', 'bld-web', 'browserutils.js')
                    ]
                }
                minify.writeConstants(minifyOptions, (err) => {
                    if (err)
                        return reject(err)
                    if (!nconf.get("uiDev")) // don't spam the log
                        logger.info('minified all resources')
                    resolve()
                })
            })
        })
    }

    connect(cb) {
        let connectUrl = nconf.get('mongoUrl')
        if (nconf.get('mongoTimeoutSec') > 10) {
            let timeoutMs = nconf.get('mongoTimeoutSec') * 1000;
            connectUrl += '?socketTimeoutMS=' + timeoutMs + '&connectTimeoutMS=' + timeoutMs;
        }
        db.connectAll({
            url: connectUrl,
            searchHosts: nconf.get('searchHosts')
        }, logger, (err) => {
            if (err) {
                logger.error("Error connecting to MongoDB", err);
                process.exit(1); // TODO is this problematic if router connection is not stable?
            }
            logger.info("Connected to MongoDB"); // currently no call to db.close(). implicit on shutdown (except reconnects)
            cb && cb()
        })
    }

    public restart(forceDefaults = false, resetMode = false) {
        this.websocketController.getConfigEditor().restart(forceDefaults, resetMode);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected process(cb) {
        let config = nconf.get("serverConfig")
        let previousValues: any = {}
        for (let prop in config)
        {
            if (serverConfig.OVERWRITE_PROPS.indexOf(prop) !== -1)
                previousValues[prop] = config[prop];
        }
        this.loadServerConfig(() => {
            /*
            nconf.load((err) => {
                if (err)
                    logger.error("Error loading config files", err)
                this.doProcess(cb)
            })
            */
            for (let prop in previousValues)
                nconf.set('serverConfig:' + prop, previousValues[prop])
            this.doProcess(cb)
        })
    }

    protected doProcess(cb) {
        if (nconf.get('serverConfig:enabled') == false) {
            logger.info('Skipped processing because it is disabled globally')
            this.isRunning = true;
            return cb && cb(true)
        }
        const now = utils.getCurrentTick()
        //logger.info('Controller process start...')

        this.setLastActive()
        //let reconnect = nconf.get('server:reconnect')
        //let canReconnect = reconnect && reconnect.method != ''

        if (!this.instanceChecker)
            this.instanceChecker = new InstanceChecker();
        if (argv.monitor === true) {
            this.instanceChecker.process().then(() => {
                cb && cb(true)
            }).catch((err) => {
                logger.error("Error during instance checking mode", err)
                cb && cb(true)
            })
            return
        }

        let tasks = []
        let scheduleAgain = true // always true here since we don't reconnect our IP
        if (this.exchangeConntroller === null)
            this.exchangeConntroller = new ExchangeController(argv.config);
        if (this.loginController === null)
            this.loginController = LoginController.getInstance();
        this.notificationController = new NotificationController()
        this.notificationController.process().then(() => {
            return this.exchangeConntroller.process()
        }).then(() => {
            // all exchanges are loaded & connected
            // since all our actions are based on events from streams we would not need this process() function to act
            // but running it every 5 seconds and act from here "flattens" market spikes

            if (nconf.get("ai") === true) {
                if (this.brain === null)
                    this.brain = new Brain(this.exchangeConntroller.getConfigFilename(), this.exchangeConntroller.getExchanges());
                if (argv.train)
                    tasks.push(this.brain.train());
                scheduleAgain = !argv.train; // brain instance for training should only be used once
            }
            else if (nconf.get("lending") === true) {
                if (this.lendingAdvisor === null)
                    this.lendingAdvisor = new LendingAdvisor(this.exchangeConntroller.getConfigFilename(), this.exchangeConntroller);
                tasks.push(this.lendingAdvisor.process())
            }
            else if (nconf.get("social") === true) {
                if (!this.socialController)
                    this.socialController = new SocialController(this.exchangeConntroller.getConfigFilename(), this.exchangeConntroller);
                tasks.push(this.socialController.process())
            }
            if (!this.tradeAdvisor) { // tradeAdvisor is always needed for websocket UI
                this.tradeAdvisor = new TradeAdvisor(this.exchangeConntroller.getConfigFilename(), this.exchangeConntroller)
                this.websocketController = new WebSocketController(this.serverSocket, this.tradeAdvisor, this.lendingAdvisor, this.socialController, this.brain);
            }
            if (nconf.get("ai") !== true && nconf.get("lending") !== true) {
                tasks.push(this.tradeAdvisor.process())
                if (!this.marginChecker)
                    this.marginChecker = new MarginChecker(this.exchangeConntroller.getExchanges())
                tasks.push(this.marginChecker.process())
                // add more tasks here...
            }

            tasks.push(this.instanceChecker.process())
            tasks.push(this.loginController.process())

            // wait for all tasks to finish
            return Promise.all(tasks)
        }).then(() => {
            let totalTime = utils.test.getPassedTime(now)
            //logger.verbose('Controller process end... total time ' + totalTime)
        }).catch((err) => {
            let subject = 'Error in Controller process'
            logger.error(subject, err)
            this.log(subject, err)
        }).then(() => {
            this.isRunning = true;
            cb && cb(scheduleAgain)
        })/*.catch((err) => { // shouldn't be reached. reconnect will try for many days
            logger.error('Error reconnecting fore new IP address', err)
            process.exit(1) // now what? more debugging tools needed?
        })*/
    }

    public handleDatabaseConnectionError(err) {
        if (!err || typeof err !== "object")
            return false;
        let message = ((err.message || "") + " " + (err.name || "")).toLocaleLowerCase(); // err.stack is too long
        if (message && message.indexOf('mongoerror') !== -1 && (
            message.indexOf('timed out') !== -1 || message.indexOf('slaveok=false') !== -1 || message.indexOf('topology was destroyed') !== -1 ||
            message.indexOf('econnreset') !== -1)) {
            // MongoError: connection 5 to localhost:27017 timed out
            this.log('Database connection error', err, err.stack)
            // we lost our database connection. our app might be in an undefined state.
            // the safest thing we can do is wait a few sec and restart it
            setTimeout(() => {
                this.restart()
                logger.error("Lost database connection")
            }, 5000)
            return true;
        }
        return false;
    }

    disconnect(cb) {
        db.close((err) => {
            if (err)
                logger.error("Error disconnecting from MongoDB", err)
            cb && cb()
        })
    }

    loadServerConfig(cb) {
        let load = () => {
            // undefined on startup
            const updateInterval = nconf.get("serverConfig:loadConfigIntervalMin") > 0 ? nconf.get("serverConfig:loadConfigIntervalMin") : 0;
            if (this.lastConfigLoad.getTime() + updateInterval * utils.constants.MINUTE_IN_SECONDS*1000 < Date.now()) {
                this.lastConfigLoad = new Date();
                serverConfig.loadServerConfig(db.get(), () => {
                    if (nconf.get('tradeMode') === undefined)
                        nconf.set('tradeMode', nconf.get('serverConfig:tradeMode'))
                    this.loadLocalConfig();
                    cb && cb()
                })
            }
            else
                cb && cb();
        }
        if (this.lastUpdateCheck.getTime() + nconf.get("serverConfig:checkUpdateIntervalH") * utils.constants.HOUR_IN_SECONDS*1000 < Date.now()) {
            this.lastUpdateCheck = new Date();
            // don't run updater too often because of RealTime trader. bot will lose its state. only update on restart
            if (updateHandler !== null) {
                updateHandler.runUpdater(() => { // will restart the app or fire this callback
                    logger.info("Checking for updates");
                    load();
                })
            }
            else
                load();
        }
        else
            load();
    }

    protected loadLocalConfig() {
        const filePath = path.join(__dirname, "..", "configLocal.js");
        if (fs.existsSync(filePath) === false) {
            logger.error("No local config file found. Please ensure the file %s exists. You can edit and copy it from configLocal-sample.ts", filePath);
            process.exit(1);
        }
        let localConf = require(filePath);
        for (let prop in localConf)
        {
            if (prop === "root") {
                for (let childProp in localConf[prop]) {
                    if (childProp !== "apiKeys"/* || !nconf.get("serverConfig:premium")*/) // overwrites happen after
                        nconf.set(childProp, localConf[prop][childProp]);
                }
            }
            else {
                for (let childProp in localConf[prop])
                {
                    if (prop === "serverConfig" && childProp === "apiKey" && nconf.get("serverConfig:apiKey") != null)
                        continue; // don't reset keys
                    nconf.set(prop + ':' + childProp, localConf[prop][childProp]);
                }
            }
        }
        if (typeof localConf.orverrides === "function")
            localConf.orverrides();
        // should we call loginController immediately with a force = true parameter?
    }

    protected setLastActive() {
        if (process.env.IS_CHILD)
            return; // doesn't have a port
        //Process.setLastActive(db.get())
        let proc = Process.getProcessObject()
        proc.apiPort = nconf.get('tlsPort')
        proc.name = InstanceChecker.getOwnInstanceName();
        Process.setLastActive(db.get(), proc, (err) => {
            if (err)
                logger.warn("Error setting process active in database", err);
        })
    }

    protected writeStartParametersFile() {
        return new Promise<void>((resolve, reject) => {
            if (process.env.IS_CHILD)
                return resolve()
            let params = process.argv.slice(2).join(" ");
            // TODO how does this end up running? app.js --config=1Aneto-temp BitMEX test --trader=Backtester -p=2095
            const paramsFile = path.join(/*utils.appDir, */nconf.get("lastParamsFile")); // use working dir
            fs.writeFile(paramsFile, params, {encoding: "utf8"}, (err) => {
                if (err)
                    return reject(err);
                resolve()
            })
        })
    }

    public async getStatus(req: http.IncomingMessage) {
        const postData = req != null ? utils.getJsonPostData((req as any).formFields) : null;
        let status = {
            ready: false,
            strategyInfos: this.tradeAdvisor ? this.tradeAdvisor.getStrategyInfos() : (this.lendingAdvisor ? this.lendingAdvisor.getStrategyInfos() : null),
            social: null, // only added on request. CPU intensive to compute
            prices: null,
            predictions: this.brain && this.brain.getLiveOracle() ? this.brain.getLiveOracle().getPredictions() : null
        }
        if (this.socialController && postData) {
            if (postData.social === true)
                status.social = await this.socialController.getAllCrawlerData();
            if (postData.prices === true)
                status.prices = (await this.socialController.getPriceData(status.social)).toObject();
        }
        // TODO isRunning ooesn't get set to true sometimes. why?
        if (process.uptime() > 16.0 && /*this.isRunning === true && */(
            status.strategyInfos !== null || status.social !== null || status.prices !== null)) // add more checks if we use different features later
            status.ready = true;
        return {data: status}
    }

    public addTelegramMessage(message: /*RawTelegramMessage*/any) {
        if (this.socialController)
            this.socialController.addTelegramMessage(message);
    }

    public sendFile(req: http.IncomingMessage, res: http.ServerResponse) {
        this.fileResponder.respond(req, res);
    }

    public proxyRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        this.httpProxy.respond(req, res);
    }

    public async login(req: http.IncomingMessage, res: http.ServerResponse) {
        let json = utils.getJsonPostData((req as any).formFields);
        let login = LoginController.getInstance();
        let loginRes = await await login.login({
            username: json.login.username,
            password: json.login.password
        });
        if (!loginRes) {
            loginRes.error = true;
            loginRes.errorCode = "unknownError";
        }
        else if (loginRes.loginRes.loginValid === false || loginRes.loginRes.subscriptionValid === false || json.login.username !== nconf.get("serverConfig:username")) {
            loginRes.error = true;
            loginRes.errorCode = loginRes.loginRes.loginValid === false ? "userNotFound" : "subscriptionNotFound";
        }
        res.writeHead(200, {'Content-Type': 'application/json; charset=UTF-8'})
        res.end(JSON.stringify(loginRes))
    }

    public async getTradebook(req: http.IncomingMessage, res: http.ServerResponse) {
        let tradeBook = this.tradeAdvisor ? this.tradeAdvisor.getTradeBook() : null;
        if (tradeBook === null)
            tradeBook = this.lendingAdvisor ? this.lendingAdvisor.getTradeBook() : null;
        let output = new JsonResponse();
        if (tradeBook !== null)
            output.data.push(await tradeBook.getHistory(utils.dispatcher.getAnyQueryData(req), output));
        else
            output.setError(WebErrorCode.TRADEBOOK_NOT_AVAILABLE, "TradeBook not available");
        res.writeHead(200, {'Content-Type': 'application/json; charset=UTF-8'})
        res.end(JSON.stringify(output))
    }
}

const controller = new Controller() // cache the existing instance
//module.exports = exports = controller
// with typescript we could also make the constructor private and add a static function getInstance()
export {controller};

// force loading dynamic imports for TypeScript // TODO null pointer exceptions when added. "rootDirs" in tsconfig doesn't compile them
/*
import "./tests/exchange";
import "./tests/import";
import "./tests/ml";
import "./tests/talib";
import "./tests/trade";
*/
