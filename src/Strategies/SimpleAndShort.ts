import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";

interface SimpleAndShortAction extends StrategyAction {
    stopStart: number;          // 3% // At how many percent loss shall stop loss buy the first 1/3 back.
    takeProfitStart: number;    // 10% // At how many percent shall the bot start taking profits.
    historyCandles: number; // (optional, default 1) How many candles the strategy shall look back for the same trend before opening a position.
    // It will only open a position if all candles go into the same direction.
    initialOrder: "buy" | "sell"; // optional, default Just wait for the first candle trend and follow it.
}

/**
 * A Strategy that doesn't look for any indicators. Instead it simply decides to buy/sell like this:
 * - If the stock is going up, buy it if I don't have any.
 * - If the stock is going down, short sell it if I don't have any.
 * - place 3 stops above and below the initial price to sell/buy the coin again.
 * Similar to CandleRepeater and DayTrendFollower strategy.
 * Works well with larger candle sizes from 1-4 hours.
 *
 * Alternative to sell all (currently not used, use other strategies)
 * - If I have some and I am losing money from what I bought, sell <- replace by StopLoss strategy
 * - If I have some and it made money (more than the fees) and it is dropping, sell <- replace by TakeProfit strategy
 * https://cryptotrader.org/topics/588268/stop-loss-bot-will-pay-for-this
 * https://cryptotrader.org/strategies/5w4ewcpGLTq26jAjT
 */
export default class SimpleAndShort extends AbstractStrategy {
    // arrays should have the same length
    protected static readonly STOP_STEPS = [0, 1, 2]; // 3,4,5 %
    protected static readonly PROFIT_STEPS = [0, 3, 5]; // 10,13,15 %

    protected action: SimpleAndShortAction;
    protected trades = 0;
    //protected positions: Order.Order[] = [];
    // every time we place an order we place stops in 2 directions: sell/buy 33% each time at x% rise/fall
    protected lossStops: number[] = [];
    protected profitStops: number[] = [];

    constructor(options) {
        super(options)
        if (!this.action.historyCandles)
            this.action.historyCandles = 1;
        if (this.action.initialOrder !== "buy" && this.action.initialOrder !== "sell")
            this.action.initialOrder = null;

        this.addInfo("trades", "trades");
        this.addInfo("holdingCoins", "holdingCoins");
        this.addInfo("entryPrice", "entryPrice");
        this.addInfoFunction("Candle trends", () => {
            let trends = []
            for (let i = 0; i < this.action.historyCandles; i++)
            {
                let candle = this.getCandleAt(i);
                if (candle)
                    trends.push(candle.trend);
            }
            return trends.toString();
        });
        this.addInfoFunction("loss stops", () => {
            return this.lossStops.toString()
        })
        this.addInfoFunction("profit stops", () => {
            return this.profitStops.toString()
        })
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            this.strategyPosition = "none";
            this.lossStops = [];
            this.profitStops = [];
            this.orderAmountPercent = 0.0;
            this.entryPrice = -1;
            this.done = false;
        }
    }

    public forceMakeOnly() {
        return true;
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
            if (this.trades === 0 && this.action.initialOrder)
                this.openInitialPosition();
            else if (this.strategyPosition === "none")
                this.openTrendPosition();
            else
                this.checkStops();
            //this.logState();
            resolve()
        })
    }

    protected openInitialPosition() {
        if (this.action.initialOrder === "buy") {
            this.openLong();
            this.emitBuy(this.defaultWeight, "Initial BUY order");
        }
        else if (this.action.initialOrder === "sell") {
            this.openShort();
            this.emitSell(this.defaultWeight, "Initial SELL order");
        }
        else
            logger.error("Can not execute unknown initial order %s in %s", this.action.initialOrder, this.className)
    }

    protected openTrendPosition() {
        // TODO check the orderbook too?
        if (this.candleTrend === "up" && this.historyTrendMatches("up", this.action.historyCandles)) {
            this.openLong();
            this.emitBuy(this.defaultWeight, "Trend BUY order");
        }
        else if (this.candleTrend === "down" && this.historyTrendMatches("down", this.action.historyCandles)) {
            this.openShort();
            this.emitSell(this.defaultWeight, "Trend SELL order");
        }
    }

    protected checkStops() {
        // TODO if we don't trade on margin (const amount) we would have to buy back 1/2 of amount the 2nd time
        const rate = this.candle.close;
        if (this.lossStops.length > 0 && (
            (this.strategyPosition === "long" && rate <= this.lossStops[0]) || (this.strategyPosition === "short" && rate >= this.lossStops[0]))) {
            this.orderAmountPercent = this.lossStops.length > 1 ? 100 / SimpleAndShort.PROFIT_STEPS.length : 100;
            this.lossStops.shift();
            const reason = utils.sprintf("Stop loss SELL order %s", SimpleAndShort.PROFIT_STEPS.length - this.lossStops.length);
            if (this.orderAmountPercent === 100)
                this.emitClose(this.defaultWeight, reason)
            else {
                if (this.strategyPosition === "long")
                    this.emitSell(this.defaultWeight, reason);
                else
                    this.emitBuy(this.defaultWeight, reason);
            }
        }
        else if (this.profitStops.length > 0 && (
            (this.strategyPosition === "long" && rate >= this.profitStops[0]) || (this.strategyPosition === "short" && rate <= this.profitStops[0]))) {
            this.orderAmountPercent = this.profitStops.length > 1 ? 100 / SimpleAndShort.PROFIT_STEPS.length : 100;
            this.profitStops.shift();
            const reason = utils.sprintf("Stop profit BUY order %s", SimpleAndShort.PROFIT_STEPS.length - this.profitStops.length)
            if (this.orderAmountPercent === 100)
                this.emitClose(this.defaultWeight, reason)
            else {
                if (this.strategyPosition === "long")
                    this.emitSell(this.defaultWeight, reason);
                else
                    // there is no short-selling on non-margin. so buying as close means we have to be on margin trading
                    this.emitBuy(this.defaultWeight, reason);
            }
        }
    }

    protected openLong() {
        this.strategyPosition = "long";
        this.trades++;
        // sell above current price (profit), sell below current price (loss)
        this.lossStops = this.createStops(this.action.stopStart, SimpleAndShort.STOP_STEPS, true);
        this.profitStops = this.createStops(this.action.takeProfitStart, SimpleAndShort.PROFIT_STEPS, false);
    }

    protected openShort() {
        this.strategyPosition = "short";
        this.trades++;
        // buy below the current price (profit), buy above the current price (loss)
        this.lossStops = this.createStops(this.action.stopStart, SimpleAndShort.STOP_STEPS, false);
        this.profitStops = this.createStops(this.action.takeProfitStart, SimpleAndShort.PROFIT_STEPS, true);
    }

    protected createStops(start: number, steps: number[], directionDown: boolean) {
        const startRate = this.candle.close;
        this.entryPrice = startRate;
        let rate = startRate;
        if (directionDown)
            rate -= startRate / 100 * start;
        else
            rate += startRate / 100 * start;
        let stops = [];
        for (let i = 0; i < steps.length; i++)
        {
            // always use % from the start rate. ok?
            if (directionDown)
                rate -= startRate / 100 * steps[i];
            else
                rate += startRate / 100 * steps[i];
            stops.push(rate)
        }
        return stops;
    }

    protected resetValues(): void {
        //this.breakoutCount = 0;
        // don't reset trends
        super.resetValues();
    }
}