import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction, ScheduledTrade} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import WaveSurfer from "./WaveSurfer";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {IndexStrategy, IndexStrategyAction, MarketTrend} from "./Mixins/IndexStrategy";

interface WaveSurferLeverageAction extends IndexStrategyAction {
    minSurfCandles: number;
    //takeProfitCandles: number; // always 1 for now
    //breakoutVolatility: number; // the min bollinger bandwidth that must exist to assume/risk breakouts
    takeProfitCandleSize: number; // optional, default 10. in minutes
    historyPriceCandles: number; // optional, default 6 - number of candles to look for price history to decide if the bot should open long or short
    lossPauseCandles: number; // optional, default 0 - how many candles the bot shall pause trading after a loss trade
    maxVolatility: number; // optional, default 0 = disabled. strategy will not enter/exit the market above this volatility (only if this is the only main strategyy)
    openBreakouts: boolean; // default true. open even if the current candle isn't the min/max candle based on EMA trend
    latestCandlePercent: number; // default 40%. how recent the min/max candle has to be for the bot to open a position (consider the wave to turn)
    onlyFollowIndicatorTrend: boolean; // optional, default false. only trade if the (longer) indicator matches our candle pattern + candle trend
    tradeIncreaseingTrendOnly: boolean; // optional, default true. only open a position if the EMA line diff is increasing

    // EMA cross params (optional)
    CrossMAType: "EMA" | "DEMA" | "SMA"; // optional, default EMA
    short: number; // default 2
    long: number; // default 7

    // Falling Knife Protection - don't buy/sell on overbought/oversold
    // RSI parameters (optional)
    interval: number;   // default 14
    low: number;        // default 30
    high: number;       // default 80 - crypto currencies have a trend to explode upwards

    // optional, for defaults see BolloingerBandsParams
    N: number; // time period for MA
    K: number; // factor for upper/lower band
    MAType: number; // moving average type, 0 = SMA

    // old idea: Holds the coin until exitLossPercent or profit decreases & exitProfitPercent is reached
    // Similar to StopLossTurn, but StopLossTurn only exit's the market (doesn't do the initial buy/sell).
    //exitLossPercent: number; // 5 %
    //exitProfitPercent: number; // 10 %
    //minHoldSec: number;
}

/**
 * A wave surfer subclass optimized for trading with high leverage (10x, 20x) such as OKEX futures.
 */
export default class WaveSurferLeverage extends WaveSurfer implements IndexStrategy {
    //protected static readonly AROON_100 = 96;
    //protected static readonly AROON_LOW = 50;

    public action: WaveSurferLeverageAction;

    // IndexStrategy mixin
    public actionMixin: IndexStrategyAction;
    public marketTrends: MarketTrend[] = [];
    public scheduledEnterMarket: ScheduledTrade = null;
    public emitScheduledEvent = false;
    public lastAvgTickMarketPrice: number = -1;

    constructor(options) {
        super(options)

        // TODO needs to be daily Aroon (see custom indicator map)
        /*
        // but even this doesn't help us against wrong buys/sells because all futures (weekly and 3 months) move at about the same prices
        this.addIndicator("Aroon", "Aroon", this.action);

        let aroon = this.getAroon("Aroon")
        this.addInfoFunction("AroonUp", () => {
            return aroon.getUp();
        });
        this.addInfoFunction("AroonDown", () => {
            return aroon.getDown();
        });
        */
        this.init(options);
    }

    public getBacktestClassName() {
        return "WaveSurfer";
    }

    // IndexStrategy mixin
    public init: (options) => void;
    public enterMarketOnTick: () => boolean;
    public resetMarketEntry: () => void;
    public checkEnterMarket: () => void;
    public isOptimisticMarket: (includeHistory?: boolean) => boolean;
    public isPessimisticMarket: (includeHistory?: boolean) => boolean;
    public addMarketTrend: (trend: MarketTrend) => void;

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]): Promise<void> {
        this.enterMarketOnTick();
        return super.tick(trades)
    }

    protected candleTick(candle: Candle.Candle): Promise<void> {
        this.resetMarketEntry();
        return super.candleTick(candle)
    }

    protected openLong(onBreakoutTrend: boolean) {
        const reason = "Pattern LOW reached, " + (onBreakoutTrend ? "up breakout happening" : "up trend expected");
        if (this.action.checkTrend && this.isPessimisticMarket(true)) {
            this.log("Prevented opening LONG position in pessimistic market with reason:", reason);
            return false;
        }
        if (this.action.delayMarketEnter)
            this.scheduledEnterMarket = new ScheduledTrade("buy", this.defaultWeight, reason);
        else
            this.emitBuy(this.defaultWeight, reason);
        if (this.strategyPosition !== "none" && WaveSurfer.backtesting === false)
            this.repeatingTrade = new ScheduledTrade("buy", this.defaultWeight, reason)
        return true;
    }

    protected openShort(onBreakoutTrend: boolean) {
        const reason = "Pattern HIGH reached, " + (onBreakoutTrend ? "down breakout happening" : "down trend expected");
        if (this.action.checkTrend && this.isOptimisticMarket(true)) {
            this.log("Prevented opening SHORT position in optimistic market with reason:", reason);
            return false;
        }
        if (this.action.delayMarketEnter)
            this.scheduledEnterMarket = new ScheduledTrade("sell", this.defaultWeight, reason);
        else
            this.emitSell(this.defaultWeight, reason);
        if (this.strategyPosition !== "none" && WaveSurfer.backtesting === false)
            this.repeatingTrade = new ScheduledTrade("sell", this.defaultWeight, reason)
        return true;
    }

    protected onClose() {
        super.onClose();
    }
}
utils.objects.applyMixins(WaveSurferLeverage, [IndexStrategy]);