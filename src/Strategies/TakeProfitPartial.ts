import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {default as TakeProfit} from "./TakeProfit";
import {AbstractTakeProfitStrategy, AbstractTakeProfitStrategyAction} from "./AbstractTakeProfitStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";

interface TakeProfitPartialAction extends AbstractTakeProfitStrategyAction {
    // assuming we pay 0.25% taker fee for buying and selling, this value should be > 0.5%
    // add interest rates for margin trading (0.13% on average for BTC on poloniex) ==> > 0.63%
    stop: number; // optional. A fixed stop price when to sell (> for long position) or buy (< for short position). If present takes precedence over 'profit'.
    profit: number; // 1.3% // in %
    updateTrailingStop: boolean; // optional, default true - True means the setback value is used as trailing stop. False means it is set to a fixed rate once when opening a position.
    percentage: number; // 20% // how many percent of the open position shall be closed
    // TODO reopen percentage: how many % the price has to move back AFTER taking profit to increase the position again

    time: number; // in seconds, optional. only close the position if the price doesn't reach a new high/low within this time
    reduceTimeByVolatility: boolean; // optional, default true. reduce the stop time during high volatility market moments
    keepTrendOpen: boolean; // optional, default true, don't close if the last candle moved in our direction (only applicable with "time" and "candleSize")
    forceMaker: boolean; // optional, default true, force the order to be a maker order
    minRate: number; // optional // only take profit once this market rate has been reached
}

/**
 * Take partial profit at x % of price increase/decrease from the market entry time.
 */
export default class TakeProfitPartial extends TakeProfit {
    public action: TakeProfitPartialAction;
    protected enabled = true;

    constructor(options) {
        super(options)
        if (nconf.get("serverConfig:openOppositePositions")) {
            logger.error("serverConfig:openOppositePositions has to be disabled for %s to work. Disabling strategy", this.className)
            this.enabled = false;
        }

        this.addInfo("holdingCoins", "holdingCoins");
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
    }

    public getOrderAmount(tradeTotalBtc: number, leverage: number = 1): number {
        let amount = tradeTotalBtc * leverage;
        // TODO better support to specify amount in coins for futures, see getOrderAmount() of IndexStrategy
        // if StopLossTurn has a small candleSize it will do almost the same (but close the order completely)
        if (nconf.get("trader") !== "Backtester") { // backtester uses BTC as unit, live mode USD
            if (leverage >= 10 && this.isPossibleFuturesPair(this.action.pair) === true)
                amount = tradeTotalBtc * leverage * /*this.ticker.last*/this.getStopPriceForType();
        }

        // TODO tradeTotalBtc is the value from config. compare with this.holdingCoins to ensure we don't "close" too much if config changed (or manual trade)
        this.orderAmountPercent = this.action.percentage;
        if (!this.orderAmountPercent || this.orderAmountPercent === 100)
            return amount;
        return amount / 100 * this.orderAmountPercent;
    }

    public isIgnoreTradeStrategy() {
        return true;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected closeLongPosition() {
        if (this.enabled) {
            if (this.strategyPosition === "none")
                this.log("No open position to take profit from. Skipping SELL");
            else if (this.action.trailingStopPerc > 0.0) {
                this.log("placing trailing stop to close long position partially because price is high with profit", this.getStopPriceForType(), "entry", this.entryPrice,
                    "stop", this.getStopSell(), "increase %", this.getPriceDiffPercent(this.getStopSell()));
                this.updateStop(true);
            }
            else {
                this.log("closing long position partially because price is high with profit", this.getStopPriceForType(), "entry", this.entryPrice,
                    "stop", this.getStopSell(), "increase %", this.getPriceDiffPercent(this.getStopSell()));
                this.emitSell(Number.MAX_VALUE, "price high with profit");
            }
        }
        this.done = true;
    }

    protected closeShortPosition() {
        if (this.enabled) {
            if (this.strategyPosition === "none")
                this.log("No open position to take profit from. Skipping BUY");
            else if (this.action.trailingStopPerc > 0.0) {
                this.log("placing trailing stop to close short position partially because price is low with profit", this.getStopPriceForType(), "entry", this.entryPrice,
                    "stop", this.getStopBuy(), "decrease %", this.getPriceDiffPercent(this.getStopBuy()));
                this.updateStop(true);
            }
            else {
                this.log("closing short position partially because price is low with profit", this.getStopPriceForType(), "entry", this.entryPrice,
                    "stop", this.getStopBuy(), "decrease %", this.getPriceDiffPercent(this.getStopBuy()));
                this.emitBuy(Number.MAX_VALUE, "price low with profit");
            }
        }
        this.done = true;
    }

    /*
    protected getCloseAmount() {
        return this.holdingCoins / 100 * this.action.percentage;
    }
    */
}
