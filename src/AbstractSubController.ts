import * as utils from "@ekliptor/apputils";
const logger = utils.logger
const nconf = utils.nconf
import * as fs from "fs";
import * as path from "path";

export abstract class AbstractSubController {
    protected readonly className: string;

    constructor() {
        this.className = this.constructor.name;
    }

    public getClassName() {
        return this.className;
    }

    public abstract process(): Promise<void>;

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

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

    protected ensureDir(rootStr: string, subPathArr: string[]) {
        return new Promise<void>((resolve, reject) => {
            if (!rootStr)
                return reject({txt: 'Invalid root dir to ensure', path: rootStr})
            fs.stat(rootStr, (err, stats) => { // follow symlinks
                if (err)
                    return reject({txt: 'Error accessing root dir to ensure', path: rootStr}) // this dir has to exist. we might not have permissions outside our app
                else if (!stats.isDirectory())
                    return reject({txt: 'Root dir is not a directory', stats: stats})

                // create sub dir paths if they don't exist
                let ensureNextDir = (i) => {
                    if (i >= subPathArr.length)
                        return resolve() // all dirs exist
                    i++;
                    const nextDir = path.join(rootStr, ...subPathArr.slice(0, i))
                    fs.lstat(nextDir, (err, stats) => { // no symlinks to break out of our app scope
                        if (err) {
                            if (err.code === 'ENOENT') {
                                fs.mkdir(nextDir, (err) => {
                                    if (err)
                                        return reject({txt: 'Error creating dir to ensure', err: err})
                                    ensureNextDir(i)
                                })
                                return
                            }
                            else
                                return reject({txt: 'Error checking subdirs of dir to ensure', err: err})
                        }
                        if (!stats.isDirectory())
                            return reject({txt: 'Subdir is not a directory', stats: stats})
                        ensureNextDir(i)
                    })
                }
                ensureNextDir(0)
            })
        })
    }

    protected getAggregateOpts() {
        return {
            maxTimeMS: nconf.get("mongoTimeoutSec") * 1000,
            allowDiskUse: true
        }
    }
}
