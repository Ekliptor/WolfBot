import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Candle, Currency, Trade, Order} from "@ekliptor/bit-models";

export class ExchangeCandles {
    public candles: Candle.Candle[] = [];
    public avgRate: number = 0;

    constructor() {
    }

    public addCandle(candle: Candle.Candle) {
        let existingCandle = this.getExchangeCandle(candle.exchange);
        if (existingCandle) {
            logger.warn("Can not add multiple exchange candles (existing: %s %s, new: %s %s) for the same time interval",
                Currency.getExchangeName(existingCandle.exchange), utils.date.toDateTimeStr(existingCandle.start, true, true),
                Currency.getExchangeName(candle.exchange), utils.date.toDateTimeStr(candle.start, true, true));
            return;
        }
        this.candles.push(candle);
        this.computeAvgRate();
    }

    public getExchangeCandle(exchange: Currency.Exchange): Candle.Candle {
        for (let i = 0; i < this.candles.length; i++)
        {
            if (this.candles[i].exchange === exchange)
                return this.candles[i];
        }
        return null;
    }

    public serialize() {
        // we could implement the EJSON interface instead. but then serialization wouldn't work with plain JSON
        return {
            candles: Candle.Candle.copy(this.candles),
            avgRate: this.avgRate
        }
    }

    public unserialize(state: any) {
        this.candles = Candle.Candle.copy(state.candles);
        this.avgRate = state.avgRate;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected computeAvgRate() {
        if (this.candles.length === 0)
            return;
        let sum = 0;
        for (let i = 0; i < this.candles.length; i++)
            sum += this.candles[i].close;
        this.avgRate = sum / this.candles.length;
    }
}

export class ExchangeCandleMap extends Map<string, ExchangeCandles> { // (date HH-DD-mm, candles)
    constructor(iterable?: Iterable<[string, ExchangeCandles]>) {
        super(iterable)
    }
}
