import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as childProcess from "child_process";
const fork = childProcess.fork;
import * as path from "path";
import * as fs from "fs";
import * as async from "async";
import {AbstractBackfinder, BackfinderOptions} from "./AbstractBackfinder";
import {StringConfigRange, NumberConfigRange, BooleanConfigRange} from "./ConfigRange";
import {BackfindConfig} from "./BackfindConfig";
import {TradeConfig} from "../Trade/TradeConfig";
import {BotEvaluation} from "../Trade/PortfolioTrader";
import * as Heap from "qheap";

/**
 * Find the optimal parameters for a set of strategies by trying out all specified values.
 */
export default class Backfinder extends AbstractBackfinder {

    constructor(options: BackfinderOptions) {
        super(options)
    }

    public run() {
        let config = this.configs[0];
        let backtests = []
        let nextConfig = config.getNext();
        let done = 0;
        while (nextConfig != null)
        {
            this.tradeConfigs.push(nextConfig)
            backtests.push((resolve) => {
                let tradeConfig = this.tradeConfigs[this.currentTest]; // cache it, it will get incremented
                const configFilename = path.join(utils.appDir, "config", "BF-" + tradeConfig.name + "-" + tradeConfig.configNr + "-" + this.currentTest + ".json");
                this.currentTest++;
                this.writeBacktestConfig(configFilename, tradeConfig).then(() => {
                    return this.forkBacktestProcess(configFilename, tradeConfig)
                }).then(() => {
                    done++;
                    logger.info("Backfinder progress: %s/%s runs done", done, backtests.length)
                    setTimeout(resolve.bind(this), 1000 + utils.getRandomInt(10, 1000)) // give them a delay to prevent writing the same cookies file
                }).catch((err) => {
                    logger.error("Backfinder child process error", err)
                    resolve() // continue with other children
                }).then(() => { // always remove the temp config file
                    return this.removeBacktestConfig(configFilename)
                })
            });
            nextConfig = config.getNext();
        }
        const now = utils.getCurrentTick()
        logger.info("Starting backfinder child processes for %s config permutations (max %s parallel)", backtests.length, nconf.get("maxParallelBacktests"))
        async.parallelLimit(backtests, nconf.get("maxParallelBacktests"), (err, results: Array<void>) => {
            if (err) { // shouldn't be reached
                logger.error("Error running Backfinder")
                utils.test.dumpError(err, logger)
                return
            }
            this.writeResults().then((filePath) => {
                let totalTime = utils.test.getPassedTime(now)
                logger.info("Backfinder has finished in %s. Results have been written to disk: %s", totalTime, filePath)
                setTimeout(process.exit.bind(this, 0), 1000)
            }).catch((err) => {
                logger.error("Error writing backfinder results", err)
            })
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}