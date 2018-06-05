import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, ScheduledTrade, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {AbstractTurnStrategy} from "./AbstractTurnStrategy";
import {TradeInfo} from "../Trade/AbstractTrader";
import * as helper from "../utils/helper";

interface PercentDemaAction extends TechnicalStrategyAction {
    long: number; // The number of candles for the indicator.
    minPercent: number; // How strong the current price has to change from the DEMA to open a position.

    // optional parameters
    CrossMAType: "EMA" | "DEMA" | "SMA"; // default DEMA
    takeProfitTicks: number; // default 0 = disabled. Close a position early if the MACD histogram decreases for x candles.
    closeLossEarly: boolean; // default = true. Close positions at a loss after takeProfitTicks too.
}

/**
 * Strategy that emits buy/sell based on the % change of a single (long) DEMA line (instead of line crosses of 2 DEMAs).
 * This works best for daytrading with a short candle size such as 30min or 15min.
 */
export default class PercentDEMA extends AbstractTurnStrategy {
    public action: PercentDemaAction;
    protected lastPercentChange: number = -1;
    protected decreasingTrendTicks: number = 0;

    constructor(options) {
        super(options)
        if (!this.action.CrossMAType)
            this.action.CrossMAType = "DEMA";
        if (!this.action.takeProfitTicks)
            this.action.takeProfitTicks = 0;
        if (!this.action.closeLossEarly)
            this.action.closeLossEarly = true;
        this.mainStrategy = true; // always main

        this.addIndicator("DEMA", this.action.CrossMAType, this.action);

        this.addInfo("lastTrend", "lastTrend");
        this.addInfoFunction("short", () => {
            return this.action.short;
        });
        let dema = this.indicators.get("DEMA")
        this.addInfoFunction("longValue", () => {
            return dema.getLongLineValue();
        });
        this.addInfoFunction("price diff %", () => {
            return helper.getDiffPercent(dema.getLongLineValue(), this.avgMarketPrice);
        });
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            //if (info.strategy.getClassName() !== this.className)
                //this.lastTrend = "none"; // be generous and allow this strategy to open a position in the same direction we just closed
            this.entryPrice = -1;
        }
        else if (this.entryPrice === -1) // else it's TakeProfit
            this.entryPrice = order.rate;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        this.plotChart();
        let dema = this.indicators.get("DEMA")
        const changePercent = helper.getDiffPercent(dema.getLongLineValue(), this.avgMarketPrice);

        if (changePercent > this.action.minPercent) {
            if (this.lastTrend !== "up")
                this.persistenceCount = 0;
            this.persistenceCount++;
            this.log("UP trend detected, price diff", changePercent, "persistence", this.action.thresholds.persistence)
            if (this.persistenceCount >= this.getPersistence()) {
                if (this.lastTrend !== "up" || this.strategyPosition === "none") {
                    if (this.openFirstPosition()) {
                        //this.emitBuy(this.defaultWeight, "DEMA price diff %: " + diff);
                        this.openLong("DEMA price diff %: " + changePercent + ", persistence: " + this.persistenceCount)
                    }
                }
            }
            this.lastTrend = "up";
        }
        else if (changePercent < this.action.minPercent*-1) {
            if (this.lastTrend !== "down")
                this.persistenceCount = 0;
            this.persistenceCount++;
            this.log("DOWN trend detected, price diff", changePercent, "persistence", this.action.thresholds.persistence)
            if (this.persistenceCount >= this.getPersistence()) {
                if (this.lastTrend !== "down" || this.strategyPosition === "none") {
                    if (this.openFirstPosition()) {
                        //this.emitSell(this.defaultWeight, "DEMA price diff %: " + diff);
                        this.openShort("DEMA price diff %: " + changePercent + ", persistence: " + this.persistenceCount)
                    }
                }
            }
            this.lastTrend = "down";
        }
        else {
            this.persistenceCount = 0;
            this.log("no trend detected, price diff", changePercent)
        }

        if (this.action.takeProfitTicks !== 0 && this.lastPercentChange !== -1 && Math.abs(changePercent) < Math.abs(this.lastPercentChange)) {
            this.decreasingTrendTicks++;
            // if we don't have a profit (and DEMA is most likely in the same direction) don't close it early to avoid opening & closing repeatedly
            if (this.decreasingTrendTicks >= this.action.takeProfitTicks && (this.action.closeLossEarly || this.hasProfit(this.entryPrice))) {
                this.emitClose(this.defaultWeight, utils.sprintf("closing decreasing %s trend after %s ticks", this.lastTrend.toUpperCase(), this.decreasingTrendTicks));
                this.decreasingTrendTicks = 0; // reset, but shouldn't fire again either way
            }
        }
        else {
            //this.decreasingTrendTicks = 0; // decrement instead
            if (this.decreasingTrendTicks > 0)
                this.decreasingTrendTicks--;
        }

        this.lastPercentChange = changePercent;
    }

    protected getPersistence() {
        return this.action.thresholds.persistence; // usually 1
    }

    protected resetValues() {
        // done for close only
        this.decreasingTrendTicks = 0;
        super.resetValues();
    }

    protected plotChart() {
        let dema = this.indicators.get("DEMA")
        let markData = {}
        markData[this.action.CrossMAType + "Long"] = dema.getLongLineValue();
        //markData[this.action.CrossMAType + "Short"] = dema.getShortLineValue();
        this.plotData.plotMark(markData);
    }
}