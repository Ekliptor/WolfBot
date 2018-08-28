import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {AbstractStopStrategy, AbstractStopStrategyAction} from "./AbstractStopStrategy";
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import * as helper from "../utils/helper";


type ClosePositionState = "always" | "profit" | "loss";

interface TimeStopAction extends AbstractStopStrategyAction {
    minCandles: number; // 12 // The minimum number of candles a position has to be open before being closed.
    trailingStopPerc: number; // optional, default 0.05% // The trailing stop percentage that will be placed after minCandles have passed.
    closePosition: ClosePositionState; // optional, default always // Only close a position if its profit/loss is in that defined state.

    time: number; // in seconds, optional // The time until the stop gets executed after the trailing stop has been reached.
    keepTrendOpen: boolean; // optional, default false, Don't close if the last candle moved in our direction (only applicable with 'time' and 'candleSize' set).
    notifyBeforeStopSec: number; // optional, notify seconds before the stop executes

    // optional RSI values: don't close short if RSI < low (long if RSI > high)
    low: number; // 52 // default 0 = disabled // This strategy will never close short positions during RSI oversold.
    high: number; // 56 // This strategy will never close long positions during RSI overbought.
    interval: number; // default 9
}

/**
 * A different kind of close-strategy, similar to a stop-loss strategy. This strategy places a trailing stop after a position was open
 * for a certain amount of candles. It can optionally look at RSI values before closing a position or only close if the position has a profit or loss.
 * Ideal for daytraders who want to exit the market after a certain amount of time to minimize risks.
 */
export default class TimeStop extends AbstractStopStrategy {
    public action: TimeStopAction;
    protected trailingStopPrice: number = -1;
    //protected priceTime: Date = new Date(Date.now() +  365*utils.constants.DAY_IN_SECONDS * 1000); // time of the last high/low
    protected lastRSI: number = -1; // identical ro RSI because it's updated on every candle tick

    constructor(options) {
        super(options)
        //if (typeof this.action.minCandles !== "number")
            //this.action.minCandles = 12;
        if (["always", "profit", "loss"].indexOf(this.action.closePosition) === -1)
            this.action.closePosition = "always";
        if (typeof this.action.trailingStopPerc !== "number")
            this.action.trailingStopPerc = 0.05;
        if (!this.action.time)
            this.stopCountStart = new Date(0); // sell immediately
        if (this.action.keepTrendOpen === undefined)
            this.action.keepTrendOpen = false;
        if (!this.action.interval)
            this.action.interval = 9;

        if (this.action.low > 0 && this.action.high > 0)
            this.addIndicator("RSI", "RSI", this.action);

        //this.addInfo("highestPrice", "highestPrice");
        //this.addInfo("lowestPrice", "lowestPrice");
        this.addInfo("positionOpenTicks", "positionOpenTicks");
        this.addInfoFunction("stop", () => {
            return this.getStopPrice();
        });
        this.addInfoFunction("untilStopSec", () => {
            return this.getTimeUntilStopSec();
        });
        this.addInfo("stopCountStart", "stopCountStart");
        this.addInfo("entryPrice", "entryPrice");

        this.addInfoFunction("positionState", () => {
            return this.getPositionState();
        });
        if (this.action.low > 0 && this.action.high > 0) {
            this.addInfoFunction("RSI", () => {
                return this.indicators.get("RSI").getValue();
            });
        }

        this.saveState = true;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            this.trailingStopPrice = -1;
        }
    }

    public serialize() {
        let state = super.serialize();
        state.trailingStopPrice = this.trailingStopPrice;
        state.lastRSI = this.lastRSI;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.trailingStopPrice = state.trailingStopPrice;
        this.lastRSI = state.lastRSI;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            if (this.done)
                return resolve();

            if (this.strategyPosition !== "none") {
                this.updateStop();
                if (this.action.order === "sell" || this.action.order === "closeLong")
                    this.checkStopSell();
                else if (this.action.order === "buy" || this.action.order === "closeShort")
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

    protected checkIndicators() {
        if (this.action.low  > 0 && this.action.high > 0) {
            let rsi = this.indicators.get("RSI")
            const value = rsi.getValue();

            if (value > this.action.high) {
                this.log("RSI UP trend detected, value", value)
            }
            else if (value < this.action.low) {
                this.log("RSI DOWN trend detected, value", value)
            }
            else
                this.log("no RSI trend detected, value", value);
            this.lastRSI = value;
        }
    }

    protected updateStop() {
        if (this.positionOpenTicks < this.action.minCandles)
            return;
        if (this.strategyPosition === "long") {
            const nextStop = this.avgMarketPrice - this.avgMarketPrice/100.0*this.action.trailingStopPerc;
            if (nextStop > this.trailingStopPrice)
                this.trailingStopPrice = nextStop;
            //this.strategyPosition = "none"; // to prevent the strategy being stuck // Backtester can sync state now too
        }
        else if (this.strategyPosition === "short") {
            const nextStop = this.avgMarketPrice + this.avgMarketPrice/100.0*this.action.trailingStopPerc;
            if (nextStop < this.trailingStopPrice)
                this.trailingStopPrice = nextStop;
            //this.strategyPosition = "none";
        }
    }

    protected checkStopSell() {
        if (this.avgMarketPrice > this.getStopSell()) {
            if (this.action.time)
                this.stopCountStart = null;
            this.stopNotificationSent = false;
            return;
        }
        if (!this.stopCountStart)
            this.stopCountStart = this.marketTime;
        // must come first to prevent sending notification too late
        else if (this.action.notifyBeforeStopSec && !this.stopNotificationSent && this.getTimeUntilStopSec() > 0 && this.getTimeUntilStopSec() < this.action.notifyBeforeStopSec)
            this.sendStopNotification();
        else if (this.action.keepTrendOpen === true && this.candleTrend === "up")
            return this.logOnce("skipping stop SELL because candle trend is up %", this.candle.getPercentChange());
        else if (this.lastRSI !== -1 && this.lastRSI > this.action.high)
            return this.logOnce("skipping stop SELL because RSI value indicates up:", this.lastRSI);
        else if (this.canClosePositionByState() === false)
            return this.logOnce("skipping stop SELL because of required position state:", this.action.closePosition);
        else if (this.stopCountStart.getTime() + this.getStopTimeSec() * 1000 <= this.marketTime.getTime())
            this.closeLongPosition();
    }

    protected checkStopBuy() {
        if (this.avgMarketPrice < this.getStopBuy()) {
            if (this.action.time)
                this.stopCountStart = null;
            this.stopNotificationSent = false;
            return;
        }
        if (!this.stopCountStart)
            this.stopCountStart = this.marketTime;
        // must come first to prevent sending notification too late
        else if (this.action.notifyBeforeStopSec && !this.stopNotificationSent && this.getTimeUntilStopSec() > 0 && this.getTimeUntilStopSec() < this.action.notifyBeforeStopSec)
            this.sendStopNotification();
        else if (this.action.keepTrendOpen === true && this.candleTrend === "down")
            return this.logOnce("skipping stop BUY because candle trend is down %", this.candle.getPercentChange());
        else if (this.lastRSI !== -1 && this.lastRSI < this.action.low)
            return this.logOnce("skipping stop BUY because RSI value indicates down:", this.lastRSI);
        else if (this.canClosePositionByState() === false)
            return this.logOnce("skipping stop BUY because of required position state:", this.action.closePosition);
        else if (this.stopCountStart.getTime() + this.getStopTimeSec() * 1000 <= this.marketTime.getTime())
            this.closeShortPosition();
    }

    protected closeLongPosition() {
        this.log("emitting sell because price dropped to", this.avgMarketPrice, "stop", this.getStopSell());
        this.emitSellClose(Number.MAX_VALUE, this.getCloseReason(true) + (this.profitTriggerReached ? ", profit triggered" : ""));
        this.done = true;
    }

    protected closeShortPosition() {
        this.log("emitting buy because price rose to", this.avgMarketPrice, "stop", this.getStopBuy());
        this.emitBuyClose(Number.MAX_VALUE, this.getCloseReason(false) + (this.profitTriggerReached ? ", profit triggered" : ""));
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
        if (this.action.order === "sell" || this.action.order === "closeLong")
            return this.getStopSell()
        return this.getStopBuy()
    }

    protected getStopTimeSec() {
        return super.getStopTimeSec();
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

    protected resetValues() {
        if (this.action.time)
            this.stopCountStart = null;
        else
            this.stopCountStart = new Date(0);
        super.resetValues();
    }
}