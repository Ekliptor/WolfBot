import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {BollingerBands as BollingerIndicator} from "../Indicators/BollingerBands";

interface PingPongAction extends TechnicalStrategyAction {
    // optional, Volume profile params
    interval: number; // default 48. The number of candles to compute the volume profile and average volume from.
    volumeRows: number; // default 24. The number of equally-sized price zones the price range is divided into.
    valueAreaPercent: number; // default 70%. The percentage of the total volume that shall make up the value area, meaning the price range where x% of the trades happen.

    minVolumeSpike: number; // default 1.1. The min volume compared to the average volume of the last 'interval' candles to open a position.
    percentBThreshold: number; // 0.001, optional, A number indicating how close to %b the price has to be to consider it "reached".

    // optional, for defaults see BolloingerBandsParams
    N: number; // The time period for MA of BollingerBands.
    K: number; // The factor for upper/lower band of BollingerBands.
    MAType: number; // The moving average type of BollingerBands. 0 = SMA
}

/**
 * Strategy that sells on the upper Bollinger Band and buys on the lower band.
 * Our assumption is that the price will always jump between the upper and lower band (as in a sideways market).
 * This strategy only trades within the value area of the volume profile, which is when price is within the range where 70% of
 * trades take place using default settings. Additionally the current candle volume must be 'minVolumeSpike' above average (SMA) of
 * the latest 'interval' candles.
 * This strategy only opens positions. You need a stop-loss and/or take profit strategy.
 */
export default class PingPong extends TechnicalStrategy {
    public action: PingPongAction;

    constructor(options) {
        super(options)
        if (typeof this.action.interval !== "number")
            this.action.interval = 48;
        if (typeof this.action.volumeRows !== "number")
            this.action.volumeRows = 24;
        if (typeof this.action.valueAreaPercent !== "number")
            this.action.valueAreaPercent = 70.0;
        if (typeof this.action.minVolumeSpike !== "number")
            this.action.minVolumeSpike = 1.1;
        if (!this.action.percentBThreshold)
            this.action.percentBThreshold = 0.001;
        this.addIndicator("VolumeProfile", "VolumeProfile", this.action);
        this.addIndicator("AverageVolume", "AverageVolume", this.action);
        this.addIndicator("BollingerBands", "BollingerBands", this.action);

        const volumeProfile = this.getVolumeProfile("VolumeProfile");
        const averageVolume = this.getVolume("AverageVolume");
        this.addInfoFunction("valueAreaHigh", () => {
            const valueArea = volumeProfile.getValueArea();
            return valueArea !== null ? valueArea.valueAreaHigh : "";
        });
        this.addInfoFunction("valueAreaLow", () => {
            const valueArea = volumeProfile.getValueArea();
            return valueArea !== null ? valueArea.valueAreaLow : "";
        });
        this.addInfoFunction("valueAreaVolume", () => {
            const valueArea = volumeProfile.getValueArea();
            return valueArea !== null ? valueArea.valueAreaVolume : "";
        });
        this.addInfoFunction("profileHigh", () => {
            const valueArea = volumeProfile.getValueArea();
            return valueArea !== null ? valueArea.profileHigh : "";
        });
        this.addInfoFunction("profileLow", () => {
            const valueArea = volumeProfile.getValueArea();
            return valueArea !== null ? valueArea.profileLow : "";
        });
        this.addInfoFunction("totalVolume", () => {
            return volumeProfile.getTotalVolume();
        });
        this.addInfoFunction("maxVolumeProfileBar", () => {
            const profile = volumeProfile.getVolumeProfile();
            return profile.length !== 0 ? profile[0].toString() : ""; // display the bar with the highest volume
        });
        this.addInfoFunction("AverageVolume", () => {
            return averageVolume.getValue();
        });
        this.addInfoFunction("VolumeFactor", () => {
            return averageVolume.getVolumeFactor();
        });

        const bollinger = this.getBollinger("BollingerBands");
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

        this.saveState = true;
        this.mainStrategy = true;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        const bollinger = this.getBollinger("BollingerBands");
        const value = bollinger.getPercentB(this.candle.close);
        const volumeProfile = this.getVolumeProfile("VolumeProfile");
        //const averageVolume = this.getVolume("AverageVolume");

        if (this.strategyPosition !== "none")
            return;

        if (value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) {
            this.log("fast moving market (consider increasing candleSize), no trend detected, percent b value", value)
        }
        else if (volumeProfile.getValueArea().isPriceWithinArea(this.candle.close) === false) {
            this.log(utils.sprintf("Skipped opening position because price %s is not within value area, low %s, high %s", this.candle.close.toFixed(8),
                volumeProfile.getValueArea().valueAreaLow.toFixed(8), volumeProfile.getValueArea().valueAreaHigh.toFixed(8)))
        }
        else if (this.isSufficientVolume() === false)
            this.log("Insufficient volume to trade " + this.getVolumeStr());
        else if (value >= 1 - this.action.percentBThreshold) {
            this.log("reached upper band, DOWN trend imminent, value", value)
            this.emitSell(this.defaultWeight, "percent b value: " + value);
        }
        else if (value <= this.action.percentBThreshold) {
            this.log("reached lower band, UP trend imminent, value", value)
            this.emitBuy(this.defaultWeight, "percent b value: " + value);
        }
        else {
            this.log("no trend detected, percent b value", value.toFixed(8))
        }
    }

    protected isSufficientVolume() {
        if (this.action.minVolumeSpike == 0.0)
            return true; // disabled
        let averageVolume = this.getVolume("AverageVolume")
        return averageVolume.getVolumeFactor() >= this.action.minVolumeSpike;
    }

    protected getVolumeStr() {
        let averageVolume = this.getVolume("AverageVolume");
        return utils.sprintf("%s %s, spike %sx", averageVolume.getValue().toFixed(8), this.action.pair.getBase(), averageVolume.getVolumeFactor().toFixed(8));
    }

    protected resetValues(): void {
        super.resetValues();
    }
}