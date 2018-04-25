import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";
import IntervalExtremes from "../../Strategies/IntervalExtremes";
import {AbstractTrendline, SingleCandleInput} from "./AbstractTrendline";
import {CandleInput} from "../Candlestick/AbstractCandlestickPatterns";

export type FibonacciTrend = "up" | "down";

/**
 * A class computing the Fibonacci Retracement values.
 * Code taken from https://github.com/rubenafo/trendyways
 */
export class FibonacciRetracement extends AbstractTrendline {
    protected candleData: SingleCandleInput[] = [];

    constructor() {
        super()
    }

    public setCandleInput(candles: Candle.Candle[]) {
        /*
        let latestCandles = candles.slice(-1);
        let inputData = []
        latestCandles.forEach((candle) => {
            // the order in AbstractStrategy is pos 0 = newest candle. here we keep newest candles at the end
            let input: SingleCandleInput = {open: candle.open, high: candle.high, low: candle.low, close: candle.close}
            inputData.unshift(input);
        })
        this.candleData = inputData;
        */
        if (candles.length === 0)
            return; // shouldn't happen
        this.candleData.push(candles[0]); // newest candle at the end
        if (this.candleData.length > this.maxCandles)
            this.candleData.shift();
    }

    public getFibonacciFromLow(candle: Candle.Candle = null): number[] {
        let input: SingleCandleInput = candle ? this.toSingleCandleInput([candle])[0] : this.getLowCandle(this.candleData);
        if (!input)
            return null;
        // TODO find low in candleData if not specified
        // TODO trend up
        let fib = this.computeFibonacciRetracement([input], "up")
        if (fib && fib.length !== 0)
            return fib[0];
        /**
         * [ 0.07558621,
         0.07380463458,
         0.07325430499999999,
         0.07270397542,
         0.07202305916,
         0.0709224 ]
         */
        return null;
    }

    public getFibonacciFromHigh(candle: Candle.Candle = null): number[] {
        let input: SingleCandleInput = candle ? this.toSingleCandleInput([candle])[0] : this.getHighCandle(this.candleData);
        if (!input)
            return null;
        let fib = this.computeFibonacciRetracement([input], "down")
        if (fib && fib.length !== 0)
            return fib[0];
        /**
         * [ 0.08110558,
         0.08202024462,
         0.08230278499999999,
         0.08258532537999999,
         0.08293490924,
         0.08349999 ]
         */
        return null;
    }

    public getFibonacciRetracement(trend: FibonacciTrend): number[][] {
        return this.computeFibonacciRetracement(this.candleData, trend);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected computeFibonacciRetracement(values: SingleCandleInput[], trend: FibonacciTrend) {
        let result: number[][] = [];
        let retracements = [1, 0.618, 0.5, 0.382, 0.236, 0];
        if (trend == 'down')
        {
            for (let i = 0; i < values.length; i++)
            {
                let diff = values[i].high - values[i].low;
                let elem: number[] = [];
                for (let r = 0; r < retracements.length; r++)
                {
                    let level = values[i].high - diff * retracements[r];
                    elem.push(level);
                }
                result.push(elem);
            }
        }
        else  // UPTREND
        {
            for (let i = 0; i < values.length; i++)
            {
                let diff = values[i].high - values[i].low;
                let elem: number[] = [];
                for (let r = 0; r < retracements.length; r++)
                {
                    let level = values[i].low + diff * retracements[r];
                    elem.push (level);
                }
                result.push(elem);
            }
        }
        return result;
    }
}