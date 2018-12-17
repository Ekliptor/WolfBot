import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, ScheduledTrade, StrategyAction} from "./AbstractStrategy";
import {AbstractTakeProfitStrategy, AbstractTakeProfitStrategyAction} from "./AbstractTakeProfitStrategy";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {TechnicalStrategyAction} from "./TechnicalStrategy";
import {default as TriggerOrder} from "./TriggerOrder";
import {AbstractTriggerOrder, TriggerOrderCommand} from "./AbstractTriggerOrder";

interface TakeProfitStochRSIAction extends AbstractTakeProfitStrategyAction {
    percentage: number; // optional, default 100%. Take profit by partially closing x% of the open position.
    // StochRSI values
    low: number; // the RSI low value to close a short position
    high: number; // the RSI high value to close a long position
    interval: number; // the RSI interval
    // optional values
    optInFastK_Period: number; // default 5. The number of candles for the real StochRSI value.
    optInFastD_Period: number; // default 3. The number of candles for the smoothened StochRSI value.
    optInFastD_MAType: number; // default 0=SMA. The MA type for smoothening.

    closeRateFactor: number; // 0.9992 // optional, default 1.0, Must be < 1. Move the stop for the closing rate a little bit away from the last price. This multiplies the close rate by this to set the stop below (for shorts 1-x is added).
    time: number; // optional, default 300 sec. wait before executing the stop order after reaching the threshold
    keepTrendOpen: boolean; // optional, default true, Don't close if the last candle moved in our direction (only applicable with 'time' and 'candleSize' set).
    alwaysIncreaseStop: boolean; // optional, default false. Move the stop closer to the market price after every candle tick of this strategy even if RSI is no more oversold/overbought.
    ensureProfit: boolean; // optional, default true. Check if we still have profit after 'time' has passed. Otherwise don't close the position.
    orderStrategy: string;
    minOpenTicks: number; // optional, default 12. How many ticks a position shall be open at least before it can be closed. If this strategy uses the same candle size as the main strategy. it's implicitly open at least 1 tick with value 0.
}

/**
 * A take profit strategy looking at the Stochastic RSI. It initiates to close a long position at RSI overbought
 * and a short position at RSI oversold. Closing is done by forwarding the order as a stop to an order strategy.
 * Works well with candle sizes of 1h or more and an order strategy running on 1min candles.
 * good RSI values: TakeProfit at 1h candles on > 87 and < 11
 */
export default class TakeProfitStochRSI extends AbstractTakeProfitStrategy {
    public action: TakeProfitStochRSIAction;
    protected lastRSI: number = -1; // identical ro RSI because it's updated on every candle tick
    protected secondLastRSI: number = -1;
    protected lastTriggerCommand: TriggerOrderCommand = null;

    constructor(options) {
        super(options)
        if (!this.action.percentage)
            this.action.percentage = 100;
        if (typeof this.action.closeRateFactor !== "number")
            this.action.closeRateFactor = 0.9992;
        if (typeof this.action.time !== "number")
            this.action.time = 300;
        if (typeof this.action.keepTrendOpen !== "boolean")
            this.action.keepTrendOpen = true;
        if (typeof this.action.alwaysIncreaseStop !== "boolean")
            this.action.alwaysIncreaseStop = false;
        if (typeof this.action.ensureProfit !== "boolean")
            this.action.ensureProfit = true;
        if (!this.action.minOpenTicks)
            this.action.minOpenTicks = 12;
        this.addIndicator("StochRSI", "StochRSI", this.action);

        this.addInfo("secondLastRSI", "secondLastRSI");
        let rsi = this.getStochRSI("StochRSI")
        this.addInfoFunction("StochRSID", () => {
            return rsi.getOutFastD();
        });
        this.addInfoFunction("StochRSIK", () => {
            return rsi.getOutFastK();
        });
        this.saveState = true;
        this.verifyOrderStrategy();
    }

    public getOrderAmount(tradeTotalBtc: number, leverage: number = 1): number {
        let amount = tradeTotalBtc * leverage;
        // TODO better support to specify amount in coins for futures, see getOrderAmount() of IndexStrategy
        // if StopLossTurn has a small candleSize it will do almost the same (but close the order completely)
        if (nconf.get("trader") !== "Backtester") { // backtester uses BTC as unit, live mode USD
            if (leverage >= 10 && this.isPossibleFuturesPair(this.action.pair) === true)
                amount = tradeTotalBtc * leverage * /*this.ticker.last*/this.avgMarketPrice;
        }

        this.orderAmountPercent = this.action.percentage;
        if (!this.orderAmountPercent || this.orderAmountPercent === 100)
            return amount;
        return amount / 100 * this.orderAmountPercent;
    }

    public serialize() {
        let state = super.serialize();
        state.lastTriggerCommand = this.lastTriggerCommand;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.lastTriggerCommand = state.lastTriggerCommand;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        super.checkIndicators(); // not really needed (yet)
        let rsi = this.getStochRSI("StochRSI")
        const value = rsi.getOutFastK(); // take the not smoothened value here
        const valueFormatted = Math.round(value * 100) / 100.0;
        this.secondLastRSI = this.lastRSI;
        if (this.strategyPosition === "none") {
            this.lastRSI = value;
            return;
        }
        if (this.action.minOpenTicks !== 0 && this.positionOpenTicks < this.action.minOpenTicks) { // positionOpenTicks is 0 the first time
            this.log(utils.sprintf("Skipping take profit check because position is open %s ticks", this.positionOpenTicks))
            this.lastRSI = value;
            return;
        }

        if (!this.done) {
            //if (this.lastRSI < this.action.low/* && value > this.lastRSI && value > this.action.low*/) {
            if (value < this.action.low) {
                this.log(utils.sprintf("DOWN max trend detected, value %s", valueFormatted))
                if (this.strategyPosition === "short")
                    this.triggerBuy("RSI value: " + valueFormatted);
            }
            //else if (this.lastRSI > this.action.high/* && value < this.lastRSI && value < this.action.high*/) {
            else if (value > this.action.high) {
                this.log(utils.sprintf("UP max trend detected, value %s", valueFormatted))
                if (this.strategyPosition === "long")
                    this.triggerSell("RSI value: " + valueFormatted);
            }
            //else
                //this.log("no (max) trend detected, value", valueFormatted)
        }
        else if (this.action.alwaysIncreaseStop && this.lastTriggerCommand) {
            const lastRate = this.lastTriggerCommand.rate;
            if (this.lastTriggerCommand.comp === ">") {
                // note that it shouldn't be possible for the price to move the other way or else the order would have been executed
                if (this.getCloseShortRate() < this.lastTriggerCommand.rate) // closeShort -> decrease threshold
                    this.lastTriggerCommand.rate = this.getCloseShortRate();
            }
            else if (this.lastTriggerCommand.comp === "<") {
                if (this.getCloseLongRate() > this.lastTriggerCommand.rate) // closeLong -> increase threshold
                    this.lastTriggerCommand.rate = this.getCloseLongRate();
            }
            if (lastRate !== this.lastTriggerCommand.rate) {
                this.log(utils.sprintf("Increasing stop to %s", this.lastTriggerCommand.rate.toFixed(8)))
                this.forwardOrder(this.lastTriggerCommand);
            }
        }
        this.lastRSI = value;
    }

    protected resetValues() {
        //this.candleTrend = "none";
        this.lastTriggerCommand = null; // reset it on every trade? really good?
        super.resetValues();
    }

    protected triggerBuy(reason: string) {
        let tradeCmd = new TriggerOrderCommand(this.action.percentage === 100 ? "closeShort" : "buy", ">", this.getCloseShortRate(), reason);
        this.forwardOrder(tradeCmd);
    }

    protected triggerSell(reason: string) {
        let tradeCmd = new TriggerOrderCommand(this.action.percentage === 100 ? "closeLong" : "sell", "<", this.getCloseLongRate(), reason);
        this.forwardOrder(tradeCmd);
    }

    protected getCloseLongRate() {
        return this.avgMarketPrice * this.action.closeRateFactor;
    }

    protected getCloseShortRate() {
        return this.avgMarketPrice + (1-this.action.closeRateFactor)*this.avgMarketPrice;
    }

    protected forwardOrder(tradeCmd: TriggerOrderCommand) {
        if (!this.hasProfitReal()) {
            this.log(utils.sprintf("Skipped forwarding %s order because position doesn't have profit", tradeCmd.action.toUpperCase()));
            return;
        }

        // forward our parameters for TriggerOrder strategy
        if (this.action.time > 0)
            tradeCmd.time = this.action.time;
        tradeCmd.keepTrendOpen = this.action.keepTrendOpen;
        if (this.action.ensureProfit)
            tradeCmd.verifyCloseFn = this.hasProfitReal.bind(this);
        tradeCmd.closeOnly = true;

        let orderStrategy = this.strategyGroup.getTriggerOrderStrategy(this.action.orderStrategy);
        this.log(utils.sprintf("Forwarding %s order to %s with reason: %s", tradeCmd.action.toUpperCase(), this.action.orderStrategy, tradeCmd.reason))
        let trade = new ScheduledTrade(this.toTradeAction(tradeCmd.action), this.defaultWeight, tradeCmd.reason, this.className);
        trade.bindEmittingStrategyFunctions(this);
        orderStrategy.addTriggerOrder(tradeCmd, trade);
        this.done = true;
        this.lastTriggerCommand = tradeCmd;
    }

    protected verifyOrderStrategy() {
        setTimeout(() => { // wait until all strategies are loaded
            if (!this.action.orderStrategy)
                return logger.error("'orderStrategy' must be defined for %s to trade", this.className)
            let orderStrategy = this.strategyGroup.getStrategyByName(this.action.orderStrategy);
            if (!orderStrategy || !(orderStrategy instanceof AbstractTriggerOrder))
                return logger.error("'orderStrategy' %s has invalid instance type in %s", this.action.orderStrategy, this.className)
        }, 1000)
    }
}