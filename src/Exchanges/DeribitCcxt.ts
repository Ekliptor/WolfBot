import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {MarketOrder, Ticker, Trade, TradeHistory, Currency} from "@ekliptor/bit-models";
import {CcxtExchange, CcxtExchangeCurrencies} from "./CcxtExchange";
import {AbstractExchange, ExOptions, OpenOrders, OrderParameters} from "./AbstractExchange";
import * as ccxt from "ccxt";
import {OrderResult} from "../structs/OrderResult";


export class DeribitCcxtCurrencies extends CcxtExchangeCurrencies {
    public getExchangePair(localPair: Currency.CurrencyPair): string {
        // present in Deribit and DeribitCcxt
        let quoteCurrencyStr = Currency.getCurrencyLabel(localPair.to);
        if (quoteCurrencyStr === "ETH")
            return "ETH-PERPETUAL";
        else if (quoteCurrencyStr === "BTC")
            return "BTC-PERPETUAL";
        return "BTC-PERPETUAL"; // fallback
    }
    public getLocalPair(exchangePair: string): Currency.CurrencyPair {
        // exchamgePair: 'BTC-PERPETUAL'
        if (exchangePair === "ETH-PERPETUAL")
            return new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.ETH);
        else if (exchangePair === "BTC-PERPETUAL")
            return new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.BTC);
        return new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.BTC);
    }
}

export default class DeribitCcxt extends CcxtExchange {
    protected currencies: DeribitCcxtCurrencies;

    constructor(options: ExOptions) {
        super(options);
        this.exchangeLabel = Currency.Exchange.DERIBIT;
        this.minTradingValue = 1.0; // min value is 1 contract, BTC contract fixed at 10$
        this.fee = 0.00002; // only for opening positions // https://www.deribit.com/main#/pages/information/fees
        this.currencies = new DeribitCcxtCurrencies(this);
        this.currencies.setSwitchCurrencyPair(true);
        this.apiClient = new ccxt.deribit(this.getExchangeConfig());
        this.apiClient.loadMarkets().then(() => {
            this.onExchangeReady();
        }).catch((err) => {
            logger.error("Error loading %s markets", this.className, err);
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

}