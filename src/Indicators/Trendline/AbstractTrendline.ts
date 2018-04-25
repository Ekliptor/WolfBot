import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";
import IntervalExtremes from "../../Strategies/IntervalExtremes";


export interface SingleCandleInput {
    open: number;
    high: number;
    close: number;
    low: number;
}

export abstract class AbstractTrendline {
    protected className: string;
    protected maxCandles: number = nconf.get("serverConfig:keepCandles") // same as strategies per default

    constructor() {
        this.className = this.constructor.name;
    }

    public setMaxCandles(max: number) {
        this.maxCandles = max;
    }

    public abstract setCandleInput(hourCandles: Candle.Candle[]): void;

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected toSingleCandleInput(candles: Candle.Candle[]) {
        let inputData: SingleCandleInput[] = []
        candles.forEach((candle) => {
            // the order in AbstractStrategy is pos 0 = newest candle. here we keep newest candles at the end
            let input: SingleCandleInput = {open: candle.open, high: candle.high, low: candle.low, close: candle.close}
            inputData.unshift(input);
        })
        return inputData;
    }

    protected getLowCandle(candles: SingleCandleInput[]) {
        let min = Number.MAX_VALUE;
        let u = -1;
        for (let i = 0; i < candles.length; i++)
        {
            if (candles[i].close < min && candles[i].close > 0.0) { // sanity check
                min = candles[i].close;
                u = i;
            }
        }
        if (u === -1)
            return null;
        return candles[u];
    }

    protected getHighCandle(candles: SingleCandleInput[]) {
        let max = 0;
        let u = -1;
        for (let i = 0; i < candles.length; i++)
        {
            if (candles[i].close > max && candles[i].close > 0.0) { // sanity check
                max = candles[i].close;
                u = i;
            }
        }
        if (u === -1)
            return null;
        return candles[u];
    }
}