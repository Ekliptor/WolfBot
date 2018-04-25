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
 * Strategy that emits buy/sell based on the MFI indicator.
 * http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:money_flow_index_mfi
 */
export default class NOOP extends TechnicalStrategy {
    public action: NOOPAction;

    constructor(options) {
        super(options)
        this.addInfoFunction("sample", () => {
            return this.action.sample;
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        // this strategy does nothing
    }
}