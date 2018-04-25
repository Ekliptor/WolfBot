import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeDirection, TradeInfo} from "../Trade/AbstractTrader";
import {MarginPosition} from "../structs/MarginPosition";

export interface AbstractMomentumAction extends StrategyAction {
    tradeDirection: TradeDirection | "notify" | "watch"; // optional. default "up"
    tradeOppositeDirection: boolean; // optional. default "false" = don't trade if we have an open position in the other direction
    strongRate: boolean; // optional. default true = adjust the rate to ensure the order gets filled immediately
    onlyDailyTrend: boolean; // optional. default true = only trade when the spike is in the same direction as the 24h % change
}

export abstract class AbstractMomentumStrategy extends AbstractStrategy {
    protected action: AbstractMomentumAction;
    protected nextRateFactor = 1.0;

    constructor(options) {
        super(options)
        if (!this.action.tradeDirection)
            this.action.tradeDirection = "up";
        if (typeof this.action.tradeOppositeDirection !== "boolean")
            this.action.tradeOppositeDirection = false;
        if (typeof this.action.strongRate !== "boolean")
            this.action.strongRate = true;
        if (typeof this.action.onlyDailyTrend !== "boolean")
            this.action.onlyDailyTrend = true;
        this.addInfoFunction("dailyChange", () => {
            return this.getDailyChange();
        });
        this.notificationPauseMin = 60*24;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close")
            this.done = false; // reset it so it can be triggered again
    }

    public onSyncPortfolio(coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange) {
        super.onSyncPortfolio(coins, position, exchangeLabel)
        if (this.strategyPosition === "none")
            this.done = false;
    }

    public getRate() {
        if (!this.action.strongRate)
            return super.getRate();
        return super.getRate() * this.nextRateFactor;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected openLong(reason: string) {
        if (this.action.tradeDirection === "down")
            return this.log("Skipped opening LONG position because trade direction is set to DOWN only. reason: " + reason);
        else if (!this.action.tradeOppositeDirection && this.strategyPosition === "short")
            return this.log("Skipped opening LONG position because we have an open SHORT position. reason: " + reason);
        else if (this.action.onlyDailyTrend && this.getDailyChange() < 0.0)
            return this.log("Skipped opening LONG position because the daily trend is DOWN. reason: " + reason);
        this.nextRateFactor = 1.02;
        reason += ", daily change: " + this.getDailyChange() + "%";
        this.log(reason);
        if (this.action.tradeDirection === "watch")
            return;
        if (this.action.tradeDirection === "notify")
            this.sendNotification("BUY signal", reason)
        else
            this.emitBuy(Number.MAX_VALUE, reason);
        //this.done = true; // wait until the trade actually happened in onTrade() - exchange might be down, insufficient balance,...
        // TODO this means that we will send many buy/sell signals even when "it's below the min trading balance" = disabled. ok?
    }

    protected openShort(reason: string) {
        if (this.action.tradeDirection === "up")
            return this.log("Skipped opening SHORT position because trade direction is set to UP only. reason: " + reason);
        else if (!this.action.tradeOppositeDirection && this.strategyPosition === "long")
            return this.log("Skipped opening SHORT position because we have an open LONG position. reason: " + reason);
        else if (this.action.onlyDailyTrend && this.getDailyChange() > 0.0)
            return this.log("Skipped opening SHORT position because the daily trend is UP. reason: " + reason);
        this.nextRateFactor = 0.98;
        reason += ", daily change: " + this.getDailyChange();
        this.log(reason);
        if (this.action.tradeDirection === "watch")
            return;
        if (this.action.tradeDirection === "notify")
            this.sendNotification("SELL signal", reason)
        else
            this.emitSell(Number.MAX_VALUE, reason);
        //this.done = true;
    }
}