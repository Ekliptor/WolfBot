import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, ScheduledTrade, StrategyOrder, StrategyPosition} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {IndexStrategy, IndexStrategyAction, MarketTrend} from "./Mixins/IndexStrategy";
import PlanRunner, {PlanRunnerOrder} from "./PlanRunner";

interface PlanRunnerLeverageAction extends IndexStrategyAction {
    orders: PlanRunnerOrder[]; // an array of orders
    waitRepeatingTradeMin: number; // default 120. how many minutes to wait before we can trade again (before existing trades get cleared). 0 = never = on bot restart
}

/**
 * For futures trading we have to close opposite positions before opening a position in the other direction.
 * Plus there are more optimizations for index trading.
 */
export default class PlanRunnerLeverage extends PlanRunner implements IndexStrategy {
    public action: PlanRunnerLeverageAction;

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
        return "PlanRunner";
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
}
utils.objects.applyMixins(PlanRunnerLeverage, [IndexStrategy]);