import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {
    AbstractExchange,
    ExOptions,
    ExApiKey,
    OrderBookUpdate,
    OpenOrders,
    OpenOrder,
    ExRequestParams,
    ExResponse,
    OrderParameters,
    MarginOrderParameters,
    CancelOrderResult,
    PushApiConnectionType,
    AbstractExchangeCurrencies
} from "./AbstractExchange";
import {OrderResult} from "../structs/OrderResult";
import {MarginPosition, MarginPositionList} from "../structs/MarginPosition";
import MarginAccountSummary from "../structs/MarginAccountSummary";

import {Currency, Ticker, Trade, TradeHistory, MarketOrder} from "@ekliptor/bit-models";

export class ContractValueMap extends Map<string, number> { // (contract currency, value in base currency)
    constructor() {
        super()
    }
}

export abstract class AbstractContractExchangeCurrencies extends AbstractExchangeCurrencies {
    constructor(exchange: AbstractContractExchange) {
        super(exchange);
    }

    public abstract getExchangeName(localCurrencyName: string): string;
    public abstract getLocalName(exchangeCurrencyName: string): string;

    public abstract getExchangePair(localPair: Currency.CurrencyPair): string;
    public abstract getLocalPair(exchangePair: string): Currency.CurrencyPair;

    public abstract toLocalTicker(exchangeTicker: any): Ticker.Ticker;

    public getExchangeContractForPair(localPair: Currency.CurrencyPair): string {
        const params: string[] = nconf.get("exchangeParams");
        if (params.length < 2)
            return null;
        const configPair = Currency.CurrencyPair.fromString(params[1]);
        if (configPair === null)
            return null; // invalid pair in config
        if (configPair.equals(localPair) === false)
            return null; // another pair
        return params[0]; // return the contract name as currency pair
    }

    public getLocalPairFromContract(exchangePair: string): Currency.CurrencyPair {
        const params: string[] = nconf.get("exchangeParams");
        if (params.length < 2)
            return null;
        if (exchangePair !== params[0])
            return null; // another pair
        const configPair = Currency.CurrencyPair.fromString(params[1]);
        if (configPair === null)
            return null; // invalid pair in config
        return configPair;
    }
}

export abstract class AbstractContractExchange extends AbstractExchange {
    protected contractValues = new ContractValueMap();

    constructor(options: ExOptions) {
        super(options)
        this.contractExchange = true;
        this.automaticImports = false; // usually they only allow imports for certain contract dates, not arbitrary
    }

    public abstract getIndexPrice(): Promise<Ticker.TickerMap>;

    public setIndexPrice(indexTickerMap: Ticker.TickerMap) {
        if (!this.ticker)
            return logger.error("Can not add index prices in %s. Ticker not initialized", this.className)
        for (let ticker of this.ticker)
        {
            let curIndexTicker = indexTickerMap.get(ticker[0]);
            if (!curIndexTicker) {
                logger.error("Currency pair %s is missing in exchange ticker of %s", ticker[0], this.className)
                continue;
            }
            ticker[1].addIndexValues(curIndexTicker);
        }
    }

    public getOrderTimeoutSec(postOnly = false) {
        return nconf.get("serverConfig:orderContractExchangeAdjustSec")
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected getContractAmount(currencyPair: Currency.CurrencyPair, rate: number, coinAmount: number) {
        const baseValue = Math.abs(coinAmount) * rate;
        let contractValue = this.contractValues.get(Currency.Currency[currencyPair.to]);
        if (!contractValue) {
            logger.error("Missing contract value for currency pair %s in %s", currencyPair.toString(), this.className)
            return 1;
        }
        let numContracts = Math.floor(baseValue / contractValue)
        if (numContracts < 1)
            numContracts = 1;
        return numContracts;
    }

    protected getBaseCurrencyAmount(currencyPair: Currency.CurrencyPair, rate: number, contractAmount: number) {
        let contractValue = this.contractValues.get(Currency.Currency[currencyPair.to]);
        if (!contractValue) {
            logger.error("Missing contract value for currency pair %s in %s", currencyPair.toString(), this.className)
            return 0.0;
        }
        const baseValue = Math.abs(contractAmount) * contractValue / rate;
        if (baseValue < 0.0)
            return 0.0;
        return baseValue;
    }

    protected getFutureContractType(): string {
        let params: string[] = nconf.get("exchangeParams") || [];
        for (let i = 0; i < params.length; i++)
        {
            if (params[i].indexOf("contract=") === 0)
                return params[i].substr(9);
        }
        const contractType: string = nconf.get("serverConfig:futureContractType");
        return contractType; // default
    }
}
