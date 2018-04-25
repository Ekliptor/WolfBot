import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

export type RSIMode = "trend" | "reverse" | "both";

interface RsiAction extends TechnicalStrategyAction {
    low: number;
    high: number;
    mode: RSIMode; // optional, default "trend". if "reverse" buy on RSI low and sell on RSI high (only if currentRSI > lastRSI)
}

/**
 * Strategy that emits buy/sell based on the RSI indicator.
 *
 * as 2nd strategy for PlanRunner:
 * "RSI": {
          "pair": "USD_BTC",
          "candleSize": 10,
          "interval": 9,
          "low": 54,
          "high": 55,
          "enableLog": false
        },
 */
export default class RSI extends TechnicalStrategy {
    // TODO create "AbstractRSIStrategy" for all our RSI strategies (including StochRSI)
    public action: RsiAction;
    protected lastRSI: number = -1; // identical ro RSI because it's updated on every candle tick
    protected secondLastRSI: number = -1;

    constructor(options) {
        super(options)
        if (typeof this.action.mode !== "string")
            this.action.mode = "trend";
        this.addIndicator("RSI", "RSI", this.action);
        // TODO RSI could be a good indicator for TakeProfit. once RSI is back to about 50 we take the profit (or lower the "profit" % value)
        /*
        this.addInfoFunction("low", () => {
            return this.action.low;
        });
        this.addInfoFunction("high", () => {
            return this.action.high;
        });
        this.addInfoFunction("interval", () => {
            return this.action.interval;
        });
        */
        this.addInfo("secondLastRSI", "secondLastRSI");
        this.addInfoFunction("RSI", () => {
            return this.indicators.get("RSI").getValue(); // TODO notify mode + display latest x values
        });
        this.saveState = true;
    }

    public serialize() {
        let state = super.serialize();
        state.lastRSI = this.lastRSI;
        state.secondLastRSI = this.secondLastRSI;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.lastRSI = state.lastRSI;
        this.secondLastRSI = state.secondLastRSI;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        let rsi = this.indicators.get("RSI")
        const value = rsi.getValue();
        const valueFormatted = Math.round(value * 100) / 100.0;
        this.secondLastRSI = this.lastRSI;
        // TODO check for this.action.thresholds.persistence, add a counter
        if (this.action.mode !== "trend") {
            // use lastRSI to ensure we don't miss our entry point
            if (this.lastRSI < this.action.low && value > this.lastRSI && value > this.action.low) {
                this.log("DOWN reverse trend detected, value", valueFormatted)
                this.emitBuy(this.defaultWeight, "RSI value: " + valueFormatted);
            }
            else if (this.lastRSI > this.action.high && value < this.lastRSI && value < this.action.high) {
                this.log("UP reverse trend detected, value", valueFormatted)
                this.emitSell(this.defaultWeight, "RSI value: " + valueFormatted);
            }
            else
                this.log("no (reverse) trend detected, value", valueFormatted)
        }
        if (this.action.mode !== "reverse") {
            if (value > this.action.high) {
                this.log("UP trend detected, value", valueFormatted)
                this.emitBuy(this.defaultWeight, "RSI value: " + valueFormatted);
            }
            else if (value < this.action.low) {
                this.log("DOWN trend detected, value", valueFormatted)
                this.emitSell(this.defaultWeight, "RSI value: " + valueFormatted);
            }
            else
                this.log("no trend detected, value", valueFormatted)
        }
        this.lastRSI = value;
    }
}