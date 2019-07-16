import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {AbstractStopStrategy, AbstractStopStrategyAction, ClosePositionState} from "./AbstractStopStrategy";
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import * as helper from "../utils/helper";

interface StopLossTurnAction extends AbstractStopStrategyAction {
    stop: number; // optional. A fixed stop price when to sell (< for long position) or buy (> for short position). If present takes precedence over 'setback'. Only 'setbackProfit' has a higher priority (if set).
    stopLong: number; // optional, default 0 (use 'setback' setting or 'setbackLong' setting). Place a different fixed stop rate for long positions.

    setback: number; // 1.3% // in % // The trailing stop percentage the price has to move against an open position for the stop to be triggered.
    // TODO dynamic stop depending on % difference of x candle high/low. or optimize it with our empirical test suite?
    setbackLong: number; // 2.5% // optional a higher setback for long positions. default = 0 = setback for both. setbackProfit takes precedence
    // TODO add setback bonus + depending on current volume (or set stop to min 24h high/low by collecting candle closes)

    // TODO add an option to immediately open a position in the other direction?
    // TODO spike not sell %: option not to trigger the stop if the price spiked x% from lowest/highest price
    // TODO different setback for closeLong and closeShort
    // time the threshold has to be passed to trigger the stop
    // "time" makes sense with higher setbacks (> 3%) to prevent "panic selling" on spikes
    time: number; // in seconds, optional
    // close early if the last high/low is x minutes back (instead of waiting for the stop to trigger)
    //closeTimeMin: number; // in minutes, optional, only use this if we have a profit already // removed, use TakeProfit strategy
    closePosition: ClosePositionState; // optional, default always // Only close a position if its profit/loss is in that defined state.
    increaseTimeByVolatility: boolean; // optional, default false. Increase the stop time during volatile markets (by a factor between 1 and 2 computed from Bollinger Bandwidth). Takes precedence over reduceTimeByVolatility.
    reduceTimeByVolatility: boolean; // optional, default true. Reduce the stop time during high volatility market moments (by a divisor between 1 and 2 computed from Bollinger Bandwidth).
    keepTrendOpen: boolean; // optional, default true, Don't close if the last candle moved in our direction (only applicable with 'time' and 'candleSize' being set).
    forceMaker: boolean; // optional false, force the order to be a maker order
    //protectProfit: number; // optional, default 0 = disabled. close a a position immediately before a profit turns into a loss once this profit % is reached
    notifyBeforeStopSec: number; // optional, Send a push notification x seconds before the stop executes.

    // optional: Use a higher stop after a certain profit has been reached.
    setbackProfit: number; // 2.5% // How much loss we allow once 'triggerProfit' is reached (same value for long and short positions).
    triggerProfit: number; // 4.5% // The minimum profit to be reached for setbackProfit to replace setback. Use this to either allow higher losses or set tighter trailing stops, depending on your trading strategy.
    timeProfit: number; // in seconds. A higher/lower time to close if position is in profit. Reduce/increase time by volatility doesn't apply to this value.
    ensureProfit: boolean; // default true. Ensure there is really profit before closing at 'setbackProfit' (otherwise fallback to the normal stop). Keep in mind that open positions are only being synced every few minutes.
    // TODO decrease time counter on high volatility, see TakeProfit?

    // optional RSI values: don't close short if RSI < low (long if RSI > high)
    low: number; // 52 // default 0 = disabled // This strategy will never close short positions during RSI oversold.
    high: number; // 56 // This strategy will never close long positions during RSI overbought.
    interval: number; // default 9
}

/**
 * An advanced stop loss strategy with additional parameters to decide if and when to close a positions. List of features:
 * - time counter: It will start a counter down to 0 seconds if the stop price is reached. The stop will only be triggered after the counter reaches 0. The counter gets reset every time the price moves above the stop.
 * - different trailing stop percentages for long and short positions
 * - tighter stop after a position reaches a defined percentage of profit
 * - keep the position open depending on current RSI and current candle trend
 * - automatically adjust stop time counter based on market volatility
 * - Smartphone notifications x minutes before the stop gets executed to allow manual intervention
 */
export default class StopLossTurn extends AbstractStopStrategy {
    protected static readonly KEEP_TREND_OPEN = true;
    protected static readonly FORCE_MAKER = false;

    public action: StopLossTurnAction;
    protected lastLoggedStop = 0;
    //protected priceTime: Date = new Date(Date.now() +  365*utils.constants.DAY_IN_SECONDS * 1000); // time of the last high/low
    protected lastRSI: number = -1; // identical ro RSI because it's updated on every candle tick
    protected warnedStopExecuted = false; // warn once per start, don't save it in state

    constructor(options) {
        super(options)
        if (!this.action.stop)
            this.action.stop = 0.0;
        if (!this.action.stopLong)
            this.action.stopLong = 0.0;
        if (!this.action.setbackLong)
            this.action.setbackLong = 0.0;
        if (!this.action.time)
            this.stopCountStart = new Date(0); // sell immediately
        if (["always", "profit", "loss"].indexOf(this.action.closePosition) === -1)
            this.action.closePosition = "always";
        if (this.action.keepTrendOpen === undefined)
            this.action.keepTrendOpen = StopLossTurn.KEEP_TREND_OPEN;
        if (typeof this.action.forceMaker !== "boolean")
            this.action.forceMaker = StopLossTurn.FORCE_MAKER;
        if (!this.action.setbackProfit)
            this.action.setbackProfit = 0;
        if (!this.action.triggerProfit)
            this.action.triggerProfit = 0;
        if (typeof this.action.ensureProfit !== "boolean")
            this.action.ensureProfit = true;
        if (!this.action.interval)
            this.action.interval = 9;

        if (this.action.low > 0 && this.action.high > 0)
            this.addIndicator("RSI", "RSI", this.action);

        this.addInfo("highestPrice", "highestPrice");
        this.addInfo("lowestPrice", "lowestPrice");
        this.addInfoFunction("stop", () => {
            return this.getStopPrice();
        });
        this.addInfoFunction("untilStopSec", () => {
            return this.getTimeUntilStopSec();
        });
        this.addInfo("stopCountStart", "stopCountStart");
        this.addInfo("entryPrice", "entryPrice");
        this.addInfo("profitTriggerReached", "profitTriggerReached");
        this.addInfoFunction("triggerPriceLong", () => {
            return this.getTriggerPriceLong()
        });
        this.addInfoFunction("triggerPriceShort", () => {
            return this.getTriggerPriceShort()
        });
        if (this.action.low > 0 && this.action.high > 0) {
            this.addInfoFunction("RSI", () => {
                return this.indicators.get("RSI").getValue();
            });
        }

        this.saveState = true;
    }

    public forceMakeOnly() {
        return this.action.forceMaker === true;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            if (this.done)
                return resolve();
            if (this.tradeTick >= nconf.get('serverConfig:tradeTickLog')) {
                this.tradeTick -= nconf.get('serverConfig:tradeTickLog');
                this.logStopValues(false); // too spammy
            }
            let log = false;
            if (!this.action.candleSize || this.highestPrice === 0) { // first init exception
                if (this.avgMarketPrice > this.highestPrice) {
                    this.highestPrice = this.avgMarketPrice;
                    log = true;
                }
                if (this.avgMarketPrice < this.lowestPrice) { // on first call both conditions are true
                    this.lowestPrice = this.avgMarketPrice;
                    log = true;
                }
                if (!this.profitTriggerReached) {
                    if (this.strategyPosition === "long" && this.avgMarketPrice >= this.getTriggerPriceLong()) {
                        this.profitTriggerReached = true;
                        this.log("LONG profit price reaced at:", this.avgMarketPrice);
                    }
                    if (this.strategyPosition === "short" && this.avgMarketPrice <= this.getTriggerPriceShort()) {
                        this.profitTriggerReached = true;
                        this.log("SHORT profit price reaced at:", this.avgMarketPrice);
                    }
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
            super.tick(trades).then(() => {
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.done) {
                if (this.warnedStopExecuted === false && this.stateMessage !== "none") {
                    this.warnedStopExecuted = true;
                    this.sendNotification("Stop already executed", "Strategy stop won't fire again", false, true);
                }
            }

            // update the prices based on candles to generate a lag.
            // so if the price moves fast in 1 direction we allow temporary higher setbacks
            let log = false;
            // use inverse high/low to keep the threshold as far away as possible in case of spikes
            // TODO on very volatile markets it might be better to use candle.close? otherwise the stop can move away too far
            // see LTC up after drop on OKEX on 2017-09-03
            //if (candle.low > this.highestPrice) {
                //this.highestPrice = candle.low; // using inverse values can be dangerous as it alows the stop to be moved incrementally
            if (candle.high > this.highestPrice) {
                this.highestPrice = candle.high;
                log = true;
            }
            //if (candle.high < this.lowestPrice) { // on first call both conditions are true
                //this.lowestPrice = candle.high;
            if (candle.low < this.lowestPrice) {
                this.lowestPrice = candle.low;
                log = true;
            }
            if (!this.profitTriggerReached) {
                if (this.strategyPosition === "long" && candle.close >= this.getTriggerPriceLong()) {
                    this.profitTriggerReached = true;
                    this.log("LONG profit price reaced at:", this.avgMarketPrice);
                }
                if (this.strategyPosition === "short" && candle.close <= this.getTriggerPriceShort()) {
                    this.profitTriggerReached = true;
                    this.log("SHORT profit price reaced at:", this.avgMarketPrice);
                }
            }
            if (log)
                this.logStopValues(true);
            super.candleTick(candle).then(() => {
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected checkIndicators() {
        if (!this.action.low || !this.action.high)
            return;
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
        if (this.useProfitStop() && this.action.setbackProfit > 0.0) // if a profit trigger is set, is has higher prio than the fixed stop
            return this.highestPrice - this.highestPrice / 100 * this.action.setbackProfit;
        if (this.action.stopLong > 0.0)
            return this.action.stopLong;
        if (this.action.stop > 0.0)
            return this.action.stop;
        if (this.action.setbackLong)
            return this.highestPrice - this.highestPrice / 100 * this.action.setbackLong;
        return this.highestPrice - this.highestPrice / 100 * this.action.setback;
    }

    protected getStopBuy() {
        if (this.useProfitStop() && this.action.setbackProfit > 0.0)
            return this.lowestPrice + this.lowestPrice / 100 * this.action.setbackProfit;
        if (this.action.stop > 0.0)
            return this.action.stop;
        return this.lowestPrice + this.lowestPrice / 100 * this.action.setback;
    }

    protected getStopPrice() {
        if (this.action.order === "sell" || this.action.order === "closeLong")
            return this.getStopSell()
        return this.getStopBuy()
    }

    protected useProfitStop() {
        if (this.action.ensureProfit === true)
            return this.profitTriggerReached && this.hasProfit(this.entryPrice);
        return this.profitTriggerReached;
    }

    protected getTriggerPriceLong() {
        if (this.entryPrice === -1 || this.action.triggerProfit == 0 || this.action.setbackProfit == 0)
            return Number.POSITIVE_INFINITY;
        return this.entryPrice + this.entryPrice / 100 * this.action.triggerProfit;
    }

    protected getTriggerPriceShort() {
        if (this.entryPrice === -1 || this.action.triggerProfit == 0 || this.action.setbackProfit == 0)
            return Number.NEGATIVE_INFINITY;
        return this.entryPrice - this.entryPrice / 100 * this.action.triggerProfit;
    }

    protected getStopTimeSec() {
        if (this.profitTriggerReached === true && this.action.triggerProfit && this.action.setbackProfit && this.action.timeProfit) {
            return this.action.timeProfit;
        }
        return super.getStopTimeSec();
    }

    protected resetValues() {
        this.lastLoggedStop = 0;
        if (this.action.time)
            this.stopCountStart = null;
        else
            this.stopCountStart = new Date(0);
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