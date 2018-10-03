import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import * as _ from "lodash";
import {VolumeProfileBar} from "../Indicators/VolumeProfile";


type VolumeTradeMode = "breakout" | "resistance" | "both";

interface VolumeProfilerAction extends TechnicalStrategyAction {
    interval: number; // default 48. The number of candles to compute the volume profile and average volume from.
    volumeRows: number; // default 24. The number of equally-sized price zones the price range is divided into.
    valueAreaPercent: number; // default 70%. The percentage of the total volume that shall make up the value area, meaning the price range where x% of the trades happen.
    minVolumeSpike: number; // default 1.1. The min volume compared to the average volume of the last 'interval' candles to open a position at a divergence.
    tradeMode: VolumeTradeMode; // default resistance. If we reach the volume profile bar with the highest volume, shall we wait for a bounce (trade the resistance) or trade a breakout? Values: breakout|resistance|both
    minVolumeSpikeBreakout: number; // default 2.1. If 'tradeMode' is set to 'both' the volume of the current candle has to be x times higher than the average volume to be considered a breakout.
    // Otherwise trade resistance (open a position in the opposite direction).
}

/**
 * Strategy that waits for price to hit a high volume spot on the volume profile.
 * Depending on 'tradeMode' it will then either:
 * - breakout: Wait until the price is at the end of this volume profile bar and then open a position with the current trend. This
 *              works well for opening positions for longer timeframes (multiple days to weeks).
 * - resistance: Immediately forward an order against the trend. You should have a 'tradeStrategy' such as 'RSIScalpOrderer' set on a smaller
 *              candleSize to delay the order execution until the trend slows down.
 * - both: Trade on breakout and resistance depending on where the current price is within the corresponding volume profile bar.
 * This strategy only opens positions. You need a stop-loss and/or take profit strategy.
 *
 * http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:volume_by_price
 * Advanced "Volume Profile" on TradingView: https://www.tradingview.com/wiki/Volume_Profile
 */
export default class VolumeProfiler extends TechnicalStrategy {
    public action: VolumeProfilerAction;

    constructor(options) {
        super(options)
        if (typeof this.action.interval !== "number")
            this.action.interval = 48;
        if (typeof this.action.volumeRows !== "number")
            this.action.volumeRows = 24;
        if (typeof this.action.valueAreaPercent !== "number")
            this.action.valueAreaPercent = 70.0;
        if (typeof this.action.minVolumeSpike !== "number")
            this.action.minVolumeSpike = 1.8;
        if (typeof this.action.tradeMode !== "string")
            this.action.tradeMode = "resistance";
        if (typeof this.action.minVolumeSpikeBreakout !== "number")
            this.action.minVolumeSpikeBreakout = 2.1;

        this.addIndicator("VolumeProfile", "VolumeProfile", this.action);
        this.addIndicator("AverageVolume", "AverageVolume", this.action);

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
        const volumeProfile = this.getVolumeProfile("VolumeProfile");
        const averageVolume = this.getVolume("AverageVolume");
        let profileBars = volumeProfile.getVolumeProfile();

        if (this.strategyPosition !== "none" || this.candleHistory.length < 2) // candleHistory must be at least 'interval' if this function is called
            return;

        const highestVolumeBar = profileBars[0];
        if (highestVolumeBar.isBelowPrice(this.candle.close) === true && highestVolumeBar.isBelowPrice(this.candleHistory[1].close) === false) {
            // we just got below the price of the highest volume bar
            if (this.isSufficientVolume() === false)
                this.log("Insufficient volume to trade below highest volume price on volume profile +" + this.getVolumeStr());
            else if (this.action.tradeMode === "breakout")
                this.tradeWithTrend(highestVolumeBar);
            else if (this.action.tradeMode === "resistance")
                this.tradeAgainstTrend(highestVolumeBar);
            else if (this.action.tradeMode === "both") {
                //if (highestVolumeBar.getMeanPrice() < this.candle.close)
                if (averageVolume.getVolumeFactor() < this.action.minVolumeSpikeBreakout)
                    this.tradeAgainstTrend(highestVolumeBar); // assume bounce upwards
                else
                    this.tradeWithTrend(highestVolumeBar);
            }
        }
        else if (highestVolumeBar.isAbovePrice(this.candle.close) === true && highestVolumeBar.isAbovePrice(this.candleHistory[1].close) === false) {
            // we just got above the price of the highest volume bar
            if (this.isSufficientVolume() === false)
                this.log("Insufficient volume to trade above highest volume price on volume profile +" + this.getVolumeStr());
            else if (this.action.tradeMode === "breakout")
                this.tradeWithTrend(highestVolumeBar);
            else if (this.action.tradeMode === "resistance")
                this.tradeAgainstTrend(highestVolumeBar);
            else if (this.action.tradeMode === "both") {
                //if (highestVolumeBar.getMeanPrice() > this.candle.close)
                if (averageVolume.getVolumeFactor() < this.action.minVolumeSpikeBreakout)
                    this.tradeAgainstTrend(highestVolumeBar); // assume bounce downwards
                else
                    this.tradeWithTrend(highestVolumeBar);
            }
        }
        else
            this.log(utils.sprintf("Skipping trade because price %s is not within the highest volume bar %s", this.candle.close.toFixed(8), highestVolumeBar.toString()));

        // TODO any use for valueArea? another strategy could only trade outside of value area and assume price will come back into that area

        /*
        if (profileBars[0].isPriceWithinRange(this.candle.close) === true) {
            // we are in the price range of the bar with the highest volume
            if (this.isSufficientVolume() === false)
                this.log("Insufficient volume to trade on volume profile +" + this.getVolumeStr());
            else if (this.action.tradeMode === "breakout")
                this.tradeWithTrend(highestVolumeBar);
            else if (this.action.tradeMode === "resistance")
                this.tradeAgainstTrend(highestVolumeBar);
        }
        */
    }

    protected tradeWithTrend(highestVolumeBar: VolumeProfileBar) {
        // also check for the price x candles back? but that might go against or intention on highly volatile markets
        const reason = utils.sprintf("Trading with trend on highest volume profile bar with vol %s", highestVolumeBar.volume);
        if (this.candle.trend === "up")
            this.emitBuy(this.defaultWeight, reason);
        else if (this.candle.trend === "down")
            this.emitSell(this.defaultWeight, reason);
        else
            this.log("No candle trend to trade with highest volume bar");
    }

    protected tradeAgainstTrend(highestVolumeBar: VolumeProfileBar) {
        const reason = utils.sprintf("Trading against trend on highest volume profile bar with vol %s", highestVolumeBar.volume);
        if (this.candle.trend === "up")
            this.emitSell(this.defaultWeight, reason);
        else if (this.candle.trend === "down")
            this.emitBuy(this.defaultWeight, reason);
        else
            this.log("No candle trend to trade against highest volume bar");
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
}