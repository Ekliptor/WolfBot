import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import BollingerBands from "./BollingerBands";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {BollingerBands as BollingerIndicator} from "../Indicators/BollingerBands";
import {Aroon as AroonIndicator} from "../Indicators/Aroon";

interface BollingerBreakoutsAction extends TechnicalStrategyAction { // same parameters as BollingerBands strategy
    breakout: number; // the number of candles the price has to stay at Aroon up/down to assume a breakout
    percentBThreshold: number; // 0.01, optional, a number indicating how close to %b the price has to be to consider it "reached"

    // optional, for defaults see BolloingerBandsParams
    N: number; // time period for MA
    K: number; // factor for upper/lower band
    MAType: number; // moving average type, 0 = SMA

    interval: number; // optional, default = 25, The number of Aroon candles to compute the Aroon trend from.
    aroonHigh: number; // optional, default 96. The value 'Aroon Up' must have to be considered high.
    aroonLow: number; // optional, defaul 50. The value 'Aroon Down' must have to be considered low.
}

/**
 * Strategy that assumes the market price will jump between the upper and lower Bollinger band (see BollingerBands strategy).
 * Additionally we use the Aroon indicator to assume a breakout if up/down is at 100. In that case
 * we wait (don't trade based on Bollinger) and trade based on Aroon if it stays at 100 for "breakout" candles.
 */
export default class BollingerBreakouts extends BollingerBands {
    //protected static readonly PERCENT_B_THRESHOLD = 0.0; // same as parent

    public action: BollingerBreakoutsAction;
    protected breakoutCount = 0;

    constructor(options) {
        super(options)
        //this.addIndicator("BollingerBands", "BollingerBands", this.action); // already added in parent
        this.addIndicator("Aroon", "Aroon", this.action);
        if (typeof this.action.breakout !== "number")
            this.action.breakout = 0;
        if (!this.action.percentBThreshold)
            this.action.percentBThreshold = BollingerBreakouts.PERCENT_B_THRESHOLD;
        if (!this.action.interval)
            //this.action.interval = Math.max(25, 1.3*this.action.N); // not initialized here
            this.action.interval = 25;
        if (!this.action.aroonHigh)
            this.action.aroonHigh = 96;
        if (!this.action.aroonLow)
            this.action.aroonLow = 50;

        // only trade if we don't have an open position (last signal might have been ignored). only important with small candleSize
        this.tradeOnce = true;

        this.addInfoFunction("AroonInterval", () => {
            return this.action.interval;
        });
        let aroon = this.getAroon("Aroon")
        this.addInfoFunction("AroonUp", () => {
            return aroon.getUp();
        });
        this.addInfoFunction("AroonDown", () => {
            return aroon.getDown();
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        let bollinger = this.getBollinger("BollingerBands")
        let aroon = this.getAroon("Aroon")
        const value = bollinger.getPercentB(this.candle.close)

        const aroonMsg = utils.sprintf("Aroon up %s, down %s, breakoutCount %s", aroon.getUp(), aroon.getDown(), (this.breakoutCount + 1));
        if (aroon.getUp() >= this.action.aroonHigh && aroon.getDown() < this.action.aroonLow) {
            // Aroon high
            this.breakoutCount++;
            this.log("Aroon up reached, UP trend,", aroonMsg)
            if (this.lastTrend === "up" && this.breakoutCount >= this.action.breakout) {
                this.emitBuy(this.defaultWeight, aroonMsg);
            }
            this.setTrend("up");
        }
        else if (aroon.getDown() >= this.action.aroonHigh && aroon.getUp() < this.action.aroonLow) {
            // Aroon low
            this.breakoutCount++;
            this.log("Aroon down reached, DOWN trend,", aroonMsg)
            if (this.lastTrend === "down" && this.breakoutCount >= this.action.breakout) {
                this.emitSell(this.defaultWeight, aroonMsg);
            }
            this.setTrend("down");
        }
        else {
            // market is moving fast -> Aroon has up and down very closely together
            // market is going sideways -> no Aroon trend
            this.breakoutCount = 0;
            this.lastTrend = "none";

            if (aroon.getUp() >= this.action.aroonHigh || aroon.getDown() >= this.action.aroonHigh)
                return this.log("Ignoring Bollinger because we are close to Aroon up/down", utils.sprintf("Aroon up %s, down %s", aroon.getUp(), aroon.getDown()));

            // check bollinger bands as fallback
            // TODO only use bollinger if the market goes sideways. how to detect? just lower the aroon threshold above?
            if (value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) {
                this.log("fast moving market (consider increasing candleSize), no trend detected, percent b value", value)
            }
            else if (value >= 1 - this.action.percentBThreshold) {
                this.log("reached upper band, DOWN trend imminent, value", value)
                this.emitSell(this.defaultWeight, "percent b value: " + value);
            }
            else if (value <= this.action.percentBThreshold) {
                this.log("reached lower band, UP trend imminent, value", value)
                this.emitBuy(this.defaultWeight, "percent b value: " + value);
            }
            else {
                this.log("no trend detected, percent b value", value)
            }
        }
    }
}