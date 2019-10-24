import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {ClosePositionState} from "./AbstractStopStrategy";
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import * as helper from "../utils/helper";
import {MarginPosition} from "../structs/MarginPosition";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {PendingOrder} from "../Trade/AbstractOrderTracker";


export interface AbstractTrailingStopAction extends TechnicalStrategyAction {
    trailingStopPerc: number; // optional, default 0.5% - The trailing stop percentage that will be placed after minCandles have passed.
    limitClose: boolean; // optional, default false - If enabled the trailing stop will be placed as a limit order at the last trade price (or above/below if makerMode is enabled). Otherwise the position will be closed with a market order.
    closePosition: ClosePositionState; // optional, default always - Only close a position if its profit/loss is in that defined state.

    time: number; // optional, default 0 = immediately - The time in seconds until the stop gets executed after the trailing stop has been reached.
    //keepTrendOpen: boolean; // optional, default false, Don't close if the last candle moved in our direction (only applicable with 'time' and 'candleSize' set).
    // we don't use RSI or anything because this is intended as a main strategy implementation with likely a higher candle size
}

/**
 * A template to easily implement a trailing stop strategy.
 * This class will update the trailing stop once it has been set, your implementation just has to set it initially.
 * It doesn't inerhit from the StopStrategy because it's intended to be used as a main strategy.
 * If you want to use a simple trailing stop as a stop-loss strategy, use the TimeStop strategy with minCandles = 1.
 */
export abstract class AbstractTrailingStop extends /*AbstractStopStrategy*/TechnicalStrategy {
    public action: AbstractTrailingStopAction;
    protected trailingStopPrice: number = -1;
    protected stopCountStart: Date = null;
    protected limitClosedPositions: boolean = false;

    constructor(options) {
        super(options)
        //if (typeof this.action.minCandles !== "number")
            //this.action.minCandles = 12;
        if (["always", "profit", "loss"].indexOf(this.action.closePosition) === -1)
            this.action.closePosition = "always";
        if (typeof this.action.trailingStopPerc !== "number")
            this.action.trailingStopPerc = 0.5;
        if (typeof this.action.limitClose !== "boolean")
            this.action.limitClose = false;
        if (!this.action.time) {
            this.stopCountStart = new Date(0); // sell immediately
            this.action.time = 0;
        }

        //this.addInfo("highestPrice", "highestPrice");
        //this.addInfo("lowestPrice", "lowestPrice");
        //this.addInfo("positionOpenTicks", "positionOpenTicks");
        this.addInfoFunction("stop", () => {
            return this.getStopPrice();
        });
        this.addInfoFunction("untilStopSec", () => {
            return this.getTimeUntilStopSec();
        });
        this.addInfo("stopCountStart", "stopCountStart");
        this.addInfo("entryPrice", "entryPrice");
        this.addInfo("done", "done");
        this.addInfo("limitClosedPositions", "limitClosedPositions");

        this.addInfoFunction("positionState", () => {
            return this.getPositionState();
        });

        this.saveState = true;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            this.trailingStopPrice = -1;
            this.limitClosedPositions = false;
        }
    }

    public onOrderFilled(pendingOrder: PendingOrder): void {
        super.onOrderFilled(pendingOrder);
        if (this.limitClosedPositions === true && pendingOrder.strategy.getClassName() === this.getClassName() && this.strategyPosition !== "none")
            this.emitClose(Number.MAX_VALUE, utils.sprintf("Closing remaining %s position amount %s after limit CLOSE order.", this.strategyPosition.toUpperCase(), this.getPositionAmount().toFixed(8)));
    }

    public onSyncPortfolio(coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange) {
        const previousAmount = this.getPositionAmount();
        super.onSyncPortfolio(coins, position, exchangeLabel);
        if (this.strategyPosition === "none") {
            this.trailingStopPrice = -1;
            this.limitClosedPositions = false;
        }
        else if (this.limitClosedPositions === true && previousAmount !== this.getPositionAmount()) // sometimes faster than filled order callback
            this.emitClose(Number.MAX_VALUE, utils.sprintf("Closing remaining %s position amount %s on position sync after limit CLOSE order.", this.strategyPosition.toUpperCase(), this.getPositionAmount().toFixed(8)));
    }

    public getOrderAmount(tradeTotalBtc: number, leverage: number = 1): number {
        let amount =  super.getOrderAmount(tradeTotalBtc, leverage);
        if (this.limitClosedPositions === false)
            return amount;
        return Math.abs(this.getPositionAmount()) * this.avgMarketPrice * leverage;
    }

    public serialize() {
        let state = super.serialize();
        state.trailingStopPrice = this.trailingStopPrice;
        state.limitClosedPositions = this.limitClosedPositions;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        if (state.trailingStopPrice > 0.0) // be sure this never gets undefined
            this.trailingStopPrice = state.trailingStopPrice;
        this.limitClosedPositions = state.limitClosedPositions || false;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            //if (this.done) // some subclasses might set "done" after opening a position
                //return resolve();

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

    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            super.candleTick(candle).then(() => {
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected updateStop(initialStop = false) {
        if (initialStop === false && this.trailingStopPrice === -1)
            return; // stop not set yet
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
        if (this.limitClosedPositions === true)
            return;
        else if (this.avgMarketPrice > this.getStopSell()) {
            if (this.action.time)
                this.stopCountStart = null;
            return;
        }
        if (!this.stopCountStart)
            this.stopCountStart = this.marketTime;
        else if (this.canClosePositionByState() === false)
            return this.logOnce("skipping stop SELL because of required position state:", this.action.closePosition);
        else if (this.stopCountStart.getTime() + this.getStopTimeSec() * 1000 <= this.marketTime.getTime())
            this.closeLongPosition();
    }

    protected checkStopBuy() {
        if (this.limitClosedPositions === true)
            return;
        else if (this.avgMarketPrice < this.getStopBuy()) {
            if (this.action.time)
                this.stopCountStart = null;
            return;
        }
        if (!this.stopCountStart)
            this.stopCountStart = this.marketTime;
        else if (this.canClosePositionByState() === false)
            return this.logOnce("skipping stop BUY because of required position state:", this.action.closePosition);
        else if (this.stopCountStart.getTime() + this.getStopTimeSec() * 1000 <= this.marketTime.getTime())
            this.closeShortPosition();
    }

    protected closeLongPosition() {
        this.log("emitting sell because price dropped to", this.avgMarketPrice, "stop", this.getStopSell());
        if (this.action.limitClose !== true)
            this.emitClose(Number.MAX_VALUE, this.getCloseReason(true)); // SellClose
        else {
            this.limitClosedPositions = true;
            this.emitSell(Number.MAX_VALUE, this.getCloseReason(true));
        }
        this.done = true;
    }

    protected closeShortPosition() {
        this.log("emitting buy because price rose to", this.avgMarketPrice, "stop", this.getStopBuy());
        if (this.action.limitClose !== true)
            this.emitClose(Number.MAX_VALUE, this.getCloseReason(false)); // BuyClose
        else {
            this.limitClosedPositions = true;
            this.emitBuy(Number.MAX_VALUE, this.getCloseReason(true));
        }
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

    protected getStopPrice() {
        //if (this.action.order === "sell" || this.action.order === "closeLong")
        if (this.strategyPosition === "long")
            return this.getStopSell()
        return this.getStopBuy()
    }

    protected getStopTimeSec() {
        if (this.action.time == 0)
            return 0;
        let stopTime = this.action.time;
        return stopTime > 0 ? stopTime : 1;
    }

    protected getTimeUntilStopSec() {
        if (!this.stopCountStart || this.stopCountStart.getTime() > Date.now() || this.action.time == 0 || !this.marketTime)
            return -1;
        let stopMs = this.getStopTimeSec() * 1000 - (this.marketTime.getTime() - this.stopCountStart.getTime());
        return stopMs > 0 ? Math.floor(stopMs/1000) : 0;
    }

    /**
     * Return the current position state. Will return 'loss' if there is no position (to be on the safer side when closing).
     */
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

    protected getCloseReason(closeLong: boolean) {
        let priceDiff = Math.round(helper.getDiffPercent(this.avgMarketPrice, this.entryPrice) * 100.0) / 100.0;
        const direction = closeLong ? "dropped" : "rose";
        let reason = "price " + direction + " " + priceDiff + "%";
        return reason;
    }

    protected resetValues() {
        if (this.action.time)
            this.stopCountStart = null;
        else
            this.stopCountStart = new Date(0);
        super.resetValues();
    }
}
