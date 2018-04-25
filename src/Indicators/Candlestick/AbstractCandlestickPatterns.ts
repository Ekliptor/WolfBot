import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";
import * as path from "path";

export interface CandleInput {
    open: number[];
    high: number[];
    close: number[];
    low: number[];
}

export abstract class AbstractCandlestickPatterns {
    protected className: string;
    protected candleInput: CandleInput = {open: [], high: [], low: [], close: []};
    protected maxCandles: number = nconf.get("serverConfig:maxCandlestickCandles")

    constructor() {
        this.className = this.constructor.name;
    }

    public setMaxCandles(max: number) {
        this.maxCandles = max;
    }

    public setCandleInput(candles: Candle.Candle[]) {
        let latestCandles = candles.slice(-1 * this.maxCandles); // save CPU
        let input: CandleInput = {open: [], high: [], low: [], close: []};
        latestCandles.forEach((candle) => {
            // the order in AbstractStrategy is pos 0 = newest candle. here we keep newest candles at the end
            input.open.unshift(candle.open);
            input.high.unshift(candle.high);
            input.close.unshift(candle.close);
            input.low.unshift(candle.low);
        })
        this.candleInput = input;
    }

    public abstract isBullishAny(): boolean;
    public abstract isBearishAny(): boolean;

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

}

// force loading dynamic imports for TypeScript
import "./NodeCandlestick";