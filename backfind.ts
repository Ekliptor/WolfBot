// node --use_strict --max-old-space-size=3096 backfind.js
// parameters: --debug (debug, otherwise use config value)
// --config: the name of the backfind config file under /config/backfind/ to run find the optimal parameters

// Genetic Algorithm (Evolution) config
// --config: // TODO
// --evolution: run the genetic algorithm to find optimal strategy parameters

require('source-map-support').install();
import * as utils from "@ekliptor/apputils";
const nconf = utils.nconf
const logger = require('./src/utils/Logger')
const argv = require('minimist')(process.argv.slice(2))
if (argv.debug === true)
    nconf.set('debug', true)
import {controller as Controller} from './src/Controller';
import {AbstractBackfinder} from "./src/Backfinder/AbstractBackfinder";


Controller.start(null, false).then(() => {
    setTimeout(() => { // ensure we are connected
        Controller.loadServerConfig(() => {
            let options: any = {}
            //if (argv.walk)
                //options.walk = true;
            let finder = AbstractBackfinder.getInstance(argv.config, argv.evolution == true ? "Evolution" : "CartesianProduct", options);
            finder.run();
        })
    }, 500)
})

// TODO after we have optimized our strategy paremters with the method above:
// feed as many indicators as possible into a neural network as input. train for the output
// if the NEXT candle went up or down