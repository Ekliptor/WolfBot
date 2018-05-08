import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import * as helper from "../utils/helper";


interface TrendlineScalperAction extends StrategyAction {
    supportLines: number[]; // the price levels where we want to open long a position
    resistanceLines: number[]; // the price levels where we want to open short a position

    // optional values
    tradeBreakout: boolean; // default false = assume price will bounce. true = wait for support/resistance to get broken and trade the breakout direction
    expirationPercent: number; // default 3%. expire orders after they move away x% from the set rate
    // TODO automatically detect lines (see this.trendlines and IntervalExtremes.ts)
}

/**
 * Strategy has pre-configured support/resistance lines. Whenever the price gets close to that line we open a trade in the other
 * direction (expecting a bounce back). Works well with high leverage (10x - 20x) and RSI strategy for entry.
 * Works well on 1min candle size together with a trade strategy such as RSIOrderer or RSIScalpOrderer.
 * This strategy doesn't close positions. You must add a stop-loss and take profit strategy.
 */
export default class TrendlineScalper extends AbstractStrategy {
    public action: TrendlineScalperAction;

    constructor(options) {
        super(options)
        if (Array.isArray(this.action.supportLines) === false)
            this.action.supportLines = [];
        if (Array.isArray(this.action.resistanceLines) === false)
            this.action.resistanceLines = [];
        if (typeof this.action.tradeBreakout !== "boolean")
            this.action.tradeBreakout = false;
        if (!this.action.expirationPercent)
            this.action.expirationPercent = 3.0;
        if (!this.action.tradeStrategy)
            logger.warn("You shoud add a tradeStrategy to %s. Otherwise you might be buying into a falling knife!", this.className)

        this.saveState = true;
        this.mainStrategy = true;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        //if (action === "close")
    }

    public serialize() {
        let state = super.serialize();
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            resolve()
        })
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        if (this.strategyPosition === "none")
            this.checkLinesBroken(candle);
        return super.candleTick(candle)
    }

    protected checkLinesBroken(candle: Candle.Candle) {
        if (this.action.tradeBreakout === false) {
            this.checkLineBroken(candle, this.action.supportLines, "<", "buy");
            this.checkLineBroken(candle, this.action.resistanceLines, ">", "sell");
        }
        else {
            this.checkLineBroken(candle, this.action.supportLines, "<", "sell");
            this.checkLineBroken(candle, this.action.resistanceLines, ">", "buy");
        }
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
        const reason = utils.sprintf("trading %s at %s", this.action.tradeBreakout ? "BREAKOUT" : "BOUNCE", line);
        if (action === "buy")
            this.emitBuy(this.defaultWeight, reason, this.className);
        else // sell
            this.emitSell(this.defaultWeight, reason, this.className);
    }

    protected resetValues() {
        //this.pendingOrder = null; // good idea to delete order on every trade?
        super.resetValues();
    }
}