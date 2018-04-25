import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency} from "@ekliptor/bit-models";

// TODO has been replaced by Ticker in bit-models. remove this?
// TODO if we trade on another exchange than poloniex all classes under /structs/ will need a converter interface
// similar to Currency.ExchangeCurrencies
export class ExchangeTickerCoinValue {
    //id: number = -1;
    last: number = 0;
    lowestAsk: number = 0;
    highestBid: number = 0;
    percentChange: number = 0;
    baseVolume: number = 0;
    quoteVolume: number = 0;
    isFrozen: boolean = false; // number as boolean 0/1
    high24hr: number = 0;
    low24hr: number = 0;

    constructor() {
    }

    public static fromJson(json): ExchangeTickerCoinValue {
        // some exchanges (poloniex) return all numbers as strings
        let coin = new ExchangeTickerCoinValue();
        for (let prop in json)
        {
            if (coin[prop] === undefined)
                continue;
            coin[prop] = parseFloat(json[prop])
            if (coin[prop] === Number.NaN) {
                logger.warn("Error parsing ExchangeTicker: key %s, value %s", prop, json[prop])
                coin[prop] = 0
            }
        }
        return coin;
    }
}

export class ExchangeTicker extends Map<Currency.CurrencyPair, ExchangeTickerCoinValue> {
    constructor() {
        super()
    }

    public static fromJson(json, currencies: Currency.ExchangeCurrencies): ExchangeTicker {
        let ticker = new ExchangeTicker();
        for (let prop in json)
        {
            let pair = currencies.getLocalPair(prop);
            if (pair === undefined)
                continue;
            let coin = ExchangeTickerCoinValue.fromJson(json[prop]);
            ticker.set(pair, coin);
        }
        return ticker;
    }
}