import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {BollingerBands as BollingerIndicator} from "../Indicators/BollingerBands";

interface BollingerBandsAction extends TechnicalStrategyAction {
    breakout: number; // default 0. The number of candles the price has to stay at the upper/lower band to assume a breakout.
    percentBThreshold: number; // 0.01, optional, A number indicating how close to %b the price has to be to consider it "reached".

    // optional, for defaults see BolloingerBandsParams
    N: number; // The time period for MA of BollingerBands.
    K: number; // The factor for upper/lower band of BollingerBands.
    MAType: number; // The moving average type of BollingerBands. 0 = SMA
}

/**
 * Strategy that emits buy/sell based on the Bollinger Bands indicator.
 * Our assumption is that the price will always jump between the upper and lower band (as in a sideways market).
 * Consequently, at the upper we sell and at the lower band we buy.
 * If the price stays at the upper/lower band for "breakout" candles, we assume this breakout will continue.
 *
 * 2h candles + 20 SMA good: https://steemit.com/cryptocurrency/@kjnk/was-this-insider-trading
 */
export default class BollingerBands extends TechnicalStrategy {
    protected static readonly PERCENT_B_THRESHOLD = 0.0;

    public action: BollingerBandsAction;
    protected breakoutCount = 0;

    constructor(options) {
        super(options)
        this.addIndicator("BollingerBands", "BollingerBands", this.action);
        // TODO could we use 2 boilinger bands: 1 with candle high for the upper band and 1 with candle low for the lower band?
        if (typeof this.action.breakout !== "number")
            this.action.breakout = 0;
        if (!this.action.percentBThreshold)
            this.action.percentBThreshold = BollingerBands.PERCENT_B_THRESHOLD;

        this.addInfoFunction("breakout", () => {
            return this.action.breakout;
        });
        this.addInfoFunction("N", () => {
            return this.action.N;
        });
        this.addInfoFunction("K", () => {
            return this.action.K;
        });
        this.addInfoFunction("MAType", () => {
            return this.action.MAType;
        });
        const bollinger = this.getBollinger("BollingerBands");
        this.addInfoFunction("percentB", () => {
            if (!this.candle)
                return -1;
            return bollinger.getPercentB(this.candle.close);
        });
        this.addInfoFunction("Bandwidth", () => {
            return bollinger.getBandwidth();
        });
        this.addInfoFunction("BandwidthAvgFactor", () => {
            return bollinger.getBandwidthAvgFactor();
        });
        this.addInfoFunction("upperValue", () => {
            return bollinger.getUpperValue();
        });
        this.addInfoFunction("middleValue", () => {
            return bollinger.getMiddleValue();
        });
        this.addInfoFunction("lowerValue", () => {
            return bollinger.getLowerValue();
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        const bollinger = this.getBollinger("BollingerBands");
        const value = bollinger.getPercentB(this.candle.close)
        // TODO check for this.action.thresholds.persistence, add a counter

        if (value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) {
            this.log("fast moving market (consider increasing candleSize), no trend detected, percent b value", value)
            this.breakoutCount = 0;
            this.lastTrend = "none";
        }
        else if (value >= 1 - this.action.percentBThreshold) {
            this.breakoutCount++;
            if (this.lastTrend === "down" && this.breakoutCount >= this.action.breakout) {
                this.log("Breakout on upper band, UP trend continuing, value", value)
                this.emitBuy(this.defaultWeight, "percent b value: " + value);
                this.setTrend("up");
            }
            // TODO only if breakoutCount <= 1? otherwise wait until count reset == no trend while the market turns
            // %b will decrease gradually, so we will then skip the next down trend
            else {
                this.log("reached upper band, DOWN trend imminent, value", value)
                this.emitSell(this.defaultWeight, "percent b value: " + value);
                this.setTrend("down");
            }
        }
        else if (value <= this.action.percentBThreshold) {
            this.breakoutCount++;
            if (this.lastTrend === "up" && this.breakoutCount >= this.action.breakout) {
                this.log("Breakout on lower band, DOWN trend continuing, value", value)
                this.emitSell(this.defaultWeight, "percent b value: " + value);
                this.setTrend("down");
            }
            else {
                this.log("reached lower band, UP trend imminent, value", value)
                this.emitBuy(this.defaultWeight, "percent b value: " + value);
                this.setTrend("up");
            }
        }
        else {
            this.log("no trend detected, percent b value", value)
            //this.breakoutCount = 0; // reset only if trend direction changes
        }
    }

    protected setTrend(trend: TrendDirection) {
        if (this.lastTrend !== trend)
            this.breakoutCount = 0;
        this.lastTrend = trend;
    }

    protected resetValues(): void {
        this.breakoutCount = 0;
        super.resetValues();
    }
}