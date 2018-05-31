import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {AbstractStopStrategy, AbstractStopStrategyAction} from "./AbstractStopStrategy";
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";

interface EarlyStopLossAction extends AbstractStopStrategyAction {
    // RSI thresholds when to immediately close an open position in the other direction
    low: number; // 20 // Below this value RSI will be considered oversold. The strategy will immediately close a long position.
    high: number; // 80 // Above this value RSI will be considered overbought. The strategy will immediately close a short position.
    interval: number; // optional, default 6 // The number of candles to use for RSI computation.

    // optional RSI values to close sooner if there is a profit
    profitLow: number; // 35
    profitHigh: number; // 70

    // from PriceSpikeDetector
    spikeClose: number; // optional, default 0 = disabled. Close a position if the price (current vs last candle) moves x% into the opposite direction. Simply put: If there is a price spike against our position.
    historyCandle: number; // optional, default 36. How many candles to look back to compare if price really is a spike. Set 0 to disable it.

    // TODO optionally close immediately by avgMarketPrice instead of waiting for the next candle tick
    // TODO add an option to immediately open a position in the other direction?
    // TODO option to wait for x candle ticks on loss?
}

/**
 * A stop loss strategy that looks at fast price movements (RSI with small candle size) and exits the market immediately.
 * We could try to enter the market like this too, but this should be combined with more signals (such as RSI and Bollinger) in a different
 * strategy to prevent false positives.
 *
 * previous Bitfinex config:
 * "EarlyStopLoss": {
          "order": "closeLong",
          "low": 15,
          "high": 85,
          "profitLow": 28,
          "profitHigh": 77,
          "spikeClose": 1.7,
          "candleSize": 5,
          "pair": "BTC_ETH",
          "enableLog": false
        },

 futures config:
 "EarlyStopLoss": {
                    "order": "closeLong",
                    "low": 21,
                    "high": 79,
                    "profitLow": 35,
                    "profitHigh": 70,
                    "spikeClose": 1.1,
                    "candleSize": 3,
                    "pair": "USD_BTC",
                    "enableLog": false
                },
 */
export default class EarlyStopLoss extends AbstractStopStrategy {
    protected static MIN_SPIKE_TRADE_WAIT_SEC = 60;
    public action: EarlyStopLossAction;
    protected lastCandle: Candle.Candle = null;
    protected lastSpikeTrade = new Date(0);

    constructor(options) {
        super(options)
        if (!this.action.interval)
            this.action.interval = 6;
        if (!this.action.spikeClose)
            this.action.spikeClose = 0;
        if (this.action.historyCandle === undefined)
            this.action.historyCandle = 36;

        this.addIndicator("RSI", "RSI", this.action);
        this.addInfoFunction("low", () => {
            return this.action.low;
        });
        this.addInfoFunction("high", () => {
            return this.action.high;
        });
        this.addInfoFunction("interval", () => {
            return this.action.interval;
        });
        this.addInfoFunction("RSI", () => {
            return this.indicators.get("RSI").getValue();
        });
        //this.addInfoFunction("lastCandleClose", () => {
            //return this.lastCandle ? this.lastCandle.close : -1;
        //});
        this.addInfoFunction("priceDiffPercent", () => {
            const priceDiffPercentTxt = this.getPriceDiffPercent().toFixed(2) + "%";
            return priceDiffPercentTxt;
        });
        this.addInfoFunction("hasProfit", () => {
            return this.hasProfit(this.entryPrice);
        });

        this.saveState = true;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close")
            this.entryPrice = -1;
        else if (this.entryPrice === -1) // else it's TakeProfit
            this.entryPrice = order.rate;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        this.checkPriceSpike();
        return super.tick(trades);
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        this.lastCandle = candle;
        return super.candleTick(candle);
    }

    protected checkIndicators() {
        // TODO if current volume > 2* last candle volume it could also be a sign to close early
        if (this.strategyPosition === "none")
            return; // nothing to do. be quiet

        let rsi = this.indicators.get("RSI")
        const value = rsi.getValue();
        const valueFormatted = Math.round(value * 100) / 100.0;
        const hasProfit = this.hasProfit(this.entryPrice);
        // TODO check for this.action.thresholds.persistence, add a counter
        if (value > this.action.high) {
            this.log("UP trend detected, value", value)
            if (this.strategyPosition === "short")
                this.emitBuyClose(Number.MAX_VALUE, "RSI value: " + valueFormatted);
        }
        else if (this.action.profitHigh != 0 && hasProfit && value > this.action.profitHigh) {
            this.log("UP (profit) trend detected, value", value)
            if (this.strategyPosition === "short")
                this.emitBuyClose(Number.MAX_VALUE, "RSI profit value: " + valueFormatted);
        }
        else if (value < this.action.low) {
            this.log("DOWN trend detected, value", value)
            if (this.strategyPosition === "long")
                this.emitSellClose(Number.MAX_VALUE, "RSI value: " + valueFormatted);
        }
        else if (this.action.profitLow != 0 && hasProfit && value < this.action.profitLow) {
            this.log("DOWN (profit) trend detected, value", value)
            if (this.strategyPosition === "long")
                this.emitSellClose(Number.MAX_VALUE, "RSI profit value: " + valueFormatted);
        }
        else
            this.log("no trend detected, value", value)
    }

    protected checkPriceSpike() {
        if (this.lastSpikeTrade.getTime() + EarlyStopLoss.MIN_SPIKE_TRADE_WAIT_SEC*1000 > Date.now())
            return; // prevent emitting multiple close events
        if (!this.action.spikeClose || !this.lastCandle)
            return;
        if (this.strategyPosition === "none")
            return; // nothing to do. be quiet

        const priceDiffPercent = this.getPriceDiffPercent();
        const priceDiffPercentTxt = priceDiffPercent.toFixed(2) + "%";
        if (this.strategyPosition === "short" && priceDiffPercent >= this.action.spikeClose) {
            if (this.betterThanHistoryPrice(true)) {
                this.emitBuyClose(Number.MAX_VALUE, utils.sprintf("emitting buy because price is rising fast to %s\nChange %s", this.avgMarketPrice.toFixed(8), priceDiffPercentTxt));
                this.lastSpikeTrade = new Date();
            }
        }
        else if (this.strategyPosition === "long" && priceDiffPercent <= this.action.spikeClose * -1) {
            if (this.betterThanHistoryPrice(false)) {
                this.emitSellClose(Number.MAX_VALUE, utils.sprintf("emitting sell because price is dropping fast to %s\nChange %s", this.avgMarketPrice.toFixed(8), priceDiffPercentTxt));
                this.lastSpikeTrade = new Date();
            }
        }
    }

    protected getStopPrice() {
        return -1; // dynamic depending on price spike
    }

    protected betterThanHistoryPrice(higher: boolean) {
        if (!this.action.historyCandle)
            return true;
        let history = this.getCandleAt(this.action.historyCandle)
        if (!history)
            return false;
        if (higher)
            return this.avgMarketPrice > history.close;
        return this.avgMarketPrice < history.close;
    }

    protected getPriceDiffPercent() {
        if (!this.lastCandle)
            return -1;
        return ((this.avgMarketPrice - this.lastCandle.close) / this.lastCandle.close) * 100; // don't use market price because it will trigger if only 1 trade is above/below
    }

    protected resetValues() {
        // general stop values, currently not used here
        super.resetValues();
    }
}