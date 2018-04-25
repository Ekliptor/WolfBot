import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Ticker, Trade, TradeHistory, MarketOrder} from "@ekliptor/bit-models";
import {AbstractExchange} from "./AbstractExchange";


export interface ExternalTickerExchange {
    /**
     * Load tickers for all specified currencies.
     * @param {string[]} requiredCurrencies ["BTC"] to only fetch pairs containing BTC. Useful to include small trading pairs (many spikes).
     *          Leave empty to fetch all tickers.
     * @returns {Promise<Ticker.ExternalTickerMap>}
     */
    getExternalTicker(requiredCurrencies: string[]): Promise<Ticker.ExternalTickerMap>;
}

export function isExternalTickerExchange(exchange: any/*AbstractExchange*/): exchange is ExternalTickerExchange {
    if (typeof exchange.getExternalTicker !== "function")
        return false;
    return exchange instanceof AbstractExchange;
}

export function filterCurrencyPairs(allPairs: string[], requiredCurrencies: string[]) {
    let filteredPairs: string[] = [];
    allPairs.forEach((pair) => {
        for (let i = 0; i < requiredCurrencies.length; i++)
        {
            if (pair.toUpperCase().indexOf(requiredCurrencies[i]) !== -1) {
                filteredPairs.push(pair);
                break;
            }
        }
    })
    return filteredPairs;
}

export function isDesiredCurrencyPair(pair: string, requiredCurrencies: string[]) {
    for (let i = 0; i < requiredCurrencies.length; i++)
    {
        if (pair.toUpperCase().indexOf(requiredCurrencies[i]) !== -1)
            return true;
    }
    return false;
}