import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {PivotLineNr} from "../Indicators/PivotPoints";


interface PivotPeaksAction extends TechnicalStrategyAction {
    leftlen: number; // optional, default 14. The number of candles a high/low must hold going back in time.
    rightlen: number; // optional, default 14. The number of candles a high/low must hold going forward in time.

}

/**
 * Strategy that checks for Pivot Point high/lows and goes long if new highs are reached (and short if new lows are reached).
 * Simply put: This strategy goes with the current trend of the market by looking a configurable amount of candles back and forth in time
 * from price highs/lows.
 * This strategy works very well for daytrading with candle sizes from 30min to 2h.
 * This strategy will open position and trade against an open position (possible reverse the direction), but never close a position completely.
 * You can combine it with a stop-loss and/or take profit strategy.
 */
export default class PivotPeaks extends TechnicalStrategy {
    public action: PivotPeaksAction;
    protected prevHighRate: number = 0.0;
    protected prevLowRate: number = 0.0;
    protected prevLong: boolean = false;
    protected prevShort: boolean = false;

    constructor(options) {
        super(options)
        if (typeof this.action.leftlen !== "number")
            this.action.leftlen = 14;
        if (typeof this.action.rightlen !== "number")
            this.action.rightlen = 14;

        this.addIndicator("PivotsHL", "PivotsHL", this.action);

        const points = this.getPivotsHL("PivotsHL");
        this.addInfoFunction("high", () => {
            return points.getHigh();
        });
        this.addInfoFunction("low", () => {
            return points.getLow();
        });
        this.saveState = true;
        this.mainStrategy = true;
    }

    public serialize() {
        let state = super.serialize();
        state.prevHighRate = this.prevHighRate;
        state.prevLowRate = this.prevLowRate;
        state.prevLong = this.prevLong;
        state.prevShort = this.prevShort;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.prevHighRate = state.prevHighRate;
        this.prevLowRate = state.prevLowRate;
        this.prevLong = state.prevLong;
        this.prevShort = state.prevShort;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        //if (this.strategyPosition !== "none") // allow opening & closing
            //return;
        const preciousCandle = this.getCandleAt(1);
        if (preciousCandle === null)
            return; // shouldn't happen
        const points = this.getPivotsHL("PivotsHL");
        const highs = points.getHighs();
        const lows = points.getLows();

        const highCond = highs.length !== 0;
        const highRate = highCond === true ? highs[0].close : this.prevHighRate;
        const goLong = highCond === true && highRate <= this.candle.close ? true : (this.prevLong === true && this.candle.high > highRate ? false : this.prevLong);
        if (goLong)
            this.emitBuy(this.defaultWeight, "Going LONG on pivot high");

        const lowCond = lows.length !== 0;
        const lowRate = lowCond === true ? lows[0].close : this.prevLowRate;
        const goShort = lowCond === true && lowRate >= this.candle.close ? true : (this.prevShort === true && this.candle.low  < lowRate ? false : this.prevShort);
        if (goShort)
            this.emitSell(this.defaultWeight, "Going SHORT on pivot low");

        this.prevShort = goShort;
        this.prevLong = goLong;
        this.prevLowRate = lowRate;
        this.prevHighRate = highRate;
    }
}