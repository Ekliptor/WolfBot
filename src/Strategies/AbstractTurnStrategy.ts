import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {StrategyAction, TradeAction, ScheduledTrade} from "./AbstractStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TechnicalStrategy} from "./TechnicalStrategy";

/**
 * A strategy that helps to turn a long position into a short (and vice versa) by exeuting a CLOSE order first.
 * Useful if we change our position based on technical indicators.
 */
export abstract class AbstractTurnStrategy extends TechnicalStrategy {
    protected scheduledEnterMarketOnTick: ScheduledTrade = null;
    protected emitScheduledEvent = false;

    constructor(options) {
        super(options)
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]): Promise<void> {
        // buy/sell events have to be emitted during tick/candleTick
        if (this.emitScheduledEvent && this.scheduledEnterMarketOnTick) {
            this.executeTrade(this.scheduledEnterMarketOnTick);
            this.scheduledEnterMarketOnTick = null;
            this.emitScheduledEvent = false;
        }
        else if (!this.emitScheduledEvent && this.scheduledEnterMarketOnTick && this.strategyPosition === "none") // make sure closing is done
            this.emitScheduledEvent = true; // just delay it 1 tick
        return super.tick(trades)
    }

    protected openLong(reason: string) {
        // TODO add RSI to prevent buying on overbought. generally MACD is faster than RSI, EMA can have about the same speed
        if (this.strategyPosition === "short")
            this.emitClose(this.defaultWeight, "changing strategy position from short to long")
        this.scheduledEnterMarketOnTick = new ScheduledTrade("buy", this.defaultWeight, reason);
        return true;
    }

    protected openShort(reason: string) {
        if (this.strategyPosition === "long")
            this.emitClose(this.defaultWeight, "changing strategy position from long to short")
        this.scheduledEnterMarketOnTick = new ScheduledTrade("sell", this.defaultWeight, reason);
        return true;
    }
}