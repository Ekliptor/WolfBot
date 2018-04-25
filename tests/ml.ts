import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {controller as Controller} from '../src/Controller';
import {AbstractExchange, ExchangeMap} from "../src/Exchanges/AbstractExchange";
import Poloniex from "../src/Exchanges/Poloniex";
import HistoryDataExchange from "../src/Exchanges/HistoryDataExchange";
import {Brain} from "../src/AI/Brain";
import {Currency} from "@ekliptor/bit-models";

let testNeuralNetwork = () => {
    Brain.firstStart(false)
    let brain = new Brain("PricePrediction", new ExchangeMap())
    setTimeout(() => {
        let numArr = [0.000016498617169439446,0.00001647762185184661,4.528378522713239e-7,6.181237532691308e-7,0.000019397234588602586,0.000020604592728351157,0.0000023263430101535336,0.00000245957377248064,0.49670727389343994,0.49679797798271147,0.029236433193896086,0.029201786334254135,0.005742023997510276,0.005975411575602261,0.03347001114976983,0.0351528939870053,0.008438621294833007,0.008688804845068935]
        brain.predict(numArr, false).then((prediction) => {
            console.log(prediction)
        })
    }, 500)
}

Controller.loadServerConfig(() => {
    utils.file.touch(AbstractExchange.cookieFileName).then(() => {
        testNeuralNetwork()
    })
})