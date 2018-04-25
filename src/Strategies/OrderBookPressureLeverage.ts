import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import OrderBookPressure from "./OrderBookPressure";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import * as helper from "../utils/helper";

interface OrderBookPressureLeverageAction extends TechnicalStrategyAction {
    ticks: number; // for how many candle ticks the pressure has to persist to open a position
    percentChange: number; // how many percent shall the price be changed by orders?
    minDiffPercent: number; // open a position if the cost to rise/lower the price by "percentChange" differes this much

    // the percentage to increase an existing position (from another strategy) if that position has a profit
    // if enabled this strategy will work as a 2nd strategy only (not open a new position)
    increaseProfitPosition: number; // optional, default 0% = disabled

    // EMA cross params (optional)
    confirmLineCross: boolean; // default true. use EMA to confirm the order book pressure trend before opening a position
    CrossMAType: "EMA" | "DEMA" | "SMA"; // optional, default EMA
    short: number; // default 3
    long: number; // default 7
}

export default class OrderBookPressureLeverage extends OrderBookPressure {

    public action: OrderBookPressureLeverageAction;

    constructor(options) {
        super(options)
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    public getOrderAmount(tradeTotalBtc: number, leverage: number = 1): number {
        // TODO proper support for using coin currency in config (and UI)
        let amountBase = tradeTotalBtc * leverage * /*this.ticker.last*/this.avgMarketPrice;
        if (!this.action.increaseProfitPosition)
            return amountBase;
        return amountBase / 100 * this.action.increaseProfitPosition;
    }

    public getBacktestClassName() {
        return "OrderBookPressure";
    }
}