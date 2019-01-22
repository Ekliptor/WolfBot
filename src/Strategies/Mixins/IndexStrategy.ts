import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction, ScheduledTrade} from "../AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "../TechnicalStrategy";
import WaveSurfer from "../WaveSurfer";
import {AbstractIndicator, TrendDirection} from "../../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";

export interface MarketTrend {
    optimistic: boolean;
    pessimistic: boolean;
}

export interface IndexStrategyAction extends TechnicalStrategyAction {
    // Leverage/Index Features (optional)
    checkTrend: boolean;            // false // check if index is greater (less) than market price before opening a long (short) position
    trendSampleSec: number;         // 180 // interval to check if the market is optimistic/pessimistic
    trendSampleSize: number;        // 5 // how many (most recent) samples shall be kept
    delayMarketEnter: boolean;      // true // delay entering the market until it moves in our direction
}

// can not have mixins with private members (TS implements them as interface and an interface only has public properties)
// TODO trade futures based on market data of another market (for example Kraken USD_BTC market) for OKEX futures. see Haasbot
export abstract class IndexStrategy extends TechnicalStrategy {
    public actionMixin: IndexStrategyAction; // action // can't have the same name or else it has to be public in all parent classes

    public marketTrends: MarketTrend[] = [];
    public scheduledEnterMarket: ScheduledTrade = null;
    public emitScheduledEvent = false;
    public lastAvgTickMarketPrice: number = -1;

    // constructor of a mixin is never called
    /*
    constructor(options) {
        super(options)
        console.log("constructor mixin")
    }
    */

    public getOrderAmount(tradeTotalBtc: number, leverage: number = 1): number {
        // rates of futures fluctuate heavily
        // so here we adjust tradeTotalBtc so that we always trade about 60% of 0.1 BTC or 2.0 LTC
        // we do this by treating tradeTotalBtc as the COIN amount (instead of USD)

        // originally: 165*20/2470 = 1.33 BTC
        // return value: 165*20 = 3300 USD
        // now: 0.08*20*2470 = 3952 USD
        // TODO proper support for using coin currency in config (and UI)
        let amountBase = tradeTotalBtc * leverage * /*this.ticker.last*/this.avgMarketPrice;
        return amountBase;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    // TypeScript implements mixins as an interface, so these functions have to be public too

    public init(options: any) {
        if (nconf.get("trader") === "Backtester")
            throw new Error(utils.sprintf("%s is not available during backtesting. Please use a class that doesn't implement IndexStrategy instead.", this.className))
        this.actionMixin = this.action as any; // copy properties modified from constructor

        if (typeof this.actionMixin.checkTrend !== "boolean")
            this.actionMixin.checkTrend = false;
        if (!this.actionMixin.trendSampleSec)
            this.actionMixin.trendSampleSec = 180;
        if (!this.actionMixin.trendSampleSize)
            this.actionMixin.trendSampleSize = 5;
        if (typeof this.actionMixin.delayMarketEnter !== "boolean")
            this.actionMixin.delayMarketEnter = true;
        Object.assign(this.action, this.actionMixin); // copy modified properties back while keeping references to "action" in tact

        this.addInfo("lastAvgTickMarketPrice", "lastAvgTickMarketPrice");
        this.addInfoFunction("optimisticMarket", () => {
            return this.isOptimisticMarket();
        });
        this.addInfoFunction("pessimisticMarket", () => {
            return this.isPessimisticMarket();
        });
        this.addInfoFunction("optimisticMarketHistory", () => {
            return this.isOptimisticMarket(true);
        });
        this.addInfoFunction("pessimisticMarketHistory", () => {
            return this.isPessimisticMarket(true);
        });

        setInterval(() => {
            this.addMarketTrend({
                optimistic: this.isOptimisticMarket(),
                pessimistic: this.isPessimisticMarket()
            })

            this.checkEnterMarket();
            this.lastAvgTickMarketPrice = this.avgMarketPrice; // use this with a fixed interval instead of the value from AbstractStrategy
        }, this.actionMixin.trendSampleSec*1000)
    }

    public enterMarketOnTick() {
        // buy/sell events have to be emitted during tick/candleTick
        if (this.emitScheduledEvent && this.scheduledEnterMarket) {
            this.log("Executing scheduled trade to enter market:", this.scheduledEnterMarket.action.toUpperCase(), this.action.pair.toString())
            this.executeTrade(this.scheduledEnterMarket);
            this.scheduledEnterMarket = null;
            this.emitScheduledEvent = false;
            return true;
        }
        return false;
    }

    public resetMarketEntry() {
        if (this.scheduledEnterMarket !== null) {
            this.log("Scheduled market entry expired on next candle, scheduled:", this.scheduledEnterMarket.action.toUpperCase())
            this.scheduledEnterMarket = null; // we got a new candle, so let the scheduled order expire
        }
    }

    public checkEnterMarket() {
        // TODO gets reset to soon with WaveSurferLeverage for LTC. how?
        if (this.scheduledEnterMarket === null || this.lastAvgTickMarketPrice === -1)
            return;
        // TODO don't open any positions if volatility is too low? bollinger bandwidth < 0.018
        // TODO check the orderbook too. but shouldn't matter for longer candle sizes as it can change quickly

        // delay entering the market until the market moves in our direction
        this.log(utils.sprintf("Scheduled trade to enter the market is pending: %s (prices: last %s, current %s)", this.scheduledEnterMarket.action.toUpperCase(),
            this.lastAvgTickMarketPrice, this.avgMarketPrice))
        if (this.scheduledEnterMarket.action === "buy" && this.lastAvgTickMarketPrice < this.avgMarketPrice) {
            this.emitScheduledEvent = true;
        }
        else if (this.scheduledEnterMarket.action === "sell" && this.lastAvgTickMarketPrice > this.avgMarketPrice) {
            this.emitScheduledEvent = true;
        }
    }

    public isOptimisticMarket(includeHistory = false): boolean {
        if (!this.ticker)
            return false;
        if (includeHistory) {
            for (let i = 0; i < this.marketTrends.length; i++)
            {
                if (this.marketTrends[i].optimistic !== true)
                    return false;
            }
        }
        return this.ticker.indexValue <= this.ticker.last;
        // TODO watch for crossing of index + last. close half our position? or use it as a signal to open?
        // TODO the discrepancy should have higher weight when we are closer to the contract delivery date
    }

    public isPessimisticMarket(includeHistory = false): boolean {
        if (!this.ticker)
            return false;
        if (includeHistory) {
            for (let i = 0; i < this.marketTrends.length; i++)
            {
                if (this.marketTrends[i].pessimistic !== true)
                    return false;
            }
        }
        return this.ticker.indexValue > this.ticker.last;
    }

    public addMarketTrend(trend: MarketTrend) {
        this.marketTrends.push(trend);
        if (this.marketTrends.length > this.actionMixin.trendSampleSize)
            this.marketTrends.shift();
    }
}