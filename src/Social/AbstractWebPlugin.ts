import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Candle, Currency, Trade, Order, Ticker, MarketOrder, SocialAction, SocialPost, Tweet, News, TrollShout} from "@ekliptor/bit-models";
import * as EventEmitter from 'events';
import * as childProcess from "child_process";
const fork = childProcess.fork;
import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs";
import * as helper from "../utils/helper";
import Notification from "../Notifications/Notification";
import {AbstractNotification} from "../Notifications/AbstractNotification";
import {SocialConfig} from "./SocialConfig";

const processFiles = [path.join(utils.appDir, 'app.js'),
    path.join(utils.appDir, 'build', 'app.js')]
const processFile = fs.existsSync(processFiles[0]) ? processFiles[0] : processFiles[1]


export interface AbstractWebPluginConfig {
    enableLog: boolean;
}

export abstract class AbstractWebPlugin extends EventEmitter {
    protected className: string;
    protected config: AbstractWebPluginConfig;
    protected socialConfig: SocialConfig; // the root config json file (containing all websites)
    protected forkChild = true; // fork a child for crawling or run in the main process

    protected logMap = new Map<string, number>(); // (sha1, timestamp)
    protected notifier: AbstractNotification;
    protected notificationPauseMin: number = nconf.get('serverConfig:notificationPauseMin'); // can be changed in subclasses
    protected lastNotification: Date = null;

    constructor(config: AbstractWebPluginConfig) {
        super()
        this.className = this.constructor.name;
        this.config = config;

        this.loadNotifier();
    }

    public getClassName() {
        return this.className;
    }

    public getConfig() {
        return this.config;
    }

    public onConfigChanged() {
        // TODO anything to update? possibly change subscribed feeds in subclasses
    }

    public setSocialConfig(config: SocialConfig) {
        this.socialConfig = config;
    }

    public getSocialConfig() {
        return this.socialConfig;
    }

    /**
     * Starts the crawling of this plugin class.
     * Usually a child process is forked for every crawler class (crawling twitter uses a lot of CPU).
     * You must implement startCrawling() in your class.
     * @returns {Promise<boolean>} true if crawling was started
     */
    public start(): Promise<boolean> {
        if (process.env.IS_CHILD || this.forkChild === false) {
            //logger.info("start crawling %s", this.className)
            if (process.env.IS_CHILD) { // ensure we always exit the child when parent exits. Reddit crawler has problems with that since 2018-09-16
                process.on("disconnect", () => {
                    process.exit(0);
                });
            }
            return this.startCrawling();
        }
        return new Promise<boolean>((resolve, reject) => {
            // or https://github.com/ryankurte/winston-cluster
            logger.info("Forking child process for %s", this.className)
            let processArgs = Object.assign([], process.execArgv)
            let dbg = false
            let maxMemorySet = false
            for (let i=0; i < processArgs.length; i++) {
                if (processArgs[i].substr(0,12) == "--debug-brk=") {
                    processArgs[i] = "--debug-brk=" + (nconf.get('debuggerPort') ? nconf.get('debuggerPort') : 43207)
                    dbg = true
                    //break
                }
                else if (processArgs[i].substr(0, 21) == "--max-old-space-size=") {
                    //processArgs[i] = "--max-old-space-size=" + nconf.get('maxMemoryMbUpdateStats'); // keep the parent value
                    maxMemorySet = true;
                }
            }
            //if (!maxMemorySet)
            //processArgs.push("--max-old-space-size=" + nconf.get('maxMemoryMbUpdateStats'))
            let nodeArgs = process.argv.slice(2)
            if (nodeArgs.indexOf("--child") === -1)
                nodeArgs.push("--child") // for easy filtering with grep command
            let env = Object.assign({}, process.env)
            env.IS_CHILD = true
            env.PARENT_PROCESS_ID = process.pid;
            env.CRAWLER_CLASS = this.className;
            //env.PORT = utils.getRandomInt(1000, 65000)
            let options = {
                cwd: process.cwd(),
                env: env,
                execPath: process.execPath,
                execArgv: processArgs, // don't change anything on the process arguments. process get's restarted with same args below
                silent: false
                //stdio:
            }
            let child = fork(processFile, nodeArgs, options)
            let parentExitListener = (code) => {
                if (!child || !child.connected)
                    return
                logger.info("Parent process exited with code %s. Killing active child process with PID %s", code, child.pid);
                child.kill(); // SIGTERM
                child = null;
            }

            child.on('error', (err) => {
                logger.error("Crawler child process encountered an error", err)
                reject(err) // promise most probably alread resolved
            })

            child.on('exit', (code, signal) => {
                logger.info('Child process exited with code %s - signal %s', code, signal)
                process.removeListener('exit', parentExitListener)
                if (child)
                    setTimeout(this.start.bind(this), 1000); // restart the child if we are still running
            })
            let resolved = false;
            child.on('message', (message) => {
                if (!resolved) {
                    resolved = true;
                    resolve(true)
                }
                this.onChildMessage(message)
                //if (message.type === 'success')
                //childSuccess = true
            })
            utils.winstonChildProc.addChildListener(logger, child);
            //child.unref(); // see also options.detached (default false, only for spawn?). but we kill the child explicitly on exit and don't wait for it
            process.on('exit', parentExitListener)

            if (dbg)
                debugger
            /*
            child.send({
                // we can only send strings and objects (no functions) because it gets sent via JSON.stringify()
                type: 'start'
            })
            */
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected abstract startCrawling(): Promise<boolean>;

    protected onChildMessage(message: any) {
        switch (message.type)
        {
            case 'event':
                //logger.verbose("received crawle child %s event message", message.eventName)
                this.emit(message.eventName, message.data)
                break;
            case 'error':
                logger.error('Crawler child process error', message.error)
                break;
            default:
                if (message.type === undefined && message.cmd && message.cmd === 'log')
                    break; // child process logs
                logger.warn('Received unknown crawler child message of type: %s', message.type)
        }
    }

    /**
     * Log arguments
     * @param args the arguments to log. You can't use %s, but arguments will be formatted as string.
     * Use utils.sprintf() to format strings.
     */
    protected log(...args) {
        if (!this.config.enableLog)
            return;
        logger.info("%s:", this.className, ...args)
    }

    protected logOnce(...args) {
        if (!this.config.enableLog)
            return;
        const now = Date.now();
        let clearMessages = () => {
            for (let log of this.logMap) // clear old logs of  messages
            {
                if (log[1] + nconf.get('serverConfig:logTimeoutMin')*utils.constants.MINUTE_IN_SECONDS*1000 < now)
                    this.logMap.delete(log[0]);
            }
        }
        let key = crypto.createHash('sha1').update(JSON.stringify(args), 'utf8').digest('hex');
        if (this.logMap.has(key)) {
            if (utils.getRandomInt(0, 99) < nconf.get("serverConfig:clearLogOnceProbability"))
                clearMessages(); // allow logging the same message next time
            return; // ANOTHER message has to be logged for this one to expire
        }
        clearMessages();
        this.logMap.set(key, now);
        this.log(...args);
    }

    /**
     * Log arguments as warning
     * @param args the arguments to log. You can't use %s, but arguments will be formatted as string.
     * Use utils.sprintf() to format strings.
     */
    protected warn(...args) {
        if (!this.config.enableLog)
            return;
        logger.warn("%s:", this.className, ...args)
    }

    protected loadNotifier() {
        this.notifier = AbstractNotification.getInstance();
    }

    protected sendNotification(headline: string, text: string = "-", requireConfirmation = false, forceSend = false) {
        // note that pushover won't accept empty message text
        if (nconf.get("trader") === "Backtester")
            return;
        const pauseMs = this.notificationPauseMin * utils.constants.MINUTE_IN_SECONDS * 1000;
        if (!forceSend && this.lastNotification && this.lastNotification.getTime() + pauseMs > Date.now())
            return;
        headline = utils.sprintf("%s: %s", this.className, headline);
        let notification = new Notification(headline, text, requireConfirmation);
        this.notifier.send(notification).then(() => {
        }).catch((err) => {
            logger.error("Error sending %s notification", this.className, err)
        });
        this.lastNotification = new Date();

        // TODO send premium notifications https://wolfbot.org/wp-json/tradebot/v1/getNotificationMethods?apiKey=
    }

    protected loadModule<T>(modulePath: string, options = undefined): T {
        try {
            let ModuleClass = require(modulePath)
            if (ModuleClass.default)
                ModuleClass = ModuleClass.default; // fix for typescript default exports
            let instance = new ModuleClass(options)
            return instance
        }
        catch (e) { // e.code === 'MODULE_NOT_FOUND'
            logger.error('failed to load module: ' + modulePath, e)
            return null
        }
    }
}
