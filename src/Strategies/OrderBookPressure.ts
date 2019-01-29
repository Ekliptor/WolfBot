import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, BuySellAction, StrategyAction, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {BollingerBands as BollingerIndicator} from "../Indicators/BollingerBands";
import {TradeInfo} from "../Trade/AbstractTrader";
import * as helper from "../utils/helper";

interface OrderBookPressureAction extends TechnicalStrategyAction {
    ticks: number; // For how many candle ticks the pressure has to persist to open a position.
    percentChange: number; // How many percent shall the price be changed by orders?
    minDiffPercent: number; // Open a position if the cost to rise/lower the price by "percentChange" differs this much.
    // 450 is a good number for strong USD_BTC pressure, otherwise 80 - depending on percentChange
    // TODO option to also open if the trend continues for x ticks and EMA confirms it

    // The percentage to increase an existing position (from another strategy) if that position has a profit
    // if enabled this strategy will work as a 2nd strategy only (not open a new position).
    increaseProfitPosition: number; // optional, default 0% = disabled

    // EMA cross params (optional)
    confirmLineCross: boolean; // default true. Use EMA to confirm direction of the order book pressure trend before opening a position.
    CrossMAType: "EMA" | "DEMA" | "SMA"; // optional, default EMA
    short: number; // default 2
    long: number; // default 7
}

/**
 * A strategy that watches the order book to see how much money is needed to rise/lower the price by x percent.
 * Then it assumes the market will move in the "cheaper" direction and trades accordingly.
 *
 * Works well on highly leveraged markets such as OKEX futures.
 * Exchanges have to be fast (responsive), so Bitfinex is also a good candidate even though they allow hidden orders (hidden from order book).
 */
export default class OrderBookPressure extends TechnicalStrategy {
    public action: OrderBookPressureAction;
    protected trendTicks: number = 0;
    protected raiseLowerDiffPercents: number[] = [];

    constructor(options) {
        super(options)
        if (nconf.get("trader") === "Backtester")
            throw new Error(utils.sprintf("%s is not available during backtesting because the order book is only available during live trading.", this.className))

        if (!this.action.increaseProfitPosition)
            this.action.increaseProfitPosition = 0;
        if (typeof this.action.confirmLineCross !== "boolean")
            this.action.confirmLineCross = true;
        if (!this.action.CrossMAType)
            this.action.CrossMAType = "EMA";
        if (!this.action.short)
            this.action.short = 2;
        if (!this.action.long)
            this.action.long = 7;
        this.mainStrategy = true;

        //this.addIndicator("MFI", "MFI", this.action); // good idea?
        this.addIndicator("EMA", this.action.CrossMAType, this.action); // can be type EMA, DEMA or SMA

        this.addInfo("ticks", "ticks");
        this.addInfo("percentChange", "percentChange");
        this.addInfo("minDiffPercent", "minDiffPercent");
        this.addInfo("lastTrend", "lastTrend");
        this.addInfo("trendTicks", "trendTicks");
        this.addInfoFunction("interval", () => {
            return this.action.interval;
        });
        this.addInfoFunction("raiseTargetPrice", () => {
            let currentPrice = this.orderBook.getLast();
            return currentPrice + currentPrice / 100 * this.action.percentChange;
        });
        this.addInfoFunction("lowerTargetPrice", () => {
            let currentPrice = this.orderBook.getLast();
            return currentPrice - currentPrice / 100 * this.action.percentChange;
        });
        this.addInfoFunction("raiseAmountBase", () => {
            return this.orderBook.getRaiseAmount(this.action.percentChange);
        });
        this.addInfoFunction("lowerAmountBase", () => {
            return this.orderBook.getLowerAmount(this.action.percentChange);
        });
        /*
        this.addInfoFunction("raiseLowerRatio", () => {
            return Math.floor(this.getRaiseLowerRatio() * 100) / 100;
        });
        */
        this.addInfoFunction("raiseLowerDiffPercent", () => {
            return Math.floor(this.getRaiseLowerDiffPercent() * 100) / 100;
        });
        this.addInfoFunction("raiseLowerDiffPercentAvg", () => {
            return Math.floor(this.getAvgRaiseLowerDiffPercent() * 100) / 100;
        });
        this.addInfoFunction("currentTrend", () => {
            return this.getRaiseLowerDiffPercent() > 0 ? "up" : "down";
        });
        this.addInfoFunction("EMA line diff %", () => {
            return this.indicators.get("EMA").getLineDiffPercent();
        });
        // TODO change the order amount based on how strong the pressure is (x times more than raiseLowerDiffPercent)
        // TODO what if WaveStopper closes our trade 1min after? add a timer to resetValues() in WaveStopper to prevent trading for x minutes or on the next tick?
        // TODO use strategyGroup in StopLossTurn to skip closing if this strategy would open the same position right away (add an interface willGoLong()...)
        // or we could just reset ticks in here after close. but that just prevents from opening right away
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
    }

    public getRate(action: BuySellAction): number {
        return -2; // use a market order (limit orders don't get filled during volatile moments)
    }

    public getOrderAmount(tradeTotalBtc: number, leverage: number = 1): number {
        if (!this.action.increaseProfitPosition)
            return super.getOrderAmount(tradeTotalBtc, leverage);
        let amount = tradeTotalBtc * leverage;
        return amount / 100 * this.action.increaseProfitPosition;
    }

    public isActiveStrategy() {
        if (this.strategyGroup.getMainStrategies().length === 0) // only this strategy is set in config
            return true;
        if (this.action.increaseProfitPosition != 0 && this.strategyGroup.getMainStrategies().length !== 0)
            return this.strategyPosition !== "none"; // only active if there already is an open position
        return true;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]): Promise<void> {
        this.addRaiseLowerDiffPercent(); // use avg of ratio on each tick instead of current value at candle tick
        return super.tick(trades)
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        return super.candleTick(candle)
    }

    protected checkIndicators() {
        // also gets called if we have 0 indicators (all ready immediately)
        //const ratio = this.getRaiseLowerRatio(); // use candleSize avg instead of current value
        //let trend: TrendDirection = ratio < 1 ? "up" : "down";
        const avgDiffPercent = this.getAvgRaiseLowerDiffPercent();
        let trend: TrendDirection = avgDiffPercent > 0 ? "up" : "down";
        this.raiseLowerDiffPercents = []; // restart will empty array and fill it up until next candle tick
        if (trend !== this.lastTrend) {
            this.lastTrend = trend;
            this.trendTicks = 0;
            this.log(utils.sprintf("New trend %s, percent %s", trend, avgDiffPercent))
            // TODO close position on trend reversal? or just use WaveStopper, StopLossTurn,...
            //return; // don't return. also alow opening at 0 (the first tick)
        }
        else
            this.trendTicks++;
        if (this.trendTicks < this.action.ticks)
            return;
        if (this.strategyPosition !== "none")
            return;

        // only check for the percentage before opening it (not when counting ticks)
        const diffPercent = Math.abs(avgDiffPercent); // use the cached value (array reset above)
        let ema = this.indicators.get("EMA")
        const emaDiff = ema.getLineDiffPercent();
        // TODO store last EMA and check if increasing/decreasing for faster reaction time
        if (this.lastTrend === "down") {
            if (diffPercent >= this.action.minDiffPercent) {
                if (!this.action.confirmLineCross || emaDiff < 0)
                    this.emitSell(this.defaultWeight, utils.sprintf("trend %s, percent %s", trend, avgDiffPercent));
                else
                    this.log(utils.sprintf("Skipped opening a SHORT position because %s doesn't confirm it with value %s", this.action.CrossMAType, emaDiff));
            }
            else
                this.log("Skipped opening a SHORT position because order book diff % is too low:", avgDiffPercent);
        }
        else if (this.lastTrend === "up") {
            if (diffPercent >= this.action.minDiffPercent) {
                if (!this.action.confirmLineCross || emaDiff > 0)
                    this.emitBuy(this.defaultWeight, utils.sprintf("trend %s, percent %s", trend, avgDiffPercent));
                else
                    this.log(utils.sprintf("Skipped opening a LONG position because %s doesn't confirm it with value %s", this.action.CrossMAType, emaDiff));
            }
            else
                this.log("Skipped opening a LONG position because order book diff % is too low:", avgDiffPercent);
        }
    }

    /**
     * Returns a how difficult it is to raise or lower the price about "percentChange"
     * @returns {number} a value > 1 if there is more money on sell orders
     * a value < 1 if there is more money on buy orders
     */
    /*
    protected getRaiseLowerRatio() {
        return this.orderBook.getRaiseAmount(this.action.percentChange) / this.orderBook.getLowerAmount(this.action.percentChange);
    }
    */

    /**
     * Equivalent to getRaiseLowerRatio(), but return value is in percent.
     * @returns {number} a value < 0 if there is more money on sell orders
     * a value > 0 if there is more money on buy orders
     */
    protected getRaiseLowerDiffPercent() {
        // positive % if raise amount bigger -> more sell orders
        // -1 to reverse it, positive = up trend, negative = down trend
        return -1 * helper.getDiffPercent(this.orderBook.getRaiseAmount(this.action.percentChange), this.orderBook.getLowerAmount(this.action.percentChange));
    }

    protected addRaiseLowerDiffPercent() {
        // TODO only keep values from last x ticks? should be dynamic such as "half of the number of ticks per candle size"
        this.raiseLowerDiffPercents.push(this.getRaiseLowerDiffPercent())
    }

    protected getAvgRaiseLowerDiffPercent() {
        let avg = 0;
        if (this.raiseLowerDiffPercents.length === 0)
            return avg;
        for (let i = 0; i < this.raiseLowerDiffPercents.length; i++)
            avg += this.raiseLowerDiffPercents[i];
        avg /= this.raiseLowerDiffPercents.length;
        return avg;
    }

    protected resetValues(): void {
        // don't reset trends
        super.resetValues();
    }
}