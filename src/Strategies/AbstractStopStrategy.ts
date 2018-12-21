import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction, StrategyOrder, StrategyEmitOrder} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {MarginPosition} from "../structs/MarginPosition";
import {TradeInfo} from "../Trade/AbstractTrader";
import * as helper from "../utils/helper";

export type ClosePositionState = "always" | "profit" | "loss";

export interface AbstractStopStrategyAction extends TechnicalStrategyAction {
    time: number; // in seconds, optional
    closePosition: ClosePositionState; // optional, default always // Only close a position if its profit/loss is in that defined state.
    increaseTimeByVolatility: boolean; // optional, default false. increase the stop time during volatile markets. takes precedence over reduceTimeByVolatility
    reduceTimeByVolatility: boolean; // optional, default true. reduce the stop time during high volatility market moments
    notifyBeforeStopSec: number; // optional, notify seconds before the stop executes

    // optional, for defaults see BolloingerBandsParams
    N: number; // time period for MA
    K: number; // factor for upper/lower band
    MAType: number; // moving average type, 0 = SMA
}

/**
 * An abstract stop strategy. Stop strategies set all values to their initial values on every buy/sell action from AbstractTrader.
 */
export abstract class AbstractStopStrategy extends /*AbstractStrategy*/TechnicalStrategy {
    protected initialOrder: StrategyOrder;
    public action: AbstractStopStrategyAction;
    protected stopCountStart: Date = null;
    protected lastCloseOrder: StrategyEmitOrder = null;
    protected closeExecuted: boolean = false; // similar to "done", but set after the order went through
    protected profitTriggerReached = false;
    protected stopNotificationSent = false;

    protected highestPrice: number = 0; // for sell/closeLong
    protected lowestPrice: number = Number.MAX_VALUE; // for buy/closeShort

    constructor(options) {
        super(options)
        if (!this.action.order)
            this.action.order = "closeLong"; // will get updated in onSync or when trading
        if (typeof this.action.increaseTimeByVolatility !== "boolean")
            this.action.increaseTimeByVolatility = false;
        if (typeof this.action.reduceTimeByVolatility !== "boolean")
            this.action.reduceTimeByVolatility = true;
        if (!this.action.notifyBeforeStopSec)
            this.action.notifyBeforeStopSec = 0;
        this.initialOrder = this.action.order;
        this.openOppositePositions = true; // sell on long position, buy on short position

        this.addIndicator("BollingerBands", "BollingerBands", this.action);
        let bollinger = this.getBollinger("BollingerBands")
        this.addInfoFunction("Bandwidth", () => {
            return bollinger.getBandwidth();
        });
        this.addInfoFunction("BandwidthAvgFactor", () => {
            return bollinger.getBandwidthAvgFactor();
        });
        this.addInfoFunction("stopTime", () => {
            //return this.action.time ? this.action.time : 0;
            return this.getStopTimeSec(); // changes with volatility and profit
        });
        this.addInfo("done", "done");
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close" || info.strategy.getClassName() === this.className || info.strategy.getInitiatorClassName() === this.className) {
            this.closeExecuted = true; // will get reset only if another strategy starts a trade
            this.entryPrice = -1;
            this.highestPrice = 0;
            this.lowestPrice = Number.MAX_VALUE;
            if (action === "close")
                this.done = false; // reset it so it can be triggered again
        }
        else if (this.entryPrice === -1) { // else it's TakeProfit
            this.entryPrice = order.rate;
            this.highestPrice = 0; // we just opened a position, reset our stop values
            this.lowestPrice = Number.MAX_VALUE;
        }
    }

    public onSyncPortfolio(coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange) {
        let previousPos = this.strategyPosition;
        let resetClosedPositionsValue = false;
        if (this.closedPositions) {
            this.closedPositions = false; // for parent function
            resetClosedPositionsValue = true;
        }
        super.onSyncPortfolio(coins, position, exchangeLabel)
        this.closedPositions = resetClosedPositionsValue;
        const isValidOrder = this.isValidOrder(this.action.order);
        if (isValidOrder === false) {
            logger.error("Invalid order action '%s' found in %s - resetting it", this.action.order, this.className)
            this.action.order = "closeLong"; // always ensure our order has a valid value for the stop to trigger. value changed in resetValues
        }
        if (this.strategyPosition !== previousPos || isValidOrder === false) {
            this.lastTrade = this.strategyPosition === "long" ? "buy" : "sell";
            this.resetValues();
        }
        if (this.strategyPosition === "none") {
            this.closedPositions = false; // reset it so that we don't close a new position again
            this.highestPrice = 0;
            this.lowestPrice = Number.MAX_VALUE;
            this.done = false;
        }
        if (this.closedPositions && this.strategyPosition !== "none" && !this.closeExecuted) {
            // this strategy needs it's own closing logic because we can close with an opposite order too
            if (this.lastCloseOrder === "buyClose")
                this.emitBuyClose(Number.MAX_VALUE, "stop strategy position out of sync");
            else if (this.lastCloseOrder === "sellClose")
                this.emitSellClose(Number.MAX_VALUE, "stop strategy position out of sync");
            else if (this.lastCloseOrder !== null)
                logger.error("Unknown lastCloseOrder %s in %s", this.lastCloseOrder, this.className)
        }
        //console.log("%s %s: %s (coins %s, margin %s)", this.className, this.action.pair.toString(), this.strategyPosition, coins, this.position.amount);
    }

    public serialize() {
        let state = super.serialize();
        state.highestPrice = this.highestPrice;
        state.lowestPrice = this.lowestPrice;
        state.profitTriggerReached = this.profitTriggerReached;
        //state.stopCountStart = this.stopCountStart; // don't save it for now. reset stop count
        state.lastCloseOrder = this.lastCloseOrder;
        state.closeExecuted = this.closeExecuted;
        state.stopNotificationSent = this.stopNotificationSent;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        if (state.highestPrice)
            this.highestPrice = state.highestPrice;
        if (state.lowestPrice)
            this.lowestPrice = state.lowestPrice;
        if (state.profitTriggerReached !== undefined)
            this.profitTriggerReached = this.profitTriggerReached;
        if (state.stopCountStart !== undefined)
            this.stopCountStart = state.stopCountStart;
        if (state.lastCloseOrder !== undefined)
            this.lastCloseOrder = state.lastCloseOrder;
        if (state.closeExecuted !== undefined)
            this.closeExecuted = state.closeExecuted;
        if (state.stopNotificationSent !== undefined)
            this.stopNotificationSent = state.stopNotificationSent;
    }

    public getStopCountStart() {
        if (!this.stopCountStart || !this.marketTime || this.stopCountStart.getTime() > this.marketTime.getTime())
            return null; // sanity checks
        return this.stopCountStart;
    }

    public onConfigChanged() {
        super.onConfigChanged();
        this.closedPositions = false;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected emitBuyClose(weight: number, reason = "") {
        super.emitBuyClose(weight, reason)
        this.closedPositions = true;
        this.lastCloseOrder = "buyClose";
    }

    protected emitSellClose(weight: number, reason = "") {
        super.emitSellClose(weight, reason)
        this.closedPositions = true;
        this.lastCloseOrder = "sellClose";
    }

    protected checkIndicators() {
        // nothing to do
    }

    protected abstract getStopPrice(): number;

    protected getStopTimeSec() {
        if (this.action.time == 0)
            return 0;
        let bollinger = this.getBollinger("BollingerBands")
        let stopTime = this.action.time;
        const bandwidthAvgFactor = bollinger.getBandwidthAvgFactor();
        if (this.action.increaseTimeByVolatility) {
            if (bandwidthAvgFactor > 1) // only increase, no reduction
                stopTime *= bandwidthAvgFactor;
            return stopTime > 0 ? stopTime : 1;
        }
        if (!this.action.reduceTimeByVolatility)
            return this.action.time;
        if (bandwidthAvgFactor > 1) { // only reduce time (no increase)
            stopTime = Math.floor(stopTime / bandwidthAvgFactor);
        }
        return stopTime > 0 ? stopTime : 1;
    }

    protected getTimeUntilStopSec() {
        if (!this.stopCountStart || this.stopCountStart.getTime() > Date.now() || this.action.time == 0 || !this.marketTime)
            return -1;
        let stopMs = this.getStopTimeSec() * 1000 - (this.marketTime.getTime() - this.stopCountStart.getTime());
        return stopMs > 0 ? Math.floor(stopMs/1000) : 0;
    }

    protected getCloseReason(closeLong: boolean) {
        let priceDiff = Math.round(helper.getDiffPercent(this.avgMarketPrice, this.entryPrice) * 100.0) / 100.0;
        const direction = closeLong ? "dropped" : "rose";
        let reason = "price " + direction + " " + priceDiff + "%";
        let rsi = this.indicators.get("RSI");
        if (rsi)
            reason += ", RSI " + rsi.getValue().toFixed(2);
        return reason;
    }

    protected sendStopNotification() {
        let message = utils.sprintf("remaining time %s min, entry price %s, current price %s, %sstop %s, position %s",
            //Math.floor(this.action.notifyBeforeStopSec / 60),
            Math.floor(this.getTimeUntilStopSec() / 60), // use the actual time because this function might be called later
            this.entryPrice.toFixed(8), this.avgMarketPrice.toFixed(8),
            (this.useProfitStop() ? "profit " : ""), this.getStopPrice().toFixed(8), this.strategyPosition);
        if (this.position)
            message += ", p/l: " + this.position.pl.toFixed(8) + " " + this.action.pair.getBase();
        this.sendNotification("Stop imminent", message);
        this.stopNotificationSent = true;
    }

    protected getPositionState(): ClosePositionState {
        let profit = false;
        if (this.position) // margin trading
            profit = this.hasProfitReal();
        else
            profit = this.hasProfit(this.entryPrice);
        return profit === true ? "profit" : "loss";
    }

    protected canClosePositionByState() {
        switch (this.action.closePosition) {
            case "profit":
            case "loss":
                return this.getPositionState() === this.action.closePosition;
            default: // always
                return true;
        }
    }

    protected useProfitStop() {
        return false; // overwrite in subclass accordingly
    }

    protected resetValues(): void {
        super.resetValues();
        //this.highestPrice = 0;
        //this.lowestPrice = Number.MAX_VALUE;
        //this.entryPrice = -1;
        this.lastCloseOrder = null;
        this.closeExecuted = false;
        this.profitTriggerReached = false;

        // if we changed our position we have to change the stop action
        if (!this.action.order)
            return;
        // TODO doesn't get reset now after onTrade()? only after next sync
        // if our main strategy does multiple buy/sell actions (DEMA) then this will close the last action
        if ((this.action.order !== "sell" && this.action.order !== "closeLong" && this.lastTrade === "buy") ||
            (this.action.order !== "buy" && this.action.order !== "closeShort" && this.lastTrade === "sell"))
        {
            if (this.action.order.indexOf("close") === 0) // the strategy is set to close
                this.action.order = this.lastTrade === "buy" ? "closeLong" : "closeShort";
            else // the strategy is set to sell/buy to minimize loss
                this.action.order = this.lastTrade === "buy" ? "sell" : "buy";
        }
        else if (this.strategyPosition !== "none")
            this.log("Increased position in the same direction. Not changing stop order")
    }
}