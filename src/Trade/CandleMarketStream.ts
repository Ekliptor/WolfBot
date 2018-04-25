import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractMarketStream} from "./AbstractMarketStream";
import {MarketStream} from "./MarketStream";
import {OrderModification} from "../structs/OrderResult";
import {Currency, Trade, Candle, Order, MarketOrder} from "@ekliptor/bit-models";
import {AbstractExchange, OrderBookUpdate} from "../Exchanges/AbstractExchange";

export class CandleMarketStream extends MarketStream {
    protected streamingCandles = false;

    constructor(exchange: AbstractExchange) {
        super(exchange)
    }

    public writeCandles(currencyPair: Currency.CurrencyPair, candles: Candle.Candle[]) {
        return new Promise<void>((resolve, reject) => {
            // we get all candles for the whole backtesting period at once
            // re-create 1 mock trade per minute and emit that so that AbstractStrategy.sendTick() gets called too
            this.streamingCandles = true;
            let emitNext = () => {
                let nextCandle = candles.shift();
                if (!nextCandle)
                    return resolve()
                let mockTrade = this.createMockTrade(nextCandle);
                // TODO with only 1 mock trade a lot more orders get cancelled because there is less volatility. add random volatility based on this 1min candle
                if (mockTrade.amount !== 0.0)
                    this.writeTrades(currencyPair, [mockTrade])
                this.emitCandles(currencyPair, [nextCandle])
                setTimeout(emitNext.bind(this), 0)
                /*
                let doCallback = (count) => { // return to the event loop multiple times to ensure all async actions are being executed
                    if (count > 0)
                        return setTimeout(doCallback.bind(this), --count);
                    setTimeout(emitNext.bind(this), 0)
                }
                setTimeout(doCallback.bind(this), 3)
                */
            }
            emitNext();
        })
    }

    public isStreamingCandles() {
        return this.streamingCandles;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected emitCandles(currencyPair: Currency.CurrencyPair, candles: Candle.Candle[]) {
        if (candles.length !== 0)
            this.emit("candles", currencyPair, candles);
    }

    protected createMockTrade(candle: Candle.Candle) {
        let trade = Trade.Trade.fromCandle(candle);
        return trade;
    }
}