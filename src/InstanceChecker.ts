import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractSubController} from "./AbstractSubController";
import {AbstractExchange, ExchangeMap} from "./Exchanges/AbstractExchange";
import {AbstractStrategy} from "./Strategies/AbstractStrategy";
import {Currency, Trade, Process} from "@ekliptor/bit-models";
import {AbstractNotification} from "./Notifications/AbstractNotification";
import Notification from "./Notifications/Notification";
import * as path from "path";
import * as fs from "fs";
import * as child_process from "child_process";
const exec = child_process.exec
import * as os from "os";
import * as db from "./database";
import * as helper from "./utils/helper";
import * as argvFunction from "minimist";
const argv = argvFunction(process.argv.slice(2));


export default class InstanceChecker extends AbstractSubController {
    public static readonly INSTANCE_CHECK_INTERVAL_SEC = 120; // must be >= 2min (time the cron will restart crashed bots)
    public static readonly INSTANCE_CHECK_API_INTERVAL_SEC = 30;

    protected lastCheck: Date = null;
    protected lastCheckApi: Date = null;
    protected lastPort: number = 0;
    //protected lastProcessRunning = new Date();
    protected lastResponse = new Date(); // assume working on startup
    protected lastOkRuntime = new Date(); // last time the runtime of the bot we are monitoring was high enough
    protected lastPID: number = 0; // the PID of the process we monitor
    protected notifier: AbstractNotification;
    protected lastNotification: Date = null;

    constructor() {
        super()
        //this.lastCheck = new Date(); // set checked on start because all bots might just be starting (system startup)
        this.notifier = AbstractNotification.getInstance(true);
    }

    public process() {
        return new Promise<void>((resolve, reject) => {
            if (argv.monitor === true)
                nconf.set('serverConfig:checkInstances', true); // argument overwrites config setting

            if (!nconf.get('serverConfig:checkInstances') || nconf.get('trader') === "Backtester"/*nconf.get('trader') !== "RealTimeTrader"*/ || process.env.IS_CHILD) {
                if (argv.monitor === true)
                    setTimeout(resolve.bind(this), InstanceChecker.INSTANCE_CHECK_API_INTERVAL_SEC);
                else
                    return resolve();
            }

            this.checkInstances().catch((err) => {
                logger.error("Error checking bot instances", err)
            }).then(() => {
                return this.watchProcessesTerminating(InstanceChecker.getOwnInstanceName());
            }).then(() => {
                resolve();
            }).catch((err) => {
                logger.error("Error watching processes for termination", err)
                resolve(); // continue
            })
        })
    }

    /**
     * Returns the name of the first directory that matches our project name.
     * @returns {string}
     */
    public static getOwnInstanceName() {
        let dirParts = utils.appDir.split(path.sep);
        let name = "";
        for (let i = dirParts.length-1; i >= 0; i--)
        {
            if (dirParts[i].indexOf(nconf.get("projectName")) !== -1) {
                name = dirParts[i];
                break;
            }
        }
        return name;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkInstances() {
        return new Promise<void>((resolve, reject) => {

            let name = this.getNextInstanceName();
            if (!name)
                return resolve(); // no monitoring available (single instance use)
            this.checkInstanceRunning(name).then(async () => {
                if (await this.isUpdaterRunning(name) === true) {
                    logger.info("Skipping bot %s API check because it's currently updating", name);
                    return Promise.resolve();
                }
                return this.checkApiAndRestart(name);
            }).then(() => {
                this.checkLastRespnseTime(name);
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected getNextInstanceName() {
        let name = InstanceChecker.getOwnInstanceName()
        if (!name) {
            if (!nconf.get("debug"))
                logger.warn("Unable to get next instance to monitor bots. Dir path: %s", utils.appDir)
            return "";
        }
        if (argv.monitor === true) {
            // we have 1 instance named Sensor1 and its monitoring instanced named Sensor_monitor
            let removeRegex = new RegExp(utils.escapeRegex(nconf.get("serverConfig:monitoringInstanceDir")) + "$");
            name = name.replace(removeRegex, "1");
        }
        else {
            // we have multiple instances named Sensor1, Sensor2,...
            if (name.match(/[0-9]+$/) === null)
                return "";
            name = name.replace(/[0-9]+$/, (substring) => {
                let cur = parseInt(substring);
                cur++;
                if (cur > nconf.get("serverConfig:instanceCount"))
                    cur = 1;
                return cur.toString();
            })
        }
        logger.verbose("Next instance name to check: %s", name)
        return name;
    }

    protected checkInstanceRunning(botName: string) {
        return new Promise<void>((resolve, reject) => {
            if (this.lastCheck && this.lastCheck.getTime() + InstanceChecker.INSTANCE_CHECK_INTERVAL_SEC * 1000 > Date.now())
                return resolve()
            this.lastCheck = new Date();

            if (os.platform() === 'win32') {
                logger.warn('Process monitoring not supported on windows. Skipped')
                return resolve()
            }
            else if (!botName) // no next instance to check available
                return resolve()

            let bundleRoot = path.resolve(utils.appDir + '..' + path.sep + botName + path.sep)
            let options = null
            const child = exec("ps aux | grep -v grep | grep '" + bundleRoot + "' | grep -v '_manual' | grep -v 'child' | awk '{print $2}'", options, (err, stdout, stderr) => {
                if (err)
                    return reject(err)
                let processIds = stdout.toString().split("\n") // should only be 1 bot // should already be a string
                //let found = false;
                processIds.forEach((strPID) => {
                    if (strPID == '')
                        return
                    const PID = parseInt(strPID)
                    if (PID == process.pid)
                        return
                    //found = true;
                    this.lastPID = PID;
                    //this.lastProcessRunning = new Date();
                });
                // we now always check the API
                resolve();
            })
        })
    }

    protected checkApiAndRestart(botName: string) {
        return new Promise<void>((resolve, reject) => {
            if (this.lastCheckApi && this.lastCheckApi.getTime() + InstanceChecker.INSTANCE_CHECK_API_INTERVAL_SEC * 1000 > Date.now())
                return resolve()
            this.lastCheckApi = new Date();

            this.checkBotApiResponsive(botName).then((isResponsive) => {
                if (isResponsive === false) {
                    if (this.lastPID === 0) {
                        logger.warn("Bot %s API is unresponsive, but no PID to kill it is available", botName);
                        return resolve();
                    }
                    // TODO verify again that it's still running?
                    const msg = utils.sprintf("Killing possibly stuck process: PID %s, last response %s", this.lastPID, utils.test.getPassedTime(this.lastResponse.getTime()));
                    logger.warn(msg)
                    this.notifyBotError(botName, "is unresponsive", msg)
                    try {
                        process.kill(this.lastPID, "SIGKILL") // just kill it. bots get (re-)started by our bash script
                    }
                    catch (e) { // permission denied if we grep some wrong processes (or process doesn't exist)
                        if (e && e.code === "ESRCH") {
                            logger.warn("Process %s to kill doesn't exist aynmore", this.lastPID, e);
                            this.lastPID = 0;
                        }
                        else
                            logger.error('Error killing process with PID %s', this.lastPID, e)
                    }
                    this.copyBotLogfile(botName);
                }
                else {
                    logger.verbose("Bot %s with PID %s is running", botName, this.lastPID)
                    // store timestamp when bot was last running and also send notification
                    // checking modification timestamp of logfile doesn't mean bot is up (might crash on startup)
                    this.lastResponse = new Date();
                }
                resolve()
            }).catch((err) => {
                logger.error("Error checking if bot api is responsive", err)
                resolve()
            })
        })
    }

    protected isUpdaterRunning(botName: string) {
        return new Promise<boolean>((resolve, reject) => {
            // check if installer is running (updateProcess.js) and skip killing it
            let bundleRoot = path.resolve(utils.appDir + '..' + path.sep + botName + path.sep)
            let options = null
            const child = exec("ps aux | grep -v grep | grep '" + bundleRoot + "' | grep 'updateProcess.js' | awk '{print $2}'", options, (err, stdout, stderr) => {
                if (err) {
                    logger.error("Error checking if updater of bot %s is running", botName);
                    return resolve(false); // assume no
                }
                let processIds = stdout.toString().split("\n") // should only be 1 bot // should already be a string
                let found = false;
                processIds.forEach((strPID) => {
                    if (strPID == '')
                        return
                    const PID = parseInt(strPID)
                    if (PID != process.pid)
                        found = true;
                });
                resolve(found);
            })
        })
    }

    public watchProcessesTerminating(botName: string) {
        // some processes might not terminate (especially phantomjs, chrome!)
        // ensure all processes are running one dir level above utils.appDir and are done when we are done with a loop in Controller
        // the phantomJS process will look like this: /usr/local/lib/node_modules/phantomjs/lib/phantom/bin/phantomjs --phantom_args /path/to/node/app.js
        // or in local module path if not installed globally
        // try to install phantomjs before on your dist and then the location.js after npm install will point to your OS version of phantomjs

        return new Promise<void>((resolve, reject) => {
            if (!botName) // no next instance to check available
                return resolve()
            if (os.platform() === 'win32') {
                logger.warn('Process monitoring not supported on windows. Skipped')
                return resolve()
            }

            let bundleRoot = path.resolve(utils.appDir + '..' + path.sep + botName + path.sep)
            let options = null
            // don't return grep or express processes (websites)
            // ensure it's a process started with silent flag (otherwise it's started manually)
            // ows workerProcess.js doesn't have that flag. exclude _manual (in directory)
            // we need maxProcessAge because we start WebInspector tasks and they run async
            const maxProcessAge = utils.date.dateAdd(new Date(), 'minute', -1*nconf.get('serverConfig:maxProcessRuntimeMin') || 20); // why was this undefined?
            const child = exec("ps aux | grep -v grep | grep '" + bundleRoot + "' | grep chrome | awk '{print $2}'", options, (err, stdout: string, stderr: string) => {
                if (err)
                    return reject(err)
                let processIds = stdout.split("\n")
                processIds.forEach((strPID) => {
                    if (strPID == '')
                        return
                    const PID = parseInt(strPID)
                    if (PID == process.pid)
                        return
                    utils.date.getElapsedUnixProcessTime(PID).then((elapsedTime) => {
                        if (!elapsedTime || elapsedTime.getTime() >= maxProcessAge.getTime())
                            return;
                        logger.warn('Killing possibly stuck process: PID %s - started %s ago', PID, utils.test.getPassedTime(elapsedTime.getTime()));
                        try {
                            process.kill(PID, "SIGKILL")
                        }
                        catch (e) { // permission denied if we grep some wrong processes
                            logger.error('Error killing process with PID %s', PID, e) // a phantomjs process of JD that closes slowly (if JD finishes last)
                        }
                    })
                })
                resolve()
            })
        })
    }

    protected checkLastRespnseTime(botName: string) {
        if (nconf.get("debug"))
            return; // don't send notification with local single debugging instance
        if (this.lastResponse.getTime() + nconf.get("serverConfig:assumeBotCrashedMin") * utils.constants.MINUTE_IN_SECONDS*1000 > Date.now())
            return;
        const msg = utils.sprintf("Last response: %s\nPort: %s", utils.test.getPassedTime(this.lastResponse.getTime()), this.lastPort);
        this.notifyBotError(botName, "is not starting", msg);
    }

    protected checkBotApiResponsive(botName: string) {
        return new Promise<boolean>((resolve, reject) => {
            this.getBotApiPort(botName).then((port) => {
                const apiUrl = "https://localhost:" + port + "/state/" // TODO also check uptime
                logger.verbose("Checking instance %s with URL: ", botName, apiUrl)
                this.lastPort = port;
                let data = {
                    apiKey: helper.getFirstApiKey(),
                }
                let reqOptions = {
                    skipCertificateCheck: true,
                    timeout: 5*1000 // in ms. default 10000 // require faster responses or else bot likely hangs
                }
                utils.postDataAsJson(apiUrl, data, (body, res) => {
                    if (body === false || this.checkBotUptime(botName, body) === false) {
                        // do a 2nd check to be sure
                        setTimeout(() => {
                            utils.postDataAsJson(apiUrl, data, (body, res) => {
                                if (body === false || this.checkBotUptime(botName, body) === false)
                                    return resolve(false)
                                resolve(true)
                            }, reqOptions)
                        }, nconf.get("serverConfig:instanceApiCheckRepeatingSec")*1000)
                        return
                    }
                    resolve(true)
                }, reqOptions)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    /**
     * Returns false if the json is invalid.
     * @param botName
     * @param statusJsonStr
     */
    protected checkBotUptime(botName: string, statusJsonStr: string): boolean {
        const json = utils.parseJson(statusJsonStr); // it's EJSON, but compatible
        if (json === null)
            return false;
        if (json.uptime > 0.0) {
            const runtimeH = Math.floor(json.runtime / utils.constants.HOUR_IN_SECONDS);
            if (runtimeH >= nconf.get("serverConfig:instanceRuntimeOkH"))
                this.lastOkRuntime = new Date();
            else if (this.lastOkRuntime.getTime() + nconf.get("serverConfig:notifyInstanceLowRuntimeH")*utils.constants.HOUR_IN_SECONDS*1000 < Date.now())
                this.notifyBotError(botName, "Bot has low uptime", utils.sprintf("Uptime %sh, last OK uptime %s", runtimeH, utils.test.getPassedTime(this.lastOkRuntime.getTime())));
        }
        return true; // JSON is valid
    }

    protected copyBotLogfile(botName: string) {
        return new Promise<void>((resolve, reject) => {
            const otherLogfile = path.join(utils.appDir, nconf.get("logfile")).replace(new RegExp(nconf.get("projectName") + "[0-9]+", "g"), botName);
            // copy it to our app dir. or better keep it in the other bots dir? but we might not have write permissions there
            const copyDest = path.join(utils.appDir, nconf.get("logfile")).replace(/\.log$/, "-" + botName + ".log");
            utils.file.copy(otherLogfile, copyDest).then(() => {
                logger.info("Copied logfile of killed instance to %s", copyDest)
                resolve()
            }).catch((err) => {
                logger.error("Error copying bot logfile of killed instance to %s", copyDest, err)
                resolve()
            })
        })
    }

    protected getBotApiPort(botName: string) {
        return new Promise<number>((resolve, reject) => {
            let collection = db.get().collection(Process.COLLECTION_NAME)
            // TODO better support for multiple hosts. but our kill command only works locally either way
            // sort by lastContact to get the most recent one
            collection.find({
                name: botName,
                hostname: os.hostname()
            }).sort({lastContact: -1}).limit(1).toArray().then((docs) => {
                if (!docs || docs.length === 0)
                    return reject({txt: "Bot to get api port not found in database", name: botName, hostname: os.hostname()})
                const doc = docs[0];
                if (!doc.apiPort)
                    return reject({txt: "ApiPort for bot not set in database", name: botName, hostname: os.hostname()})
                resolve(doc.apiPort)
            }).catch((err) => {
                reject(err);
            })
        })
    }

    protected notifyBotError(botName: string, title: string, message: string) {
        const pauseMs = nconf.get('serverConfig:notificationPauseMin') * utils.constants.MINUTE_IN_SECONDS * 1000;
        if (this.lastNotification && this.lastNotification.getTime() + pauseMs > Date.now()) // lastNotification per bot? we only monitor 1 instance per bot
            return;
        let headline = botName + " " + title;
        let notification = new Notification(headline, message, false);
        // TODO setting to always force a specific notification method (Pushover for admin notifications)
        this.notifier.send(notification).then(() => {
        }).catch((err) => {
            logger.error("Error sending %s notification", this.className, err)
        });
        this.lastNotification = new Date();
    }

}
