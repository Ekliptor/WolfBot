import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";
import IntervalExtremes from "../../Strategies/IntervalExtremes";
import {AbstractTrendline} from "./AbstractTrendline";


/**
 * A class that finds support and resistance lines.
 * Similar to Bollinger Bands or Donchian Channels indicators. Also see IntervalExtremes strategy.
 * Useful with large values such as 7 days (168 hours).
 */
export class Trendlines extends AbstractTrendline {
    protected hourCandles: Candle.Candle[] = [];
    //protected resistance: number = 0; // TODO cache? but we have to compute it for different hours
    //protected support: number = 0;
    protected skipLatestCandles = 1;

    constructor() {
        super()
    }

    public setSkipLatestCandles(skip: number) {
        this.skipLatestCandles = skip; // skip the latest ones to see if they break the previous trend line
    }

    /**
     * Add candle data to compute trend lines. All candles must have a candleSize of 60 min.
     * @param {Candle.Candle[]} hourCandles use strategy.getCandles(60, nconf.get("serverConfig:trendlineKeepDays") * 24)
     */
    public setCandleInput(hourCandles: Candle.Candle[]) {
        /* // save CPU by only adding the last
        let candles = [];
        for (let i = 0; i < hourCandles.length; i++)
        {
            if (hourCandles[i].interval !== 60) {
                logger.error("Invalid candle with wrong candle size %s in %s", hourCandles[i].interval, this.className)
                continue;
            }
            candles.unshift(hourCandles[i]) // the order in AbstractStrategy is pos 0 = newest candle. here we keep newest candles at the end
        }
        this.hourCandles = candles;
        */
        if (hourCandles.length === 0)
            return; // shouldn't happen
        if (hourCandles[0].interval !== 60) {
            logger.error("Invalid candle with wrong candle size %s in %s", hourCandles[0].interval, this.className)
            return;
        }
        this.hourCandles.push(hourCandles[0]); // newest candle at the end
        if (this.hourCandles.length > this.maxCandles)
            this.hourCandles.shift();
        //this.computeLines();
    }

    public getResistanceLine(hours: number) {
        let candleRange = this.getCandles(hours);
        let max = 0;
        for (let i = 0; i < candleRange.length; i++)
        {
            if (candleRange[i].close > max && candleRange[i].close > 0.0) // sanity check
                max = candleRange[i].close;
        }
        return Math.max(0, max);
    }

    public getSupportLine(hours: number) {
        let candleRange = this.getCandles(hours);
        let min = Number.MAX_VALUE;
        for (let i = 0; i < candleRange.length; i++)
        {
            if (candleRange[i].close < min && candleRange[i].close > 0.0) // sanity check
                min = candleRange[i].close;
        }
        return Math.max(0, min);
    }

    public resistanceHolding(hours: number, rate: number, percentChannel: number = 0.5) {
        const line = this.getResistanceLine(hours);
        const high = line * (1 + percentChannel / 100.0);
        return rate <= high;
    }

    public supportHolding(hours: number, rate: number, percentChannel: number = 0.5) {
        const line = this.getSupportLine(hours);
        const low = line * (1 - percentChannel / 100.0);
        return rate >= low;
    }

    public isReady(hours: number) {
        let candleRange = this.getCandles(hours);
        return candleRange.length >= hours;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected getCandles(hours: number) {
        return this.hourCandles.slice(-1 * (hours+this.skipLatestCandles), -1 * this.skipLatestCandles);
    }
}