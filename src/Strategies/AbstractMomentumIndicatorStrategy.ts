import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeDirection, TradeInfo} from "../Trade/AbstractTrader";
import {MarginPosition} from "../structs/MarginPosition";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";

export type AbstractMomentumIndicatorMode = "trend" | "reverse";

/*
export interface AbstractMomentumIndicatorStrategyAction extends TechnicalStrategyAction {
    low: number; // the low value of this indicator
    high: number; // the high value of this indicator
    // depending on the trading strategy we might go short or long on high/low
}


export abstract class AbstractMomentumIndicatorStrategy extends TechnicalStrategy {
    public action: AbstractMomentumIndicatorStrategyAction;
    protected tradingAgainstTrend: boolean = false;

    constructor(options) {
        super(options)
    }

    public onConfigChanged() {
        super.onConfigChanged();
        this.checkTradingAgainstTrend();
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkTradingAgainstTrend() {
        if (this.action.high < this.action.low)
            this.tradingAgainstTrend = true;
        else
            this.tradingAgainstTrend = false;
    }
}
*/