import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

type EntryIndicatorName = "RSI" | "CCI" | "MFI"; // OBV is unbound, bad for trading config

interface UnlimitedMarginAction extends TechnicalStrategyAction {
    profitTargetPercent: number; // optional, default 1.5%. The net profit of your total margin position (opened during multiple trades) when it shall be closed.
    interval: number; // optional, default 15. The number of candles to use for the high/low calculation to compute the entry indicator value from.
    minVolumeSpike: number; // optional, default 1.1. The min volume compared to the average volume of 'interval' candles to open a first position.

    entryIndicator: EntryIndicatorName; // default RSI. The indicator to use to open and increase a position.
    low: number; // optional, default 28. Only go long if the entry indicator is below this value.
    high: number; // optional, default 72. Only go short if the entry indicator is above this value.

    maxGoLongPrice: number; // optional, default 0 = any price. The maximum price to open a long position.
    minGoShortPrice: number; // optional, default 0 = any price. The minimum price to open a short position.
}

/**
 * Strategy that always closes positions at a profit. This is done by increasing the position size.
 * To be able to always increase your position size as required you should set about 0.5 - 1.0 % of your total available trading capital for this strategy
 * to begin its first trade. Hence the name "unlimited" margin. This strategy is intended to be used for margin trading.
 * This strategy is optimized for the top 20 coins by market cap. It should not be used with other coins!
 * The first trade of this strategy will be AGAINST the current trend of your chosen indicator and this position will be increased on successive indicator highs/lows.
 * This strategy will open and close existing positions, so don't combine it with take-profit or stop-loss strategies to avoid unintended side effects (positions
 * closing at a loss).
 * Keep in mind that during Backtesting trading fees are deducted which might still decrease your total balance if 'profitTargetPercent' isn't high enough and during
 * real-time trading exchanges will charge you interest rates for margin trading.
 */
export default class UnlimitedMargin extends TechnicalStrategy {
    public action: UnlimitedMarginAction;

    constructor(options) {
        super(options)
        if (typeof this.action.profitTargetPercent !== "number")
            this.action.profitTargetPercent = 1.5;
        if (typeof this.action.interval !== "number")
            this.action.interval = 15;
        if (typeof this.action.minVolumeSpike !== "number")
            this.action.minVolumeSpike = 1.1;
        if (typeof this.action.entryIndicator !== "string")
            this.action.entryIndicator = "RSI";
        if (typeof this.action.low !== "number")
            this.action.low = 50;
        if (typeof this.action.high !== "number")
            this.action.high = 50;
        if (typeof this.action.maxGoLongPrice !== "number")
            this.action.maxGoLongPrice = 0.0;
        if (typeof this.action.minGoShortPrice !== "number")
            this.action.minGoShortPrice = 0.0;

        this.addIndicator("AverageVolume", "AverageVolume", this.action);
        this.addIndicator("EntryIndicator", this.action.entryIndicator, this.action);

        const entryIndicator = this.indicators.get("EntryIndicator");
        this.addInfoFunction("EntryIndicatorValue", () => {
            return entryIndicator.getValue();
        });
        const averageVolume = this.getVolume("AverageVolume");
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
        if (this.strategyPosition !== "none")
            this.checkCloseProfitablePosition();
        else
            this.checkOpenFirstPosition();
    }

    protected checkOpenFirstPosition() {
        const entryIndicator = this.indicators.get("EntryIndicator");
        const value = entryIndicator.getValue();
        if (value < this.action.low) {
            if (this.action.maxGoLongPrice == 0.0 || this.action.maxGoLongPrice < this.candle.close) {
                if (this.isSufficientVolume() === false)
                    this.log("Insufficient volume to go long on indicator low " + this.getVolumeStr());
                else
                    this.emitBuy(this.defaultWeight, utils.sprintf("%s low reached at %s, going LONG against trend", this.action.entryIndicator, value.toFixed(8)));
            }
        }
        else if (value > this.action.high) {
            if (this.action.minGoShortPrice == 0.0 || this.action.minGoShortPrice > this.candle.close) {
                if (this.isSufficientVolume() === false)
                    this.log("Insufficient volume to go short on indicator high " + this.getVolumeStr());
                else
                    this.emitSell(this.defaultWeight, utils.sprintf("%s high reached at %s, going SHORT against trend", this.action.entryIndicator, value.toFixed(8)));
            }
        }
        else
            this.log(utils.sprintf("No %s trend detected at value %s", this.action.entryIndicator, value.toFixed(8)));
    }

    protected checkCloseProfitablePosition() {
        if (this.hasProfitReal(this.action.profitTargetPercent) === true) {
            this.emitClose(Number.MAX_VALUE, utils.sprintf("Profit target %s%% reached", this.action.profitTargetPercent));
            return;
        }

        // check if we should increase our existing position
        const entryIndicator = this.indicators.get("EntryIndicator");
        const value = entryIndicator.getValue(); // here we don't check the avg volume again
        if (this.strategyPosition === "long" && value < this.action.low) {
            this.emitBuy(this.defaultWeight, utils.sprintf("%s low reached at %s, increasing LONG against trend", this.action.entryIndicator, value.toFixed(8)));
        }
        else if (this.strategyPosition === "short" && value > this.action.high) {
            this.emitSell(this.defaultWeight, utils.sprintf("%s high reached at %s, increasing SHORT against trend", this.action.entryIndicator, value.toFixed(8)));
        }
        else {
            const pl = this.position ? this.position.pl : 0.0;
            this.log(utils.sprintf("Keeping position at same size with %s trend %s at p/l %s %s", this.action.entryIndicator, value.toFixed(8),
                pl.toFixed(8), Currency.getCurrencyLabel(this.action.pair.from)));
        }
    }

    protected isSufficientVolume() {
        if (this.action.minVolumeSpike == 0.0)
            return true; // disabled
        let indicator = this.getVolume("AverageVolume")
        return indicator.getVolumeFactor() >= this.action.minVolumeSpike;
    }

    protected getVolumeStr() {
        let indicator = this.getVolume("AverageVolume");
        return utils.sprintf("%s %s, spike %sx", indicator.getValue().toFixed(8), this.action.pair.getBase(), indicator.getVolumeFactor().toFixed(8));
    }
}