import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

interface CciAction extends TechnicalStrategyAction {
    low: number; // -100
    high: number; // 100
    closeShort: number; // default 0
    closeLong: number; // default 0
    interval: number; // default 20
}

/**
 * Strategy that emits buy/sell based on the CCI indicator.
 * We go long on high and short on low.
 * Optionally you can provide CCI values to where to close the long/short position (default 0).
 */
export default class CCI extends TechnicalStrategy {
    public action: CciAction;
    protected lastCCI: number = -1; // identical ro OBV because it's updated on every candle tick
    protected secondLastCCI: number = -1;

    constructor(options) {
        super(options)
        if (typeof this.action.closeShort !== "number")
            this.action.closeShort = 0;
        if (typeof this.action.closeLong !== "number")
            this.action.closeLong = 0;
        if (typeof this.action.interval !== "number")
            this.action.interval = 20;
        this.addIndicator("CCI", "CCI", this.action);

        this.addInfo("secondLastCCI", "secondLastCCI");
        this.addInfoFunction("CCI", () => {
            return this.indicators.get("CCI").getValue();
        });
        this.saveState = true;
    }

    public serialize() {
        let state = super.serialize();
        state.lastCCI = this.lastCCI;
        state.secondLastCCI = this.secondLastCCI;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.lastCCI = state.lastCCI;
        this.secondLastCCI = state.secondLastCCI;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        let cci = this.indicators.get("CCI")
        const value = cci.getValue();
        const valueFormatted = Math.round(value * 100) / 100.0;
        this.secondLastCCI = this.lastCCI;
        if (this.strategyPosition !== "none") {
            if (this.strategyPosition === "long" && value < this.action.closeLong)
                this.emitClose(this.defaultWeight, "closing long at CCI value: " + valueFormatted);
            else if (this.strategyPosition === "short" && value > this.action.closeShort)
                this.emitClose(this.defaultWeight, "closing short at CCI value: " + valueFormatted);
            this.lastCCI = value;
            return;
        }

        // TODO look for bullish/bearish divergences (hitting low/high twice) to signal a trend reversal

        if (value > this.action.high) {
            this.log("UP trend detected, value", valueFormatted)
            this.emitBuy(this.defaultWeight, "CCI value: " + valueFormatted);
        }
        else if (value < this.action.low) {
            this.log("DOWN trend detected, value", valueFormatted)
            this.emitSell(this.defaultWeight, "CCI value: " + valueFormatted);
        }
        else
            this.log("no trend detected, value", valueFormatted)

        this.lastCCI = value;
    }
}