import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

export interface TrendatronAction extends TechnicalStrategyAction {
    interval: number; // The number of candles for SMAs to compute GannSwing.
    stddevPriod: number; // optional, default 20 - The number of candles for the VIX indicator to compute the standard derivation.
}

/**
 * Port of the Trendatron.coffee strategy.
 * A strategy that follows waves of the chart by doing swing trading. It does this by combining 4 SMAs to
 * Gann Swing indicator and adding VIX to check for volatility.
 * Additionally it supports scalping, meaning it can buy more after sharp drops in price.
 */
export default class Trendatron extends TechnicalStrategy {
    // scalping tries to buy into huge price drops once the price starts to increase a little
    protected static readonly SCALP = true;
    protected static readonly SPIKE_SELL:boolean = false;
    // Fat finger sniping places an additional order 10% above/below the current market rate in anticipation of a big order.
    protected static readonly SNIPE = false;

    // interval: Max = 250 | Min = 50 | Default = 250

    public action: TrendatronAction;
    protected coolOff: number = 0; // TODO cooloff for 30 candles when StopLoss triggers?

    constructor(options) {
        super(options)
        this.addIndicator("GannSwing", "GannSwing", this.action);
        this.addIndicator("VIX", "VIX", this.action);

        let vix = this.getCryptotraderIndicator("VIX").getResult()
        this.addInfoFunction("interval", () => {
            return this.action.interval;
        });
        let VIX = this.getCryptotraderIndicator("VIX");
        this.addInfoFunction("VIX wvf", () => {
            return VIX.getResult().wvf;
        });
        this.addInfoFunction("VIX rangehigh", () => {
            return VIX.getResult().rangehigh;
        });
        this.addInfoFunction("VIX rangelow", () => {
            return VIX.getResult().rangelow;
        });
        this.addInfoFunction("VIX trade", () => {
            return VIX.getResult().trade ? VIX.getResult().trade.toString() : "";
        });
        let gannSwing = this.getCryptotraderIndicator("GannSwing");
        this.addInfoFunction("GannSwing tradesell", () => {
            return gannSwing.getResult().tradesell ? gannSwing.getResult().tradesell.toString() : "";
        });
        this.addInfoFunction("GannSwing tradebuy", () => {
            return gannSwing.getResult().tradebuy? gannSwing.getResult().tradebuy.toString() : "";
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return super.tick(trades); // TODO check scalping in here for faster response time?
    }

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

        if (tradebuy === true && this.coolOff <= 0) {
            this.emitBuy(this.defaultWeight, "Trend Buy");
            trading = 1;
        }
        if (Trendatron.SCALP === true && this.coolOff <= 0) {
            // TODO scalp buy can also fire in a prolonged down trend. improve it
            if (trade[0] === 1 && trade[1] === 1 && trade[2] === 0 && trade[3] === 0 && trade[4] === 0 && trade[5] === 0 && wvf > 8.5) {
                this.emitBuy(Number.MAX_VALUE, "Scalp Buy");
                trading = 1;
            }
        }
        if (Trendatron.SPIKE_SELL === true && this.coolOff <= 0) {
            if (trade[0] === 0 && trade[1] === 0 && trade[2] === 1 && trade[3] === 1 && trade[4] === 1 && trade[5] === 1 && wvf > 6.5) {
                this.emitSell(Number.MAX_VALUE, "Spike Sell");
                trading = 1;
            }
        }
        // TODO "Spike Sell" as opposite of "Scalp Buy". find good parameters

        if ((tradesell === true && wvf < 2.85) || (tradebuy === true && wvf > 8.5 && trade[0] === 1 && trade[1] === 0)) {
            this.emitSell(this.defaultWeight, "Trend Sell"); // TODO sell 2x if we bought before?
            trading = 1;
        }
        if (Trendatron.SNIPE && trading === 0) {
            if (this.coolOff % 2 === 0) { // TODO our bot can not issue sell and buy orders at the same time. improve our API
                this.rate = this.getCandle().close * 1.1;
                this.emitSell(this.defaultWeight, "Snipe Sell");
            }
            else {
                this.rate = this.getCandle().close * 0.9;
                this.emitBuy(this.defaultWeight, "Snipe Buy");
            }
        }
        this.coolOff--;
    }
}