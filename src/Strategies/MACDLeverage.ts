import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, ScheduledTrade} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import MACD from "./MACD";
import {IndexStrategy, IndexStrategyAction, MarketTrend} from "./Mixins/IndexStrategy";

interface MacdLeverageAction extends IndexStrategyAction {
    // more technical parameters, see MACD indicator
    takeProfitTicks: number; // default 0 = disabled. close a position early if the MACD histogram decreases for x candles
    closeLossEarly: boolean; // default = true. close positions at a loss after takeProfitTicks too
    noiseFilterFactor: number; // default = 1.5. increase the max histogram after a loss trade. useful to protect further losses in sideways markets
    histogramIncreaseFactor: number; // default 1.05. only open a position if the histogram increases/decreases by this factor
    closeSidewaysMarkets: boolean; // default false. close a position in sideways markets at the first tick with a profit
    openAgainPriceChange: number; // default 0.3%. how much the price has to change at least to open a long/short position again

    // optional: Aroon to only trade if we are in a trending market (not sideways)
    interval: number; // default 0 = disabled. compute Aroon up/down of the latest candles
    trendCandleThreshold: number; // default = 76. the min value of the Aroon up/down to open a position
}

/**
 * For futures trading we have to close opposite positions before opening a position in the other direction.
 * Plus there are more optimizations for index trading.
 */
export default class MACDLeverage extends MACD implements IndexStrategy {
    public action: MacdLeverageAction;

    // IndexStrategy mixin
    public actionMixin: IndexStrategyAction;
    public marketTrends: MarketTrend[] = [];
    public scheduledEnterMarket: ScheduledTrade = null;
    public emitScheduledEvent = false;
    public lastAvgTickMarketPrice: number = -1;

    constructor(options) {
        super(options)
        this.init(options);
    }

    public getBacktestClassName() {
        return "MACD";
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

    protected openLong(reason: string) {
        if (this.action.checkTrend && this.isPessimisticMarket(true)) {
            this.log("Prevented opening LONG position in pessimistic market with reason:", reason);
            return false;
        }
        if (this.strategyPosition === "short")
            this.emitClose(this.defaultWeight, "changing strategy position from short to long")
        if (this.action.delayMarketEnter)
            this.scheduledEnterMarket = new ScheduledTrade("buy", this.defaultWeight, reason);
        else
            this.scheduledEnterMarketOnTick = new ScheduledTrade("buy", this.defaultWeight, reason);
        return true;
    }

    protected openShort(reason: string) {
        if (this.action.checkTrend && this.isOptimisticMarket(true)) {
            this.log("Prevented opening SHORT position in optimistic market with reason:", reason);
            return false;
        }
        if (this.strategyPosition === "long")
            this.emitClose(this.defaultWeight, "changing strategy position from long to short")
        if (this.action.delayMarketEnter)
            this.scheduledEnterMarket = new ScheduledTrade("sell", this.defaultWeight, reason);
        else
            this.scheduledEnterMarketOnTick = new ScheduledTrade("sell", this.defaultWeight, reason);
        return true;
    }
}
utils.objects.applyMixins(MACDLeverage, [IndexStrategy]);