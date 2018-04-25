import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {TradeDirection} from "../Trade/AbstractTrader";

interface KAMAAction extends TechnicalStrategyAction {
    interval: number;
    tradeDirection: TradeDirection | "watch"; // optional, default "both". "watch" only computes indicators
}

/**
 * Strategy that emits buy/sell based on the KAMA indicator.
 * http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:kaufman_s_adaptive_moving_average
 * Shouldn't be used alone, but together with other strategies.
 */
export default class KAMA extends TechnicalStrategy {
    public action: KAMAAction;

    constructor(options) {
        super(options)
        if (!this.action.tradeDirection)
            this.action.tradeDirection = "both";

        this.addIndicator("KAMA", "KAMA", this.action);
        this.addInfoFunction("KAMA", () => {
            return this.indicators.get("KAMA").getValue();
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        if (this.strategyPosition !== "none" || this.action.tradeDirection === "watch")
            return;
        let mfi = this.indicators.get("KAMA")
        const value = mfi.getValue();
        // TODO check for this.action.thresholds.persistence, add a counter
        if (value < this.candle.close) { // uptend, KAMA value lags behind = below
            this.log("UP trend detected, value", value)
            if (this.action.tradeDirection !== "down")
                this.emitBuy(this.defaultWeight, "MFI value: " + value);
        }
        else if (value > this.candle.close) {
            this.log("DOWN trend detected, value", value)
            if (this.action.tradeDirection !== "up")
                this.emitSell(this.defaultWeight, "MFI value: " + value);
        }
        else
            this.log("no trend detected, value", value)
    }
}