import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, MomentumIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

/**
 * Sentiment indicator to check if the market is short or long.
 * This simply counts market buy vs market sell trades. Also known as cumulative volume delta.
 * This is not margin funding 'sentiment' or opinion mining of social media 'sentiment'.
 */
export default class Sentiment extends AbstractIndicator {
    protected params: MomentumIndicatorParams;
    protected longAmount = 0.0;
    protected shortAmount = 0.0;
    protected candleCount = 0;
    // TODO add interval parameter and delete again after some time

    constructor(params: MomentumIndicatorParams) {
        super(params)
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.candleCount++;
            resolve()
        })
    }

    public addTrades(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            // TODO interval (just like RSI?) to delete old data?
            // TODO better way to differentiate between "buy" and "close short"?
            // TODO volume of closed trades (sentiment are open positions)
            trades.forEach((trade) => {
                if (trade.type === Trade.TradeType.BUY) {
                    this.longAmount += trade.amount;
                    this.shortAmount -= trade.amount; // assume close short
                    if (this.shortAmount < 0.0)
                        this.shortAmount = 0.0;
                }
                else if (trade.type === Trade.TradeType.SELL) {
                    this.shortAmount += trade.amount;
                    this.longAmount -= trade.amount; // assume close long
                    if (this.longAmount < 0.0)
                        this.longAmount = 0.0;
                }
                else
                    logger.error("Unknown trade type %s in %s", trade.type, this.className)
            })
            resolve()
        })
    }

    public getLongAmount() {
        return this.longAmount;
    }

    public getShortAmount() {
        return this.shortAmount;
    }

    public getLongShortPercentage() {
        if (this.longAmount === 0 || this.shortAmount === 0)
            return -1;
        return this.longAmount / (this.longAmount + this.shortAmount) * 100.0;
    }

    public isReady() {
        return this.candleCount >= this.params.interval;
    }

    public serialize() {
        let state = super.serialize();
        state.longAmount = this.longAmount;
        state.shortAmount = this.shortAmount;
        state.candleCount = this.candleCount;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.longAmount = state.longAmount;
        this.shortAmount = state.shortAmount;
        this.candleCount = state.candleCount;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

}

export {Sentiment}