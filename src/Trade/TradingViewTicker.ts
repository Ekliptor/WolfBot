import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as TradingViewAPI from "tradingview-scraper";

export interface TradingviewTickerRes {
    last_retrieved: string; // ISO date
    ch: number;
    chp: number;
    current_session: string; // "market"
    description: string;
    exchange: string;
    fractional: boolean;
    high_price: number;
    is_tradable: boolean;
    low_price: number;
    lp: number; // last price
    minmov: number;
    minmove2: number;
    open_price: number;
    original_name: string;
    prev_close_price: number;
    pricescale: number;
    pro_name: string;
    short_name: string;
    type: string; // bitcoin
    update_mode: string; // streaming
    volume: number;
    s: string; // ok
    last_update: string; // ISO date
    ask: number;
    bid: number;
}

export class TradingViewTicker {
    constructor() {
    }

    /**
     * Fetch the latest TradingView ticker data for a given symbol.
     * @param tickerSymbol the symbol to fetch data for. Examples: BITFINEX:BTCUSDSHORTS, COINBASE:BTCUSD
     */
    public async getTradingviewTicker(tickerSymbol: string): Promise<TradingviewTickerRes> {
        const tv = new TradingViewAPI();
        let ticker = await tv.getTicker(tickerSymbol);
        return ticker;
    }

    public addTickerValue(values: number[], ticker: TradingviewTickerRes, maxDataPoints: number, property: string = "lp") {
        let nextValue = ticker[property];
        if (nextValue === undefined)
            nextValue = -1;
        values.push(nextValue);
        if (values.length > maxDataPoints)
            values.shift();
        return values;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}