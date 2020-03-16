import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {controller as Controller} from '../src/Controller';
import {Currency} from "@ekliptor/bit-models";
import * as fs from "fs";
import * as path from "path";
import {ExchangeRates} from "../src/Fiat/ExchangeRates";

let testFiatRates = async () => {
    let rates = new ExchangeRates();
    let usdThb = await rates.getRate("USD", "THB");
    console.log("USD THB RATE", usdThb)
    let usdThb2 = await rates.getRate("USD", "THB");
    console.log("USD THB RATE", usdThb2)
    console.log("CACHED RATE", rates.getRateFromCache("USD", "THB"))

    console.log("convert 500 USD", await rates.convert("USD", "THB", 500))
}

Controller.loadServerConfig(() => {
    testFiatRates()
})
