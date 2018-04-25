import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

interface MfiAction extends TechnicalStrategyAction {
    low: number;
    high: number;
}

/**
 * Strategy that emits buy/sell based on the MFI indicator.
 * http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:money_flow_index_mfi
 */
export default class MFI extends TechnicalStrategy {
    public action: MfiAction;

    constructor(options) {
        super(options)
        this.addIndicator("MFI", "MFI", this.action);
        this.addInfoFunction("low", () => {
            return this.action.low;
        });
        this.addInfoFunction("high", () => {
            return this.action.high;
        });
        this.addInfoFunction("interval", () => {
            return this.action.interval;
        });
        this.addInfoFunction("MFI", () => {
            return this.indicators.get("MFI").getValue();
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        let mfi = this.indicators.get("MFI")
        const value = mfi.getValue();
        // TODO check for this.action.thresholds.persistence, add a counter
        if (value > this.action.high) {
            this.log("UP trend detected, value", value)
            this.emitBuy(this.defaultWeight, "MFI value: " + value);
        }
        else if (value < this.action.low) {
            this.log("DOWN trend detected, value", value)
            this.emitSell(this.defaultWeight, "MFI value: " + value);
        }
        else
            this.log("no trend detected, value", value)
    }
}