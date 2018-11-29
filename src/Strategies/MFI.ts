import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction, ScheduledTrade} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import {AbstractMomentumIndicatorMode} from "./AbstractMomentumIndicatorStrategy";

interface MfiAction extends TechnicalStrategyAction {
    low: number; // Below this value MFI will be considered oversold. The strategy will queue a buy order to be executed after 'trendCandles' going up.
    high: number; // Above this value MFI will be considered overbought. The strategy will queue a sell order to be executed after 'trendCandles' going down.
    interval: number; // The number of candles to use for MFI computation.

    trendCandles: number; // default 1. Wait for x candles in the same direction as MFI before opening a position.
    // 0 = immediately, 1 immediately on current candle, 2 = after 1 full tick
    //mode: AbstractMomentumIndicatorMode; // not used here. we queue an order and trade when the market turns
}

/**
 * Strategy that emits buy/sell based on the MFI indicator. MFI is an oscillator that contains both price and volume. You can think of it as RSI with volume.
 * http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:money_flow_index_mfi
 */
export default class MFI extends TechnicalStrategy {
    public action: MfiAction;
    protected trendCandleCount: number = 0;

    constructor(options) {
        super(options)
        if (!this.action.trendCandles)
            this.action.trendCandles = 1;
        //if (!this.action.mode)
            //this.action.mode = "trend";

        this.addIndicator("MFI", "MFI", this.action);
        this.addInfo("trendCandleCount", "trendCandleCount");
        this.addInfoFunction("low", () => {
            return this.action.low;
        });
        this.addInfoFunction("high", () => {
            return this.action.high;
        });
        this.addInfoFunction("interval", () => {
            return this.action.interval;
        });
        this.addInfoFunction("MFI", () => {
            return this.indicators.get("MFI").getValue();
        });
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        //if (action === "close")
    }

    public serialize() {
        let state = super.serialize();
        state.trendCandleCount = this.trendCandleCount;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.trendCandleCount = state.trendCandleCount;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected currentCandleTick(candle: Candle.Candle, isNew: boolean): Promise<void> {
        this.checkExecuteByCandleMatch(candle, false)
        return super.currentCandleTick(candle, isNew);
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        this.checkExecuteByCandleMatch(candle, true)
        return super.candleTick(candle);
    }

    protected checkIndicators() {
        let mfi = this.indicators.get("MFI")
        const value = mfi.getValue();
        // TODO check for this.action.thresholds.persistence, add a counter

        if (value > this.action.high) {
            this.log("UP trend detected, value", value);
            const reason = utils.sprintf("MFI value: %s", value)
            if (this.strategyPosition === "none") {
                if (this.action.trendCandles >= 1)
                    this.pendingOrder = new ScheduledTrade("sell", this.defaultWeight, this.className); // overwrite existing ones, don't reset counter
                else
                    this.emitSell(this.defaultWeight, reason);
            }
            else if (this.strategyPosition === "short")
                this.emitClose(Number.MAX_VALUE, reason); // exit immediately
        }
        else if (value < this.action.low) {
            this.log("DOWN trend detected, value", value);
            const reason = utils.sprintf("MFI value: %s", value)
            if (this.strategyPosition === "none") {
                if (this.action.trendCandles >= 1)
                    this.pendingOrder = new ScheduledTrade("buy", this.defaultWeight, this.className);
                else
                    this.emitBuy(this.defaultWeight, reason);
            }
            else if (this.strategyPosition === "long")
                this.emitClose(Number.MAX_VALUE, reason);
        }
        else
            this.log("no trend detected, value", value)
    }

    protected checkExecuteByCandleMatch(candle: Candle.Candle, fullCandle: boolean) {
        if (this.action.trendCandles < 1 || !this.pendingOrder)
            return;
        if (this.action.trendCandles === 1) {
            // execute immediately on the current candle (not finished, candle might still turn against us)
            if (this.trendMatchesTrade(candle) === true) {
                this.executeTrade(this.pendingOrder);
                this.pendingOrder = null;
            }
            return;
        }
        if (fullCandle === true)
            this.trendCandleCount++;
        if (this.trendCandleCount >= this.action.candleSize) {
            if (this.trendMatchesTrade(candle) === true) {
                this.executeTrade(this.pendingOrder);
                this.pendingOrder = null;
            }
        }
    }

    protected resetValues() {
        this.trendCandleCount = 0;
        //this.pendingOrder = null; // good idea to delete order on every trade?
        super.resetValues();
    }
}