import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {TradeConfig} from "../Trade/TradeConfig";
import {ConfigRange, StringConfigRange, NumberConfigRange, BooleanConfigRange} from "./ConfigRange";
import * as _ from "lodash";

export class BackfindConfig /*extends TradeConfig*/ {
    protected static DELETE_PROPERTIES = ["parameterJson", "ranges", "rangeProduct", /*"rangePos", */"rangeCount", "rangeReferences"];
    public readonly name: string = "";
    public readonly configNr: number = 0;
    // properties are added dynamically and are the same as in TradeConfig
    // but we can't extend it because the types are different (and readonly -> only accessible in parent constructor)

    protected static nextConfigNr: number = 0;

    protected parameterJson: any;
    protected ranges: any[][] = [];
    protected rangeProduct: any[][] = null;
    protected rangePos = 0; // the current position of the inner array (our current values of rangeProduct)

    protected rangeCount = 0; // the total number of config ranges we have
    protected rangeReferences = new Map<number, ConfigRange<any>>(); // (rangeCount, instance)

    constructor(json: any, configName: string) {
        //super(json, configName);
        this.parameterJson = json;
        this.name = configName.replace(/\.json$/, "");
        this.addProperties(json, this);
        this.rangeProduct = utils.objects.cartesianProduct(this.ranges); // also needed for random selection within range

        this.configNr = ++BackfindConfig.nextConfigNr;
    }

    /**
     * Gets the next TradeConfig instance from the cartesian product of all specified config values.
     * @returns {TradeConfig}
     */
    public getNext(): TradeConfig {
        let i = this.rangePos;
        if (i >= this.rangeProduct.length)
            return null;
        this.rangePos++;
        let nextValues = this.rangeProduct[i];
        for (let u = 0; u < nextValues.length; u++) // update the next values to be set
        {
            this.rangeReferences.get(u).setCurrentValue(nextValues[u])
        }
        let instance = _.cloneDeep(this);
        this.setCurrentValues(instance);

        BackfindConfig.DELETE_PROPERTIES.forEach((prop) => {
            delete instance[prop]
        })
        return instance;
        //return instance; // instance of BackfindConfig has the same properties
        //let tradeConfig = new TradeConfig(JSON.parse(JSON.stringify(this)), this.name);
        //delete tradeConfig["markets"]; // they get added dynamically
    }

    /** Gets a new TradeConfig instance with random config parameters within the specified ranges.
     * @return {TradeConfig}
     */
    public getRandom(): TradeConfig {
        let nextValues = this.rangeProduct[0]; // just choose a range to start the random selection
        for (let u = 0; u < nextValues.length; u++) // update the next values to be set with random values
        {
            this.rangeReferences.get(u).setRandomValue()
        }
        let instance = _.cloneDeep(this);
        this.setCurrentValues(instance);

        BackfindConfig.DELETE_PROPERTIES.forEach((prop) => {
            delete instance[prop]
        })
        return instance;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected addProperties(json: any, addToRoot: any) {
        for (let prop in json)
        {
            let value = json[prop];
            if (Array.isArray(value) === false) {
                if (utils.objects.isObject(value)) {
                    addToRoot[prop] = {}
                    this.addProperties(value, addToRoot[prop]) // recursively add child props
                }
                else
                    addToRoot[prop] = value; // add scalar value
                continue;
            }

            // add the range property we want to test and find the best value for
            let range = ConfigRange.getRange(value);
            this.rangeReferences.set(this.rangeCount, range);
            this.ranges.push(range.values)
            addToRoot[prop] = range;
            this.rangeCount++;
        }
    }

    protected setCurrentValues(root: any) {
        for (let prop in root)
        {
            let value = root[prop];
            if (Array.isArray(value) === true)
                continue; // shouldn't happen here anymore, but arrays are objects in JS
            if (utils.objects.isObject(value)) {
                if (value.isConfigRange === true)
                    root[prop] = value.currentValue;
                else
                    this.setCurrentValues(value); // recursively set child values
            }
        }
    }
}