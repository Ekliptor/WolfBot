// inspired by http://poloniexlendingbot.readthedocs.io/en/latest/index.html

import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractExchange, ExOptions, ExApiKey, OrderBookUpdate, OpenOrders, OpenOrder, ExRequestParams, ExResponse, OrderParameters, MarginOrderParameters, CancelOrderResult, PushApiConnectionType} from "./AbstractExchange";
import {OrderResult} from "../structs/OrderResult";
import {MarginPosition, MarginPositionList} from "../structs/MarginPosition";
import MarginAccountSummary from "../structs/MarginAccountSummary";

import {Currency, Ticker, Trade, TradeHistory, MarketOrder, Funding} from "@ekliptor/bit-models";
import {OfferResult} from "../structs/OfferResult";
import {CoinMap} from "../Trade/PortfolioTrader";
import {OrderBook} from "../Trade/OrderBook";
//import {LendingMarketStream} from "../Trade/LendingMarketStream";

export class LendingExchangeMap extends Map<string, AbstractLendingExchange> { // (exchange name, instance)
    constructor() {
        super()
    }
}

export interface MarginLendingParams {
    days: number;
}

export type LoanDirection = "lend" | "loan"; // loan currently not used
export interface LoanOffer {
    offerNumber: number | string;
    type: LoanDirection;
    currency: Currency.Currency;
    rate: number;
    days: number;
    amount: number;
    remainingAmount: number; // has to be == amount if our loan has been fully accepted
    created: Date; // use now if no date provided by exchange
}
export class LoanOffers {
    //public readonly currency; // currency set per offer
    public readonly exchangeName: string;
    public offers: LoanOffer[] = [];

    constructor(/*currency: Currency.Currency, */exchangeName: string) {
        //this.currency = currency;
        this.exchangeName = exchangeName;
    }

    public static toFundingOrders(offers: LoanOffers, exchangeLabel: Currency.Exchange): Funding.FundingOrder[] {
        let orders = []
        offers.offers.forEach((offer) => {
            let tradeObj = new Funding.FundingOrder();
            tradeObj.date = offer.created;
            tradeObj.amount = offer.amount;
            tradeObj.type = offer.type === "lend" ? Funding.FundingType.OFFER : Funding.FundingType.REQUEST;
            tradeObj.rate = offer.rate;
            tradeObj.days = offer.days;
            tradeObj.ID = offer.offerNumber;
            orders.push(Funding.FundingAction.verify(tradeObj, offer.currency, exchangeLabel));
        })
        return orders;
    }

    public addOffer(order: LoanOffer) {
        ["rate", "days", "amount", "remainingAmount"].forEach((prop) => {
            if (typeof order[prop] === "string") {
                order[prop] = parseFloat(order[prop]);
                if (order[prop] === Number.NaN)
                    order[prop] = 0;
            }
        });
        this.offers.push(order)
    }

    public isOpenOffer(offerNumber: number | string) {
        for (let i = 0; i < this.offers.length; i++)
        {
            if (this.offers[i].offerNumber == offerNumber)
                return true;
        }
        return false;
    }

    public getOffer(offerNumber: number | string): LoanOffer {
        for (let i = 0; i < this.offers.length; i++)
        {
            if (this.offers[i].offerNumber == offerNumber)
                return this.offers[i];
        }
        return null;
    }
}

export class ActiveLoan {
    public readonly exchangeName: string;
    id: number | string;
    type: LoanDirection;
    currency: Currency.Currency;
    rate: number;
    days: number;
    amount: number;
    created: Date; // use now if no date provided by exchange

    constructor(exchangeName: string, id: number | string, currency: Currency.Currency, rate: number, days: number, amount: number, created: Date = new Date()) {
        this.exchangeName = exchangeName;
        this.id = id;
        this.type = "lend"; // default
        this.currency = currency;
        this.rate = rate;
        this.days = days;
        this.amount = amount;
        this.created = created;
    }
}
export class ExchangeActiveLoanMap extends Map<string, ActiveLoan[]> { // (currency nr, loans)
    constructor() {
        super()
    }
    public addLoan(currency: string, loan: ActiveLoan) {
        let loans = this.get(currency);
        if (!loans)
            loans = [];
        loans.push(loan);
        this.set(currency, loans);
        return this;
    }
}

export abstract class AbstractLendingExchange extends AbstractExchange {
    // we could implemenent full strategy support for the lending market too
    // but that's an overkill, just use a few small classes from the "Lending" folder
    //onLoadRequest(loanRequest: LoanRequest)

    //protected lendingMarketStream: LendingMarketStream; // use only 1 market stream for all exchange data
    protected lendingFee: number = 0.0025;
    protected globalLendingStatsCurrency: Currency.Currency = Currency.Currency.USD;
    protected fundingCurrencies: Currency.Currency[] = [];
    protected minLendingValue: number = 0;
    protected minLendingValueCurrency: Currency.Currency = Currency.Currency.USD;
    protected minLendingDays: number = 2; // for Bitfinex and poloniex
    protected pollExchangeTicker = false;
    protected exchangeTicker = new Ticker.TickerMap(); // should be equivalent to "ticker" in trading mode
    //protected lendingTicker = new Ticker.TickerMap();
    protected lendingOrderBook = new Map<string, OrderBook<Funding.FundingOrder>>(); // (currency, orders)
    protected totalLendingBalances: Currency.LocalCurrencyList = {};

    constructor(options: ExOptions) {
        super(options)
        if (nconf.get("lending")) {
            setTimeout(() => { // done after child constructor
                this.webSocketTimeoutMs += nconf.get("serverConfig:websocketTimeoutAddMs"); // funding trades happen a lot less frequently
            }, 0)

            this.marketStream.on("tradesFunding", (currency: Currency.Currency, trades: Funding.FundingTrade[]) => {
                const currencyStr = Currency.Currency[currency];
                let book = this.lendingOrderBook.get(currencyStr);
                if (book) // order book not available in HistoryDataExchange
                    book.setLast(trades[trades.length-1].rate);
            })
        }
    }

    public getLendingFee(inPercent = true) {
        return inPercent === true ? this.lendingFee * 100.0 : this.lendingFee;
    }

    public getGlobalLendingStatsCurrency() {
        return this.globalLendingStatsCurrency;
    }

    public getMinLendingValue() {
        return this.minLendingValue;
    }

    public getMinLendingValueCurrency() {
        return this.minLendingValueCurrency;
    }

    public getMinLendingDays() {
        return this.minLendingDays;
    }

    public getExchangeTicker() {
        return this.exchangeTicker;
    }

    public getLendingOrderBook() {
        return this.lendingOrderBook;
    }

    public getTotalLendingBalances() {
        return this.totalLendingBalances;
    }

    public subscribeToFundingMarkets(currencies: Currency.Currency[]) {
        // either this or subscribeToMarkets() will be called - the bot never runs in both modes
        this.fundingCurrencies = currencies;
        this.fundingCurrencies.forEach((currency) => {
            this.startLendingOrderBook(currency);
        })
        //this.fundingOrderBook.clear(); // no local order book for now. just emit requests in real time
        this.openConnection();
        this.startPolling();
        if (this.pollExchangeTicker)
            this.scheduleFetchExchangeTicker();
    }

    public abstract getFundingBalances(): Promise<Currency.LocalCurrencyList>;
    public abstract getActiveLoans(): Promise<ExchangeActiveLoanMap>;
    public abstract placeOffer(currency: Currency.Currency, rate: number, amount: number, params: MarginLendingParams): Promise<OfferResult>;
    public abstract getAllOffers(): Promise<LoanOffers>;
    public abstract cancelOffer(offerNumber: number | string): Promise<CancelOrderResult>;

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected scheduleFetchExchangeTicker() {
        // some exchanges (bitfinex) only update the exchange ticker via trades API
        // so in lending mode we have to fetch the ticker separately
        let fetch = () => {
            this.fetchExchangeTicker().then((ticker) => {
                this.setExchangeTickerMap(ticker)
                setTimeout(this.scheduleFetchExchangeTicker.bind(this), nconf.get('serverConfig:tickerExpirySec')*1000)
            }).catch((err) => {
                logger.error("Error fetching exchange ticker", err)
                setTimeout(this.scheduleFetchExchangeTicker.bind(this), nconf.get('serverConfig:tickerExpirySec')*1000)
            })
        }
        fetch();
    }

    protected fetchExchangeTicker() {
        return new Promise<Ticker.TickerMap>((resolve, reject) => {
            // overwrite this if required
            resolve()
        })
    }

    protected setExchangeTickerMap(tickerMap: Ticker.TickerMap) {
        //this.exchangeTicker = tickerMap; // update existing ticker objects because we pass references around (to strategies...)
        for (let ticker of tickerMap)
        {
            let existingTicker = this.exchangeTicker.get(ticker[0]);
            if (existingTicker)
                Object.assign(existingTicker, ticker[1]);
            else
                this.exchangeTicker.set(ticker[0], ticker[1]);
        }
        this.exchangeTicker.setCreated(new Date()) // update it
        if (this.currencyPairs.length === 0 && this.ticker.getCreated().getTime() < this.exchangeTicker.getCreated().getTime()) // update it if there are no trade streams open
            this.setTickerMap(tickerMap)
    }

    protected startLendingOrderBook(currency: Currency.Currency) {
        const currencyStr = Currency.Currency[currency]
        let orderBook = this.lendingOrderBook.get(currencyStr);
        if (orderBook) {
            this.lendingOrderBook.get(currencyStr).clear(); // keep old references
            this.lendingOrderBook.get(currencyStr).setSnapshot([], this.localSeqNr); // seq numbers come from the same websocket connection as trades
        }
        else
            this.lendingOrderBook.set(currencyStr, new OrderBook<Funding.FundingOrder>())
    }

    protected verifyLendingRequest(currency: Currency.Currency, amount: number) {
        return new Promise<string>((resolve, reject) => {
            const currencyStr = Currency.Currency[currency];
            const pairStr = this.currencies.getExchangeName(currencyStr)
            if (pairStr === undefined)
                return reject({txt: "Currency not supported by this exchange", exchange: this.className, currency: currencyStr});
            else if (this.minLendingValue == 0)
                return resolve(pairStr) // shortcut

            let lendingAmountBase = amount;
            if (currency !== this.minLendingValueCurrency) {
                // redundant to RealTimeLendingTrader
                const currencyPairStr = new Currency.CurrencyPair(this.minLendingValueCurrency, currency).toString();
                let ticker = this.exchangeTicker.get(currencyPairStr)
                if (!ticker) {
                    logger.warn("Unable to get %s %s ticker to convert lending amount", currencyPairStr, this.className)
                    lendingAmountBase = Number.MAX_VALUE; // try to continue
                }
                else
                    lendingAmountBase *= ticker.last;
            }
            if (lendingAmountBase < this.minLendingValue)
                return reject({txt: "Lending amount is below min lending value", exchange: this.className, currency: currencyStr, amount: amount, min: this.minLendingValue});
            resolve(pairStr)
        })
    }
}