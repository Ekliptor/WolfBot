import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";


interface TrendlineScalperAction extends StrategyAction {
    supportLines: number[]; // the price levels where we want to open long a position
    resistanceLines: number[]; // the price levels where we want to open short a position

    tradeBreakout: boolean; // default false. wait for support/resistance to get broken and trade the breakout direction
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
    protected lastRSI: number = -1; // identical ro RSI because it's updated on every candle tick
    protected secondLastRSI: number = -1;

    constructor(options) {
        super(options)
        if (Array.isArray(this.action.supportLines) === false)
            this.action.supportLines = [];
        if (Array.isArray(this.action.resistanceLines) === false)
            this.action.resistanceLines = [];
        if (typeof this.action.tradeBreakout !== "boolean")
            this.action.tradeBreakout = false;

        this.addInfo("secondLastRSI", "secondLastRSI");
        this.addInfoFunction("RSI", () => {
            return this.indicators.get("RSI").getValue(); // TODO notify mode + display latest x values
        });
        this.saveState = true;
        this.mainStrategy = true;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        //if (action === "close")
    }

    public serialize() {
        let state = super.serialize();
        state.lastRSI = this.lastRSI;
        state.secondLastRSI = this.secondLastRSI;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.lastRSI = state.lastRSI;
        this.secondLastRSI = state.secondLastRSI;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            resolve()
        })
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        this.checkLinesBroken(candle);
        return super.candleTick(candle)
    }

    protected checkLinesBroken(candle: Candle.Candle) {

    }

    protected checkLineBroken(candle: Candle.Candle, lines: number[], comp: "<" | ">") {
        for (let i = 0; i < lines.length; i++)
        {

        }
    }

    protected resetValues() {
        //this.pendingOrder = null; // good idea to delete order on every trade?
        super.resetValues();
    }
}