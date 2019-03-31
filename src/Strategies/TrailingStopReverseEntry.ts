import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction, ScheduledTrade} from "./AbstractStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import * as helper from "../utils/helper";


interface TrailingStopReverseEntryAction extends StrategyAction {
    supportLines: number[]; // The price levels below we want to open long a position.
    resistanceLines: number[]; // The price levels above we want to open short a position.

    // optional values
    trailingStopGoLong: number; // optional, default 2% - Place a trailing stop to go long if price reverses up and is still below the support line.
    trailingStopGoShort: number; // optional, default 2% - Place a trailing stop to go short if price reverses down and is still above the resistance line.
    expirationPercent: number; // optional, default 4%. Only execute orders at price levels that are within x% of the set support/resistance lines.
    // TODO automatically detect lines (see this.trendlines and IntervalExtremes.ts)
}

/**
 * Strategy that has pre-configured support/resistance lines. When the price crosses such a line we place a trailing stop to trade in the other
 * direction (expecting a bounce back). This trade will only happen if the entry price (when the trailing stop gets executed) is still
 * above resistance (resp. below support).
 * Works well with high leverage (10x - 20x) and RSI strategy for entry.
 * Works well on 1min candle size together with a trade strategy such as RSIOrderer or RSIScalpOrderer.
 * This strategy doesn't close positions. You must add a stop-loss and take profit strategy.
 */
export default class TrailingStopReverseEntry extends AbstractStrategy {
    public action: TrailingStopReverseEntryAction;
    protected trailingStopPrice: number = -1;
    protected stopStartPrice: number = -1;

    constructor(options) {
        super(options)
        if (Array.isArray(this.action.supportLines) === false)
            this.action.supportLines = [];
        if (Array.isArray(this.action.resistanceLines) === false)
            this.action.resistanceLines = [];
        if (typeof this.action.trailingStopGoLong !== "number")
            this.action.trailingStopGoLong = 2.0;
        if (typeof this.action.trailingStopGoShort !== "number")
            this.action.trailingStopGoShort = 2.0;
        if (!this.action.expirationPercent)
            this.action.expirationPercent = 4.0;
        //if (!this.action.tradeStrategy)
            //logger.warn("You shoud add a tradeStrategy to %s. Otherwise you might be buying into a falling knife!", this.className)

        this.saveState = true;
        this.mainStrategy = true;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        //if (action === "close")
        // TODO remove stop if position !== "none" ?
    }

    public serialize() {
        let state = super.serialize();
        state.trailingStopPrice = this.trailingStopPrice;
        state.stopStartPrice = this.stopStartPrice;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        if (state.trailingStopPrice > 0.0) // be sure this never gets undefined
            this.trailingStopPrice = state.trailingStopPrice;
        if (state.stopStartPrice > 0.0)
            this.stopStartPrice = state.stopStartPrice;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            //if (this.done) // some subclasses might set "done" after opening a position
                //return resolve();

            if (this.pendingOrder) {
                this.updateStop();
                if (this.pendingOrder.action === "sell")
                    this.checkStopSell();
                else if (this.pendingOrder.action === "buy")
                    this.checkStopBuy();
            }
            resolve();
        })
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        if (this.strategyPosition === "none" && !this.pendingOrder)
            this.checkLinesBroken(candle);
        return super.candleTick(candle)
    }

    protected checkLinesBroken(candle: Candle.Candle) {
        this.checkLineBroken(candle, this.action.supportLines, "<", "buy");
        this.checkLineBroken(candle, this.action.resistanceLines, ">", "sell");
    }

    protected checkLineBroken(candle: Candle.Candle, lines: number[], comp: "<" | ">", action: TradeAction) {
        for (let i = 0; i < lines.length; i++)
        {
            if (comp === "<") {
                if (candle.close < lines[i] && this.isWithinRange(candle.close, lines[i])) {
                    this.forwardTrade(action, lines[i]);
                    break;
                }
                continue;
            }
            // comp === ">"
            if (candle.close > lines[i] && this.isWithinRange(candle.close, lines[i])) {
                this.forwardTrade(action, lines[i]);
                break;
            }
        }
    }

    protected isWithinRange(currentRate: number, orderRate: number) {
        let percentDiff = Math.abs(helper.getDiffPercent(currentRate, orderRate));
        if (percentDiff <= this.action.expirationPercent)
            return true;
        return false;
    }

    protected forwardTrade(action: TradeAction, line: number) {
        const reason = utils.sprintf("placing trailing stop %s at %s", action.toUpperCase(), line);
        this.pendingOrder = new ScheduledTrade(action, this.defaultWeight, reason, this.className);
        this.stopStartPrice = line;
        this.updateStop(true);
    }

    protected updateStop(initialStop = false) {
        if (initialStop === false && this.trailingStopPrice === -1)
            return; // stop not set yet
        if (!this.pendingOrder) {
            this.warn("Pendig order must be set for the trailing stop to be updated");
            return;
        }
        if (this.pendingOrder.action === "buy") {
            const nextStop = this.avgMarketPrice + this.avgMarketPrice/100.0*this.action.trailingStopGoLong;
            if (this.trailingStopPrice === -1 || nextStop < this.trailingStopPrice)
                this.trailingStopPrice = nextStop;
        }
        else if (this.pendingOrder.action === "sell") {
            const nextStop = this.avgMarketPrice - this.avgMarketPrice/100.0*this.action.trailingStopGoShort;
            if (nextStop > this.trailingStopPrice)
                this.trailingStopPrice = nextStop;
        }
    }

    protected checkStopSell() {
        if (this.avgMarketPrice < this.getStopSell())
            this.openShortPosition();
    }

    protected checkStopBuy() {
        if (this.avgMarketPrice > this.getStopBuy())
            this.openLongPosition();
    }

    protected openShortPosition() {
        if (this.isWithinRange(this.avgMarketPrice, this.stopStartPrice) === false || this.avgMarketPrice < this.stopStartPrice) {
            this.log(utils.sprintf("Skipped going SHORT because market price is below resistance: %s < %s", this.avgMarketPrice.toFixed(8), this.stopStartPrice.toFixed(8)));
            return;
        }
        const reason = utils.sprintf("emitting sell because price dropped to %s, stop %s", this.avgMarketPrice.toFixed(8), this.trailingStopPrice.toFixed(8));
        this.log(reason);
        this.emitSell(Number.MAX_VALUE, reason);
        this.done = true;
    }

    protected openLongPosition() {
        if (this.isWithinRange(this.avgMarketPrice, this.stopStartPrice) === false || this.avgMarketPrice > this.stopStartPrice) {
            this.log(utils.sprintf("Skipped going LONG because market price is above support: %s > %s", this.avgMarketPrice.toFixed(8), this.stopStartPrice.toFixed(8)));
            return;
        }
        const reason = utils.sprintf("emitting buy because price rose to %s, stop %s", this.avgMarketPrice.toFixed(8), this.avgMarketPrice.toFixed(8));
        this.emitBuy(Number.MAX_VALUE, reason);
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

    protected resetValues() {
        //this.pendingOrder = null; // good idea to delete order on every trade?
        super.resetValues();
    }
}