import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {AbstractStopStrategy, AbstractStopStrategyAction} from "./AbstractStopStrategy";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

interface TimeOrderAction extends AbstractStopStrategyAction {
    executeMin: number; // A countdown in minutes after which the buy/sell order will be executed.
    keepTrendOpen: boolean; // optional, default true, Don't execute the order yet if the last candle moved in our direction (only applicable with 'candleSize' set).
}

/**
 * A simple strategy that buys or sells after a specified amount of time has passed.
 * This is useful to place a manual order after the dip of a spike to buy more if you assume this is the start of a new trend.
 * Also useful after a buy from spikes of VolumeSpikeDetector or PriceSpikeDetector.
 */
export default class TimeOrder extends AbstractStopStrategy {
    public action: TimeOrderAction;
    protected countStart: Date = new Date(Date.now() + 365*utils.constants.DAY_IN_SECONDS*1000);

    constructor(options) {
        super(options)
        if (this.action.keepTrendOpen === undefined)
            this.action.keepTrendOpen = true;

        this.addInfo("countStart", "countStart");
        this.addInfoFunction("executeMin", () => {
            return this.action.executeMin;
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            if (this.done)
                return resolve();
            if (this.tradeTick >= nconf.get('serverConfig:tradeTickLog')) {
                this.tradeTick -= nconf.get('serverConfig:tradeTickLog');
                this.logStopValues(true);
            }
            //if (this.countStart === null) // count will be started after a trade (from another strategy) in resetValues()
                //this.countStart = this.marketTime;

            if (this.isCloseLongPending() === true)
                this.checkSell();
            else if (this.isCloseShortPending() === true)
                this.checkBuy();
            resolve()
        })
    }

    protected getStopPrice() {
        return -1; // order after time, regardless of price
    }

    protected checkSell() {
        if (this.action.keepTrendOpen === true && this.candleTrend === "up")
            return this.logOnce("skipping time sell because candle trend is up %", this.candle.getPercentChange());
        else if (this.countStart.getTime() + this.action.executeMin * 60 * 1000 <= this.marketTime.getTime()) {
            this.log("emitting sell because countdown expired, price", this.avgMarketPrice, "executeMin", this.action.executeMin);
            this.emitSellClose(Number.MAX_VALUE, "countdown expired");
            this.done = true;
        }
    }

    protected checkBuy() {
        if (this.action.keepTrendOpen === true && this.candleTrend === "down")
            return this.logOnce("skipping time buy because candle trend is down %", this.candle.getPercentChange());
        else if (this.countStart.getTime() + this.action.executeMin * 60 * 1000 <= this.marketTime.getTime()) {
            this.log("emitting buy because countdown expired, price", this.avgMarketPrice, "executeMin", this.action.executeMin);
            this.emitBuyClose(Number.MAX_VALUE, "countdown expired");
            this.done = true;
        }
    }

    protected resetValues() {
        //this.countStart = new Date(Date.now() + 365*utils.constants.DAY_IN_SECONDS*1000);
        this.countStart = this.marketTime;
        super.resetValues();
    }

    protected logStopValues(force = false) {
        const passed = this.countStart.getTime() < this.marketTime.getTime() ? utils.test.getPassedTime(this.countStart.getTime(), this.marketTime.getTime()) : "n/a";
        this.log("market price", this.avgMarketPrice.toFixed(8), "passed time", passed)
    }
}
