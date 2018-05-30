import * as utils from '@ekliptor/apputils';
const logger = utils.logger
const nconf = utils.nconf
import * as fs from "fs";
import * as path from "path";

export default class AbstractController {
    private processTimerID: NodeJS.Timer;

    constructor() {
    }

    scheduleProcessRepeating() {
        let nextTick = /*nconf.get('server:processIntervalBaseSec') +*/
            nconf.get('serverConfig:processIntervalBaseSec') + utils.getRandomInt(0, nconf.get('serverConfig:processIntervalRandomSec'))
        clearTimeout(this.processTimerID)
        this.processTimerID = setTimeout(() => {
            this.process((scheduleAgain) => {
                if (scheduleAgain !== false)
                    this.scheduleProcessRepeating()
            })
        }, nextTick * 1000)
    }

    stopProcessTimer() {
        clearTimeout(this.processTimerID)
    }

    protected process(cb) {
        throw new Error("AbstractController process() has to be implemented in subclass")
    }

    protected ensureTempDir() {
        return new Promise<void>((resolve, reject) => {
            if (process.env.IS_CHILD)
                return resolve(); // avoid conflicting disk ops
            let tempDir = path.join(utils.appDir, nconf.get('tempDir'))
            nconf.set('fullTempDir', tempDir)
            fs.stat(tempDir, (err, stats) => {
                let mkdir = () => {
                    fs.mkdir(tempDir, (err) => {
                        if (err)
                            reject(err)
                        resolve()
                    })
                }
                if (err) {
                    if (err.code === 'ENOENT')
                        return mkdir()
                    return logger.error("Error getting temp dir", err);
                }
                if (!stats.isDirectory())
                    return mkdir()
                // clean everything from the last session. use a value > candleSize to keep the state even on multiple crashes
                this.cleanupDir(tempDir, /*1*/nconf.get("serverConfig:restoreStateMaxAgeMin")).then(() => {
                    resolve()
                })
            })
        })
    }

    protected cleanupDir(dirPath, maxAgeMin) {
        return new Promise((resolve, reject) => {
            fs.readdir(dirPath, (err, files) => {
                if (err) {
                    if (err.code === 'ENOENT')
                        return fs.mkdir(dirPath, (err) => {
                            if (err)
                                logger.error('Error creating temp dir', err)
                        })
                    return logger.error('Error cleaning temp dir', err)
                }
                let cleanups = []
                let maxAge = new Date().getTime() - maxAgeMin * 60 * 1000
                files.forEach((file) => {
                    cleanups.push(new Promise((resolve, reject) => {
                        let filePath = path.join(dirPath, file)
                        fs.lstat(filePath, (err, stats) => {
                            if (err) {
                                logger.error(err.toString())
                                return resolve() // continue
                            }
                            let created = new Date(stats.ctime)
                            // only delete root files. other parts of this app might write different things in here
                            if (stats.isFile() && created.getTime() < maxAge) {
                                fs.unlink(filePath, (err) => {
                                    if (err)
                                        logger.error(err.toString())
                                })
                            }
                            resolve()
                        })
                    }))
                })
                Promise.all(cleanups).then(() => {
                    resolve()
                }).catch((err) => {
                    logger.error('Error cleaning up temp dir', err)
                    resolve() // continue cleaning
                })
            })
        })
    }
}