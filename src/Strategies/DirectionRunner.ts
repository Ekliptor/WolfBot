import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, StrategyOrder, StrategyPosition, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {AbstractStopStrategy} from "./AbstractStopStrategy";
import {AbstractTakeProfitStrategy} from "./AbstractTakeProfitStrategy";
import {TradeInfo} from "../Trade/AbstractTrader";
import * as helper from "../utils/helper";

export interface DirectionRunnerAction extends StrategyAction {
    direction: "long" | "short"; // optional, default long // The initial direction this strategy is set to open a position.
    // This value is being updated by the strategies set in the 'longTrendIndicators' setting.

    // optional values
    // TODO collect x hour price high/lows and only trade near them
    enterImmediately: boolean; // default false. Don't wait for the indicators to change their buy/sell signal. Enter the market on the first signal.
    longTrendIndicators: string[]; // Set the direction automatically based on long trend indicators such as EMA. Each indicator here must have it's own config added to your current config file.
    volume: number; // default 0. The min volume of the last candle for the trade to be executed.
    volumeCandleSize: number; // default 60. The trade period in minutes for "volume".
    ticks: number; // default 0. The number of candle ticks to wait before executing the order. 0 = execute immediately.
    indicators: string[]; // default RSIScalper. Some technical indicators or strategies to look for the right moment to open a position in our 'direction' value from config. Only checked once (the last tick). Each indicator here must have it's own config added to your current config file.
    exitIndicators: string[]; // default RSI. Indicators/Strategies to exit the market.
    // How many minutes to wait before we can trade again (before existing trades get cleared). 0 = never = on bot restart. Counter starts on close of a position.
    waitRepeatingTradeMin: number; // default 300.
}

enum DirectionRunnerState {
    WAITING = 1,
    //ENTERING = 2, // we will emit waiting until open
    OPEN = 3
}
type LastSignal = "buy" | "sell" | "mixed" | "mixedPendingBuy" | "mixedPendingSell";
interface DirectionRunnerOrder {
    action: TradeAction;
    rate: number;
}

/**
 * Strategy that emits buy/sell signal based a some indicators it looks for.
 * Those indicators are full (secondary) strategies. The direction of this strategy will
 * change every time ALL strategies emit a trade signal in the same direction (buy or sell).
 */
export default class DirectionRunner extends /*AbstractTurnStrategy*/TechnicalStrategy {
    public action: DirectionRunnerAction;
    protected directionRunnerState: DirectionRunnerState = DirectionRunnerState.WAITING;
    protected plannedOrder: DirectionRunnerOrder = null;
    protected plannedOrderTicks = 0;
    //protected executedOrders: number[] = []; // only execute every order once
    protected executedOrders: string[] = []; // only for debugging here
    protected executingOrder: DirectionRunnerOrder = null;
    protected nextResetExecutedOrders: Date = null;
    protected lastSignal: LastSignal = "mixed";

    constructor(options) {
        super(options)
        if (!this.action.direction)
            this.action.direction = "long";
        else if (this.action.direction !== "long" && this.action.direction !== "short")
            throw new Error(utils.sprintf("Invalid direction '%s' in %s", this.action.direction, this.className));
        if (typeof this.action.enterImmediately !== "boolean")
            this.action.enterImmediately = false;
        if (!this.action.longTrendIndicators)
            this.action.longTrendIndicators = [];
        if (!this.action.volume)
            this.action.volume = 0;
        if (!this.action.volumeCandleSize)
            this.action.volumeCandleSize = 60;
        if (!this.action.ticks)
            this.action.ticks = 0;
        if (!this.action.indicators)
            this.action.indicators = ["RSIScalper"];
        if (!this.action.exitIndicators)
            this.action.exitIndicators = ["RSI"];
        if (!this.action.waitRepeatingTradeMin)
            this.action.waitRepeatingTradeMin = 300;

        this.addInfo("plannedOrderTicks", "plannedOrderTicks");
        this.addInfo("executedOrders", "executedOrders");
        this.addInfo("lastSignal", "lastSignal");
        this.addInfoFunction("directionRunnerState", () => {
            return DirectionRunnerState[this.directionRunnerState];
        });
        this.addInfoFunction("plannedOrder", () => {
            if (!this.plannedOrder)
                return "";
            return this.plannedOrder.action + "@" + this.plannedOrder.rate;
        });
        setTimeout(this.disableStrategies.bind(this), 0); // has to be done after all strategies are initialized
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            this.directionRunnerState = DirectionRunnerState.WAITING;
            this.lastSignal = "mixed";
            if (this.action.waitRepeatingTradeMin > 0 && this.marketTime)
                this.nextResetExecutedOrders = new Date(this.marketTime.getTime() + this.action.waitRepeatingTradeMin*utils.constants.MINUTE_IN_SECONDS*1000);
        }
        if (this.executingOrder && action === this.executingOrder.action) {
            this.executedOrders.push(this.executingOrder.action + "@" + this.executingOrder.rate);
            this.executingOrder = null;
            this.directionRunnerState = DirectionRunnerState.OPEN;
        }
    }

    public serialize() {
        let state = super.serialize();
        state.plannedOrder = this.plannedOrder;
        state.plannedOrderTicks = this.plannedOrderTicks;
        state.executedOrders = this.executedOrders;
        state.nextResetExecutedOrders = this.nextResetExecutedOrders;
        state.lastSignal = this.lastSignal;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.plannedOrder = state.plannedOrder;
        this.plannedOrderTicks = state.plannedOrderTicks;
        this.executedOrders = state.executedOrders;
        this.nextResetExecutedOrders = state.nextResetExecutedOrders;
        this.lastSignal = state.lastSignal;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            if (this.nextResetExecutedOrders !== null && this.marketTime && this.nextResetExecutedOrders.getTime() < this.marketTime.getTime()) {
                this.nextResetExecutedOrders = null;
                this.executedOrders = []; // TODO better cache orders before timeout and only remove them?
            }
            //this.checkOrders(this.avgMarketPrice, false);
            resolve()
        })
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.setDirection();
            if (this.strategyPosition === "none") // be sure in case state gets stuck
                this.directionRunnerState = DirectionRunnerState.WAITING;
            else
                this.directionRunnerState = DirectionRunnerState.OPEN;
            switch (this.directionRunnerState)
            {
                case DirectionRunnerState.WAITING:
                    this.findMarketDip();
                    break;
                case DirectionRunnerState.OPEN:
                    this.findExitPoint();
                    break;
            }
            resolve()
        })
    }

    protected checkIndicators() {
        // we don't have our own indicators, they are part of strategy group
    }

    protected setDirection() {
        // we change our direction if all indicators give the same signal
        let nextTrade: TradeAction = this.action.direction === "long" ? "buy" : "sell";
        let change = false;
        for (let i = 0; i < this.action.longTrendIndicators.length; i++)
        {
            let indicatorStrategy = this.strategyGroup.getStrategyByName(this.action.longTrendIndicators[i]);
            if (!indicatorStrategy.getLastTradeAction() || indicatorStrategy.getLastTradeAction() === "close")
                continue;
            if (indicatorStrategy.getLastTradeAction() === nextTrade)
                return;
            change = true;
        }
        if (change) {
            this.action.direction = nextTrade === "buy" ? "short" : "long"; // reverse it
            this.log(utils.sprintf("Changed strategy direction to '%s'", this.action.direction));
        }
    }

    protected findMarketDip() {
        // TODO we have to enter sooner. like when RSI is back up to 50 - use another strategy
        if (this.action.direction === "long") {
            if (this.action.enterImmediately) {
                if (this.indicatorsMatch("buy", this.action.indicators)) {
                    if (this.plannedOrderTicks >= this.action.ticks && this.volumeMatches()) {
                        this.emitBuy(this.defaultWeight, "going LONG immediately");
                        this.executingOrder = {action: "buy", rate: this.avgMarketPrice};
                    }
                    this.plannedOrderTicks++;
                }
            }
            // 1. wait for an opposite signal first
            else if (this.lastSignal === "mixed") {
                if (this.indicatorsMatch("sell", this.action.indicators))
                    this.lastSignal = "sell";
            }
            // 2. now check if the previous signal reversed
            else if (this.lastSignal === "sell" || this.lastSignal === "mixedPendingBuy") {
                if (this.indicatorsMatch("buy", this.action.indicators)) {
                    if (this.plannedOrderTicks >= this.action.ticks && this.volumeMatches()) {
                        this.emitBuy(this.defaultWeight, "going LONG on market dip");
                        this.executingOrder = {action: "buy", rate: this.avgMarketPrice};
                    }
                    this.plannedOrderTicks++;
                }
                else {
                    this.lastSignal = "mixedPendingBuy";
                    this.decrementPlannedOrderTicks();
                }
            }
        }
        else if (this.action.direction === "short") {
            if (this.action.enterImmediately) {
                if (this.indicatorsMatch("sell", this.action.indicators)) {
                    if (this.plannedOrderTicks >= this.action.ticks && this.volumeMatches()) {
                        this.emitSell(this.defaultWeight, "going SHORT immediately");
                        this.executingOrder = {action: "sell", rate: this.avgMarketPrice};
                    }
                    this.plannedOrderTicks++;
                }
            }
            // 1. wait for an opposite signal first
            else if (this.lastSignal === "mixed") {
                if (this.indicatorsMatch("buy", this.action.indicators))
                    this.lastSignal = "buy";
            }
            // 2. now check if the previous signal reversed
            else if (this.lastSignal === "buy" || this.lastSignal === "mixedPendingSell") {
                if (this.indicatorsMatch("sell", this.action.indicators)) {
                    if (this.plannedOrderTicks >= this.action.ticks && this.volumeMatches()) {
                        this.emitSell(this.defaultWeight, "going SHORT on market dip");
                        this.executingOrder = {action: "sell", rate: this.avgMarketPrice};
                    }
                    this.plannedOrderTicks++;
                }
                else {
                    this.lastSignal = "mixedPendingSell";
                    this.decrementPlannedOrderTicks();
                }
            }
        }
    }

    protected findExitPoint() {
        // TODO option to only exit if we reached RSI oversold (signal in our direction), see findMarketDip()
        // TODO exit ticks
        if (this.strategyPosition === "long") {
            if (this.indicatorsMatch("sell", this.action.exitIndicators)) {
                this.emitClose(this.defaultWeight, "indicators say LONG run ended")
            }
        }
        else if (this.strategyPosition === "short") {
            if (this.indicatorsMatch("buy", this.action.exitIndicators)) {
                this.emitClose(this.defaultWeight, "indicators say SHORT run ended")
            }
        }
    }

    protected removePlannedOrder() {
        this.plannedOrder = null;
        this.plannedOrderTicks = 0;
    }

    protected indicatorsMatch(tradeAction: TradeAction, indicators: string[]) {
        for (let i = 0; i < indicators.length; i++)
        {
            let indicatorStrategy = this.strategyGroup.getStrategyByName(indicators[i]);
            //if (!indicatorStrategy.isDisabled())
                //continue; // shouldn't happen here (wrong config)
            if (indicatorStrategy.getLastTradeAction() !== tradeAction) {
                this.logOnce(utils.sprintf("Indicator %s doesn't match %s order. Last trade %s", indicatorStrategy.getClassName(), tradeAction.toUpperCase(),
                    indicatorStrategy.getLastTradeAction()))
                return false;
            }
        }
        return true;
    }

    protected disableStrategies() {
        let strategies = this.strategyGroup.getAllStrategies(); // disable our indicator strategies such as RSI,...
        let allIndicators = this.action.longTrendIndicators.concat(this.action.indicators).concat(this.action.exitIndicators);
        strategies.forEach((strategy) => {
            if (strategy.getClassName() === this.action.tradeStrategy || strategy.isMainStrategy())
                return;
            if (strategy instanceof AbstractStopStrategy || strategy instanceof AbstractTakeProfitStrategy)
                return;
            for (let i = 0; i < allIndicators.length; i++)
            {
                if (allIndicators.indexOf(strategy.getClassName()) === -1)
                    return; // this strategy is not part of any indicators. keep it enabled so it can trade on its own
            }
            this.log(utils.sprintf("Disabled %s strategy because it's part of our indicators", strategy.getClassName()))
            strategy.setDisabled(true);
        })
    }

    protected decrementPlannedOrderTicks() {
        if (this.plannedOrderTicks > 0)
            this.plannedOrderTicks--;
    }

    protected volumeMatches() {
        if (this.action.volume > 0 && this.action.volumeCandleSize > 0) {
            let candles = this.getCandles(this.action.volumeCandleSize, 1);
            if (candles.length === 0) {
                this.log(utils.sprintf("Skipping order because not enough data for the min volume check"))
                return false;
            }
            if (candles[0].volume < this.action.volume) {
                this.log(utils.sprintf("Skipping order because volume %s during the last %s min is not enough, required %s",
                    candles[0].volume, this.action.volumeCandleSize, this.action.volume))
                return false;
            }
        }
        return true;
    }

    protected resetValues() {
        this.plannedOrder = null;
        this.plannedOrderTicks = 0;
        super.resetValues();
    }
}