import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {AbstractStopStrategy, AbstractStopStrategyAction} from "./AbstractStopStrategy";
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import {MarginPosition} from "../structs/MarginPosition";
import * as helper from "../utils/helper";

interface ProtectProfitAction extends AbstractStopStrategyAction {
    profit: number; // 0.8% // in %. The threshold in percent at which we enable this stop after we have reached that amount of profit.
    profitFactor: number; // 2.1 // How much a position has to fall back from 'profit' to be closed. For example profitFactor 2.0 -> from 0.8% to 0.4%
    // time the threshold has to be passed to trigger the stop
    time: number; // default = 120. in seconds, optional // The number of seconds the position has to be below the defined profit target to be closed. A value of 0 closes it immediately.
    minOpenTime: number; // default = 900. in seconds, optional // TODO move to the "profit" threshold
    // The number of seconds a position has to be open before it can be closed. This is useful if you are doing scalping and want to wait at least x seconds for the price to reverse before taking a loss.
    ensureProfitPercent: number; // 0.25% (0 = disabled) // Only close if we really have this profit according to the exchange API. Useful if you do manual trading along with the bot. This setting might cause a position to be never closed.
    // entryPrice + trading fees also make it difficult to be certain. rise this value to be more sure at the risk of missing to close the position

    // only works for margin/futures trading
    useRealProfitLoss: boolean; // default false. Use the real profit/loss value from the exchange API (instead of this strategy's entry price) for all computations. Useful if increase the position by manual trading.
    // Only updated about every 6min with margin position.. // TODO some exchanges publish the position via Websocket too
    // TODO use RSI with a bigger candleSize and close only if the trend against our position is strong
}

/**
 * A different kind of stop loss strategy that protects our profits by selling/buying before our
 * position turns into a loss.
 *
 * Futures example:
 *  "ProtectProfit": {
          "profit": 0.9,
          "time": 30,
          "useRealProfitLoss": true,
          "candleSize": 1,
          "pair": "USD_BTC",
          "enableLog": true
        },

 StopLoss:
 "setback": 3.5,
 "time": 1800,
 */
export default class ProtectProfit extends AbstractStopStrategy {
    public action: ProtectProfitAction;
    protected stopCountStart: Date = null;
    //protected priceTime: Date = new Date(Date.now() +  365*utils.constants.DAY_IN_SECONDS * 1000); // time of the last high/low
    protected positionProfitableStart: Date = null; // TODO reset if we turn into a loss? (stop doesn't fire, error, fast market,...)

    constructor(options) {
        super(options)
        if (typeof this.action.profitFactor !== "number")
            this.action.profitFactor = 2.1;
        if (typeof this.action.time !== "number")
            this.action.time = 120;
        if (!this.action.time)
            this.stopCountStart = new Date(0); // sell immediately
        if (!this.action.minOpenTime)
            this.action.minOpenTime = 900;
        if (typeof this.action.ensureProfitPercent !== "number")
            this.action.ensureProfitPercent = 0.25;
        if (typeof this.action.useRealProfitLoss !== "boolean")
            this.action.useRealProfitLoss = false;

        // TODO add RSI and only close if trend against our position is strong?
        this.addInfo("highestPrice", "highestPrice");
        this.addInfo("lowestPrice", "lowestPrice");
        this.addInfoFunction("stop", () => {
            if (this.isCloseLongPending() === true)
                return this.getStopSell()
            return this.getStopBuy()
        });
        this.addInfoFunction("stopClose", () => {
            if (this.isCloseLongPending() === true)
                return this.getStopSell(true)
            return this.getStopBuy(true)
        });
        this.addInfoFunction("untilStopSec", () => {
            if (!this.stopCountStart || this.stopCountStart.getTime() > Date.now() || this.action.time == 0 || !this.marketTime)
                return -1;
            let stopMs = this.action.time * 1000 - (this.marketTime.getTime() - this.stopCountStart.getTime());
            return stopMs > 0 ? Math.floor(stopMs/1000) : 0;
        });
        this.addInfoFunction("profitLossPercent", () => {
            return this.position ? this.position.getProfitLossPercent(this.avgMarketPrice) : 0.0;
        });
        this.addInfo("stopCountStart", "stopCountStart");
        this.addInfo("entryPrice", "entryPrice");
        this.addInfo("positionSyncPrice", "positionSyncPrice");
        this.addInfo("positionOpened", "positionOpened");
        this.addInfo("positionProfitableStart", "positionProfitableStart");
        this.addInfoFunction("hasProfit", () => {
            return this.hasProfit(this.entryPrice);
        });

        this.saveState = true;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            this.entryPrice = -1;
            this.positionProfitableStart = null;
        }
        else if (this.entryPrice === -1) // else it's TakeProfit
            this.entryPrice = order.rate; // TODO sometimes not getting set. but get's set in onSyncPortfolio(). set entryPrice in parent class?
    }

    public onSyncPortfolio(coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange) {
        super.onSyncPortfolio(coins, position, exchangeLabel)
        if (this.strategyPosition === "none") {
            this.positionProfitableStart = null;
        }
        else if (this.action.useRealProfitLoss && this.position && !this.positionProfitableStart && !this.position.isEmpty() && this.position.pl > 0.0)
            this.positionProfitableStart = this.marketTime;
    }

    public serialize() {
        let state = super.serialize();
        state.positionProfitableStart = this.positionProfitableStart;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.positionProfitableStart = state.positionProfitableStart;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            if (this.done)
                return resolve();
            if (!this.action.candleSize || this.highestPrice === 0) { // first init exception
                if (this.avgMarketPrice > this.highestPrice) {
                    this.highestPrice = this.avgMarketPrice;
                }
                if (this.avgMarketPrice < this.lowestPrice) { // on first call both conditions are true
                    this.lowestPrice = this.avgMarketPrice;
                }
            }

            if (this.strategyPosition !== "none") {
                if (this.isCloseLongPending() === true)
                    this.checkStopSell();
                else if (this.isCloseShortPending() === true)
                    this.checkStopBuy();
            }
            resolve()
        })
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (candle.high > this.highestPrice) {
                this.highestPrice = candle.high;
            }
            if (candle.low < this.lowestPrice) {
                this.lowestPrice = candle.low;
            }
            resolve()
        })
    }

    protected getStopPrice() {
        if (this.isCloseLongPending() === true)
            return this.getStopSell()
        return this.getStopBuy()
    }

    protected checkStopSell() {
        if (!this.hasProfit(this.entryPrice) && !this.positionProfitableStart) // don't set minPercent here or we won't sell anymore if the price keeps falling
            return; // enable stop after position was profitable
        if (!this.canClose())
            return;
        if (this.avgMarketPrice > this.getStopSell()) {
            if (this.action.time)
                this.stopCountStart = null;
            if (!this.positionProfitableStart)
                this.positionProfitableStart = this.marketTime;
            return;
        }
        if (this.action.minOpenTime > 0) {
            if (!this.positionProfitableStart)
                return; // position was never profitable
            else if (this.positionProfitableStart.getTime() + this.action.minOpenTime*1000 > this.marketTime.getTime())
                return; // position wasn't profitable long enough
        }
        if (this.avgMarketPrice > this.getStopSell(true))
            return this.logOnce("Reached SELL closing gap of LONG position. Close near...");
        else if (this.isRisingMoment())
            return this.logOnce(utils.sprintf("Preventing SELL close because of rising moment. now %s, last %s, close %s", this.avgMarketPrice, this.lastAvgMarketPrice, this.candle.close));
        if (!this.stopCountStart)
            this.stopCountStart = this.marketTime;
        else if (this.stopCountStart.getTime() + this.action.time * 1000 <= this.marketTime.getTime() && this.closeNow()) {
            this.log("emitting sell because price dropped to", this.avgMarketPrice, "stop", this.getStopSell());
            this.emitSellClose(Number.MAX_VALUE, "price dropped");
            this.done = true;
        }
    }

    protected checkStopBuy() {
        if (!this.hasProfit(this.entryPrice) && !this.positionProfitableStart)
            return; // enable stop after position was profitable
        if (!this.canClose())
            return;
        if (this.avgMarketPrice < this.getStopBuy()) {
            if (this.action.time)
                this.stopCountStart = null;
            if (!this.positionProfitableStart)
                this.positionProfitableStart = this.marketTime;
            return;
        }
        if (this.action.minOpenTime > 0) {
            if (!this.positionProfitableStart)
                return; // position was never profitable
            else if (this.positionProfitableStart.getTime() + this.action.minOpenTime*1000 > this.marketTime.getTime())
                return; // position wasn't profitable long enough
        }
        if (this.avgMarketPrice < this.getStopBuy(true))
            return this.logOnce("Reached BUY closing gap of SHORT position. Close near...");
        else if (!this.isRisingMoment())
            return this.logOnce(utils.sprintf("Preventing BUY close because of falling moment. now %s, last %s, close %s", this.avgMarketPrice, this.lastAvgMarketPrice, this.candle.close));
        if (!this.stopCountStart)
            this.stopCountStart = this.marketTime;
        else if (this.stopCountStart.getTime() + this.action.time * 1000 <= this.marketTime.getTime() && this.closeNow()) {
            this.log("emitting buy because price rose to", this.avgMarketPrice, "stop", this.getStopBuy());
            this.emitBuyClose(Number.MAX_VALUE, "price rose");
            this.done = true;
        }
    }

    protected getStopSell(close = false) {
        //return this.highestPrice - this.highestPrice / 100 * this.action.profit;
        if (this.entryPrice < 0)
            return -1;
        const percentage = close ? this.action.profit / this.action.profitFactor : this.action.profit;
        // opposite to StopLossTurn. we want to sell above the entry price before our position turns into a loss
        if (this.action.useRealProfitLoss && this.position) {
            if (this.position.getProfitLossPercent(this.avgMarketPrice) < percentage && this.avgMarketPrice < this.positionSyncPrice)
                return this.avgMarketPrice - this.avgMarketPrice / 100.0; // just sell 1% below current rate
            return this.avgMarketPrice + this.avgMarketPrice / 100.0; // never sell, always 1% above
        }
        return this.entryPrice + this.entryPrice / 100 * percentage;
    }

    protected getStopBuy(close = false) {
        //return this.lowestPrice + this.lowestPrice / 100 * this.action.profit;
        if (this.entryPrice < 0)
            return -1;
        const percentage = close ? this.action.profit / this.action.profitFactor : this.action.profit;
        if (this.action.useRealProfitLoss && this.position) {
            if (this.position.getProfitLossPercent(this.avgMarketPrice) < percentage && this.avgMarketPrice > this.positionSyncPrice)
                return this.avgMarketPrice + this.avgMarketPrice / 100.0; // just buy 1% above current rate // TODO or use positionSyncPrice?
            return this.avgMarketPrice - this.avgMarketPrice / 100.0; // never buy, always 1% below
        }
        return this.entryPrice - this.entryPrice / 100 * percentage;
    }

    protected canClose() {
        if (this.strategyPosition === "long" && this.candleTrend === "up")
            return false;
        if (this.strategyPosition === "short" && this.candleTrend === "down")
            return false;
        return this.positionOpened && this.positionOpened.getTime() + this.action.minOpenTime*1000 < this.getMarketTime().getTime();
    }

    protected closeNow() {
        if (!this.action.ensureProfitPercent)
            return true;
        return this.hasProfit(this.entryPrice, Math.min(this.action.ensureProfitPercent, this.action.profit / this.action.profitFactor));
    }

    protected isRisingMoment() {
        // too frequent with trades. use candles
        //return this.avgMarketPrice > this.lastAvgMarketPrice; // TODO check orderbook too
        if (!this.candle)
            return false;
        return this.avgMarketPrice > this.lastAvgMarketPrice && this.avgMarketPrice > this.candle.close;
    }

    protected resetValues() {
        if (this.action.time)
            this.stopCountStart = null;
        else
            this.stopCountStart = new Date(0);
        super.resetValues();
    }
}
