import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, IchimokuIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";


/**
 * Ichimoku Clouds indicator, which is mostly used to show support and resistance as well as the trend direction.
 * http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:ichimoku_cloud
 */
export default class IchimokuClouds extends AbstractIndicator {
    protected params: IchimokuIndicatorParams;
    protected candles: Candle.Candle[] = [];
    protected conversion: number = -1;
    protected base: number = -1;
    protected spanA: number = -1;
    protected spanB: number = -1;

    constructor(params: IchimokuIndicatorParams) {
        super(params)
        this.params = Object.assign(new IchimokuIndicatorParams(), this.params);
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.candles = this.storeCandle(candle);
            if (this.candles.length < this.params.spanPeriod)
                return resolve(); // not enough data yet

            const ichimoku = new Ichimoku({
                conversionPeriod : this.params.conversionPeriod,
                basePeriod       : this.params.basePeriod,
                displacement     : this.params.displacement,
                spanPeriod       : this.params.spanPeriod,
                values           : []
            });
            for (let i = 0; i < this.candles.length; i++)
            {
                let ichimokuValue = ichimoku.nextValue({
                    high  : this.candles[i].high,
                    low   : this.candles[i].low,
                    close : this.candles[i].close
                });
                if (ichimokuValue === undefined)
                    continue;
                this.conversion = ichimokuValue.conversion;
                this.base = ichimokuValue.base;
                this.spanA = ichimokuValue.spanA;
                this.spanB = ichimokuValue.spanB;
            }
            resolve();
        })
    }

    public removeLatestCandle() {
        this.candles = this.removeLatestDataAny<Candle.Candle>(this.candles);
    }

    public isReady() {
        return this.conversion !== -1 && this.candles.length >= this.params.spanPeriod;
    }

    public getConversion() {
        return this.conversion;
    }

    public getBase() {
        return this.base;
    }

    public getSpanA() {
        return this.spanA;
    }

    public getSpanB() {
        return this.spanB;
    }

    public priceAboveCloud(price: number) {
        let max = Math.max(this.spanA, this.spanB);
        return price > max;
    }

    public cloudIsGreen() {
        return this.spanA > this.spanB;
    }

    public cloudIsRed() {
        return this.spanA < this.spanB;
    }

    public priceAboveBaseLine(price: number) {
        return price > this.base;
    }

    public conversionAboveBaseLine() {
        return this.conversion > this.base;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected storeCandle(candle: Candle.Candle) {
        this.candles.push(candle);
        if (this.candles.length > 2*this.params.spanPeriod) // keep more data to ensure we can enough compute values
            this.candles.shift();
        return this.candles;
    }
}

interface IchimokuParams {
    conversionPeriod: number;
    basePeriod: number;
    spanPeriod: number;
    displacement: number;
    values?: number[];
}
interface IchimokuResult {
    conversion: number;
    base: number;
    spanA: number;
    spanB: number;
}

/**
 * class taken from: https://github.com/rd13/ichimoku
 */
class Ichimoku {
    protected defaults: IchimokuParams;
    protected params: IchimokuParams;
    protected generator: Iterator<IchimokuResult>;

    constructor(input: IchimokuParams) {
        let _this = this

        this.defaults = {
            conversionPeriod : 9,
            basePeriod       : 26,
            spanPeriod       : 52,
            displacement     : 26
        }

        // Overwrite param defaults
        this.params = Object.assign({}, this.defaults, input)

        this.generator = (function* () {
            let result
            let tick

            let period = Math.max(_this.params.conversionPeriod, _this.params.basePeriod, _this.params.spanPeriod, _this.params.displacement)
            let periodCounter = 0
            let spanCounter = 0
            let highs = []
            let lows = []
            let spanAs = []
            let spanBs = []

            let conversionPeriodLow, conversionPeriodHigh
            let basePeriodLow, basePeriodHigh
            let spanbPeriodLow, spanbPeriodHigh

            tick = yield

            while (true) {
                // Keep a list of lows/highs for the max period
                highs.push(tick.high)
                lows.push(tick.low)

                if(periodCounter < period) {
                    periodCounter++
                } else {
                    highs.shift()
                    lows.shift()

                    // Tenkan-sen (ConversionLine): (9-period high + 9-period low)/2))
                    conversionPeriodLow = lows.slice(-_this.params.conversionPeriod).reduce( (a,b) => Math.min(a,b) )
                    conversionPeriodHigh = highs.slice(-_this.params.conversionPeriod).reduce( (a,b) => Math.max(a,b) )
                    let conversionLine = (conversionPeriodHigh + conversionPeriodLow) /2

                    // Kijun-sen (Base Line): (26-period high + 26-period low)/2))
                    basePeriodLow = lows.slice(-_this.params.basePeriod).reduce( (a,b) => Math.min(a,b) )
                    basePeriodHigh = highs.slice(-_this.params.basePeriod).reduce( (a,b) => Math.max(a,b) )
                    let baseLine = (basePeriodHigh + basePeriodLow) /2

                    // Senkou Span A (Leading Span A): (Conversion Line + Base Line)/2))
                    let spanA = 0
                    spanAs.push((conversionLine + baseLine) /2)

                    // Senkou Span B (Leading Span B): (52-period high + 52-period low)/2))
                    let spanB = 0
                    spanbPeriodLow = lows.slice(-_this.params.spanPeriod).reduce( (a,b) => Math.min(a,b) )
                    spanbPeriodHigh = highs.slice(-_this.params.spanPeriod).reduce( (a,b) => Math.max(a,b) )
                    spanBs.push((spanbPeriodHigh + spanbPeriodLow) /2)

                    // Senkou Span A / Senkou Span B offset by 26 periods
                    if(spanCounter < _this.params.displacement) {
                        spanCounter++
                    } else {
                        spanA = spanAs.shift()
                        spanB = spanBs.shift()
                    }

                    result = {
                        conversion : parseFloat(conversionLine.toFixed(5)),
                        base       : parseFloat(baseLine.toFixed(5)),
                        spanA      : parseFloat(spanA.toFixed(5)),
                        spanB      : parseFloat(spanB.toFixed(5))
                    }

                }

                tick = yield result
            }
        })()

    }
    nextValue(price): IchimokuResult {
        return this.generator.next(price).value;
    }

}

export {IchimokuClouds}