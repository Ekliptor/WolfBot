import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, PivotPointsType} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {PivotLineNr} from "../Indicators/PivotPoints";

type ConfirmationIndicatorName = "" | "RSI" | "CCI" | "MFI"; // OBV is unbound, bad for trading config

interface PivotSniperAction extends TechnicalStrategyAction {
    type: PivotPointsType; // optional, default 'standard' // The Pivot Points calculation method you want to use. Values: standard|fibonacci|demark
    interval: number; // optional, default 15. The number of candles to use for the high/low calculation as the previous period to compute the Pivot Points values from.
    // Also sets the number of candles to compute the confirmation indicator value from.
    supportLevel: PivotLineNr; // optional, default 2. The support level at which you want to open a long position. Standard Pivot Points have 2 levels, Fibonacci 3 and Demark only 1. Values: 1|2|3
    resistanceLevel: PivotLineNr; // optional, default 2. The resistance level at which you want to open a short position. Standard Pivot Points have 2 levels, Fibonacci 3 and Demark only 1. Values: 1|2|3
    minVolumeSpike: number; // optional, default 1.1. The min volume compared to the average volume of 'interval' candles to open a position at a support or resistance.

    confirmationIndicator: ConfirmationIndicatorName; // default empty = none. The indicator to use to wait for confirmation to open a position.
    low: number; // optional, default 50. Only go short if the confirmation indicator is below this value.
    high: number; // optional, default 50. Only go long if the confirmation indicator is above this value.

    maxGoLongPrice: number; // optional, default 0 = any price // The maximum price to open a long position.
    minGoShortPrice: number; // optional, default 0 = any price // The minimum price to open a short position.
}

/**
 * Strategy that checks support and resistance of Pivot Points.
 * We wait for support or resistance to get hit and open a position in the opposite direction,
 * assuming the market will bounce back.
 * This strategy works very well for daytrading with candle sizes from 30min to 4h.
 * This strategy will open and close existing positions, but you can still combine it with a stop-loss and/or take profit strategy.
 */
export default class PivotSniper extends TechnicalStrategy {
    public action: PivotSniperAction;

    constructor(options) {
        super(options)
        if (typeof this.action.type !== "string")
            this.action.type = "standard";
        if (typeof this.action.interval !== "number")
            this.action.interval = 15;
        if (typeof this.action.supportLevel !== "number" || this.action.supportLevel < 1 || this.action.supportLevel > 3)
            this.action.supportLevel = 2;
        if (typeof this.action.resistanceLevel !== "number" || this.action.resistanceLevel < 1 || this.action.resistanceLevel > 3)
            this.action.resistanceLevel = 2;
        if (typeof this.action.minVolumeSpike !== "number")
            this.action.minVolumeSpike = 1.1;
        if (typeof this.action.confirmationIndicator !== "string")
            this.action.confirmationIndicator = ""; // none
        if (typeof this.action.low !== "number")
            this.action.low = 50;
        if (typeof this.action.high !== "number")
            this.action.high = 50;
        if (typeof this.action.maxGoLongPrice !== "number")
            this.action.maxGoLongPrice = 0.0;
        if (typeof this.action.minGoShortPrice !== "number")
            this.action.minGoShortPrice = 0.0;

        this.addIndicator("PivotPoints", "PivotPoints", this.action);
        this.addIndicator("AverageVolume", "AverageVolume", this.action);
        if (this.action.confirmationIndicator)
            this.addIndicator("ConfirmationIndicator", this.action.confirmationIndicator, this.action);

        const points = this.getPivotPoints("PivotPoints");
        this.addInfoFunction("pivotPoint", () => {
            return points.getPivotPoint();
        });
        this.addInfoFunction("support1", () => {
            return points.getSupport1();
        });
        this.addInfoFunction("support2", () => {
            return points.getSupport2();
        });
        this.addInfoFunction("support3", () => {
            return points.getSupport3();
        });
        this.addInfoFunction("resistance1", () => {
            return points.getResistance1();
        });
        this.addInfoFunction("resistance2", () => {
            return points.getResistance2();
        });
        this.addInfoFunction("resistance3", () => {
            return points.getResistance3();
        });
        this.saveState = true;
        this.mainStrategy = true;
    }

    public serialize() {
        let state = super.serialize();
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        //if (this.strategyPosition !== "none") // allow opening & closing
            //return;

        const points = this.getPivotPoints("PivotPoints");
        const confirmationIndicator = this.action.confirmationIndicator ? this.indicators.get("ConfirmationIndicator") : null;
        if (this.candle.close <= points.getSupport(this.action.supportLevel)) {
            if (this.isSufficientVolume() === false)
                this.log("Insufficient volume to go long on support line " + this.getVolumeStr());
            else if (this.trendConfirmed("up") === false)
                this.log("UP trend not confirmed by indicator value " + confirmationIndicator.getValue().toFixed(8));
            else if (this.action.maxGoLongPrice == 0.0 || this.action.maxGoLongPrice < this.candle.close) {
                const reason = utils.sprintf("Reached support line %s", this.action.supportLevel);
                if (this.strategyPosition === "short")
                    this.emitClose(this.defaultWeight, reason);
                else if (this.strategyPosition === "none")
                    this.emitBuy(this.defaultWeight, reason);
                else
                    this.log("Skipping BUY because of an already existing LONG position: " + reason);
            }
        }
        else if (this.candle.close >= points.getResistance(this.action.resistanceLevel)) {
            if (this.isSufficientVolume() === false)
                this.log("Insufficient volume to go short on resistance line " + this.getVolumeStr());
            else if (this.trendConfirmed("down") === false)
                this.log("DOWN trend not confirmed by indicator value " + confirmationIndicator.getValue().toFixed(8));
            else if (this.action.minGoShortPrice == 0.0 || this.action.minGoShortPrice > this.candle.close) {
                const reason = utils.sprintf("Reached resistance line %s", this.action.resistanceLevel);
                if (this.strategyPosition === "short")
                    this.emitClose(this.defaultWeight, reason);
                else if (this.strategyPosition === "none")
                    this.emitSell(this.defaultWeight, reason);
                else
                    this.log("Skipping SELL because of an already existing SHORT position: " + reason);
            }
        }
    }

    protected isSufficientVolume() {
        if (this.action.minVolumeSpike == 0.0)
            return true; // disabled
        let indicator = this.getVolume("AverageVolume")
        return indicator.getVolumeFactor() >= this.action.minVolumeSpike;
    }

    protected getVolumeStr() {
        let indicator = this.getVolume("AverageVolume");
        return utils.sprintf("%s %s, spike %sx", indicator.getValue().toFixed(8), this.action.pair.getBase(), indicator.getVolumeFactor().toFixed(8));
    }

    protected trendConfirmed(direction: Candle.TrendDirection) {
        if (!this.action.confirmationIndicator)
            return true; // no indicator set
        const indicator = this.indicators.get("ConfirmationIndicator");
        switch (direction) {
            case "up":          return indicator.getValue() > this.action.high;
            case "down":        return indicator.getValue() < this.action.low;
            case "none":        return this.action.low <= indicator.getValue() && this.action.high >= indicator.getValue();
        }
        utils.test.assertUnreachableCode(direction);
    }
}