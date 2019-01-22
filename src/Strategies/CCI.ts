import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {
    AbstractMomentumIndicatorMode,
} from "./AbstractMomentumIndicatorStrategy";

interface CciAction extends TechnicalStrategyAction  {
    low: number; // -100 // Open a short position after CCI goes below this value.
    high: number; // 100 // Open a long position after CCI goes above this value.
    closePosition: boolean; // optional, default false - Close a position when reaching closeShort or closeLong values.
    closeShort: number; // default 0 // Close a short position after CCI goes above this value.
    closeLong: number; // default 0 // Close a long position after CCI goes below this value.
    interval: number; // default 20 // The number of candles of the SMA for the CCI average price calculation.
    mode: AbstractMomentumIndicatorMode; // default 'trend' // If set to 'trend' this strategy goes long on 'high' and short on 'low'. If set to 'reversal' it goes short on 'high' and long on 'low'.
    // The reversal mode works better with larger candles (>1h). Values: trend|reversal
}

/**
 * Strategy that emits buy/sell based on the CCI indicator.
 * We go long on CCI high and short on CCI low.
 * Optionally you can provide CCI values to where to close the long/short position (default 0).
 */
export default class CCI extends TechnicalStrategy {
    public action: CciAction;
    protected lastCCI: number = -1; // identical ro OBV because it's updated on every candle tick
    protected secondLastCCI: number = -1;

    constructor(options) {
        super(options)
        if (typeof this.action.closePosition !== "boolean")
            this.action.closePosition = false;
        if (typeof this.action.closeShort !== "number")
            this.action.closeShort = 0;
        if (typeof this.action.closeLong !== "number")
            this.action.closeLong = 0;
        if (typeof this.action.interval !== "number")
            this.action.interval = 20;
        if (!this.action.mode)
            this.action.mode = "trend";
        this.addIndicator("CCI", "CCI", this.action);

        this.addInfo("secondLastCCI", "secondLastCCI");
        this.addInfoFunction("CCI", () => {
            return this.indicators.get("CCI").getValue();
        });
        this.saveState = true;
        //this.checkTradingAgainstTrend();
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
            if (this.action.closePosition === true) {
                if (this.strategyPosition === "long" && value < this.action.closeLong)
                    this.emitClose(this.defaultWeight, "closing long at CCI value: " + valueFormatted);
                else if (this.strategyPosition === "short" && value > this.action.closeShort)
                    this.emitClose(this.defaultWeight, "closing short at CCI value: " + valueFormatted);
            }
            this.lastCCI = value;
            return;
        }

        // TODO look for bullish/bearish divergences (hitting low/high twice) to signal a trend reversal

        if (this.action.mode === "reverse") {
            if (value > this.action.high) {
                this.log("UP trend detected, trading against trend, value", valueFormatted)
                this.emitSell(this.defaultWeight, "CCI value: " + valueFormatted);
            }
            else if (value < this.action.low) {
                this.log("DOWN trend detected, trading against trend, value", valueFormatted)
                this.emitBuy(this.defaultWeight, "CCI value: " + valueFormatted);
            }
            else
                this.log("no trend detected, trading against trend, value", valueFormatted)
        }
        else {
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
        }

        this.lastCCI = value;
    }
}