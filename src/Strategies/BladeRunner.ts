import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, BuySellAction, StrategyAction, TradeAction} from "./AbstractStrategy";
import {AbstractTimeoutStrategy} from "./AbstractTimeoutStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";

interface BladeRunnerAction extends StrategyAction {
    //order: "buy" | "sell"; // if set to sell the bot will make short sells
    profit: number; // 2.3% // in %, required profit to sell the previously bought coins again
    fee: number; // 0.25% // in % // TODO find a way to set this per exchange? but we don't want our strategies to be aware of exchanges?
    historyCandles: number; // (optional, default 1) how many candles the strategy shall look back for the same trend before opening a position
    // removed since we use maker orders
    //priceDiffPercent: number; // 0.01% // in %, how many % above/below the current market price orders shall be placed (to avoid maker fee)
    // useful for finding good % config: http://www.alcula.com/calculators/finance/percentage-calculator/
    // TODO add "only open with trend" option from Trendatron strategy
}

type BladeState = "open" | "closed" | "opening" | "closing";

/**
 * A strategy that looks only at direct price points and buys/sells only if there is a profit,
 * meaning once the market exit price is higher/lower than the entry price (minus trading fees).
 * This strategy has 100% success rate (every trade pair wins) at the cost of some orders being stuck (no taker available)
 * which means we get the coins fully back, though they might never reach a price at which we can sell them.
 *
 * BladeRunner works best with small amounts (e.g. 0.02 BTC) on many coin pairs in parallel (>= 10).
 * http://www.traderslaboratory.com/forums/forex/19132-blade-runner-strategy.html
 */
export default class BladeRunner extends AbstractTimeoutStrategy {
    protected action: BladeRunnerAction;
    protected state: BladeState = "closed";

    constructor(options) {
        super(options)
        if (!this.action.historyCandles)
            this.action.historyCandles = 1;

        this.addInfo("entryPrice", "entryPrice");
        this.addInfo("state", "state");
        this.addInfoFunction("Price rise %", () => {
            if (this.entryPrice === -1 || this.state !== "open")
                return "-";
            return this.getPriceRisePercent().toFixed(2);
        });
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
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info); // really good idea to reset values?
        //console.log("TRADE", action, this.state)
        if (this.state === "opening") {
            this.state = "open";
            this.entryPrice = order.rate;
            this.log("opened with price", order.rate.toFixed(8))
        }
        else if (this.state === "open" || this.state === "closing") {
            this.state = "closed";
            this.log("closed with price", order.rate.toFixed(8))
        }
        else
            this.warn(utils.sprintf("Received trade %s in unknown state %s in %s", action, this.state, this.className))
        this.clearTimeout();
    }

    public getRate(action: BuySellAction) {
        if (this.state === "opening")
            //return this.avgMarketPrice;
            return -1;
        else if (this.state === "open" || this.state === "closing") {
            /*
            if (this.goLong())
                return this.getSellPrice() + this.avgMarketPrice / 100 * this.action.priceDiffPercent;
            return this.getBuyPrice() - this.avgMarketPrice / 100 * this.action.priceDiffPercent;
            */
            // we already verified the price in checkPosition() when we decided to close it
            // return -1 so the trader decides based on the order book
            return -1;
        }
        logger.warn("getRate() in %s called in unknown state %s", this.className, this.state)
        return this.avgMarketPrice;
    }

    public forceMakeOnly() {
        return true;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            if (this.state === "closed")
                this.openPosition();
            else if (this.state === "open")
                this.checkPosition();
            this.checkTimeout();
            resolve()
        })
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.logState();
            resolve()
        })
    }

    protected onTimeout() {
        if (this.state === "opening") // if we don't have enough BTC to open a position the trade fails (onTrade() never gets called)
            this.state = "closed";
        else if (/*this.state === "open" || */this.state === "closing") {
            // checkPosition() will be called repeatedly as long as the price is high/low enough
            // but if our order executed previously (TODO how?) we get "nothing to sell" error and onTrade() is never called
            // might not have been closed, but better assume close to continue
            this.state = "closed";
        }
        else {
            this.warn(utils.sprintf("Order timeout in unknown state %s in %s", this.state, this.className));
            this.state = "closed";
        }
        this.resetValues();
    }

    protected openPosition() {
        if (this.goLong() && this.candleTrend === "up" && this.historyTrendMatches("up", this.action.historyCandles)) {
            this.state = "opening";
            //this.rate = this.avgMarketPrice; // set rates dynamically to be able to adjust them
            this.log("opening LONG position at price", this.avgMarketPrice);
            this.emitBuy(this.defaultWeight, "opening LONG position");
        }
        else if (this.goShort() && this.candleTrend === "down" && this.historyTrendMatches("down", this.action.historyCandles)) {
            this.state = "opening";
            this.log("opening SHORT position at price", this.avgMarketPrice);
            this.emitSell(this.defaultWeight, "opening SHORT position");
        }
        this.startTimeout();
    }

    protected checkPosition() {
        // TODO support for SellAmount in AbstractStrategy (just like rate) to be able to keep some of our coins? tradeTotalBtc takes care of it good enough
        if (this.goLong()) {
            // we have bought coins and wait for the right price to sell
            let price = this.getSellPrice();
            if (this.avgMarketPrice >= price && this.candleTrend !== "up") {
                //this.rate = price + this.avgMarketPrice / 100 * this.action.priceDiffPercent;
                const logMessage = utils.sprintf("closing LONG position with %s%% profit", this.getPriceRisePercent().toFixed(2))
                this.log(logMessage);

                // we have to actually close margin positions (not just buying/selling)
                // otherwise our Trader skips buying/selling in the other direction.
                // the strategy doesn't know it's a margin position
                this.emitSellClose(Number.MAX_VALUE, logMessage);
                this.state = "closing";
                this.startTimeout();
            }
        }
        else {
            // we are short selling coins, wait for the right price to buy
            let price = this.getBuyPrice();
            if (this.avgMarketPrice <= price && this.candleTrend !== "down") {
                //this.rate = price - this.avgMarketPrice / 100 * this.action.priceDiffPercent;
                const logMessage = utils.sprintf("closing SHORT position after %s%% price drop", this.getPriceRisePercent().toFixed(2))
                this.log(logMessage);
                this.emitBuyClose(Number.MAX_VALUE, logMessage);
                this.state = "closing";
                this.startTimeout();
            }
        }
    }

    protected goLong() {
        return this.action.order === "buy" || this.action.order === "closeLong";
    }

    protected goShort() {
        return this.action.order === "sell" || this.action.order === "closeShort";
    }

    protected getSellPrice() {
        let entryPrice100 = this.entryPrice / 100;
        return this.entryPrice + entryPrice100 * this.action.profit + entryPrice100 * this.action.fee;
    }

    protected getBuyPrice() {
        let entryPrice100 = this.entryPrice / 100;
        return this.entryPrice - entryPrice100 * this.action.profit - entryPrice100 * this.action.fee;
    }

    protected getPriceRisePercent() {
        let rate = /*this.getRate()*/this.avgMarketPrice;
        return ((rate - this.entryPrice) / this.entryPrice) * 100; // ((y2 - y1) / y1)*100 - positive % if price is rising
    }

    protected resetValues() {
        this.entryPrice = -1;
        // state is being kept
        super.resetValues();
        // after trading candleTrend will be "none", so we will wait at least 1 candle before buying/selling again
    }

    protected logState() {
        if (this.entryPrice === -1) {
            this.log("no open position", "market price", this.avgMarketPrice.toFixed(8), "state", this.state)
            return;
        }
        let closePrice = this.action.order === "buy" ? this.getSellPrice() : this.getBuyPrice();
        this.log("state", this.state, ", market price", this.avgMarketPrice.toFixed(8), ", trend", this.candleTrend,
            ", entry price", this.entryPrice.toFixed(8), ", exit price", closePrice.toFixed(8))
    }
}