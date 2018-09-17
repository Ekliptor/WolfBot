import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import * as _ from "lodash";

type DivergenceIndicatorName = "RSI" | "CCI" | "MFI"; // OBV is unbound, bad for trading config

interface IndicatorDivergenceAction extends TechnicalStrategyAction {
    divergenceIndicator: DivergenceIndicatorName;
    low: number; // needed for what?
    high: number;
    interval: number; // default 14. Use 0 for unlimited (since bot is collecting candles).
    percentIndicatorTolerance: number; // optional, default 0.5%

    maxGoLongPrice: number;
    minGoShortPrice: number;
}

class PriceExtreme {
    public rate: number;
    public indicatorValue: number;
    public candleTicks: number = 0; // countip up starting at 0 = current candle tick

    constructor(rate: number, indicatorValue: number) {
        this.rate = rate;
        this.indicatorValue = indicatorValue;
    }
}

/**
 * Strategy that emits buy/sell based on the OBV indicator.
 * We look if OBV makes new highs/lows on price highs/lows. Then we assume the trend to continue (breakout).
 * Otherwise we open a position in the opposite direction.
 * This strategy only opens positions. You need a stop-loss and/or take profit strategy.
 */
export default class IndicatorDivergence extends TechnicalStrategy {
    public action: IndicatorDivergenceAction;
    protected lastIndicatorValue: number = -1; // identical ro OBV because it's updated on every candle tick
    protected secondLastIndicatorValue: number = -1;
    protected highs: PriceExtreme[] = [];
    protected lows: PriceExtreme[] = [];

    constructor(options) {
        super(options)
        if (typeof this.action.interval !== "string")
            this.action.divergenceIndicator = "RSI";
        if (typeof this.action.low !== "number")
            this.action.low = 50;
        if (typeof this.action.high !== "number")
            this.action.high = 50;
        if (typeof this.action.interval !== "number")
            this.action.low = 14;
        if (typeof this.action.percentIndicatorTolerance !== "number")
            this.action.percentIndicatorTolerance = 0.5;
        if (typeof this.action.maxGoLongPrice !== "number")
            this.action.maxGoLongPrice = 0.0;
        if (typeof this.action.minGoShortPrice !== "number")
            this.action.minGoShortPrice = 0.0;
        this.addIndicator(this.action.divergenceIndicator, "divInd", this.action);

        this.addInfo("secondLastIndicatorValue", "secondLastIndicatorValue");
        this.addInfoFunction("indicatorValue", () => {
            return this.indicators.get("divInd").getValue();
        });
        this.saveState = true;
    }

    public serialize() {
        let state = super.serialize();
        state.lastIndicatorValue = this.lastIndicatorValue;
        state.secondLastIndicatorValue = this.secondLastIndicatorValue;
        state.highs = this.highs;
        state.lows = this.lows;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.lastIndicatorValue = state.lastIndicatorValue;
        this.secondLastIndicatorValue = state.secondLastIndicatorValue;
        this.highs = state.highs;
        this.lows = state.lows;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        let indicator = this.indicators.get("divInd")
        const value = indicator.getValue();
        const valueFormatted = Math.round(value * 100) / 100.0;
        this.secondLastIndicatorValue = this.lastIndicatorValue;
        this.addToHistory(value, this.candle.close);
        if (this.strategyPosition !== "none" || this.obvHistory.length < this.action.interval || this.priceHistory.length < this.action.interval) {
            this.lastIndicatorValue = value;
            return;
        }

        const maxOBV = _.max(this.obvHistory);
        const maxPrice = _.max(this.priceHistory);
        const minPrice = _.min(this.priceHistory);

        if (maxOBV === value) {
            this.log("Volume high detected, value", valueFormatted)
            if (maxPrice === this.candle.close)
                this.emitBuy(this.defaultWeight, utils.sprintf("OBV value max %s at price high, assuming UP breakout", valueFormatted));
            else if (minPrice === this.candle.close)
                this.emitSell(this.defaultWeight, utils.sprintf("OBV value max %s at price low, assuming DOWN breakout", valueFormatted));
            else if (this.action.openReversal === true) {
                this.log("Price failed to make a new high or low on OBV max")
                if (this.candle.trend === "up")
                    this.emitSell(this.defaultWeight, utils.sprintf("OBV value max %s on up candle without price high, assuming DOWN reversal", valueFormatted));
                else if (this.candle.trend === "down")
                    this.emitBuy(this.defaultWeight, utils.sprintf("OBV value max %s on down candle without price low, assuming UP reversal", valueFormatted));
                else
                    this.log("No candle trend on OBV max")
            }
        }

        this.lastIndicatorValue = value;
    }

    protected addToHistory(obv: number, price: number) {
        this.obvHistory.push(obv);
        this.priceHistory.push(price);
        if (this.obvHistory.length > this.action.interval)
            this.obvHistory.shift();
        if (this.priceHistory.length > this.action.interval)
            this.priceHistory.shift();
    }
}