import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency} from "@ekliptor/bit-models";
import {ConfigCurrencyPair, TradeConfig} from "../Trade/TradeConfig";
import * as _ from "lodash";
import {AbstractConfig} from "../Trade/AbstractConfig";

export interface LendingConfigRuntimeUpdate {
    pollTimeActive: number;
    pollTimeInactive: number;
    xDayThreshold: number;
    xDays: number;
}
export interface CurrencyConfRuntimeUpdate {
    maxActiveAmount: number;
    minLoanSize: number;
    minDailyRate: number;
    maxToLend: number;
    maxPercentToLend: number;
    returnDateUTC: string;
}
export interface CurrencyJson {
    [currencyName: string]: CurrencyConfRuntimeUpdate;
}

export class LendingConfig extends AbstractConfig {
    //public readonly name: string = "";

    public readonly exchange: string = ""; // the value read from config
    public readonly exchanges: string[] = []; // the value exposed to ExchangeController for compatibility, only contains 1 element

    public readonly pollTimeActive: number = 60; // seconds when to poll for new loan requests (only applies if the exchange has no websocket support)
    public readonly pollTimeInactive: number = 240;
    public readonly xDayThreshold: number = 1.8; // min daily rate at which to lend for more days
    public readonly days: number = 2; // how many days to lend at the default (strategy) rate
    public readonly xDays: number = 30; // for how many days to lend at the higher rate
    public readonly xDayReservePercentage = 30; // TODO reserve coins for higher interest rates
    public readonly markets: Currency.Currency[] = [];

    // TODO
    public readonly hideCoins = false; // only place offers after there are requests for it (only good idea for poloniex where requests are present longer)
    // TODO option to only show x% of coins if hideCoins == false
    public readonly keepStuckOffers = true; // keep the offer on the order book if it is has only been partially filled
    public readonly spreadLend = 3; // spread available balance across x offers
    // polo bot: Gap modes: Raw, RawBTC, Relative -> default relative 10% top 200% - not needed since we use EMA? can be implemented as strategy too
    // more lending styles: https://github.com/eAndrius/BitfinexLendingBot#strategy

    // per coin config (copied from "currencies" object)
    public readonly currency: Currency.Currency; // the currency for this (expanded) config, see expandConfig()
    public readonly maxActiveAmount = 1; // how many offers of a coin shall be placed simultaneously. only applies if hideCoins == true
    public readonly maxToLend = 0; // takes precedent over maxPercentToLend if > 0
    public readonly maxPercentToLend = 100;
    public readonly returnDateUTC = ""; // get all coins back before this date
    // TODO returnDate for maxToLend/maxPercentToLend that will enforce limits BEFORE this date
    // TODO deltaPercent per currency, see DEMA strategy

    public readonly minLoanSize: number = 0;
    public readonly minDailyRate: number = 0;

    // indicators are stored in IndicatorAdder class
    //public readonly configNr: number = 0;

    constructor(json: any, configName: string) {
        super(json, configName)
        // copy expanded properties first, then overwrite globals
        for (let prop in json)
        {
            if (this[prop] !== undefined)
                this[prop] = json[prop];
        }

        if (json.exchange) {
            if (json.exchange === "default")
                this.exchange = nconf.get("defaultExchanges")[0]
            else
                this.exchange = json.exchange;
        }
        else
            this.exchange = nconf.get("defaultExchanges")[0]
        this.exchanges.push(this.exchange)
        if (json.pollTimeActive)
            this.pollTimeActive = Math.floor(json.pollTimeActive)
        if (json.pollTimeInactive)
            this.pollTimeInactive = Math.floor(json.pollTimeInactive)
        if (json.days)
            this.days = Math.floor(json.days)
        if (json.xDayThreshold)
            this.xDayThreshold = parseInt(json.xDayThreshold)
        if (json.xDays)
            this.xDays = Math.floor(json.xDays)
        if (json.currency)
            this.currency = json.currency;
        this.loadMarkets(json.strategies);
        //this.loadMarketsFromCurrencies(json.currencies);
    }

    public static expandConfig(json: any): any[] {
        // expand the compact config format (single object) to an array of multiple configs (config numbers, strategies,...)
        let configs = []
        for (let currencyStr in json.currencies)
        {
            let curConfig = _.cloneDeep(json);
            delete curConfig.currencies;

            // copy per coin config
            curConfig.currency = parseInt(Currency.Currency[currencyStr]);
            for (let prop in json.currencies[currencyStr])
                curConfig[prop] = json.currencies[currencyStr][prop];

            // add strategy currency
            let currency = LendingConfig.getCurrency(currencyStr);
            if (!currency)
                throw new Error("Unknown currency in lending config: " + currencyStr);
            for (let prop in curConfig.strategies)
                curConfig.strategies[prop].currency = currency;

            configs.push(curConfig)
        }
        return configs;
    }

    public static resetCounter() {
        AbstractConfig.resetCounter();
    }

    public getConfigCurrencyPair(currency: Currency.Currency): ConfigCurrencyPair {
        return LendingConfig.createConfigCurrencyPair(this.configNr, currency);
    }

    public static createConfigCurrencyPair(configNr: number, currency: Currency.Currency): ConfigCurrencyPair {
        return configNr + "-" + Currency.Currency[currency];
    }

    public static getCurrencyJson(configs: LendingConfig[]): CurrencyJson {
        let currencyJson: CurrencyJson = {};
        configs.forEach((config) => {
            config.markets.forEach((currencyNr) => {
                let currency = Currency.Currency[currencyNr];
                currencyJson[currency] = {
                    maxActiveAmount: config.maxActiveAmount,
                    minLoanSize: config.minLoanSize,
                    minDailyRate: config.minDailyRate,
                    maxToLend: config.maxToLend,
                    maxPercentToLend: config.maxPercentToLend,
                    returnDateUTC: config.returnDateUTC
                }
            })
        })
        return currencyJson;
    }

    public listConfigCurrencies() {
        let pairs: ConfigCurrencyPair[] = []
        this.markets.forEach((currencyPair) => {
            pairs.push(this.getConfigCurrencyPair(currencyPair))
        })
        return pairs;
    }

    public hasCurrency(currency: Currency.Currency) {
        for (let i = 0; i < this.markets.length; i++)
        {
            if (this.markets[i] == currency)
                return true;
        }
        return false;
    }

    public static getCurrency(configPair: string): Currency.Currency {
        const isString = typeof configPair === "string";
        if (!isString && typeof configPair === "number")
            return configPair;
        if (isString && configPair.match("^[0-9]+$") !== null)
            return parseInt(configPair);
        let cur = Currency.Currency[configPair]
        if (!cur) {
            logger.error("Unknown currency pair in config: %s", configPair)
            return undefined;
        }
        return cur
    }

    public update(update: LendingConfigRuntimeUpdate) {
        // TODO add/remove properties is not working
        for (let prop in update)
        {
            if (update[prop] !== undefined) // don't set invalid values (removing means setting them to 0/null)
                this[prop] = update[prop];
        }
    }

    public updateCurrency(update: CurrencyConfRuntimeUpdate) {
        for (let prop in update)
        {
            if (update[prop] !== undefined) // don't set invalid values (removing means setting them to 0/null)
                this[prop] = update[prop];
        }
    }

    protected loadMarkets(strategies) {
        let markets = new Set<string>();
        for (let name in strategies)
            markets.add(strategies[name].currency)
        for (let pairStr of markets)
        {
            let pair = LendingConfig.getCurrency(pairStr)
            if (pair === undefined)
                throw new Error("Can not load lending config markets");
            this.markets.push(pair)
        }
    }

    /*
    protected loadMarketsFromCurrencies(currencies) {
        let markets = new Set<string>(Object.keys(currencies));
        for (let pairStr of markets)
        {
            let pair = LendingConfig.getCurrency(pairStr)
            if (pair === undefined)
                throw new Error("Can not load lending config markets");
            this.markets.push(pair)
        }
    }
    */
}