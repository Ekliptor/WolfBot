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
    divergenceIndicator: DivergenceIndicatorName; // default RSI. The indicator to use to check for bullish/bearish divergence on new price highs/lows.
    low: number; // not used, just set internally for indicator to work
    high: number;
    interval: number; // default 14. The number of candles the divergence indicator shall keep in history.
    divergenceHistory: number; // default 16. The number of candles we go back to compare price vs indicator highs/lows.
    percentIndicatorTolerance: number; // optional, default 0.5%. The percentage the new indicator value can be lower/higher as the previous high/low to still be considered an indicator divergence.
    // You can use negative values to require the indicator to have a bigger difference to the previous value.

    maxGoLongPrice: number; // optional, default 0 = any price // The maximum price to open a long position
    minGoShortPrice: number; // optional, default 0 = any price // The minimum price to open a short position.
}

class PricePoint {
    public rate: number;
    public indicatorValue: number;
    //public candleTicks: number = 0; // counting up starting at 0 = current candle tick

    constructor(rate: number, indicatorValue: number) {
        this.rate = rate;
        this.indicatorValue = indicatorValue;
    }
}

/**
 * Strategy that trades on bullish and bearish divergence.
 * A bullish divergence is when the price makes a lower low (LL) while the chosen indicator makes a higher low (HL).
 * A bullish divergence is the moment to open a long position.
 * A bearish divergence is when the price makes a higher high (HH) while the chosen indicator makes a lower high (LH).
 * A bearish divergence is the moment to open a short position.
 * This strategy only opens positions. You need a stop-loss and/or take profit strategy.
 */
export default class IndicatorDivergence extends TechnicalStrategy {
    public action: IndicatorDivergenceAction;
    protected lastIndicatorValue: number = -1; // identical ro OBV because it's updated on every candle tick
    protected secondLastIndicatorValue: number = -1;
    protected prices: PricePoint[] = [];

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
        if (typeof this.action.divergenceHistory !== "number")
            this.action.divergenceHistory = 16;
        if (typeof this.action.percentIndicatorTolerance !== "number")
            this.action.percentIndicatorTolerance = 0.5;
        if (typeof this.action.maxGoLongPrice !== "number")
            this.action.maxGoLongPrice = 0.0;
        if (typeof this.action.minGoShortPrice !== "number")
            this.action.minGoShortPrice = 0.0;

        this.addIndicator("divInd", this.action.divergenceIndicator, this.action);
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
        state.prices = this.prices;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.lastIndicatorValue = state.lastIndicatorValue;
        this.secondLastIndicatorValue = state.secondLastIndicatorValue;
        this.prices = state.prices;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        let indicator = this.indicators.get("divInd")
        const value = indicator.getValue();
        const valueFormatted = Math.round(value * 100) / 100.0;
        this.secondLastIndicatorValue = this.lastIndicatorValue;

        const prices = this.prices.map(p => p.rate);
        const indicatorValues = this.prices.map(p => p.indicatorValue);
        const prevMaxRate = _.max(prices);
        const prevMaxIndicator = _.max(indicatorValues);
        const prevMinRate = _.min(prices);
        const prevMinIndicator = _.min(indicatorValues);
        this.addToHistory(value, this.candle.close);
        if (this.strategyPosition !== "none" || this.prices.length < this.action.divergenceHistory) {
            this.lastIndicatorValue = value;
            return;
        }

        if (this.candle.close < prevMinRate) {
            // check for bullish divergence: price makes a LL, indicator a HL
            if (this.isWithinIndicatorTolerance(value, prevMinIndicator, true) === true) {
                this.log(utils.sprintf("Bullish divergence: price LL %s < %s, indicator HL %s > %s", this.candle.close, prevMinRate, valueFormatted, prevMinIndicator));
                if (this.action.maxGoLongPrice == 0.0 || this.action.maxGoLongPrice < this.candle.close) {
                    this.emitBuy(this.defaultWeight, utils.sprintf("Bullish divergence at indicator HL %s > %s", valueFormatted, prevMinIndicator));
                }
            }
            else
                this.log(utils.sprintf("No bullish divergence on price LL %s", this.candle.close));
        }
        else if (this.candle.close > prevMaxRate) {
            // check for bearish divergence: price makes a HH, indicator a LH
            if (this.isWithinIndicatorTolerance(value, prevMaxIndicator, false) === true) {
                this.log(utils.sprintf("Bearish divergence: price HH %s > %s, indicator LH %s < %s", this.candle.close, prevMaxRate, valueFormatted, prevMaxIndicator));
                if (this.action.minGoShortPrice == 0.0 || this.action.minGoShortPrice > this.candle.close) {
                    this.emitSell(this.defaultWeight, utils.sprintf("Bearish divergence at indicator LH %s < %s", valueFormatted, prevMaxIndicator));
                }
            }
            else
                this.log(utils.sprintf("No bearish divergence on price HH %s", this.candle.close));
        }

        this.lastIndicatorValue = value;
    }

    protected addToHistory(indicatorValue: number, price: number) {
        let point = new PricePoint(price, indicatorValue);
        this.prices.push(point);
        if (this.prices.length > this.action.divergenceHistory)
            this.prices.shift();
    }

    protected isWithinIndicatorTolerance(currentVal: number, compareVal: number, bigger: boolean) {
        if (bigger === true) {
            const toleranceVal = currentVal + (this.action.percentIndicatorTolerance != 0.0 ? currentVal / 100.0 * this.action.percentIndicatorTolerance : 0.0);
            return toleranceVal > compareVal;
        }
        else { // smaller
            const toleranceVal = currentVal - (this.action.percentIndicatorTolerance != 0.0 ? currentVal / 100.0 * this.action.percentIndicatorTolerance : 0.0);
            return toleranceVal < compareVal;
        }
    }
}