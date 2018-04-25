import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
//import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {BollingerBands as BollingerIndicator} from "../Indicators/BollingerBands";
import {AbstractTurnStrategy} from "./AbstractTurnStrategy";

interface ChannelBreakoutAction extends TechnicalStrategyAction {
    closeOnMiddleBand: boolean; // optional, default false. close an open position if the price reaches the middle band
    percentBThreshold: number; // 0.01, optional, a number indicating how close to %b the price has to be to consider it "reached"

    // optional, for defaults see BolloingerBandsParams
    N: number; // time period for MA
    K: number; // factor for upper/lower band
    MAType: number; // // default = 3 = DEMA moving average type, 0 = SMA

    // TODO add more band indicators to choose from:
    // https://traderstrategies.wordpress.com/2015/06/10/acceleration-bands/
    // http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:keltner_channels
}

/**
 * Strategy that assumes a trend change or breakout when the upper or lower band is reached.
 * It will then open a position as long as the price stays on that band.
 * Strategy has an open market position about 50% of the time.
 */
export default class ChannelBreakout extends AbstractTurnStrategy {
    protected static readonly PERCENT_B_THRESHOLD = 0.0;

    public action: ChannelBreakoutAction;
    protected breakoutCount = 0;

    constructor(options) {
        super(options)
        this.addIndicator("BollingerBands", "BollingerBands", this.action);
        if (typeof this.action.closeOnMiddleBand !== "boolean")
            this.action.closeOnMiddleBand = false;
        if (!this.action.percentBThreshold)
            this.action.percentBThreshold = ChannelBreakout.PERCENT_B_THRESHOLD;
        if (typeof this.action.MAType !== "number")
            this.action.MAType = 3;

        this.addInfo("breakoutCount", "breakoutCount");
        this.addInfoFunction("N", () => {
            return this.action.N;
        });
        this.addInfoFunction("K", () => {
            return this.action.K;
        });
        this.addInfoFunction("MAType", () => {
            return this.action.MAType;
        });
        let bollinger = this.getBollinger("BollingerBands")
        this.addInfoFunction("%b", () => {
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
        this.plotChart();
        let bollinger = this.getBollinger("BollingerBands")
        const value = bollinger.getPercentB(this.candle.close)
        // TODO we can also add a very short EMA and check if the EMA value is above the upper band (or below the lower band)

        if (value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) {
            this.log("fast moving market (consider increasing candleSize), no trend detected, percent b value", value)
            this.breakoutCount = 0;
            this.lastTrend = "none";
        }
        else if (value >= 1 - this.action.percentBThreshold) {
            this.breakoutCount++;
            if (this.lastTrend !== "up") {
                this.log("Breakout on upper band, UP trend, value", value)
                this.openLong("percent b value: " + value);
                this.setTrend("up");
            }
        }
        else if (value <= this.action.percentBThreshold) {
            this.breakoutCount++;
            if (this.lastTrend !== "down") {
                this.log("Breakout on lower band, DOWN trend, value", value)
                this.openShort("percent b value: " + value);
                this.setTrend("down");
            }
        }
        else {
            this.log("no trend detected, percent b value", value)
            //this.breakoutCount = 0; // reset only if trend direction changes

            // close position if we reach the middle band
            if (this.action.closeOnMiddleBand) {
                if ((this.strategyPosition === "short" && this.avgMarketPrice > bollinger.getMiddleValue()) ||
                    (this.strategyPosition === "long" && this.avgMarketPrice < bollinger.getMiddleValue())) {
                    this.emitClose(this.defaultWeight, "price reached middle band at value: " + bollinger.getMiddleValue());
                    this.setTrend("none");
                }
            }
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

    protected plotChart() {
        let bollinger = this.getBollinger("BollingerBands")
        let markData = {
            upperBand: bollinger.getUpperValue(),
            lowerBand: bollinger.getLowerValue(),
            middleBand: bollinger.getMiddleValue()
        }
        this.plotData.plotMark(markData);
        this.plotData.plotMark({
            bandwidth: bollinger.getBandwidth(),
            bandwidthAvgFactor: bollinger.getBandwidthAvgFactor()
        }, true)
    }
}