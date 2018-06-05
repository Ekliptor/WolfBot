import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";

interface PriceRangeAction extends StrategyAction {
    minChangePercent: number; // 2 % The min percentage between the low and high price point to open a position.
    intervalSec: number; // 300 // The number of seconds after which a price point expires.
    logTradeTicks: number; // optional, default 300 - Log the current low and high price points after every x trade ticks. 'enableLog' must be set to true.
}

class PricePoint {
    rate: number;
    date: Date;

    constructor(rate: number, date: Date) {
        this.rate = rate;
        this.date = date;
    }
}

/**
 * Detect if a price always jumps between a high a low and buy/sell accordingly.
 * Works well in sideways markets (that usually have low volume). It is meant for fast trades, possibly many trades per hour
 * if there are changes >= 'minChangePercent'.
 * This strategy can be a faster alternative to using BollingerBands in a sideways market and sell at the upper band and buy at the lower band.
 */
export default class PriceRangeTrader extends AbstractStrategy {
    protected action: PriceRangeAction;
    protected low: PricePoint = null;
    protected high: PricePoint = null;
    protected changePercent: number = 0; // 0 < x <= 100 %

    constructor(options) {
        super(options)
        if (!this.action.logTradeTicks)
            this.action.logTradeTicks = 300;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            this.updatePricePoints(trades);

            if (this.low && this.high) {
                const change = "change " + this.changePercent.toFixed(3) + "%";
                if (this.tradeTick >= this.action.logTradeTicks) {
                    this.tradeTick -= this.action.logTradeTicks;
                    this.log("market price", this.marketPrice);
                    this.log("low", this.low.rate, "high", this.high.rate, change);
                }

                if (this.strategyStart.getTime() + this.action.intervalSec * 1000 < this.marketTime.getTime()) {
                    if (this.changePercent >= this.action.minChangePercent) {
                        // TODO count how many times the price moved between high and low before emitting signals
                        // how? add all low/high pairs to an array and keep for 10min?
                        const buy = this.low.date.getTime() > this.high.date.getTime();
                        let msg = "low " + this.low.rate + "\nhigh " + this.high.rate + "\n" + change + "\nprice difference " + (this.high.rate - this.low.rate);
                        this.log("emitting", (buy ? "BUY" : "SELL"), msg);
                        if (buy)
                            this.emitBuy(this.defaultWeight, msg);
                        else
                            this.emitSell(this.defaultWeight, msg);
                    }
                }
            }
            resolve()
        })
    }

    protected updatePricePoints(trades: Trade.Trade[]) {
        // delete expired points
        if (this.isExpiredPoint(this.low))
            this.low = null;
        if (this.isExpiredPoint(this.high))
            this.high = null;

        trades.forEach((trade) => {
            // initialize points
            if (!this.low) {
                this.low = new PricePoint(trade.rate, trade.date);
                this.maybeSwitchPoints();
                return;
            }
            else if (!this.high) {
                this.high = new PricePoint(trade.rate, trade.date);
                this.maybeSwitchPoints();
                return;
            }

            // set low/high
            if (trade.rate <= this.low.rate)
                this.low = new PricePoint(trade.rate, trade.date);
            else if (trade.rate >= this.high.rate)
                this.high = new PricePoint(trade.rate, trade.date);
        })
        if (!this.low || !this.high) {
            this.changePercent = 0;
            return;
        }
        this.changePercent = this.high.rate / this.low.rate * 100 - 100;
    }

    protected isExpiredPoint(point: PricePoint) {
        if (!point)
            return false;
        return point.date.getTime() + this.action.intervalSec * 1000 < Date.now();
    }

    protected maybeSwitchPoints() {
        if (!this.low || !this.high)
            return;
        if (this.low.rate > this.high.rate) {
            let temp = this.low;
            this.low = this.high;
            this.high = temp;
        }
    }
}