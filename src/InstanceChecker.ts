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


export default class InstanceChecker extends AbstractSubController {
    public static readonly INSTANCE_CHECK_INTERVAL_SEC = 300; // must be >= 5min (time the cron will restart crashed bots)

    protected lastCheck: Date = null;
    protected notifier: AbstractNotification;
    protected lastNotification: Date = null;

    constructor() {
        super()
        //this.lastCheck = new Date(); // set checked on start because all bots might just be starting (system startup)
        this.notifier = AbstractNotification.getInstance();
    }

    public process() {
        return new Promise<void>((resolve, reject) => {
            if (!nconf.get('serverConfig:checkInstances') || nconf.get('trader') === "Backtester"/*nconf.get('trader') !== "RealTimeTrader"*/ || process.env.IS_CHILD)
                return resolve();

            this.checkInstances().then(() => {
                resolve()
            }).catch((err) => {
                logger.error("Error checking bot instances", err)
                resolve() // continue
            })
        })
    }

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
            if (this.lastCheck && this.lastCheck.getTime() + InstanceChecker.INSTANCE_CHECK_INTERVAL_SEC * 1000 > Date.now())
                return resolve()

            let name = this.getNextInstanceName()
            this.checkInstanceRunning(name).then(() => {
                this.lastCheck = new Date();
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected getNextInstanceName() {
        let name = InstanceChecker.getOwnInstanceName()
        if (!name || name.match(/[0-9]+$/) === null) {
            if (!nconf.get("debug"))
                logger.warn("Unable to get next instance to monitor bots. Dir path: %s", utils.appDir)
            return "";
        }
        name = name.replace(/[0-9]+$/, (substring) => {
            let cur = parseInt(substring);
            cur++;
            if (cur > nconf.get("serverConfig:instanceCount"))
                cur = 1;
            return cur.toString();
        })
        logger.verbose("Next instance name to check: %s", name)
        return name;
    }

    protected checkInstanceRunning(botName: string) {
        return new Promise<void>((resolve, reject) => {
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
                let processIds = stdout.split("\n") // should only be 1 bot
                processIds.forEach((strPID) => {
                    if (strPID == '')
                        return
                    const PID = parseInt(strPID)
                    if (PID == process.pid)
                        return

                    this.checkBotApiResponsive(botName).then((isResponsive) => {
                        if (isResponsive === false) {
                            // TODO verify again that it's still running?
                            const msg = 'Killing possibly stuck process: PID ' + PID;
                            logger.warn(msg)
                            this.notifyBotKill(botName, msg)
                            try {
                                process.kill(PID, "SIGKILL") // just kill it. bots get (re-)started by our bash script
                            }
                            catch (e) { // permission denied if we grep some wrong processes
                                logger.error('Error killing process with PID %s', PID, e)
                            }
                            this.copyBotLogfile(botName);
                        }
                        else
                            logger.verbose("Bot %s with PID %s is running", botName, PID)
                        resolve()
                        // TODO also check modification timestamp of logfile to decide if bot is running
                    }).catch((err) => {
                        logger.error("Error checking if bot api is responsive", err)
                        resolve()
                    })
                })
            })
        })
    }

    protected checkBotApiResponsive(botName: string) {
        return new Promise<boolean>((resolve, reject) => {
            this.getBotApiPort(botName).then((port) => {
                const apiUrl = "https://localhost:" + port + "/state/"
                logger.verbose("Checking instance %s with URL: ", botName, apiUrl)
                let data = {apiKey: helper.getFirstApiKey()}
                let reqOptions = {skipCertificateCheck: true}
                utils.postDataAsJson(apiUrl, data, (body, res) => {
                    if (body === false || !utils.parseJson(body)) { // it's EJSON, but compatible
                        // do a 2nd check to be sure
                        setTimeout(() => {
                            utils.postDataAsJson(apiUrl, data, (body, res) => {
                                if (body === false || !utils.parseJson(body))
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
            collection.findOne({
                name: botName,
                hostname: os.hostname() // TODO better support for multiple hosts. but our kill command only works locally either way
            }).then((doc) => {
                if (!doc)
                    return reject({txt: "Bot to get api port not found in database", name: botName, hostname: os.hostname()})
                else if (!doc.apiPort)
                    return reject({txt: "ApiPort for bot not set in database", name: botName, hostname: os.hostname()})
                resolve(doc.apiPort)
            }).catch((err) => {
                reject(err);
            })
        })
    }

    protected notifyBotKill(botName: string, message: string) {
        const pauseMs = nconf.get('serverConfig:notificationPauseMin') * utils.constants.MINUTE_IN_SECONDS * 1000;
        if (this.lastNotification && this.lastNotification.getTime() + pauseMs > Date.now()) // TODO lastNotification per bot?
            return;
        let headline = botName + " is unresponsive";
        let notification = new Notification(headline, message, false);
        this.notifier.send(notification).then(() => {
        }).catch((err) => {
            logger.error("Error sending %s notification", this.className, err)
        });
        this.lastNotification = new Date();
    }

}