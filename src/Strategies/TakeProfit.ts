import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {AbstractTakeProfitStrategy, AbstractTakeProfitStrategyAction} from "./AbstractTakeProfitStrategy";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {TechnicalStrategyAction} from "./TechnicalStrategy";

interface TakeProfitAction extends /*StrategyAction*/AbstractTakeProfitStrategyAction {
    // assuming we pay 0.25% taker fee for buying and selling, this value should be > 0.5%
    // add interest rates for margin trading (0.13% on average for BTC on poloniex) ==> > 0.63%
    stop: number; // optional. A fixed stop price when to sell (> for long position) or buy (< for short position). If present takes precedence over 'profit'.
    profit: number; // 2.3% // in %

    time: number; // in seconds, optional. only close the position if the price doesn't reach a new high/low within this time
    reduceTimeByVolatility: boolean; // optional, default true. Reduce the stop time during high volatility market moments.
    keepTrendOpen: boolean; // optional, default true, Don't close if the last candle moved in our direction (only applicable with 'time' and 'candleSize' set).
    forceMaker: boolean; // optional, default true, force the order to be a maker order
    minRate: number; // optional // Only take profit once this market rate has been reached. Price must be above it for long positions and below it for short positions.
    // TODO option to always immediately take the profit once the profit threshold has been reached
}

/**
 * An advanced take profit strategy with additional parameters to decide if and when to close a positions. List of features:
 * - time counter: It will start a counter down to 0 seconds if the profit stop price is reached. The stop will only be triggered after the counter reaches 0. The counter gets reset every time the price moves above the stop.
 * - automatically adjust stop time counter based on market volatility
 */
export default class TakeProfit extends AbstractTakeProfitStrategy {
    protected static readonly KEEP_TREND_OPEN = true;
    protected static readonly FORCE_MAKER = true;

    public action: TakeProfitAction;
    protected lastLoggedStop = 0;

    constructor(options) {
        super(options)
        if (!this.action.stop)
            this.action.stop = 0.0;
        if (this.action.time)
            this.stopCountStart = new Date(Date.now() + 1000*utils.constants.DAY_IN_SECONDS*1000); // use Date.now() because marketTime is null
        else
            this.stopCountStart = new Date(0); // sell immediately
        if (this.action.keepTrendOpen === undefined)
            this.action.keepTrendOpen = TakeProfit.KEEP_TREND_OPEN;
        if (typeof this.action.forceMaker !== "boolean")
            this.action.forceMaker = TakeProfit.FORCE_MAKER;
        if (!this.action.minRate)
            this.action.minRate = 0.0;

        this.addInfo("highestPrice", "highestPrice");
        this.addInfo("lowestPrice", "lowestPrice");
        this.addInfoFunction("stop", () => {
            if (this.action.order === "sell" || this.action.order === "closeLong")
                return this.getStopSell()
            return this.getStopBuy()
        });
        this.addInfoFunction("untilStopSec", () => {
            if (!this.stopCountStart || this.stopCountStart.getTime() > Date.now() || this.action.time == 0 || !this.marketTime)
                return -1;
            let stopMs = this.getStopTimeSec() * 1000 - (this.marketTime.getTime() - this.stopCountStart.getTime());
            return stopMs > 0 ? Math.floor(stopMs/1000) : 0;
        });
        this.addInfo("stopCountStart", "stopCountStart");
    }

    public forceMakeOnly() {
        return this.action.forceMaker === true;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            super.tick(trades).then(() => {
                if (this.done)
                    return resolve();
                if (this.tradeTick >= nconf.get('serverConfig:tradeTickLog')) {
                    this.tradeTick -= nconf.get('serverConfig:tradeTickLog');
                    this.logStopValues(true);
                }
                let log = false;
                //if (this.entryPrice === -1) // causes buggy/late reset
                    //this.entryPrice = this.avgMarketPrice;
                if (!this.action.candleSize || this.highestPrice === 0) { // first init exception
                    if (this.avgMarketPrice > this.highestPrice) {
                        this.highestPrice = this.avgMarketPrice;
                        this.updateStopCount();
                        log = true;
                    }
                    if (this.avgMarketPrice < this.lowestPrice) { // on first call both conditions are true
                        this.lowestPrice = this.avgMarketPrice;
                        this.updateStopCount();
                        log = true;
                    }
                }
                if (log)
                    this.logStopValues();

                if (this.strategyPosition !== "none") {
                    if (this.action.order === "sell" || this.action.order === "closeLong")
                        this.checkStopSell();
                    else if (this.action.order === "buy" || this.action.order === "closeShort")
                        this.checkStopBuy();
                }
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            // update the prices based on candles to generate a lag.
            // so if the price moves fast in 1 direction we allow temporary higher setbacks
            let log = false;
            // use close price here instead of high/low
            if (candle.close > this.highestPrice) {
                this.highestPrice = candle.close;
                this.updateStopCount();
                log = true;
            }
            if (candle.close < this.lowestPrice) { // on first call both conditions are true
                this.lowestPrice = candle.close;
                this.updateStopCount();
                log = true;
            }
            if (log)
                this.logStopValues();
            super.candleTick(candle).then(() => {
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected checkStopSell() {
        if (this.action.minRate && this.avgMarketPrice < this.action.minRate)
            return;
        if (this.avgMarketPrice < this.getStopSell() || !this.hasProfit(this.avgMarketPrice)) { // < is opposite to StopLoss
            if (this.action.time)
                this.stopCountStart = new Date(this.marketTime.getTime() + 365*utils.constants.DAY_IN_SECONDS*1000); // reset it
            return;
        }
        else if (this.action.keepTrendOpen === true && this.candleTrend === "up") // same as in StopLoss
            return this.logOnce("skipping stop because candle trend is up %", this.candle.getPercentChange());
        if (this.stopCountStart.getTime() + this.getStopTimeSec() * 1000 <= this.marketTime.getTime())
            this.closeLongPosition();
    }

    protected checkStopBuy() {
        if (this.action.minRate && this.avgMarketPrice > this.action.minRate)
            return;
        if (this.avgMarketPrice > this.getStopBuy() || !this.hasProfit(this.avgMarketPrice)) { // > is opposite to StopLoss
            if (this.action.time)
                this.stopCountStart = new Date(this.marketTime.getTime() + 365*utils.constants.DAY_IN_SECONDS*1000); // reset it
            return;
        }
        else if (this.action.keepTrendOpen === true && this.candleTrend === "down") // same as in StopLoss
            return this.logOnce("skipping stop because candle trend is down %", this.candle.getPercentChange());
        if (this.stopCountStart.getTime() + this.getStopTimeSec() * 1000 <= this.marketTime.getTime())
            this.closeShortPosition();
    }

    protected closeLongPosition() {
        this.log("emitting sell because price is high with profit", this.avgMarketPrice, "entry", this.entryPrice,
            "stop", this.getStopSell(), "increase %", this.getPriceDiffPercent(this.getStopSell()));
        this.emitSellClose(Number.MAX_VALUE, "price high with profit");
        this.done = true;
    }

    protected closeShortPosition() {
        this.log("emitting buy because price is low with profit", this.avgMarketPrice, "entry", this.entryPrice,
            "stop", this.getStopBuy(), "decrease %", this.getPriceDiffPercent(this.getStopBuy()));
        this.emitBuyClose(Number.MAX_VALUE, "price low with profit");
        this.done = true;
    }

    protected getStopSell() {
        // TODO prevent stops from showing values below 0 ?
        if (this.action.stop)
            return this.action.stop;
        return this.entryPrice + this.entryPrice / 100 * this.action.profit; // + and - opposite to StopLoss
    }

    protected getStopBuy() {
        if (this.action.stop)
            return this.action.stop;
        return this.entryPrice - this.entryPrice / 100 * this.action.profit; // + and - opposite to StopLoss
    }

    protected getPriceDiffPercent(stopPrice: number) {
        return ((this.entryPrice - stopPrice) / stopPrice) * 100; // ((y2 - y1) / y1)*100 - positive % if price is rising
    }

    protected updateStopCount() {
        // we reached a new high/low. reset the time to avoid closing this position too soon
        // TODO we would need different counters for high/low if the price moves very quickly between high/low, but unrealistic
        if (this.action.time) // else we sell/buy immediately
            this.stopCountStart = this.marketTime;
    }

    protected resetValues() {
        //this.entryPrice = this.avgMarketPrice; // we just bought/sold, reset it to the current price
        this.lastLoggedStop = 0;
        if (this.action.time)
            this.stopCountStart = new Date((this.marketTime ? this.marketTime : new Date()).getTime() + 365*utils.constants.DAY_IN_SECONDS*1000);
        else
            this.stopCountStart = new Date(0);
        this.candleTrend = "none";
        super.resetValues();
    }

    protected logStopValues(force = false) {
        const long = this.action.order === "sell" || this.action.order === "closeLong";
        const stop = long ? this.getStopSell() : this.getStopBuy();
        if (!force && this.lastLoggedStop === stop)
            return
        this.lastLoggedStop = stop;
        this.log("market price", this.avgMarketPrice.toFixed(8), "lowest", this.lowestPrice.toFixed(8), "highest", this.highestPrice.toFixed(8))
        if (long)
            this.log("new stop sell", stop)
        else
            this.log("new stop buy", stop)
    }
}