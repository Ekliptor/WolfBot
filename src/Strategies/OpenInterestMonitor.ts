import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {Candle, Ticker, Currency} from "@ekliptor/bit-models";
import * as db from "../database";
import * as helper from "../utils/helper";

interface OpenInterestMonitorAction extends TechnicalStrategyAction {
    changePercent: number; // optional, default 1.1% - How many percent the open interest has to change (per candleSize) to trigger a notification.
}

/**
 * Strategy that watches the open interest of derivates exchanges (currently only BitMEX).
 * It displays the information, makes it accessible to other strategies and sends notification on open interest changes.
 * TODO add trading functionality
 */
export default class OpenInterestMonitor extends TechnicalStrategy {
    public action: OpenInterestMonitorAction;
    protected currentTicker: Ticker.Ticker = null;
    protected tickerLastH: Ticker.Ticker = null;
    protected ticker24H: Ticker.Ticker = null;

    constructor(options) {
        super(options)
        if (this.action.candleSize !== 60)
            throw new Error(utils.sprintf("Config candleSize must be set to 60 min for %s to work.", this.className)) // TODO we can support any size even though we don't have data for all resolutions, just use closest
        if (typeof this.action.changePercent !== "number")
            this.action.changePercent = 1.1;

        this.addInfoFunction("currentTickerRate", () => {
            return this.currentTicker === null ? -1.0 : this.currentTicker.last;
        });
        this.addInfoFunction("currentTickerOpenInterest", () => {
            return this.currentTicker === null ? -1.0 : this.currentTicker.openInterest;
        });
        this.addInfoFunction("currentTickerFundingRate", () => {
            return this.currentTicker === null ? -1.0 : this.currentTicker.fundingRate;
        });
        this.addInfoFunction("tickerLastHRate", () => {
            return this.tickerLastH === null ? -1.0 : this.tickerLastH.last;
        });
        this.addInfoFunction("tickerLastHOpenInterest", () => {
            return this.tickerLastH === null ? -1.0 : this.tickerLastH.openInterest;
        });
        this.addInfoFunction("tickerLastHFundingRate", () => {
            return this.tickerLastH === null ? -1.0 : this.tickerLastH.fundingRate;
        });
        this.addInfoFunction("ticker24HRate", () => {
            return this.ticker24H === null ? -1.0 : this.ticker24H.last;
        });
        this.addInfoFunction("ticker24HOpenInterest", () => {
            return this.ticker24H === null ? -1.0 : this.ticker24H.openInterest;
        });
        this.addInfoFunction("ticker24HFundingRate", () => {
            return this.ticker24H === null ? -1.0 : this.ticker24H.fundingRate;
        });
        this.saveState = true;

        /*
        setTimeout(async () => {
            await this.loadTickers();
            this.checkOpenInterestChange();
        }, 300)*/
    }

    public serialize() {
        let state = super.serialize();
        state.currentTicker = this.currentTicker;
        state.tickerLastH = this.tickerLastH;
        state.ticker24H = this.ticker24H;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.currentTicker = Object.assign(new Ticker.Ticker(state.currentTicker.exchange), state.currentTicker);
        this.tickerLastH = Object.assign(new Ticker.Ticker(state.tickerLastH.exchange), state.tickerLastH);
        this.ticker24H = Object.assign(new Ticker.Ticker(state.ticker24H.exchange), state.ticker24H);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected async candleTick1min(candle: Candle.Candle): Promise<void> {
        // nothing to do
    }

    protected checkIndicators() {
        this.loadTickers().then(() => {
            this.checkOpenInterestChange();
            // TODO check funding rate? but funding rate changes usually don't have an immediate impact on price
        }).catch((err) => {
            this.warn("Error loading tickers", err);
        })
    }

    protected checkOpenInterestChange() {
        if (this.currentTicker === null || this.tickerLastH === null)
            return;
        const percentChange = helper.getDiffPercent(this.currentTicker.openInterest, this.tickerLastH.openInterest);
        if (Math.abs(percentChange) >= this.action.changePercent) {
            const text = utils.sprintf("Change %s%%\r\nCurrent %s mio USD\r\nPrevious H %s mio USD", percentChange.toFixed(2), (this.currentTicker.openInterest / 1000000).toFixed(2),
                (this.tickerLastH.openInterest / 1000000).toFixed(2));
            this.sendNotification("BitMEX open interest changed", text, false, true);
        }
    }

    protected async loadTickers(): Promise<void> {
        // we only have BitMEX open interest stored currently. so don't get it fom this.config for the current exchange
        const endDate = this.marketTime ? this.marketTime : new Date();
        // use BTC pair as fallback
        const currencyPair = this.action.pair.equals(new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.ETH)) ? this.action.pair : new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.BTC);
        let tickers = await Ticker.getTickers(db.get(), Currency.Exchange.BITMEX, currencyPair, endDate);
        if (tickers.length !== 0)
            this.currentTicker = tickers[0];
        if (tickers.length > 1)
            this.tickerLastH = tickers[1];
        if (tickers.length >= 24)
            this.ticker24H = tickers[23];
        else
            this.warn("Incomplete ticker data, available " + tickers.length);
    }
}
