import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, ScheduledTrade, StrategyOrder, StrategyPosition} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {IndexStrategy, IndexStrategyAction, MarketTrend} from "./Mixins/IndexStrategy";
import DirectionRunner from "./DirectionRunner";

interface DirectionRunnerLeverageAction extends IndexStrategyAction {
    direction: "long" | "short";

    // optional values
    enterImmediately: boolean; // default false. don't wait for the indicators to change their buy/sell signal. enter on the first signal
    longTrendIndicators: string[]; // set the direction automatically based on long trend indicators such as EMA
    volume: number; // default 0. the min volume of the last candle for the trade to be executed
    volumeCandleSize: number; // default 60. the trade period in minutes for "volume"
    ticks: number; // default 0. the number of candle ticks to wait before executing the order. 0 = execute immediately
    indicators: string[]; // default RSIScalper. some technical indicators. indicator config has to be added separately. only checked once (the last tick)
    exitIndicators: string[]; // default RSI. indicators to exit the market
    // how many minutes to wait before we can trade again (before existing trades get cleared). 0 = never = on bot restart. counter starts on close
    waitRepeatingTradeMin: number; // default 300.
}

/**
 * For futures trading we have to close opposite positions before opening a position in the other direction.
 * Plus there are more optimizations for index trading.
 */
export default class DirectionRunnerLeverage extends DirectionRunner implements IndexStrategy {
    public action: DirectionRunnerLeverageAction;

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
        return "DirectionRunner";
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
utils.objects.applyMixins(DirectionRunnerLeverage, [IndexStrategy]);