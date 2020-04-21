import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction, StrategyOrder, StrategyEmitOrder} from "./AbstractStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {MarginPosition} from "../structs/MarginPosition";
import {TradeInfo} from "../Trade/AbstractTrader";
import * as helper from "../utils/helper";

export interface AbstractTakeProfitStrategyAction extends TechnicalStrategyAction {
    time: number; // in seconds, optional. only close the position if the price doesn't reach a new high/low within this time
    reduceTimeByVolatility: boolean; // optional, default true. reduce the stop time during high volatility market moments
    trailingStopPerc: number; // optional, default 0.0% (0 = trade immediately) - The trailing stop percentage that will be placed once the computed profit target of the strategy has been reached.

    // optional, for defaults see BolloingerBandsParams
    N: number; // time period for MA
    K: number; // factor for upper/lower band
    MAType: number; // moving average type, 0 = SMA
}

/**
 * An abstract take profit strategy. Take profit strategies reset their values on every buy/sell action from AbstractTrader.
 */
export abstract class AbstractTakeProfitStrategy extends /*AbstractStrategy*/TechnicalStrategy {
    protected initialOrder: StrategyOrder;
    public action: AbstractTakeProfitStrategyAction;
    protected stopCountStart: Date = null; // TODO 2nd counter to also check if there is a new low
    protected lastCloseOrder: StrategyEmitOrder = null;
    protected closeExecuted: boolean = false; // similar to "done", but set after the order went through

    protected highestPrice: number = 0; // for sell/closeLong
    protected lowestPrice: number = Number.MAX_VALUE; // for buy/closeShort
    protected trailingStopPrice: number = -1;

    constructor(options) {
        super(options)
        if (!this.action.order)
            this.action.order = "closeLong"; // will get updated in onSync or when trading
        if (typeof this.action.reduceTimeByVolatility !== "boolean")
            this.action.reduceTimeByVolatility = false;
        if (typeof this.action.trailingStopPerc !== "number")
            this.action.trailingStopPerc = 0.0;
        this.initialOrder = this.action.order;
        this.openOppositePositions = true; // sell on long position, buy on short position
        this.saveState = true; // our indicators need history
        // TODO merge with AbstractStopStrategy or add more features

        this.addIndicator("BollingerBands", "BollingerBands", this.action);
        let bollinger = this.getBollinger("BollingerBands")
        this.addInfoFunction("Bandwidth", () => {
            return bollinger.getBandwidth();
        });
        this.addInfoFunction("BandwidthAvgFactor", () => {
            return bollinger.getBandwidthAvgFactor();
        });
        this.addInfoFunction("stopTime", () => {
            return this.getStopTimeSec();
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
            if (action === "close") {
                this.done = false; // reset it so it can be triggered again
                this.trailingStopPrice = -1;
            }
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
            this.trailingStopPrice = -1;
            this.done = false;
        }
        if (this.closedPositions && this.strategyPosition !== "none" && !this.closeExecuted) {
            // this strategy needs it's own closing logic because we don't close all of our position
            if (this.lastCloseOrder === "buy")
                this.emitBuy(Number.MAX_VALUE, "profit strategy position out of sync");
            else if (this.lastCloseOrder === "sell")
                this.emitSell(Number.MAX_VALUE, "profit strategy position out of sync");
            else if (this.lastCloseOrder !== null)
                logger.error("Unknown lastCloseOrder %s in %s", this.lastCloseOrder, this.className)
        }
    }

    public serialize() {
        let state = super.serialize();
        state.highestPrice = this.highestPrice;
        state.lowestPrice = this.lowestPrice;
        state.stopCountStart = this.stopCountStart; // counter starts/resets differently than in stop strategy. store it
        state.lastCloseOrder = this.lastCloseOrder;
        state.closeExecuted = this.closeExecuted;
        state.trailingStopPrice = this.trailingStopPrice;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        if (state.highestPrice)
            this.highestPrice = state.highestPrice;
        if (state.lowestPrice)
            this.lowestPrice = state.lowestPrice;
        if (state.stopCountStart)
            this.stopCountStart = state.stopCountStart;
        if (state.lastCloseOrder)
            this.lastCloseOrder = state.lastCloseOrder;
        if (state.closeExecuted)
            this.closeExecuted = state.closeExecuted;
        if (state.trailingStopPrice > 0.0) // be sure this never gets undefined
            this.trailingStopPrice = state.trailingStopPrice;
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

    public getTakeProfitPrice() { // simpler than in AbstractStopStrategy where we also check config values
        if (this.isCloseLongPending() === true)
            return this.getStopSell();
        return this.getStopBuy();
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            //if (this.done) // some subclasses might set "done" after opening a position
                //return resolve();

            // child classes will have other implementations of these functions, so we have to call both
            if (this.strategyPosition !== "none") {
                this.updateStop();
                //if (this.action.order === "sell" || this.action.order === "closeLong")
                if (this.strategyPosition === "long")
                    this.checkStopSell();
                //else if (this.action.order === "buy" || this.action.order === "closeShort")
                else if (this.strategyPosition === "short")
                    this.checkStopBuy();
            }
            super.tick(trades).then(() => {
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected emitBuy(weight: number, reason = "") {
        super.emitBuy(weight, reason)
        this.closedPositions = true;
        this.lastCloseOrder = "buy";
    }

    protected emitSell(weight: number, reason = "") {
        super.emitSell(weight, reason)
        this.closedPositions = true;
        this.lastCloseOrder = "sell";
    }

    protected checkIndicators() {
        // nothing to do
    }

    protected getStopTimeSec() {
        if (this.action.time == 0)
            return 0;
        if (!this.action.reduceTimeByVolatility)
            return this.action.time;
        let bollinger = this.getBollinger("BollingerBands")
        let stopTime = this.action.time;
        const bandwidthAvgFactor = bollinger.getBandwidthAvgFactor();
        if (bandwidthAvgFactor > 1) { // only reduce time (no increase)
            stopTime = Math.floor(stopTime / bandwidthAvgFactor);
        }
        return stopTime > 0 ? stopTime : 1;
    }

    protected updateStop(initialStop = false) {
        if (initialStop === false && this.trailingStopPrice === -1)
            return; // stop not set yet
        if (this.action.trailingStopPerc <= 0.0) {
            this.warn("Can not set trailing stop because config trailingStopPerc must be greater than 0");
            return;
        }
        if (this.strategyPosition === "long") {
            const nextStop = this.avgMarketPrice - this.avgMarketPrice/100.0*this.action.trailingStopPerc;
            if (nextStop > this.trailingStopPrice)
                this.trailingStopPrice = nextStop;
            //this.strategyPosition = "none"; // to prevent the strategy being stuck // Backtester can sync state now too
        }
        else if (this.strategyPosition === "short") {
            const nextStop = this.avgMarketPrice + this.avgMarketPrice/100.0*this.action.trailingStopPerc;
            if (this.trailingStopPrice === -1 || nextStop < this.trailingStopPrice)
                this.trailingStopPrice = nextStop;
            //this.strategyPosition = "none";
        }
    }

    protected checkStopSell() {
        if (this.avgMarketPrice > this.getStopSell()) {
            if (this.action.time)
                this.stopCountStart = null;
            return;
        }
        if (!this.stopCountStart)
            this.stopCountStart = this.marketTime;
        //else if (this.canClosePositionByState() === false)
            //return this.logOnce("skipping stop SELL because of required position state:", this.action.closePosition);
        else if (this.stopCountStart.getTime() + this.getStopTimeSec() * 1000 <= this.marketTime.getTime())
            this.closeLongPosition();
    }

    protected checkStopBuy() {
        if (this.avgMarketPrice < this.getStopBuy()) {
            if (this.action.time)
                this.stopCountStart = null;
            return;
        }
        if (!this.stopCountStart)
            this.stopCountStart = this.marketTime;
        //else if (this.canClosePositionByState() === false)
            //return this.logOnce("skipping stop BUY because of required position state:", this.action.closePosition);
        else if (this.stopCountStart.getTime() + this.getStopTimeSec() * 1000 <= this.marketTime.getTime())
            this.closeShortPosition();
    }

    protected closeLongPosition() {
        this.log("emitting sell because price dropped to", this.avgMarketPrice, "stop", this.getStopSell());
        this.emitClose(Number.MAX_VALUE, this.getCloseReason(true)); // SellClose, TakeProfitPartial will just use another order amount
        this.done = true;
    }

    protected closeShortPosition() {
        this.log("emitting buy because price rose to", this.avgMarketPrice, "stop", this.getStopBuy());
        this.emitClose(Number.MAX_VALUE, this.getCloseReason(false)); // BuyClose, TakeProfitPartial will just use another order amount
        this.done = true;
    }

    protected getStopSell() {
        if (this.trailingStopPrice !== -1)
            return this.trailingStopPrice;
        return 0.0;
    }

    protected getStopBuy() {
        if (this.trailingStopPrice !== -1)
            return this.trailingStopPrice;
        return Number.MAX_VALUE;
    }

    protected getCloseReason(closeLong: boolean) {
        let priceDiff = Math.round(helper.getDiffPercent(this.avgMarketPrice, this.entryPrice) * 100.0) / 100.0;
        const direction = closeLong ? "dropped" : "rose";
        let reason = "price " + direction + " " + priceDiff + "%";
        return reason;
    }

    protected resetValues(): void {
        super.resetValues();
        //this.highestPrice = 0;
        //this.lowestPrice = Number.MAX_VALUE;
        this.lastCloseOrder = null;
        this.closeExecuted = false;

        // if we changed our position we have to change the stop action
        if (!this.action.order)
            return;
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
