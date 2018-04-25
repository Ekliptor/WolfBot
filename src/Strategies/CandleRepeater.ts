import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeDirection, TradeInfo} from "../Trade/AbstractTrader";

interface CandleRepeaterAction extends StrategyAction {
    maxPrevUpCandlePercent: number; // the maximum % the last candle can increase to assume the trend will continue and open a long position
    maxPrevDownCandlePercent: number; // the maximum % the last candle can decrease to assume the trend will continue and open a short position
    tradeDirection: TradeDirection; // optional. default "up"
}

/**
 * Strategy that assumes the candle of the previous day will repeat itself on the next day (trends tend to continue).
 * Works best with large candle sizes such as 24h (1440 min) or 12h (720 min).
 * This strategy needs StopLoss and/or TakeProfit strategies to close positions.
 * Similar to SimpleAndShort and DayTrendFollower strategy.
 */
export default class CandleRepeater extends AbstractStrategy {
    protected action: CandleRepeaterAction;

    constructor(options) {
        super(options)
        if (!this.action.tradeDirection)
            this.action.tradeDirection = "up";

        this.addInfo("done", "done");
        this.addInfoFunction("candleChange", () => {
            return this.getLastCandleChange()
        })
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            this.done = false;
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            resolve()
        })
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.followPreviousCandle();
            resolve()
        })
    }

    protected followPreviousCandle() {
        //if (this.strategyPosition !== "none") // always allow to trade once
        if (this.done)
            return;

        const candleChange = this.getLastCandleChange();
        const candleChangeAbs = Math.abs(candleChange);
        if (this.candleTrend === "up" && this.strategyPosition !== "short") { // don't trade in the opposite direction of our position
            if (candleChangeAbs < this.action.maxPrevUpCandlePercent)
                this.openLong(utils.sprintf("Last candle trend was UP with %s%%", candleChange));
            else
                this.log(utils.sprintf("Prevented opening position on candle trend %s because change is too high %s%%", this.candleTrend.toUpperCase(), candleChange))
        }
        else if (this.candleTrend === "down" && this.strategyPosition !== "long") {
            if (candleChangeAbs < this.action.maxPrevDownCandlePercent)
                this.openShort(utils.sprintf("Last candle trend was DOWN with %s%%", candleChange));
            else
                this.log(utils.sprintf("Prevented opening position on candle trend %s because change is too high %s%%", this.candleTrend.toUpperCase(), candleChange))
        }
        else
            this.log(utils.sprintf("No candle trend, change %s%%", candleChange))
    }

    protected openLong(reason: string) {
        if (this.action.tradeDirection === "down")
            return this.log("Skipped opening LONG position because trade direction is set to DOWN only. reason: " + reason);
        //else if (!this.action.tradeOppositeDirection && this.strategyPosition === "short")
            //return this.log("Skipped opening LONG position because we have an open SHORT position. reason: " + reason);
        this.log(reason);
        this.emitBuy(Number.MAX_VALUE, reason);
        //this.done = true; // wait until the trade actually happened in onTrade() - exchange might be down, insufficient balance,...
    }

    protected openShort(reason: string) {
        if (this.action.tradeDirection === "up")
            return this.log("Skipped opening SHORT position because trade direction is set to UP only. reason: " + reason);
        //else if (!this.action.tradeOppositeDirection && this.strategyPosition === "long")
            //return this.log("Skipped opening SHORT position because we have an open LONG position. reason: " + reason);
        this.log(reason);
        this.emitSell(Number.MAX_VALUE, reason);
        //this.done = true;
    }

    protected getLastCandleChange() {
        if (!this.candle)
            return -1;
        const candleChange = this.candle.getPercentChange();
        return Math.round(candleChange * 100) / 100.0; // 2 decimals is enough for display
    }

    protected resetValues(): void {
        super.resetValues();
    }
}