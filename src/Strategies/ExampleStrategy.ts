import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, StrategyOrder, StrategyPosition, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import {MarginPosition} from "../structs/MarginPosition";
import {GenericStrategyState} from "./AbstractGenericStrategy";

//import * as _ from "lodash"; // useful for array operations (better than underscore library)
//import * as helper from "../utils/helper"; // more useful functions such as helper.getDiffPercent()


/**
 * This is the action interface for your strategy. It defines all parameters that are available for this strategy.
 * Those parameters can be set in the ExampleStrategy.json config file in the /config folder.
 *
 * Every config file can use this strategy, but it is good practice to create 1 config file with the same name as
 * this strategy as an example how to use your strategy.
 */
interface ExampleStrategyAction extends TechnicalStrategyAction {
    interval: number; // default 14. Defines the number of candles
    mySettingSwitch: boolean; // default true. open a position in the opposite direction if price fails to make a new high/low on OBV max

    // some available settings in every strategy (from parent):
    candleSize: number; // candle size in minutes (only relevant if this strategy implements the candleTick() or checkIndicators() function)
    pair: Currency.CurrencyPair; // The currency pair this strategy trades on. (The exchange is defined in the root of the config 1 level above the strategies.)
    enableLog: boolean; // Enables logging for this strategy. call this.log() or this.warn()
}

/**
 * This is an example strategy. You can use it as a template to create your own strategy.
 * This file shows a lot available features and is therefore longer than most strategies.
 * Your first strategy can have only 50-100 lines of code. See NOOP.ts for a minimal example.
 */
export default class ExampleStrategy extends TechnicalStrategy {
    public action: ExampleStrategyAction;
    protected lastOBV: number = -1; // identical ro OBV because it's updated on every candle tick
    protected secondLastOBV: number = -1;
    protected obvHistory: number[] = [];
    protected priceHistory: number[] = [];

    constructor(options) {
        super(options)
        logger.error("%s is an example to build your own strategy. It should not be used for trading.", this.className);

        // set the default values
        if (typeof this.action.myCustomInterval !== "number")
            this.action.myCustomInterval = 14;
        if (typeof this.action.mySettingSwitch !== "boolean")
            this.action.mySettingSwitch = true;
        this.addIndicator("OBV", "OBV", this.action);

        this.addInfo("secondLastOBV", "secondLastOBV");
        this.addInfoFunction("OBV", () => {
            return this.indicators.get("OBV").getValue();
        });
        this.saveState = true;
        this.mainStrategy = true;
    }

    /**
     * This is called on every trade
     * @param {TradeAction} action
     * @param {Order} order
     * @param {Trade[]} trades
     * @param {TradeInfo} info
     */
    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo): void {
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            // do some cleanup after closing a position
        }

    }

    public onSyncPortfolio(coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange): void {
        super.onSyncPortfolio(coins, position, exchangeLabel)
    }

    /**
     *
     * @returns {GenericStrategyState}
     */
    public serialize(): GenericStrategyState {
        let state = super.serialize();
        state.lastOBV = this.lastOBV;
        state.secondLastOBV = this.secondLastOBV;
        state.obvHistory = this.obvHistory;
        state.obvHistory = this.obvHistory;
        return state;
    }

    /**
     *
     * @param state
     */
    public unserialize(state: GenericStrategyState) {
        super.unserialize(state);
        this.lastOBV = state.lastOBV;
        this.secondLastOBV = state.secondLastOBV;
        this.obvHistory = state.obvHistory;
        this.obvHistory = state.obvHistory;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    /**
     *
     * @param {Trade[]} trades
     * @returns {Promise<void>}
     */
    protected async tick(trades: Trade.Trade[]): Promise<void> {
        return super.tick(trades);
    }

    /**
     *
     * @param {Candle} candle
     * @returns {Promise<void>}
     */
    protected async candleTick(candle: Candle.Candle): Promise<void> {
        return super.candleTick(candle);
    }

    /**
     *
     * @param {Candle} candle
     * @param {boolean} isNew
     * @returns {Promise<void>}
     */
    protected async currentCandleTick(candle: Candle.Candle, isNew: boolean): Promise<void> {
        // overwrite this in your subclass if your strategy needs the current candle
        return super.currentCandleTick(candle, isNew);
    }

    /**
     * It is called right after the candleTick() function in this class (from within the parent's candleTick() function).
     * The difference to candleTick() is that it only called after ALL indicators in this strategy are ready (have enough data
     * so that they hold valid values).
     */
    protected checkIndicators(): void {
        let obv = this.indicators.get("OBV")
        const value = obv.getValue();
        const valueFormatted = Math.round(value * 100) / 100.0;
        this.secondLastOBV = this.lastOBV;
        this.addToHistory(value, this.candle.close);
        if (this.strategyPosition !== "none" || this.obvHistory.length < this.action.interval || this.priceHistory.length < this.action.interval) {
            this.lastOBV = value;
            return;
        }

        const maxOBV = _.max(this.obvHistory);
        const maxPrice = _.max(this.priceHistory);
        const minPrice = _.min(this.priceHistory);

        if (maxOBV === value) {
            this.log("Volume high detected, value", valueFormatted)
            if (maxPrice === this.candle.close)
                this.emitBuy(this.defaultWeight, utils.sprintf("OBV value max %s at price high, assuming UP breakout", valueFormatted));
            else if (minPrice === this.candle.close)
                this.emitSell(this.defaultWeight, utils.sprintf("OBV value max %s at price low, assuming DOWN breakout", valueFormatted));
            else if (this.action.openReversal === true) {
                this.log("Price failed to make a new high or low on OBV max")
                if (this.candle.trend === "up")
                    this.emitSell(this.defaultWeight, utils.sprintf("OBV value max %s on up candle without price high, assuming DOWN reversal", valueFormatted));
                else if (this.candle.trend === "down")
                    this.emitBuy(this.defaultWeight, utils.sprintf("OBV value max %s on down candle without price low, assuming UP reversal", valueFormatted));
                else
                    this.log("No candle trend on OBV max")
            }
        }

        this.lastOBV = value;
    }

    /**
     *
     */
    protected resetValues(): void {
        super.resetValues();
    }

    // ################################################################
    // Your custom functions start here

    protected addToHistory(obv: number, price: number) {
        this.obvHistory.push(obv);
        this.priceHistory.push(price);
        if (this.obvHistory.length > this.action.interval)
            this.obvHistory.shift();
        if (this.priceHistory.length > this.action.interval)
            this.priceHistory.shift();
    }

    protected demoLogFunctions() {

    }
}