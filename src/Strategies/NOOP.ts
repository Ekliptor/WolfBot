import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

interface NOOPAction extends TechnicalStrategyAction {
    sample: string;
}

/**
 * This strategy does nothing. It is just a sample and placeholder.
 */
export default class NOOP extends TechnicalStrategy {
    public action: NOOPAction;

    constructor(options) {
        super(options)
        this.addInfoFunction("sample", () => {
            return this.action.sample;
        });
    }

    public getMinWarumCandles() {
        return 0; // ensure we don't start any trade imports with this strategy
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        // this strategy does nothing
    }
}
