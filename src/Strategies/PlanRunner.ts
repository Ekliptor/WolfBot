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
import {AbstractOrderer} from "./AbstractOrderer";

export interface PlanRunnerAction extends StrategyAction {
    orders: PlanRunnerOrder[]; // an array of orders
    // how many minutes to wait before we can trade again (before existing trades get cleared). 0 = never = on bot restart. counter starts on close
    waitRepeatingTradeMin: number; // default 600.
}

export interface PlanRunnerOrder extends TechnicalStrategyAction/*StrategyAction*/ {
    action: StrategyOrder; // the order to execute
    comp: "<" | ">"; // comparator: if the price has to be greater or less to execute the order
    rate: number; // the min/max rate for the buy/sell/close order

    // optional values
    expirationPercent: number; // default 3%. expire orders after they move away x% from the set rate
    position: StrategyPosition; // default "none". the position the strategy has to be in for the order to be executed
    volume: number; // default 0. the min volume of the last candle for the trade to be executed
    volumeCandleSize: number; // default 60. the trade period in minutes for "volume"
    ticks: number; // default 0. the number of candle ticks to wait before executing the order. 0 = execute immediately
    reason: string; // the reason for this trade
    indicators: string[]; // some technical indicators. indicator config has to be added separately. only checked once (the last tick)
    // TODO more complex conditions. but JS code in JSON is overkill?
    // but multiple price points are ok: "buy if price reaches x and then y within a candles"
    // TODO StopLoss strategy that closes based on EMA or MACD to use with this class
}

/**
 * Strategy that emits buy/sell signal based on user configured steps (such as price points) in config.
 * Technical Indicators can also be used.
 * http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:money_flow_index_mfi
 */
export default class PlanRunner extends /*AbstractTurnStrategy*/TechnicalStrategy {
    public action: PlanRunnerAction;
    protected plannedOrder: PlanRunnerOrder = null;
    protected plannedOrderTicks = 0;
    //protected executedOrders: number[] = []; // only execute every order once
    protected executedOrders: string[] = [];
    protected executingOrder: PlanRunnerOrder = null;
    protected nextResetExecutedOrders: Date = null;

    constructor(options) {
        super(options)
        for (let i = 0; i < this.action.orders.length; i++)
        {
            if (!this.action.orders[i].expirationPercent)
                this.action.orders[i].expirationPercent = 3.0;
            if (!this.action.orders[i].position)
                this.action.orders[i].position = "none";
            if (!this.action.orders[i].volume)
                this.action.orders[i].volume = 0;
            if (!this.action.orders[i].volumeCandleSize)
                this.action.orders[i].volumeCandleSize = 60;
            if (!this.action.orders[i].ticks)
                this.action.orders[i].ticks = 0;
            if (!this.action.orders[i].reason)
                this.action.orders[i].reason = "";
            if (!this.action.orders[i].indicators)
                this.action.orders[i].indicators = [];
        }
        if (!this.action.waitRepeatingTradeMin)
            this.action.waitRepeatingTradeMin = 600;
        // reset after bot start in live trading (not for backtesting)
        if (nconf.get("trader") !== "Backtester")
            this.nextResetExecutedOrders = new Date(Date.now() + this.action.waitRepeatingTradeMin*utils.constants.MINUTE_IN_SECONDS*1000);

        this.addInfo("plannedOrderTicks", "plannedOrderTicks");
        this.addInfo("executedOrders", "executedOrders");
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
            if (this.action.waitRepeatingTradeMin > 0 && this.marketTime)
                this.nextResetExecutedOrders = new Date(this.marketTime.getTime() + this.action.waitRepeatingTradeMin*utils.constants.MINUTE_IN_SECONDS*1000);
        }
        if (this.executingOrder && action === this.getTradeAction(this.executingOrder)) {
            this.executedOrders.push(this.executingOrder.action + "@" + this.executingOrder.rate);
            this.executingOrder = null;
        }
    }

    public serialize() {
        let state = super.serialize();
        state.plannedOrder = this.plannedOrder;
        state.plannedOrderTicks = this.plannedOrderTicks;
        state.executedOrders = this.executedOrders;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.plannedOrder = state.plannedOrder;
        this.plannedOrderTicks = state.plannedOrderTicks;
        let executedOrders: string[] = [];
        state.executedOrders.forEach((order: string) => {
            // only add orders as "executed" if they are still present in our config
            let orderParts = order.split("@");
            for (let i = 0; i < this.action.orders.length; i++)
            {
                if (orderParts.length === 2 && parseFloat(orderParts[1]) === this.action.orders[i].rate && orderParts[0] === this.action.orders[i].action) {
                    executedOrders.push(/*order*/this.action.orders[i].action + "@" + this.action.orders[i].rate);
                    break;
                }
            }
        })
        this.executedOrders = executedOrders;
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
            this.checkOrders(candle.close, true);
            resolve()
        })
    }

    protected checkIndicators() {
        // we don't have our own indicators, they are part of strategy group
    }

    protected checkOrders(rate: number, tick: boolean) {
        if (!this.candle)
            return; // wait for at least 1 candle
        let plannedOrder = false;
        for (let i = 0; i < this.action.orders.length; i++)
        {
            let order = this.action.orders[i];
            if (this.executedOrders.indexOf(order.action + "@" + order.rate) !== -1)
                continue;
            else if (this.candle.volume < order.volume)
                continue;

            // look for the first planned order that matches all criteria
            //if (order.action === "buy" || order.action === "closeShort") {
            if (order.comp === ">") {
                if (rate >= order.rate && this.isWithinRange(rate, order)) {
                    this.planOrder(order, tick);
                    plannedOrder = true;
                    if (this.checkEmitOrder(order, i) === true)
                        break;
                }
            }
            //else if (order.action === "sell" || order.action === "closeLong") {
            else if (order.comp === "<") {
                if (rate <= order.rate && this.isWithinRange(rate, order)) {
                    this.planOrder(order, tick);
                    plannedOrder = true;
                    if (this.checkEmitOrder(order, i) === true)
                        break;
                }
            }
            else
                logger.error("Unknown order action/comparator %s/%s in %s", order.action, order.comp, this.className)
        }
        if (!plannedOrder)
            this.removePlannedOrder();
    }

    protected checkEmitOrder(order: PlanRunnerOrder, orderIndex: number) {
        // TODO there might be multiple buy/sell/close orders and we might count for the "wrong" one. but they can't really be "conflicting"
        //if (this.plannedOrder && this.plannedOrder.action === order.action)
            //return;
        if (this.plannedOrderTicks < order.ticks)
            return this.log(utils.sprintf("Skipping %s@%s order because %s is not enough ticks", order.action.toUpperCase(), order.rate, this.plannedOrderTicks))
        if (order.position !== this.strategyPosition)
            return this.logOnce(utils.sprintf("Skipping %s@%s order because position '%s' does't match required position '%s'", order.action.toUpperCase(), order.rate,
                this.strategyPosition, order.position))
        if (!this.indicatorsMatch(order))
            return this.logOnce(utils.sprintf("Skipping %s@%s order because indicators don't match", order.action.toUpperCase(), order.rate))
        if (order.volume > 0 && order.volumeCandleSize > 0) {
            let candles = this.getCandles(order.volumeCandleSize, 1);
            if (candles.length === 0)
                return this.log(utils.sprintf("Skipping %s order because not enough data for the min volume check", order.action.toUpperCase()))
            if (candles[0].volume < order.volume)
                return this.log(utils.sprintf("Skipping %s order because volume %s during the last %s min is not enough, required %s", order.action.toUpperCase(),
                    candles[0].volume, order.volumeCandleSize, order.volume))
        }

        switch (order.action)
        {
            case "buy":
                this.emitBuy(this.defaultWeight, utils.sprintf("planned buy@%s: %s", order.rate, order.reason));
                break;
            case "sell":
                this.emitSell(this.defaultWeight, utils.sprintf("planned sell@%s: %s", order.rate, order.reason));
                break;
            case "closeLong":
            case "closeShort":
                this.emitClose(this.defaultWeight, utils.sprintf("planned close@%s: %s", order.rate, order.reason));
                break;
            default:
                return;
        }
        //this.executedOrders.push(orderIndex);
        //this.executedOrders.push(order.action + "@" + order.rate); // moved to onTrade() and only added if executed
        this.executingOrder = order;
        return true;
    }

    protected planOrder(order: PlanRunnerOrder, tick: boolean) {
        if (!tick)
            return;
        if (this.isPlannedOrder(order.action))
            this.plannedOrderTicks++;
        else if (!this.plannedOrder) { // we don't have a planned order yet
            this.plannedOrder = order;
            this.plannedOrderTicks = 0;
        }
    }

    protected isPlannedOrder(action: StrategyOrder) {
        if (!this.plannedOrder)
            return false;
        return this.plannedOrder.action === action;
    }

    protected removePlannedOrder() {
        this.plannedOrder = null;
        this.plannedOrderTicks = 0;
    }

    protected indicatorsMatch(order: PlanRunnerOrder) {
        let tradeAction = this.getTradeAction(order);
        for (let i = 0; i < order.indicators.length; i++)
        {
            let indicatorStrategy = this.strategyGroup.getStrategyByName(order.indicators[i]);
            //if (!indicatorStrategy.isDisabled())
                //continue; // shouldn't happen here (wrong config)
            if (indicatorStrategy.getLastTradeAction() !== tradeAction) {
                this.logOnce(utils.sprintf("Indicator %s doesn't match %s order. Last trade %s", indicatorStrategy.getClassName(), order.action.toUpperCase(),
                    indicatorStrategy.getLastTradeAction()))
                return false;
            }
        }
        return true;
    }

    protected isWithinRange(rate: number, order: PlanRunnerOrder) {
        if (!order.expirationPercent)
            return true;
        let percentDiff = Math.abs(helper.getDiffPercent(rate, order.rate));
        if (percentDiff <= order.expirationPercent)
            return true;
        this.logOnce(utils.sprintf("Skipping %s@%s order because rate is outside of the expiration range. %s%%, rate %s", order.action.toUpperCase(), order.rate,
            percentDiff.toFixed(2), rate));
        return false;
    }

    protected disableStrategies() {
        let strategies = this.strategyGroup.getAllStrategies(); // disable our indicator strategies such as RSI,...
        strategies.forEach((strategy) => {
            if (strategy.getClassName() === this.action.tradeStrategy || strategy.isMainStrategy())
                return;
            if (strategy instanceof AbstractStopStrategy || strategy instanceof AbstractTakeProfitStrategy || strategy instanceof AbstractOrderer)
                return;
            for (let i = 0; i < this.action.orders.length; i++)
            {
                if (this.action.orders[i].indicators.indexOf(strategy.getClassName()) === -1)
                    return; // this strategy is not part of any indicators. keep it enabled so it can trade on its own
            }
            this.log(utils.sprintf("Disabled %s strategy because it's part of our indicators", strategy.getClassName()))
            strategy.setDisabled(true);
        })
    }

    protected getTradeAction(order: PlanRunnerOrder): TradeAction {
        return this.toTradeAction(order.action)
    }

    protected resetValues() {
        this.plannedOrder = null;
        this.plannedOrderTicks = 0;
        super.resetValues();
    }
}