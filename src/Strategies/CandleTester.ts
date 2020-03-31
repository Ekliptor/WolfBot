import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

interface CandleTesterAction extends TechnicalStrategyAction {
    sample: string;
}

/**
 * This strategy just logs candles.
 * It is only intended for debugging purposes.
 */
export default class CandleTester extends TechnicalStrategy {
    public action: CandleTesterAction;
    protected candleTickCounter: number = 0; // counts the number of candles after start — need for valid calculations with kama


    constructor(options) {
        super(options)
        this.addInfoFunction("sample", () => {
            return this.action.sample;
        });
    }

    public getMinWarumCandles() {
        return 0; // ensure we don't start any trade imports with this strategy
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    protected async candleTick(candle: Candle.Candle): Promise<void> {
        this.candleTickCounter += 1;
        logger.verbose("%s candle: %s CandleTester Market time: %s, open %s, close %s, volume %s, trades %s",
            this.candleTickCounter, utils.getUnixTimeStr(true, candle.start), utils.getUnixTimeStr(true, this.marketTime),
            candle.open.toFixed(2), candle.close.toFixed(2), candle.volume.toFixed(2), candle.trades);

        return super.candleTick(candle);
    }

    protected checkIndicators() {
        // this strategy does nothing
    }
}
