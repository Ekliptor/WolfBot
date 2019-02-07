import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import * as _ from "lodash";
import * as helper from "../utils/helper";
import {VolumeProfileBar} from "../Indicators/VolumeProfile";


interface VolumeProfileControlAction extends TechnicalStrategyAction {
    minPercentDivergence: number; // default 1.8. The min percentage the current price has to diverge from the highest volume profile bar to open a position.
    interval: number; // default 24. The number of candles to compute the volume profile and average volume from.
    volumeRows: number; // default 24. The number of equally-sized price zones the price range is divided into.
    valueAreaPercent: number; // default 70%. The percentage of the total volume that shall make up the value area, meaning the price range where x% of the trades happen.
    minVolumeSpike: number; // default 1.1. The min volume compared to the average volume of the last 'interval' candles to open a position.
    aroonReached: number; // default 80. If AroonUp or AroonDown are above this value the market is assumed trending and this strategy will not open positions.
}

/**
 * Strategy that waits the current price is away a certain percentage from the highest Volume Profile bar
 * and then opens a position under the assumption the price will diverge back to that price level again.
 * This is a medium/fast trading strategy designed for 5min to 30min candles in consolidating (not trending) markets.
 * This strategy only opens positions. You need a stop-loss and/or take profit strategy.
 *
 * http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:volume_by_price
 * Advanced "Volume Profile" on TradingView: https://www.tradingview.com/wiki/Volume_Profile
 */
export default class VolumeProfileControl extends TechnicalStrategy {
    public action: VolumeProfileControlAction;

    constructor(options) {
        super(options)
        if (typeof this.action.interval !== "number")
            this.action.interval = 24;
        if (typeof this.action.volumeRows !== "number")
            this.action.volumeRows = 24;
        if (typeof this.action.valueAreaPercent !== "number")
            this.action.valueAreaPercent = 70.0;
        if (typeof this.action.minVolumeSpike !== "number")
            this.action.minVolumeSpike = 1.1;
        if (typeof this.action.aroonReached !== "number")
            this.action.aroonReached = 80;

        this.addIndicator("VolumeProfile", "VolumeProfile", this.action);
        this.addIndicator("AverageVolume", "AverageVolume", this.action);
        this.addIndicator("Aroon", "Aroon", this.action);

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
        const aroon = this.getAroon("Aroon");
        this.addInfoFunction("AroonUp", () => {
            return aroon.getUp();
        });
        this.addInfoFunction("AroonDown", () => {
            return aroon.getDown();
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
        //const averageVolume = this.getVolume("AverageVolume");
        const aroon = this.getAroon("Aroon");
        let profileBars = volumeProfile.getVolumeProfile();

        if (this.strategyPosition !== "none" || this.candleHistory.length < 2) // candleHistory must be at least 'interval' if this function is called
            return;

        const highestVolumeBar = profileBars[0];
        const priceDiff = helper.getDiffPercent(this.candle.close, volumeProfile.getPointOfControl());
        if (highestVolumeBar.isPriceWithinRange(this.candle.close) === false && Math.abs(priceDiff) >= this.action.minPercentDivergence) {
            // we are far enough away from the POC
            if (this.isSufficientVolume() === false)
                this.log("Insufficient volume to trade at price outside of highest volume profile bar " + this.getVolumeStr());
            else if (aroon.getUp() >= this.action.aroonReached || aroon.getDown() >= this.action.aroonReached)
                this.log(utils.sprintf("Skipping trade because market trending, AroonUp %s, AroonDown %s", aroon.getUp(), aroon.getDown()));
            else
                this.tradeTowardsPointOfControl(highestVolumeBar, priceDiff);
        }
        else
            this.log(utils.sprintf("Skipping trade because price %s is %s%% near the highest volume bar %s", this.candle.close.toFixed(8),
                priceDiff.toFixed(2), highestVolumeBar.toString()));
    }

    protected tradeTowardsPointOfControl(highestVolumeBar: VolumeProfileBar, priceDiffPercent: number) {
        const volumeProfile = this.getVolumeProfile("VolumeProfile");
        const reason = utils.sprintf("Trading towards POC outside of highest volume profile bar with vol %s%% %s", highestVolumeBar.getVolumePercentage(volumeProfile.getTotalVolume()).toFixed(8), this.getVolumeStr());
        if (priceDiffPercent > 0.0)
            this.emitSell(this.defaultWeight, reason);
        else if (priceDiffPercent < 0.0)
            this.emitBuy(this.defaultWeight, reason);
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