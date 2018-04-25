import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, ScheduledTrade, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {AbstractTurnStrategy} from "./AbstractTurnStrategy";
import {TradeInfo} from "../Trade/AbstractTrader";

interface DemaAction extends TechnicalStrategyAction {
    // optional parameters
    CrossMAType: "EMA" | "DEMA" | "SMA"; // default DEMA // TODO add HMA https://discuss.tradewave.net/t/hull-moving-average/287
    autoSensitivity: boolean; // default false. automatically adjust how strong a line crossing must be based on the current market volatility
    minVolatility: number; // default 0.01 (0 = always open positions). min Bollinger Bandwidth value to open/close a position
    closeDecreasingDiff: number; // default 0 = disabled. close a position if the line diff is decreasing for x candle ticks
    resetLastCloseCount: number; // default 10 (0 = disabled). after how many candles shall the last close line diff be reset to 0
    // TODO add scalping (instead of selling on a drop). only needed for larger candle sizes (>1h)
    // TODO option to disable strategy below a certain volatility (to switch between DEMA and WaveSurfer)
    dynamicPersistence: boolean; // default false. decrease the persistence count on high volatility markets

    // optional, for defaults see BolloingerBandsParams
    N: number; // time period for MA
    K: number; // factor for upper/lower band
    MAType: number; // moving average type, 0 = SMA
}

/**
 * Strategy that emits buy/sell based on the DEMA indicator of the short and long line.
 * Strategy has an open market position over 70% of the time.
 */
export default class DEMA extends AbstractTurnStrategy {
    public action: DemaAction;
    protected lastLineDiff: number = 0;
    protected lastCloseLineDiff: number = 0;
    protected closeTickCount: number = 0;
    protected closeLineCandleTicks: number = 0;

    constructor(options) {
        super(options)
        if (!this.action.CrossMAType)
            this.action.CrossMAType = "DEMA";
        if (typeof this.action.autoSensitivity !== "boolean")
            this.action.autoSensitivity = false;
        if (!this.action.minVolatility)
            this.action.minVolatility = 0.01;
        if (!this.action.closeDecreasingDiff)
            this.action.closeDecreasingDiff = 0;
        if (typeof this.action.resetLastCloseCount !== "number")
            this.action.resetLastCloseCount = 10;
        if (typeof this.action.dynamicPersistence !== "boolean")
            this.action.dynamicPersistence = false;
        this.mainStrategy = true; // always main

        this.addIndicator("DEMA", this.action.CrossMAType, this.action);
        this.addIndicator("BollingerBands", "BollingerBands", this.action);

        this.addInfo("lastTrend", "lastTrend");
        this.addInfo("lastLineDiff", "lastLineDiff");
        this.addInfo("lastCloseLineDiff", "lastCloseLineDiff");
        this.addInfo("closeTickCount", "closeTickCount");
        this.addInfo("closeLineCandleTicks", "closeLineCandleTicks");
        this.addInfoFunction("short", () => {
            return this.action.short;
        });
        this.addInfoFunction("long", () => {
            return this.action.long;
        });
        let dema = this.indicators.get("DEMA")
        this.addInfoFunction("shortValue", () => {
            return dema.getShortLineValue();
        });
        this.addInfoFunction("longValue", () => {
            return dema.getLongLineValue();
        });
        this.addInfoFunction("line diff", () => {
            return dema.getLineDiff();
        });
        this.addInfoFunction("line diff %", () => {
            return dema.getLineDiffPercent();
        });
        let bollinger = this.getBollinger("BollingerBands")
        this.addInfoFunction("Bandwidth", () => {
            return bollinger.getBandwidth();
        });
        this.addInfoFunction("BandwidthAvgFactor", () => {
            return bollinger.getBandwidthAvgFactor();
        });
    }

    /*
    public getOrderAmount(tradeTotalBtc: number, leverage: number = 1): number {
        let amount = tradeTotalBtc * leverage;
        if (this.strategyPosition === "none")
            return amount;
        // doesn't work on most exchanges because our margin is already at its limit. we have to close our position first
        return amount * 2; // change the direction of our position
    }
    */

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            // store the value of the last close (StopLossTurn) and only open again if the value increased
            let dema = this.indicators.get("DEMA")
            //this.lastLineDiff = 0; // never reset it
            this.lastCloseLineDiff = dema.getLineDiffPercent();
            this.closeTickCount = 0;
            if (info.strategy.getClassName() !== this.className)
                this.lastTrend = "none"; // be generous and allow this strategy to open a position in the same direction we just closed
            this.entryPrice = -1;
        }
        else if (this.entryPrice === -1) // else it's TakeProfit
            this.entryPrice = order.rate;
        this.closeLineCandleTicks = 0;
    }

    public isActiveStrategy() {
        let bollinger = this.getBollinger("BollingerBands")
        if (this.action.minVolatility !== 0.0 && this.action.minVolatility > bollinger.getBandwidth())
            return false;
        return true;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        this.plotChart();
        this.checkResetValues();
        let dema = this.indicators.get("DEMA")
        let bollinger = this.getBollinger("BollingerBands")
        const diff = dema.getLineDiffPercent();
        if (!this.isActiveStrategy()) {
            this.log("market volatility too low to open/close positions. bandwidth", bollinger.getBandwidth(), ", line diff", diff)
            return;
        }

        let upThreshold = this.action.thresholds.up;
        let downThreshold = this.action.thresholds.down;
        if (this.action.autoSensitivity === true) {
            // TODO alternatively increase long/short. we can't decrease long/short without computing everything new
            // TODO alternatively use FRAMA indicator and compute EMA of the last candle, then adjust alpha for computation of current EMA
            const bandwidthAvgFactor = bollinger.getBandwidthAvgFactor();
            if (bandwidthAvgFactor > 1) { // only increase sensitivity (no decrease)
                upThreshold /= bandwidthAvgFactor;
                downThreshold /= bandwidthAvgFactor;
            }
        }

        // TODO don't open a position if this trend has already been going on for a long time (bot just started)
        // we could serialize lastTrend and diff with strategy data. but then we might not start trading for days...
        // or easier: 1. only open a position if the diff value is increasing (decreasing if negative) or 2. only if abs(diff) < 1

        if (diff > upThreshold) {
            if (this.lastTrend !== "up")
                this.persistenceCount = 0;
            this.persistenceCount++;
            this.log("UP trend detected, line diff", diff, "persistence", this.action.thresholds.persistence)
            if (this.persistenceCount >= this.getPersistence()) {
                // TODO also check for strategyPosition? but then we can't open 2x with small amounts
                if (this.lastTrend !== "up" || this.strategyPosition === "none" || (this.lastCloseLineDiff !== 0 && diff > this.lastCloseLineDiff + upThreshold)) {
                    if (this.openFirstPosition()) {
                        //this.emitBuy(this.defaultWeight, "DEMA line diff %: " + diff);
                        this.openLong("DEMA line diff %: " + diff + ", persistence: " + this.persistenceCount)
                        this.lastCloseLineDiff = 0;
                    }
                }
            }
            this.lastTrend = "up";
        }
        else if (diff < downThreshold) {
            if (this.lastTrend !== "down")
                this.persistenceCount = 0;
            this.persistenceCount++;
            this.log("DOWN trend detected, line diff", diff, "persistence", this.action.thresholds.persistence)
            if (this.persistenceCount >= this.getPersistence()) {
                if (this.lastTrend !== "down" || this.strategyPosition === "none" || (this.lastCloseLineDiff !== 0 && diff < this.lastCloseLineDiff + downThreshold)) {
                    if (this.openFirstPosition()) {
                        //this.emitSell(this.defaultWeight, "DEMA line diff %: " + diff);
                        this.openShort("DEMA line diff %: " + diff + ", persistence: " + this.persistenceCount)
                        this.lastCloseLineDiff = 0;
                    }
                }
            }
            this.lastTrend = "down";
        }
        else {
            this.persistenceCount = 0;
            this.log("no trend detected, line diff", diff)
            // TODO emit close here? but will cause too many open/close orders
        }

        // check if the value is increasing/decreasing and close a position sooner
        // TODO store entryPrice and only close if there is a profit? see MACD
        if (this.strategyPosition === "none" || this.action.closeDecreasingDiff == 0)
            return;
        if (this.lastLineDiff === 0) {
            this.lastLineDiff = diff;
            return;
        }
        if (this.strategyPosition === "long") {
            if (diff < this.lastLineDiff)
                this.closeTickCount++;
            else
                this.closeTickCount = 0;
        }
        else if (this.strategyPosition === "short") {
            if (diff > this.lastLineDiff)
                this.closeTickCount++;
            else
                this.closeTickCount = 0;
        }
        if (this.closeTickCount >= this.action.closeDecreasingDiff) {
            this.emitClose(this.defaultWeight, utils.sprintf("closing decreasing trend after %s ticks", this.closeTickCount));
            // reset it already to avoid multiple emits
            this.closeTickCount = 0;
            this.lastLineDiff = 0;
        }
        else
            this.lastLineDiff = diff;
    }

    protected getPersistence() {
        if (!this.action.dynamicPersistence)
            return this.action.thresholds.persistence;
        let persistence = this.action.thresholds.persistence;
        let bollinger = this.getBollinger("BollingerBands")
        const bandwidthAvgFactor = bollinger.getBandwidthAvgFactor();
        if (bandwidthAvgFactor <= 1) // less volatile than avg
            return persistence;
        //persistence = Math.floor(persistence / (bandwidthAvgFactor + (1 - bandwidthAvgFactor)*3));
        persistence = Math.floor(persistence / bandwidthAvgFactor);
        if (persistence < 1)
            persistence = 1;
        return persistence;
    }

    protected checkResetValues() {
        if (this.action.resetLastCloseCount > 0 && this.lastCloseLineDiff !== 0) {
            this.closeLineCandleTicks++;
            if (this.closeLineCandleTicks >= this.action.resetLastCloseCount) {
                this.log(utils.sprintf("Resetting lastCloseLineDiff after %s candle ticks", this.closeLineCandleTicks))
                this.lastTrend = "none";
                this.lastCloseLineDiff = 0;
            }
        }
        /*
        if (this.holdingCoins === 0 && this.lastTrend !== "none") {
            this.log("Resetting last trend because order didn't get filled (cancelled?)")
            this.lastTrend = "none"; // last order didn't get filled (got cancelled)
        }
        */
    }

    protected resetValues() {
        // done for close only
        //this.lastLineDiff = 0;
        //this.lastCloseLineDiff = 0;
        //this.closeTickCount = 0;
        //this.closeLineCandleTicks = 0;
        super.resetValues();
    }

    protected plotChart() {
        let dema = this.indicators.get("DEMA")
        let bollinger = this.getBollinger("BollingerBands")
        let markData = {}
        markData[this.action.CrossMAType + "Long"] = dema.getLongLineValue();
        markData[this.action.CrossMAType + "Short"] = dema.getShortLineValue();
        this.plotData.plotMark(markData);
        this.plotData.plotMark({
            bandwidth: bollinger.getBandwidth(),
            bandwidthAvgFactor: bollinger.getBandwidthAvgFactor()
        }, true)
    }
}