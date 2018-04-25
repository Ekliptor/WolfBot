import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import Trendatron from "./Trendatron";
import {TrendatronAction} from "./Trendatron";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

interface ScalperAction extends TrendatronAction {
    interval: number; // the number of candles for SMAs to compute GannSwing
}

export default class Scalper extends Trendatron {
    protected action: ScalperAction;

    constructor(options) {
        super(options)
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        let bot_efficiency, combo, current_btc_equiv, current_fiat_equiv, day, efficiency, efficiency_percent, instrument, market_efficiency, month, pair1, pair2, pairs, price, rangehigh, rangelow, starting_btc_equiv, starting_fiat_equiv, swing, today, trade, tradebuy, tradesell, trading, vix, wvf;
        trading = 0;
        vix = this.getCryptotraderIndicator("VIX").getResult()
        wvf = vix.wvf;
        rangehigh = vix.rangehigh;
        rangelow = vix.rangelow;
        trade = vix.trade;
        swing = this.getCryptotraderIndicator("GannSwing").getResult()
        tradesell = swing.tradesell;
        tradebuy = swing.tradebuy;

        if (trade[0] === 1 && trade[1] === 1 && trade[2] === 0 && trade[3] === 0 && trade[4] === 0 && trade[5] === 0 && wvf > 8.5) {
            this.emitBuy(Number.MAX_VALUE, "Scalp Buy");
            trading = 1;
        }
        // TODO "Spike Sell" as opposite of "Scalp Buy". find good parameters
    }
}