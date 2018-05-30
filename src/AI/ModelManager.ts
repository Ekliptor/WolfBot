import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as path from "path";
import * as fs from "fs";
import {Brain, PredictionCurrencyData} from "./Brain";
import {BrainConfig} from "./BrainConfig";
import {BudFox, CombinedCurrencyData} from "./BudFox";
import {Architect, Layer, Network, Neuron, Trainer} from "synaptic";

export class ModelManager {
    protected config: BrainConfig;
    protected budFox: BudFox;

    constructor(config: BrainConfig, budFox: BudFox) {
        this.config = config;
        this.budFox = budFox;
    }

    public saveModel(network: Network) {
        return new Promise<void>((resolve, reject) => {
            const modelPath = path.join(utils.appDir, "models", this.config.name + ".json")
            const json = JSON.stringify(this.serialize(network))
            fs.writeFile(modelPath, json, {encoding: "utf8"}, (err) => {
                if (err)
                    return reject({txt: "Error storing model", err: err})
                resolve()
            })
        })
    }

    public loadModel() {
        return new Promise<Network>((resolve, reject) => {
            const modelPath = path.join(utils.appDir, "models", this.config.name + ".json")
            fs.readFile(modelPath, {encoding: "utf8"}, (err, data) => {
                if (err)
                    return reject({txt: "Error loading model", err: err})
                let networkData = utils.parseJson(data);
                if (!networkData)
                    return reject({txt: "Invalid JSON in stored network"})
                let network = this.unserialize(networkData)
                resolve(network)
            })
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected serialize(network: Network): any {
        let json = network.toJSON() // toJson() returns a serializable object
        json.budFox = {
            minPrice: this.budFox.getMinPrice(),
            maxPrice: this.budFox.getMaxPrice()
        }
        return json;
    }

    protected unserialize(json: any): Network {
        if (json.budFox) {
            this.budFox.setMinPrice(json.budFox.minPrice);
            this.budFox.setMaxPrice(json.budFox.maxPrice);
            delete json.budFox;
        }
        let network = Network.fromJSON(json)
        return network;
    }
}