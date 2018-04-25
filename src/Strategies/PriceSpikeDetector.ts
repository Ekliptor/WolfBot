import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {TradeDirection} from "../Trade/AbstractTrader";
import {AbstractMomentumAction, AbstractMomentumStrategy} from "./AbstractMomentumStrategy";

interface PriceSpikeAction extends AbstractMomentumAction {
    spikePercent: number; // 3.0% // as x% price difference (higher/lower) as the last candle
    endOfSpike: boolean; // optional, default false. true = wait until the spike reverses, false = buy/sell immediately with the spike
    historyCandle: number; // optional, default 36. how many candles to look back to compare if price really is a spike. set 0 to disable it

    // optionally set a min/max price
    stop: number; // 0.05226790 BTC
    // optional. default buy = <, sell = >
    // does the price have to be higher or lower than the stop?
    comp: "<" | ">";

    // look at last x candles to check for a spike too. default disabled
    spikeHistoryPercent: number; // 5.5%
    historyCandleCount: number; // 3

    tradeDirection: TradeDirection | "notify" | "watch"; // optional. default "both"
    tradeOppositeDirection: boolean; // optional. default "false" = don't trade if we have an open position in the other direction
    strongRate: boolean; // optional. default true = adjust the rate to ensure the order gets filled immediately
    onlyDailyTrend: boolean; // optional. default true = only trade when the spike is in the same direction as the 24h % change

    // TODO option to allow closing opposite positions when used as secondary strategy
    // TODO option to only open positions with x% of total trading size
}

/**
 * Detect if the price of spikes x % up/down (compared to the last candle).
 */
export default class PriceSpikeDetector extends AbstractMomentumStrategy {
    protected static readonly CHECK_TRADES_PERCENT = 65; // how many % of trades of the spike candle shall we wait for when using endOfSpike == true
    protected static readonly REVERSE_SPIKE_TIMEOUT_SEC = 60; // after this time the reversal of a spike will be ignored (abort sending trade signals)

    protected action: PriceSpikeAction;
    protected lastCandle: Candle.Candle = null;
    protected candleTrend: TrendDirection = "none";
    protected checkTradeCount = -1;
    protected checkTrades: Trade.Trade[] = [];
    protected reverseSpikeTimeout: Date = null;
    // TODO AbstractMomentumStrategy + what about conflicting positions? only follow same position by default (and open new)
    // TODO add RSI to prevent buying on RSI overbought at the end of a spike

    constructor(options) {
        super(options)
        this.tradeOnce = true; // will prevent multiple buy/sell events on every tick (if not paused)
        if (this.action.endOfSpike === undefined)
            this.action.endOfSpike = false;
        if (this.action.historyCandle === undefined)
            this.action.historyCandle = 36;
        if (!this.action.stop)
            this.action.stop = 0.0;
        if (!this.action.spikeHistoryPercent)
            this.action.spikeHistoryPercent = 0;
        if (!this.action.historyCandleCount)
            this.action.historyCandleCount = 0;
        else
            this.action.historyCandleCount = Math.floor(this.action.historyCandleCount);
        if (!this.action.tradeDirection)
            this.action.tradeDirection = "both"; // overwrite from parent

        this.addInfoFunction("lastCandleClose", () => {
            return this.lastCandle ? this.lastCandle.close : -1;
        });
        this.addInfoFunction("priceDiffPercent", () => {
            const priceDiffPercentTxt = this.getPriceDiffPercent(this.lastCandle).toFixed(2) + "%";
            return priceDiffPercentTxt;
        });
        if (this.action.spikeHistoryPercent && this.action.historyCandleCount) {
            this.addInfoFunction("priceDiffPercentHistory", () => {
                const batchedCandle = this.batchCandles(this.getHistorySpikeCandles());
                const priceDiffPercentHistory = this.getPriceDiffPercent(batchedCandle);
                return priceDiffPercentHistory.toFixed(2) + "%";
            });
        }
        this.addInfo("done", "done");
        this.saveState = true; // ensures faster start if bot crashes (often happens on big spikes with exchange errors)
    }

    public serialize() {
        let state = super.serialize();
        //state.lastCandle = Candle.Candle.copy([this.lastCandle])[0]; // not needed. history candles are serialized in parent class
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            if (this.done)
                return resolve();

            if (this.canTrade()) {
                // this strategy is usually only used to enter the market (though as main strategy it could exit too)
                this.checkPriceSpike();
                this.checkEndOfSpike(trades);
            }
            resolve()
        })
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.done)
                return resolve();

            this.lastCandle = Object.assign({}, candle);
            //this.logSpikeValues();
            resolve()
        })
    }

    protected checkPriceSpike() {
        if (!this.lastCandle)
            return;
        else if (this.action.endOfSpike === true && this.checkTradeCount !== -1)
            return; // we are already waiting for the end of a spike

        // TODO add timer to check if the spike lasts at least x seconds
        const priceDiffPercent = this.getPriceDiffPercent(this.lastCandle);
        const priceDiffPercentTxt = priceDiffPercent.toFixed(2) + "%";
        const batchedCandle = this.batchCandles(this.getHistorySpikeCandles());
        const priceDiffPercentHistory = this.getPriceDiffPercent(batchedCandle);
        const priceDiffPercentHistoryTxt = priceDiffPercentHistory.toFixed(2) + "%";

        //this.log("current price spike", priceDiffPercentTxt);
        if (priceDiffPercent >= this.action.spikePercent || priceDiffPercentHistory >= this.action.spikeHistoryPercent) {
            // TODO also check if priceDiffPercentHistory is positive? this would prevent buying in a short up spike on a huge drop
            if (this.betterThanHistoryPrice(true)) {
                if (this.action.endOfSpike)
                    this.waitForEndOfSpike("up", priceDiffPercent);
                else {
                    // we are in the middle of this spike. so go with it
                    // a strategy that buys/sells should check again if the price is rising (how?) to avoid buying into the bounce back?
                    this.openLong(utils.sprintf("emitting buy because price is rising fast to %s\nChange %s, history %s", this.avgMarketPrice.toFixed(8), priceDiffPercentTxt, priceDiffPercentHistoryTxt));
                }
            }
        }
        else if (priceDiffPercent <= this.action.spikePercent * -1 || priceDiffPercentHistory <= this.action.spikeHistoryPercent * -1) {
            if (this.betterThanHistoryPrice(false)) {
                if (this.action.endOfSpike)
                    this.waitForEndOfSpike("down", priceDiffPercent);
                else {
                    this.openShort(utils.sprintf("emitting sell because price is dropping fast to %s\nChange %s, history %s", this.avgMarketPrice.toFixed(8), priceDiffPercentTxt, priceDiffPercentHistoryTxt));
                }
            }
        }
    }

    protected checkEndOfSpike(trades: Trade.Trade[]) {
        if (!this.action.endOfSpike || this.checkTradeCount === -1)
            return;
        this.addTrades(trades);
        if (this.checkTrades.length < this.checkTradeCount)
            return; // we don't have enough trades since the spike candle
        let trend = this.computeTrend(this.checkTrades);
        if (trend === "none")
            return this.log("Waiting for end of spike. No reverse trend detected yet");
        else if (trend == this.candleTrend)
            return this.log("Waiting for end of spike. Candle trend is continuing:", this.candleTrend);

        // we are at the end of a spike. so buy/sell into the opposite direction
        if (this.spikeTimeout())
            return;
        if (trend === "up" && this.candleTrend === "down")
            this.openLong(utils.sprintf("emitting buy because candle trend is reversing to go up to %s", this.avgMarketPrice))
        else if (trend === "down" && this.candleTrend === "up")
            this.openShort(utils.sprintf("emitting sell because candle trend is reversing to go down to %s", this.avgMarketPrice))
        else // shouldn't happen
            logger.error("Conflicting trends found in %s: candle %s, current %s", this.className, this.candleTrend, trend)
    }

    protected waitForEndOfSpike(candleTrend: TrendDirection, priceDiffPercent: number) {
        this.checkTradeCount = Math.ceil(this.lastCandle.trades / 100 * PriceSpikeDetector.CHECK_TRADES_PERCENT);
        this.candleTrend = candleTrend;
        const priceDiffPercentTxt = priceDiffPercent.toFixed(2) + "%";
        this.log("Ongoing price spike", this.candleTrend, priceDiffPercentTxt, "- Waiting for the trend to turn, required trades:", this.checkTradeCount);
    }

    protected openLong(reason: string) {
        this.openPosition(reason, "buy");
    }

    protected openShort(reason: string) {
        this.openPosition(reason, "sell");
    }

    protected openPosition(reason: string, action: TradeAction) {
        let trade = false;
        if (this.action.stop > 0.0) {
            const comp = this.getComparator(action);
            if (comp === "<") {
                if (this.avgMarketPrice < this.action.stop)
                    trade = true;
                else
                    this.log(utils.sprintf("Skipped %s trade because rate %s is above stop %s", action.toUpperCase(), this.avgMarketPrice.toFixed(8), this.action.stop.toFixed(8)))
            }
            else if (comp === ">") {
                if (this.avgMarketPrice > this.action.stop)
                    trade = true;
                else
                    this.log(utils.sprintf("Skipped %s trade because rate %s is below stop %s", action.toUpperCase(), this.avgMarketPrice.toFixed(8), this.action.stop.toFixed(8)))
            }
        }
        else
            trade = true;
        if (trade) {
            if (action === "buy")
                super.openLong(reason);
            else
                super.openShort(reason);
        }
    }

    protected spikeTimeout() {
        if (!this.reverseSpikeTimeout) {
            this.reverseSpikeTimeout = this.getMarketTime();
            return false;
        }
        else if (this.reverseSpikeTimeout.getTime() + PriceSpikeDetector.REVERSE_SPIKE_TIMEOUT_SEC*1000 < this.getMarketTime().getTime()) {
            this.log("Reverse spike timed out. Resetting values");
            this.resetValues();
            return true;
        }
        return false;
    }

    protected addTrades(trades: Trade.Trade[]) {
        this.checkTrades = this.checkTrades.concat(trades);
        let i = this.checkTrades.length - this.checkTradeCount;
        if (i > 0)
            this.checkTrades.splice(0, i) // remove oldest ones
    }

    protected getPriceDiffPercent(candle: Candle.Candle) {
        if (!candle)
            return -1;
        //return ((this.marketPrice - this.lastCandle.close) / this.lastCandle.close) * 100; // ((y2 - y1) / y1)*100 - positive % if price is rising
        return ((this.avgMarketPrice - candle.close) / candle.close) * 100; // don't use market price because it will trigger if only 1 trade is above/below
    }

    /**
     * Check if the price is really bigher/lower than at a certain candle in history.
     * @param {boolean} higher
     * @returns {boolean}
     */
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

    protected getHistorySpikeCandles() {
        let candles = [];
        for (let i = 0; i < this.action.historyCandleCount; i++)
            candles.push(this.getCandleAt(i));
        return candles;
    }

    protected getComparator(action: TradeAction): "<" | ">" {
        if (this.action.comp)
            return this.action.comp;
        if (action === "buy")
            return "<";
        else // sell. this strategy doesn't use close orders
            return ">";
    }

    protected logSpikeValues() {
        const priceDiffPercentTxt = this.getPriceDiffPercent(this.lastCandle).toFixed(2) + "%";
        this.log("market price", this.avgMarketPrice, "last close", this.lastCandle.close, "priceDiff", priceDiffPercentTxt)
    }

    protected resetValues(): void {
        this.lastCandle = null;
        this.candleTrend = "none";
        this.checkTradeCount = -1;
        this.checkTrades = [];
        this.reverseSpikeTimeout = null;
        super.resetValues();
    }
}