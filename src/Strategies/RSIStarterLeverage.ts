import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import RSIStarter from "./RSIStarter";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import * as helper from "../utils/helper";

interface RSIStarterLeverageAction extends TechnicalStrategyAction {
    low: number;
    high: number;
    lowStartFactor: number; // optional, default 0.75, max 0.95. the bot will enter a down trend immediately if RSI <= lowStartFactor*low, otherwise wait for the end of it and go long
    candlePercentReverse: number; // optional, default 4.0. how many percent the last candle has to go in the other direction to enter the market at the end of a spike/drop
    pauseCandles: number; // optional, default 25. how many candles to pause after a bad trade
    historyCandleSize: number; // optional, default 60. candle size in min to check for the long trend
}

/**
 * A strategy that only opens positions based on RSI (should be used together with other strategies)
 * 1. after a sharp drop when the price goes up again (scalping, also see MomentumTurn strategy)
 * 2. when there is a sudden spike upwards
 */
export default class RSIStarterLeverage extends RSIStarter {

    public action: RSIStarterLeverageAction;

    /**
     * example:
     *         "RSIStarterLeverage": {
          "low": 20,
          "high": 85,
          "interval": 6,
          "pair": "USD_LTC",
          "candleSize": 10,
          "enableLog": true
        },
     currently disabled because causes too many trades per day and more losses on the long term
     */

    constructor(options) {
        super(options)
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    public getOrderAmount(tradeTotalBtc: number, leverage: number = 1): number {
        // TODO proper support for using coin currency in config (and UI)
        let amountBase = tradeTotalBtc * leverage * /*this.ticker.last*/this.avgMarketPrice;
        return amountBase;
    }

    public getBacktestClassName() {
        return "RSIStarter";
    }
}