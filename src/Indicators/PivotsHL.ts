import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, MomentumIndicatorParams, PivotsHLParams} from "./AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

/**
 * An indicator calculating Pivot Points high/lows.
 * https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/pivot-points-high-low
 * https://www.tradingview.com/script/QTnrNj6i-Pivot-Reversal-Strategy-TimeFramed/
 */
export default class PivotsHL extends AbstractIndicator {
    protected params: PivotsHLParams;
    protected candleHistory: Candle.Candle[] = [];
    protected highPoints: Candle.Candle[] = [];
    protected lowPoints: Candle.Candle[] = [];

    constructor(params: PivotsHLParams) {
        super(params)
        this.params = Object.assign(new PivotsHLParams(), this.params);
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

    /**
     * Get all pivot point high candles. The most recent candle is at pos 0.
     */
    public getHighs(): Candle.Candle[] {
        let x = this.highPoints;
        return x.reverse();
    }

    /**
     * Get all pivot point low candles. The most recent candle is at pos 0.
     */
    public getLows(): Candle.Candle[] {
        let x = this.lowPoints;
        return x.reverse();
    }

    /**
     * Get the most recent pivot point high price.
     */
    public getHigh(): number {
        return this.highPoints.length !== 0 ? this.highPoints[this.highPoints.length-1].close : 0.0;
    }

    /**
     * Get the most recent pivot point low price.
     */
    public getLow(): number {
        return this.lowPoints.length !== 0 ? this.lowPoints[this.lowPoints.length-1].close : 0.0;
    }

    public isReady() {
        const max = Math.max(this.params.leftLen, this.params.rightLen);
        return this.candleHistory.length >= 2*max;
    }

    public getAllValues() {
        return {
            highPoints: this.highPoints.length !== 0 ? this.highPoints[this.highPoints.length-1].close : 0.0,
            lowPoints: this.lowPoints.length !== 0 ? this.lowPoints[this.lowPoints.length-1].close : 0.0,
        }
    }

    public serialize() {
        let state = super.serialize();
        state.candleHistory = this.candleHistory;
        state.highPoints = this.highPoints;
        state.lowPoints = this.lowPoints;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.candleHistory = Candle.Candle.copy(state.candleHistory);
        this.highPoints = Candle.Candle.copy(state.highPoints);
        this.lowPoints = Candle.Candle.copy(state.lowPoints);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected addCandleHistory(candle: Candle.Candle) {
        this.candleHistory.push(candle);
        const max = Math.max(this.params.leftLen, this.params.rightLen);
        while (this.candleHistory.length > 20*max) // remove old candles. we need to keep a lot more history
            this.candleHistory.shift();

        // update HL
        this.highPoints = [];
        this.lowPoints = [];
        for (let i = 0; i < this.candleHistory.length; i++)
        {
            if (this.isMaxPoint(i, true) === true)
                this.highPoints.push(this.candleHistory[i]);
            else if (this.isMaxPoint(i, false) === true)
                this.lowPoints.push(this.candleHistory[i]);
        }
    }

    protected isMaxPoint(current: number, high: boolean): boolean {
        const rate = this.candleHistory[current].close;
        // go left
        let leftCount = 0;
        for (let i = current-1; i >= 0; i--)
        {
            if ((high === true && this.candleHistory[i].close <= rate) || (high === false && this.candleHistory[i].close >= rate))
                leftCount++;
            else
                leftCount = 0;
            if (leftCount >= this.params.leftLen)
                break;
        }

        // go right
        let rightCount = 0;
        for (let i = current+1; i < this.candleHistory.length; i++)
        {
            if ((high === true && this.candleHistory[i].close <= rate) || (high === false && this.candleHistory[i].close >= rate))
                rightCount++;
            else
                rightCount = 0;
            if (rightCount >= this.params.rightLen)
                break;
        }

        return leftCount >= this.params.leftLen && rightCount >= this.params.rightLen;
    }
}

export {PivotsHL}