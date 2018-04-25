// node --use_strict --max-old-space-size=3096 backfind.js
// parameters: --debug (debug, otherwise use config value)
// --config: the name of the AI config file under /config/machine-learning/ to run find the optimal parameters
// --train: train the network on history data
// --predict: predict prices in live mode

// file has been merged with app.js because we need a webserver to show our live price prediction from AI
/*
require('source-map-support').install();
import * as utils from "@ekliptor/apputils";
const nconf = utils.nconf
const logger = require('./src/utils/Logger')
const argv = require('minimist')(process.argv.slice(2))
if (argv.debug === true)
    nconf.set('debug', true)
import {Brain} from "./src/AI/Brain";


nconf.set("ai", true);
let brain = new Brain(argv.config);
if (argv.train)
    brain.train();
*/