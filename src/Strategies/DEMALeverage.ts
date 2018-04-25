import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, ScheduledTrade} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import DEMA from "./DEMA";
import {IndexStrategy, IndexStrategyAction, MarketTrend} from "./Mixins/IndexStrategy";

interface DEMALeverageAction extends IndexStrategyAction {
    // optional parameters
    CrossMAType: "EMA" | "DEMA" | "SMA"; // default DEMA
    autoSensitivity: boolean; // default false. automatically adjust how strong a line crossing must be based on the current market volatility
    minVolatility: number; // default 0.0 (always open positions). min Bollinger Bandwidth value to open a position
    closeDecreasingDiff: number; // default 0 = disabled. close a position if the line diff is decreasing for x candle ticks
    resetLastCloseCount: number; // default 10 (0 = disabled). after how many candles shall the last close line diff be reset to 0
    dynamicPersistence: boolean; // default false. decrease the persistence count on high volatility markets

    // optional, for defaults see BolloingerBandsParams
    N: number; // time period for MA
    K: number; // factor for upper/lower band
    MAType: number; // moving average type, 0 = SMA
}

/**
 * For futures trading we have to close opposite positions before opening a position in the other direction.
 * Plus there are more optimizations for index trading.
 */
export default class DEMALeverage extends DEMA implements IndexStrategy {
    public action: DEMALeverageAction;

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
        return "DEMA";
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
utils.objects.applyMixins(DEMALeverage, [IndexStrategy]);