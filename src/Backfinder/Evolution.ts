import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as Genetic from "genetic-js";
import * as path from "path";
import {AbstractBackfinder, BackfinderOptions} from "./AbstractBackfinder";
import {TradeConfig} from "../Trade/TradeConfig";
import * as _ from "lodash";

// alternative upcoming library: https://github.com/jayhardee9/darwin-js

// TODO combine boolean decision tree with genetic algorithm to select strategies. see ForexAnalysis source.
// although increasing values of a strategy towards infinity should be the same as disabling it

// TODO implement test class for Walk Forward Analysis: run on multiple overlapping periods [optimizing, testing] (also for Backfinder)
// http://www.easyexpertforex.com/walk-forward-analysis.html

// TODO trend partitioner class: divide training data into up, down (and side) market. then train for optimal parameters on each class separately

// TODO random start offset per generation (or per config instance?) to prevent over optimizing for a specific time period

export default class Evolution extends AbstractBackfinder {
    protected genetic = Genetic.create();

    constructor(options: BackfinderOptions) {
        super(options)
    }

    public run() {
        // TODO make sure candle data is cached before starting
        let loadPreviousParams = Promise.resolve()
        if (this.options.walk)
            loadPreviousParams = this.loadPreviousParams();
        loadPreviousParams.then(() => {
            this.solve()
        }).catch((err) => {
            logger.error("Error starting %s", this.className, err)
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected solve() {
        let config = this.configs[0];
        this.genetic.optimize = Genetic.Optimize.Maximize; // alternative to optimize(fitness, fitness)
        this.genetic.select1 = Genetic.Select1.Tournament2;
        this.genetic.select2 = Genetic.Select2.Tournament2;
        const that = this;

        this.genetic.seed = function() {
            /*
            function randomString(len) {
                var text = "";
                var charset = "abcdefghijklmnopqrstuvwxyz0123456789";
                for(var i=0;i<len;i++)
                    text += charset.charAt(Math.floor(Math.random() * charset.length));
                let nextConfig = config.getRandom();
                return text;
            }

            // create random strings that are equal in length to solution
            return randomString(this.userData["solution"].length);
            */
            if (that.previousConfigParams.length !== 0)
                return that.previousConfigParams.shift();
            let nextConfig = config.getRandom();
            return nextConfig;
        };

        this.genetic.mutate = function(entity) {
            /*
            function replaceAt(str, index, character) {
                return str.substr(0, index) + character + str.substr(index+character.length);
            }
            // chromosomal drift
            var i = Math.floor(Math.random()*entity.length)
            return replaceAt(entity, i, String.fromCharCode(entity.charCodeAt(i) + (Math.floor(Math.random()*2) ? 1 : -1)));
            */
            // optional. we can just create a new random config for now and pick 1 of its strategies.
            // mutation is important to add new config varieties
            let nextConfig = config.getRandom();
            let strategyNames = Object.keys(nextConfig["strategies"]);
            let strategyCount = strategyNames.length;
            // higher mutation probability for main (first) strategy
            let randomStrategyName = strategyNames[utils.getRandomInt(0, strategyCount)];
            if (utils.getRandomInt(1, 1001) <= this.configuration.mutationPrimaryStrategyProbability*10)
                randomStrategyName = strategyNames[0];
            entity.strategies[randomStrategyName] = nextConfig["strategies"][randomStrategyName]
            return entity;
        };

        this.genetic.crossover = function(mother, father) {
            /*
            // two-point crossover
            var len = mother.length;
            var ca = Math.floor(Math.random()*len);
            var cb = Math.floor(Math.random()*len);
            if (ca > cb) {
                var tmp = cb;
                cb = ca;
                ca = tmp;
            }

            var son = father.substr(0,ca) + mother.substr(ca, cb-ca) + father.substr(cb);
            var daughter = mother.substr(0,ca) + father.substr(ca, cb-ca) + mother.substr(cb);

            return [son, daughter];
            */
            // create 2 children by switching strategies
            // TODO implement range-changes for every strategy. then we can also implement mutate()
            // switching strategies might be bad because in general:
            // longer candle size -> higher stop loss
            // shorter candle size -> smaller stop loss
            let daughter = _.cloneDeep(mother);
            let son = _.cloneDeep(father);
            for (let stragegyName in mother.strategies)
            {
                //let temp = mother.strategies[stragegyName];
                if (utils.getRandomInt(0, 2) === 0)
                    daughter.strategies[stragegyName] = father.strategies[stragegyName];
                if (utils.getRandomInt(0, 2) === 0)
                    son.strategies[stragegyName] = mother.strategies[stragegyName];
            }
            return [son, daughter];
        };

        this.genetic.fitness = function(entity) {
            /*
            // gets called size (population size) times and then waits until all calls are done
            var fitness = 0;

            var i;
            for (i=0;i<entity.length;++i) {
                // increase fitness for each character that matches
                if (entity[i] == this.userData["solution"][i])
                    fitness += 1;

                // award fractions of a point as we get warmer
                fitness += (127-Math.abs(entity.charCodeAt(i) - this.userData["solution"].charCodeAt(i)))/50;
            }
            //return fitness;
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    resolve(fitness)
                }, utils.getRandomInt(0, 2))
            })
            */
            return new Promise<number>((resolve, reject) => {
                const tradeConfig: TradeConfig = entity;
                const configFilename = path.join(utils.appDir, "config", "BF-" + tradeConfig.name + "-" + tradeConfig.configNr + "-" + that.currentTest + ".json");
                that.currentTest++;
                that.writeBacktestConfig(configFilename, tradeConfig).then(() => {
                    logger.info("Forking Evolution process")
                    return that.queueBacktest(configFilename, tradeConfig)
                }).then(() => {
                    logger.info("Evolution process has finished")
                    let result = that.resultsMap.get(configFilename)
                    let fitness = result && result["currentBaseEquivalent"] ? result["currentBaseEquivalent"] : 0; // or use botVsMarketPercent?
                    setTimeout(resolve.bind(this, fitness), 1000 + utils.getRandomInt(10, 1000)) // give them a delay to prevent writing the same cookies file
                }).catch((err) => {
                    logger.error("Evolution child process error", err)
                    resolve(0) // continue with other children
                }).then(() => { // always remove the temp config file
                    if (nconf.get("evolutionDeleteTradeFiles"))
                        that.cleanupResults();
                    return that.removeBacktestConfig(configFilename)
                })
            })
        };

        /*
        this.genetic.generation = function(pop, generation, stats) {
            // stop running once we've reached the solution
            return pop[0].entity != this.userData["solution"];
        };
        */

        this.genetic.notification = function(pop, generation, stats, isFinished) {
            /*
            function lerp(a, b, p) {
                return a + (b-a)*p;
            }
            var value = pop[0].entity;
            this.last = this.last||value;
            if (pop != 0 && value == this.last)
                return;

            var solution = [];
            var i;
            for (i=0;i<value.length;++i) {
                var diff = value.charCodeAt(i) - this.last.charCodeAt(i);
                var style = "background: transparent;";
                if (diff > 0) {
                    style = "background: rgb(0,200,50); color: #fff;";
                } else if (diff < 0) {
                    style = "background: rgb(0,100,50); color: #fff;";
                }
                //solution.push("<span style=\"" + style + "\">" + value[i] + "</span>");
                solution.push(value[i]);
            }
            var buf = "";
            buf += "generation: " + generation + ", best fitness: " + pop[0].fitness.toPrecision(5) + " - " + solution.join("");
            //$("#results tbody").prepend(buf);
            console.log(buf)

            this.last = value;
            */

            // print state
            if (pop.length === 0)
                return;
            let best = pop[0].entity;
            this.last = this.last || best;
            if (/*pop != 0 && */best === this.last)
                return;
            // generation == iteration
            logger.info("generation: %s, best fitness: %s", generation, pop[0].fitness.toPrecision(5))
            this.last = best;

            // write results file (in case we abort early)
            that.writeResults(false).then((filePath) => {
                if (nconf.get("evolutionDeleteTradeFiles"))
                    that.cleanupResults();
                if (this.configuration.iterations > generation)
                    return logger.info("Temp results have been written to disk: %s", filePath)
                logger.info("Final results have been written to disk: %s", filePath)
                setTimeout(process.exit.bind(this, 0), 1000)
            }).catch((err) => {
                logger.error("Error writing backfinder results", err)
            })
        };

        let geneticConfig = { // available as this.configuration in genetic functions
            //iterations: 4000,
            iterations: 10,
            fittestAlwaysSurvives: false, // true causes endless repeat if 2 strategies are equally fitting (and we don't implement mutation)
            size: 850, // population size: first generation will start with 2x this value (mother + father). total results will be iterations*size
            crossover: 0.35, // // probability [0.0, 1.0]
            // 0.2 // try out more different values to prevent most top strategies having the same settings. though this might make conversion harder
            mutation: 0.5, // probability [0.0, 1.0]
            maxResults: 100, // per notification
            webWorkers: false,
            skip: 1, // notification frequency // has to be 1 to store results in the end (there is no end callback?)
            // trading config
            mutationPrimaryStrategyProbability: 80.0
        };
        let userData = { // available as this.userData in genetic functions
            //"solution": $("#quote").val()
            //solution: "Hello Backfinder Evolution"
        };
        this.genetic.evolve(geneticConfig, userData);
    }
}