import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, MomentumIndicatorParams, PivotPointsParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

export type PivotLineNr = 1 | 2 | 3;

/**
 * An indicator calculating Standard, Fibonacci or Demark Pivot Points.
 * https://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:pivot_points
 */
export default class PivotPoints extends AbstractIndicator {
    protected params: PivotPointsParams;
    protected candleHistory: Candle.Candle[] = [];
    protected pivotPoint: number = -1;
    protected resistance1: number = -1;
    protected resistance2: number = -1;
    protected resistance3: number = -1;
    protected support1: number = -1;
    protected support2: number = -1;
    protected support3: number = -1;
    protected high: number = -1;
    protected low: number = -1;
    protected close: number = -1;
    protected open: number = -1;

    constructor(params: PivotPointsParams) {
        super(params)
        this.params = Object.assign(new PivotPointsParams(), this.params);
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.addCandleHistory(candle);
            resolve();
        })
    }

    public removeLatestCandle() {
        this.candleHistory = this.removeLatestDataAny<Candle.Candle>(this.candleHistory);
    }

    public getValue() {
        return this.pivotPoint;
    }

    public getPivotPoint() {
        return this.pivotPoint;
    }

    public getResistance1() {
        return this.resistance1;
    }

    public getResistance2() {
        return this.resistance2;
    }

    public getResistance3() {
        return this.resistance3;
    }

    public getSupport1() {
        return this.support1;
    }

    public getSupport2() {
        return this.support2;
    }

    public getSupport3() {
        return this.support3;
    }

    public getResistance(nr: PivotLineNr) {
        switch (nr) {
            case 1:         return this.resistance1;
            case 2:         return this.resistance2;
            case 3:         return this.resistance3;
        }
        //logger.error("Resistance nr %s doesn't exist in %s", nr, this.className);
        utils.test.assertUnreachableCode(nr);
    }

    public getSupport(nr: PivotLineNr): number {
        switch (nr) {
            case 1:         return this.support1;
            case 2:         return this.support2;
            case 3:         return this.support3;
        }
        utils.test.assertUnreachableCode(nr);
    }

    public isReady() {
        return this.pivotPoint !== -1 && this.candleHistory.length >= this.params.interval;
    }

    public getAllValues() {
        return {
            pivotPoint: this.pivotPoint,
            resistance1: this.resistance1,
            resistance2: this.resistance2,
            resistance3: this.resistance3,
            support1: this.support1,
            support2: this.support2,
            support3: this.support3
        }
    }

    public serialize() {
        let state = super.serialize();
        state.candleHistory = this.candleHistory;
        state.pivotPoint = this.pivotPoint;
        state.resistance1 = this.resistance1;
        state.resistance2 = this.resistance2;
        state.resistance3 = this.resistance3;
        state.support1 = this.support1;
        state.support2 = this.support2;
        state.support3 = this.support3;
        state.high = this.high;
        state.low = this.low;
        state.close = this.close;
        state.open = this.open;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.candleHistory = Candle.Candle.copy(state.candleHistory);
        this.pivotPoint = state.pivotPoint;
        this.resistance1 = state.resistance1;
        this.resistance2 = state.resistance2;
        this.resistance3 = state.resistance3;
        this.support1 = state.support1;
        this.support2 = state.support2;
        this.support3 = state.support3;
        this.high = state.high;
        this.low = state.low;
        this.close = state.close;
        this.open = state.open;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected addCandleHistory(candle: Candle.Candle) {
        this.candleHistory.push(candle);
        if (this.candleHistory.length >= this.params.interval*2) {
            this.updatePivotPoints(); // calc from oldest candles (previous period)
            while (this.candleHistory.length > this.params.interval) // remove the 1st time period completely
                this.candleHistory.shift();
        }
        else if (this.pivotPoint === -1 && this.candleHistory.length === this.params.interval)
            this.updatePivotPoints(); // initial update
    }

    protected updatePivotPoints() {
        this.calcHighLowClose();
        switch (this.params.type)
        {
            case "standard":
                this.pivotPoint = (this.high + this.low + this.close) / 3;
                this.support1 = this.pivotPoint*2 - this.high;
                this.support2 = this.pivotPoint - (this.high - this.low);
                this.resistance1 = this.pivotPoint*2 - this.low;
                this.resistance2 = this.pivotPoint + (this.high - this.low);
                break;
            case "fibonacci":
                this.pivotPoint = (this.high + this.low + this.close) / 3;
                this.support1 = this.pivotPoint - (0.382 * (this.high - this.low));
                this.support2 = this.pivotPoint - (0.618 * (this.high - this.low));
                this.support3 = this.pivotPoint - (1.0 * (this.high - this.low));
                this.resistance1 = this.pivotPoint + (0.382 * (this.high - this.low));
                this.resistance2 = this.pivotPoint + (0.618 * (this.high - this.low));
                this.resistance3 = this.pivotPoint + (1.0 * (this.high - this.low));
                break;
            case "demark":
                let x: number;
                if (this.close < this.open)
                    x = this.high + 2*this.low + this.close;
                else if (this.close > this.open)
                    x = 2*this.high + this.low + this.close;
                else // close == open
                    x = this.high + this.low + 2*this.close;
                this.pivotPoint = x / 4;
                this.support1 = x/2 - this.high;
                this.resistance1 = x/2 - this.low;
                break;
            default:
                utils.test.assertUnreachableCode(this.params.type);
        }
    }

    protected calcHighLowClose() {
        let high = 0, close = 0, open = -1, low = Number.MAX_VALUE;
        for (let i = 0; i < this.params.interval && i < this.candleHistory.length; i++)
        {
            // go through the first half of our candle history to get the HLC for this period
            const candle = this.candleHistory[i];
            if (open === -1)
                open = candle.open;
            if (candle.high > high)
                high = candle.high;
            if (candle.low < low)
                low = candle.low;
            close = candle.close;
        }
        this.high = high;
        this.low = low;
        this.close = close;
        this.open = open;
    }
}

export {PivotPoints}