import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import * as _ from "lodash";

interface ObvAction extends TechnicalStrategyAction {
    interval: number; // default 14. use 0 for unlimited (since bot is collecting candles)
    openReversal: boolean; // default true. open a position in the opposite direction if price fails to make a new high/low on OBV max
}

/**
 * Strategy that emits buy/sell based on the OBV indicator.
 * We look if OBV makes new highs/lows on price highs/lows. Then we assume the trend to continue (breakout).
 * Otherwise we open a position in the opposite direction.
 * This strategy only opens positions. You need a stop-loss and/or take profit strategy.
 */
export default class OBV extends TechnicalStrategy {
    public action: ObvAction;
    protected lastOBV: number = -1; // identical ro OBV because it's updated on every candle tick
    protected secondLastOBV: number = -1;
    protected obvHistory: number[] = [];
    protected priceHistory: number[] = [];

    constructor(options) {
        super(options)
        if (typeof this.action.interval !== "number")
            this.action.interval = 14;
        if (typeof this.action.openReversal !== "boolean")
            this.action.openReversal = true;
        this.addIndicator("OBV", "OBV", this.action);

        this.addInfo("secondLastOBV", "secondLastOBV");
        this.addInfoFunction("OBV", () => {
            return this.indicators.get("OBV").getValue();
        });
        this.saveState = true;
    }

    public serialize() {
        let state = super.serialize();
        state.lastOBV = this.lastOBV;
        state.secondLastOBV = this.secondLastOBV;
        state.obvHistory = this.obvHistory;
        state.obvHistory = this.obvHistory;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.lastOBV = state.lastOBV;
        this.secondLastOBV = state.secondLastOBV;
        this.obvHistory = state.obvHistory;
        this.obvHistory = state.obvHistory;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        let obv = this.indicators.get("OBV")
        const value = obv.getValue();
        const valueFormatted = Math.round(value * 100) / 100.0;
        this.secondLastOBV = this.lastOBV;
        this.addToHistory(value, this.candle.close);
        if (this.strategyPosition !== "none" || this.obvHistory.length < this.action.interval || this.priceHistory.length < this.action.interval) {
            this.lastOBV = value;
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

        this.lastOBV = value;
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