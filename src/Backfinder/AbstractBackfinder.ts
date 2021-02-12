import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as childProcess from "child_process";
const fork = childProcess.fork;
import * as path from "path";
import * as fs from "fs";
import * as async from "async";
import {StringConfigRange, NumberConfigRange, BooleanConfigRange} from "./ConfigRange";
import {BackfindConfig} from "./BackfindConfig";
import {TradeConfig} from "../Trade/TradeConfig";
import {BotEvaluation} from "../Trade/PortfolioTrader";
import * as Heap from "qheap";
import {runInNewContext} from "vm";
//import {Backfinder} from "./Backfinder"; // circular dependency

const processFiles = [path.join(utils.appDir, 'app.js'),
    path.join(utils.appDir, 'build', 'app.js')]
const processFile = fs.existsSync(processFiles[0]) ? processFiles[0] : processFiles[1]

export type BackfindType = "CartesianProduct" | "Evolution";

export interface BackfinderResult {
    result: BotEvaluation;
    params: TradeConfig;
}

export interface BacktestQueueItem {
    configFilename: string;
    tradeConfig: TradeConfig;
    resolve: () => void;
    reject: (err: any) => void;
}

export interface BackfinderOptions {
    configFilename: string;
    walk?: boolean;
}

export abstract class AbstractBackfinder {
    protected className: string;
    protected configFilename: string;
    protected options: BackfinderOptions;
    protected errorState = false;
    protected configs: BackfindConfig[] = [];
    protected tradeConfigs: TradeConfig[] = [];
    protected currentTest = 0;
    protected runningBacktestInstances = 0;
    protected backtestQueue: BacktestQueueItem[] = [];
    protected results: Heap = this.getResultHeap();
    protected resultsMap = new Map<string, BackfinderResult>(); // (configFilename, result)
    protected previousConfigParams: TradeConfig[] = [];

    constructor(options: BackfinderOptions) {
        this.className = this.constructor.name;
        this.configFilename = options.configFilename;
        if (this.configFilename.substr(-5) !== ".json")
            this.configFilename += ".json";
        this.options = options;
        this.loadConfig();
    }

    public abstract run(): void;

    public static getInstance(configFilename: string, type: BackfindType, options?: BackfinderOptions): AbstractBackfinder {
        options.configFilename = configFilename;
        options.walk = nconf.get("serverConfig:backtest:walk")
        switch (type)
        {
            case "CartesianProduct":        return AbstractBackfinder.loadModule(path.join(__dirname, "Backfinder"), options);
            case "Evolution":               return AbstractBackfinder.loadModule(path.join(__dirname, "Evolution"), options);

        }
        return utils.test.assertUnreachableCode(type);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected forkBacktestProcess(configFilename: string, tradeConfig: TradeConfig) {
        return new Promise<void>((resolve, reject) => {
            this.runningBacktestInstances++;
            let processArgs = Object.assign([], process.execArgv)
            let dbg = false
            for (let i=0; i < processArgs.length; i++) {
                if (processArgs[i].substr(0,12) == "--debug-brk=") {
                    processArgs[i] = "--debug-brk=" + (nconf.get('debuggerPort') ? nconf.get('debuggerPort') : 43207)
                    dbg = true
                    //break
                }
            }
            let nodeArgs = process.argv.slice(2)
            nodeArgs.push('--trader=Backtester')
            let childConfig = path.basename(configFilename, ".json");
            nodeArgs = utils.proc.addChildProcessArgument(nodeArgs, "--config", childConfig)
            let env = Object.assign({}, process.env)
            env.IS_CHILD = true
            env.PARENT_PROCESS_ID = process.pid;
            env.BACKFINDER = true
            let options = {
                cwd: process.cwd(),
                env: env,
                execPath: process.execPath,
                execArgv: processArgs, // don't change anything on the process arguments. process get's restarted with same args below
                silent: false
                //stdio:
            }
            let child = fork(processFile, nodeArgs, options)
            let gotResults = false
            child.on('error', (err) => {
                reject(err)
            })
            child.on('exit', (code, signal) => {
                logger.info('Backfinder process exited with code %s - signal %s', code, signal)
                child = null
                if (gotResults)
                    resolve()
                else
                    reject('Backfinder process exited without sending results')
                this.onBacktestDone()
            })
            child.on('message', (message) => {
                this.onChildMessage(configFilename, tradeConfig, message)
                if (message.type === 'result')
                    gotResults = true
            })
            //child.unref(); // see also options.detached (default false, only for spawn?). but we kill the child explicitly on exit and don't wait for it

            if (dbg)
                debugger
            /* // child process starts immediately (bad for debugging, but we can debug it separately)
             child.send({
             updateStatsClassName: "foo",
             type: 'start'
             })
             */
        })
    }

    protected onChildMessage(configFilename: string, tradeConfig: TradeConfig, message: any) {
        switch (message.type)
        {
            case 'result':
                let result = message.result;
                logger.info('Received backfinder results from child: bot %s%, market %s%', result.botEfficiencyPercent, result.marketEfficiencyPercent)
                this.results.insert({result: result, output: path.basename(configFilename, ".json"), params: tradeConfig})
                this.resultsMap.set(configFilename, result)
                break;
            case 'error':
                logger.error('Backfinder child process error', message.error)
                break;

            case 'importTick':
            case 'tick':
            case 'autoImportNotSupported':
                // ignore these events in Backfinder
                break;

            default:
                if (message.type === undefined && message.cmd && message.cmd === 'log')
                    break; // child process logs
                logger.warn('Received unknown backfinder child message of type: %s', message.type)
        }
    }

    /**
     * Adds a backtest to be executed while respecting "maxParallelBacktests" setting. Same arguments and return value as forkBacktestProcess()
     * @param configFilename
     * @param tradeConfig
     * @returns {Promise<void>}
     */
    protected queueBacktest(configFilename: string, tradeConfig: TradeConfig) {
        if (this.runningBacktestInstances < nconf.get("maxParallelBacktests")) {
            return this.forkBacktestProcess(configFilename, tradeConfig)
        }
        return new Promise<void>((resolve, reject) => {
            this.backtestQueue.push({configFilename: configFilename, tradeConfig: tradeConfig, resolve: resolve, reject: reject})
        })
    }

    protected onBacktestDone() {
        this.runningBacktestInstances--;
        if (this.runningBacktestInstances >= nconf.get("maxParallelBacktests"))
            return; // shouldn't be possible here
        let next = this.backtestQueue.shift();
        if (!next)
            return;
        this.forkBacktestProcess(next.configFilename, next.tradeConfig).then(() => {
            next.resolve()
        }).catch((err) => {
            next.reject(err)
        })
    }

    protected writeBacktestConfig(filePath: string, nextConfig: TradeConfig) {
        return new Promise<string>((resolve, reject) => {
            let outConfig = {
                data: [nextConfig]
            }
            fs.writeFile(filePath, utils.stringifyBeautiful(outConfig), (err) => {
                if (err)
                    return reject({txt: "Error writing backtest config file", err: err})
                setTimeout(resolve.bind(this, filePath), 100) // otherwise reading fails sometimes with invalid JSON error
            })
        })
    }

    protected removeBacktestConfig(configFilename: string) {
        return new Promise<void>((resolve, reject) => {
            fs.unlink(configFilename, (err) => {
                if (err) { // file might not exist if we aborted too early
                    if (err.code === 'ENOENT')
                        return resolve()
                    return reject({txt: "Error removing backtest config file", err: err})
                }
                resolve()
            })
        })
    }

    protected writeResults(clear = true) {
        return new Promise<string>((resolve, reject) => {
            // write to main trades dir so the final result file is easier to find
            const filePath = path.join(utils.appDir, nconf.get("tradesDir"), nconf.get("backfindDir") + "-" + this.configFilename);
            // our heap is ordered by bot success
            let allResults = {data: []}
            //let resultsCopy = Object.assign(this.getResultHeap(), this.results) // copying doesn't work, both heaps get emtied
            let newHeap = this.getResultHeap();
            let result = this.results.remove();
            while (result)
            {
                allResults.data.push(result);
                newHeap.insert(result)
                result = this.results.remove();
            }
            if (clear)
                this.resultsMap.clear();
            else
                this.results = newHeap;
            logger.verbose("Saving result file to %s ...", filePath)
            fs.writeFile(filePath, utils.stringifyBeautiful(allResults), (err) => {
                if (err)
                    return reject({txt: "Error writing backtest results", err: err})
                resolve(filePath)
            })
        })
    }

    /**
     * Remove all log and html files from child processes. Useful if we run large backtests because otherwise we might run out of disk space.
     * The main logfile with the evaluated results of all instances will not be deleted.
     * @returns {Promise<void>}
     */
    protected cleanupResults() {
        return new Promise<void>((resolve, reject) => {
            let filePath = path.join(utils.appDir, nconf.get("tradesDir"), nconf.get("backfindDir"));
            utils.file.cleanupDir(filePath, 0).then(() => {
                resolve();
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected loadConfig() {
        const filePath = path.join(utils.appDir, "config", "backfind", this.configFilename)
        let data = fs.readFileSync(filePath, {encoding: "utf8"});
        if (!data) {
            logger.error("Can not load config file under: %s", filePath)
            return this.waitForRestart()
        }
        let json = utils.parseJson(data);
        if (!json || !json.data) {
            logger.error("Invalid JSON in config file: %s", filePath)
            return this.waitForRestart()
        }
        if (json.data.length > 1) // TODO increase limit? but takes long time either way and difficult to evaluate otherwise
            logger.error("WARNING: Config has %s entries. Currently backfinding is only supported with the first entry", json.data.length);
        json.data.forEach((conf) => {
            let config = new BackfindConfig(conf, this.configFilename);
            this.configs.push(config)
        })
    }

    protected loadPreviousParams() {
        return new Promise<void>((resolve, reject) => {
            const filePath = path.join(utils.appDir, nconf.get("tradesDir"), nconf.get("backfindDir") + "-" + this.configFilename);
            if (!fs.existsSync(filePath)) {
                logger.warn("No previous backfind params found at: %s", filePath)
                return resolve()
            }
            fs.access(filePath, fs.constants.W_OK, (err) => {
                if (err)
                    return reject({txt: "File with previous results is not writable. Unable to write results back", file: filePath, err: err})
                let data = fs.readFileSync(filePath, {encoding: "utf8"});
                let json = utils.parseJson(data);
                if (!json || !Array.isArray(json.data))
                    return reject({txt: "Error parsing json of previous backfind params", file: filePath})
                json.data.forEach((result) => {
                    this.previousConfigParams.push(result.params) // contains more parameters, but they will be ignored
                })
                logger.info("Loaded %s previous backfind params from: %s", this.previousConfigParams.length, filePath)
                resolve()
            })
        })
    }

    protected waitForRestart() {
        this.errorState = true;
        //process.exit(1) // don't exit or else we can't restart it via http API, backfinding will only be done locally (for now)
        logger.error("App entered error state. Please restart the app")
    }

    protected getResultHeap(): Heap {
        return new Heap({
            comparBefore(a: BackfinderResult, b: BackfinderResult) {
                return a.result.botVsMarketPercent > b.result.botVsMarketPercent; // higher numbers come first
            },
            compar(a: BackfinderResult, b: BackfinderResult) {
                return a.result.botVsMarketPercent > b.result.botVsMarketPercent ? -1 : 1;
            },
            freeSpace: false,
            size: 100
        });
    }

    protected static loadModule(modulePath: string, options = undefined) {
        try {
            let ModuleClass = require(modulePath)
            if (ModuleClass.default)
                ModuleClass = ModuleClass.default; // fix for typescript default exports
            let instance = new ModuleClass(options)
            return instance
        }
        catch (e) { // e.code === 'MODULE_NOT_FOUND'
            logger.error('failed to load module in %s: %s', __filename, modulePath, e)
            return null
        }
    }
}

// force loading dynamic imports for TypeScript
import "./Backfinder";
import "./Evolution";
//import "./ForexAnalytics";
