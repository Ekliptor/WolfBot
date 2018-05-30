import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {LendingAdvisor} from "./LendingAdvisor";
import {AbstractExchange, CancelOrderResult, ExchangeMap, OrderParameters} from "../Exchanges/AbstractExchange";
import {Trade, Order, Currency, Candle, Funding} from "@ekliptor/bit-models";
import {LendingConfig} from "./LendingConfig";
import {AbstractGenericTrader} from "../Trade/AbstractGenericTrader";
import {AbstractLendingStrategy, LendingStrategyOrder, LendingTradeAction} from "./Strategies/AbstractLendingStrategy";
import {
    AbstractLendingExchange, ExchangeActiveLoanMap, LendingExchangeMap,
    MarginLendingParams
} from "../Exchanges/AbstractLendingExchange";
import {CoinMap} from "../Trade/PortfolioTrader";
import {OfferResult} from "../structs/OfferResult";
import * as path from "path";


export interface LendingTradeInfo {
    strategy?: AbstractLendingStrategy; // strategy not mandatory. multiple strategies might adjust interest rates. then they get updated async
    reason?: string;
    exchange?: AbstractLendingExchange;
}

export class InterestMap extends Map<string, number> { // (currency, daily rate in %)
    constructor() {
        super()
    }
}
export class GlobalInterestMap extends Map<string, InterestMap> { // (exchange name, interest rates)
    constructor() {
        super()
    }
}
export class TotalEquityMap extends Map<string, number> {  // (exchange name, equity)

}
export class OfferMap extends Map<string, Funding.FundingOrder[]> { // (exchange name, offer)
    constructor() {
        super()
    }
    public getOffers(exchangeName: string, currency: Currency.Currency): Funding.FundingOrder[] {
        let offers: Funding.FundingOrder[] = [];
        let exOffers = this.get(exchangeName);
        if (!exOffers || exOffers.length === 0)
            return offers;
        exOffers.forEach((offer) => {
            if (offer.currency == currency)
                offers.push(offer)
        })
        return offers;
    }
    public getOfferAmount(exchangeName: string, currency: Currency.Currency): number {
        let offers = this.getOffers(exchangeName, currency);
        let sum = 0;
        for (let i = 0; i < offers.length; i++)
            sum += offers[i].amount;
        return sum;
    }
}
export class ActiveLoanMap extends Map<string, ExchangeActiveLoanMap> { // (exchange name, loans)
    constructor() {
        super()
    }
}
export interface LendingRate {
    volume: number;
    volumeAvg: number;
    rate: number; // the rate of our lent coins
    simpleRate: number;
    //currentMinRate: number; // the rate our strategy set as the min rate in trader // moved to globalMinLendingRates map
    lendingFee: number; // should be identical for all currencies
}
export class ExchangeLendingRateMap extends Map<string, LendingRate> { // (currency, lending rates)
    constructor() {
        super()
    }
}
export class LendingRateMap extends Map<string, ExchangeLendingRateMap> { // (exchange name, currencies + lending rates)
    constructor() {
        super()
    }
}

export class LendingCoinStatus {
    limited: boolean = false;

    constructor() {
    }
}
export class ExchangeCoinStatusMap extends Map<string, LendingCoinStatus> { // (currency, status)
    constructor() {
        super()
    }
}
export class CoinStatusMap extends Map<string, ExchangeCoinStatusMap> { // (exchange name, currencies + status)
    constructor() {
        super()
    }
}

export class GlobalExchangeInterest {
    currencyStr: string;
    perYear: number = 0;
    perMonth: number = 0;
    perWeek: number = 0;
    perDay: number = 0;
    perHour: number = 0;

    constructor(currencyStr: string) {
        this.currencyStr = currencyStr;
    }
    public convert(exchangeRate: number) {
        this.perYear *= exchangeRate;
        this.perMonth *= exchangeRate;
        this.perWeek *= exchangeRate;
        this.perDay *= exchangeRate;
        this.perHour *= exchangeRate;
    }
    public add(coinInterest: GlobalExchangeInterest) {
        this.perYear += coinInterest.perYear;
        this.perMonth += coinInterest.perMonth;
        this.perWeek += coinInterest.perWeek;
        this.perDay += coinInterest.perDay;
        this.perHour += coinInterest.perHour;
    }
}
export class GlobalLendingStatsMap extends Map<string, GlobalExchangeInterest> { // (exchange name, interest)
    constructor() {
        super()
    }
}

export type LoanUpdate = "placed" | "cancelled" | "synced"; // finished loans don't have an event. we just sync/update our balances

export abstract class AbstractLendingTrader extends AbstractGenericTrader {
    protected static instances = new Map<string, AbstractLendingTrader>(); // (config name+number, instance)
    protected exchanges: LendingExchangeMap; // (exchange name, instance)
    protected config: LendingConfig;
    protected lendingAdvisor: LendingAdvisor;
    protected interestMap = new InterestMap();
    protected updateOffersTimerID: NodeJS.Timer = null;
    protected moveOffers = false;
    protected updateCurrencyOffers = new Set<string>(); // (currencyStr)

    protected lastPlacedCoinOffers: Date = new Date(0); // non-static because every currency has it's own trader instance

    // portfolio members, no portfolio trader class for lending (always with portfolio == real coins)
    protected static globalExchanges: LendingExchangeMap = new LendingExchangeMap() // (exchange name, instance), all exchanges (needed to save HTTP requests to deduplicate requests)
    protected static coinBalances = new CoinMap(); // all balances including unused funds
    protected static coinBalancesTaken = new CoinMap(); // placed + accepted offers
    protected static coinBalancesTakenPercent = new CoinMap();
    protected static coinBalancesAvailable = new CoinMap(); // computed from coinBalances and coinBalancesTaken
    protected static activeLoans = new ActiveLoanMap();
    protected static activeLendingRates = new LendingRateMap();
    protected static globalInterestStats = new GlobalLendingStatsMap();
    protected static globalMinLendingRates = new GlobalInterestMap(); // see interestMap
    protected static coinStatusMap = new CoinStatusMap();
    protected static totalEquityMap = new TotalEquityMap();
    protected static submittedOffers = new OfferMap(); // to cancel offers that don't fill in time
    protected static updatePortfolioTimerID: number = -1;
    protected static lastPortfolioUpdate: Date = new Date(0);
    //protected static lastMarginPositionUpdateMs: number = -1; // no need to sync portfolio with strategies

    constructor(config: LendingConfig) {
        super();
        this.config = config;
        this.logPath = path.join(utils.appDir, nconf.get("tradesDir"), this.logPath, this.className + "-" + config.name + ".log")
        AbstractLendingTrader.instances.set(config.name + "-" + config.configNr, this);
    }

    public setExchanges(lendingAdvisor: LendingAdvisor) {
        this.lendingAdvisor = lendingAdvisor;
        this.exchanges = lendingAdvisor.getExchanges();
        for (let exchange of this.exchanges)
        {
            if (!AbstractLendingTrader.globalExchanges.has(exchange[0])) {
                AbstractLendingTrader.globalExchanges.set(exchange[0], exchange[1])
                AbstractLendingTrader.activeLoans.set(exchange[0], new ExchangeActiveLoanMap())
                AbstractLendingTrader.activeLendingRates.set(exchange[0], new ExchangeLendingRateMap())
                AbstractLendingTrader.globalInterestStats.set(exchange[0], /*null*/new GlobalExchangeInterest(""))
                AbstractLendingTrader.coinStatusMap.set(exchange[0], new ExchangeCoinStatusMap());
                let minLendingRatesMap = new InterestMap();
                /* // only 1 currency present per trader instance
                this.config.markets.forEach((currency) => {
                    const currencyStr = Currency.Currency[currency];
                    minLendingRatesMap.set(currencyStr, 0); // initialize with 0
                })
                */
                AbstractLendingTrader.globalMinLendingRates.set(exchange[0], minLendingRatesMap)
                AbstractLendingTrader.totalEquityMap.set(exchange[0], 0)
            }
        }
    }

    public getConfig() {
        return this.config;
    }

    public getBalances() {
        return AbstractLendingTrader.coinBalances;
    }

    public getBalancesTaken() {
        return AbstractLendingTrader.coinBalancesTaken;
    }

    public getBalancesTakenPercent() {
        return AbstractLendingTrader.coinBalancesTakenPercent;
    }

    public getCoinBalancesAvailable() {
        return AbstractLendingTrader.coinBalancesAvailable;
    }

    public getActiveLoans() {
        return AbstractLendingTrader.activeLoans;
    }

    public getLendingRates() {
        return AbstractLendingTrader.activeLendingRates;
    }

    public getGlobalInterestStats() {
        return AbstractLendingTrader.globalInterestStats;
    }

    public getMinLendingRates() {
        return AbstractLendingTrader.globalMinLendingRates;
    }

    public getCoinStatusMap() {
        return AbstractLendingTrader.coinStatusMap;
    }

    public getTotalEquity() {
        return AbstractLendingTrader.totalEquityMap;
    }

    public callAction(action: LendingStrategyOrder, strategy: AbstractLendingStrategy, reason = ""): void {
        const currencyStr = Currency.Currency[strategy.getAction().currency];
        if (nconf.get("serverConfig:premium") === true && nconf.get("serverConfig:loggedIn") === false) {
            const msg = utils.sprintf("Unable to %s %s in %s because you don't have a valid subscription: %s - %s", action, currencyStr, this.className, strategy.getClassName(), reason)
            logger.info(msg)
            //this.writeLogLine(msg)
            return;
        }
        if (this.isTrading.has(currencyStr)) {
            logger.warn("Ignoring action %s %s in %s because last action hasn't finished", action, currencyStr, this.className)
            return; // ignoring should be better (safer) than queueing actions
        }
        this.syncMarket(strategy);
        /*
        if (!this.warmUpDone() && this.isStarting()) {
            logger.verbose("Scheduling retry of %s trade because %s is currently starting", action, this.className)
            setTimeout(this.callAction.bind(this, action, strategy, reason), 10000);
            return;
        }
        */

        switch (action)
        {
            case "place":
            //case "cancel":
                /*
                this.isTrading.set(currencyStr, true);
                setTimeout(() => {
                    this.isTrading.delete(currencyStr); // just to be sure
                }, nconf.get("serverConfig:orderTimeoutSec")*1000)

                this[action](strategy, reason).then(() => {
                    this.isTrading.delete(currencyStr);
                    logger.verbose("Trading action %s %s has finished in %s", action, currencyStr, this.className)
                }).catch((err) => {
                    logger.error("Error executing %s %s in %s", action, currencyStr, this.className, err);
                    this.isTrading.delete(currencyStr);
                })
                */
                // we have different trader instances per currency/exchange
                let strategyRate = strategy.getRate() * 100;
                if (strategyRate < this.config.minDailyRate) {
                    logger.verbose("%s interest rate is below min daily configured rate at %s", currencyStr, strategy.getRate())
                    // maybe we decreased it too much because we didn't place any loans
                    // add random fraction to ensure the offers get updated
                    strategyRate = this.config.minDailyRate + this.config.minDailyRate / 100 * utils.getRandom(0.1, 0.5);
                }
                if (this.interestMap.get(currencyStr) !== strategyRate) {
                    logger.verbose("Updated %s interest rate to %s, reason: %s", currencyStr, strategy.getRate(), reason)
                    this.interestMap.set(currencyStr, strategyRate)
                    // update it globally for all exchanges
                    for (let rate of AbstractLendingTrader.globalMinLendingRates)
                        rate[1].set(currencyStr, strategyRate);
                    this.updateCurrencyOffers.add(currencyStr);
                    this.scheduleUpdateOffers();
                }
                return;
            default:
                logger.error("Trader can not act on unknown action %s %s", action, currencyStr)
        }
    }

    public addOffer(exchange: AbstractExchange, offer: Funding.FundingOrder) {
        let offers: Funding.FundingOrder[] = AbstractLendingTrader.submittedOffers.get(exchange.getClassName());
        if (!offers)
            offers = [];
        let found = false;
        for (let i = 0; i < offers.length; i++)
        {
            if (offers[i].uniqueID === offer.uniqueID) {
                found = true;
                break;
            }
        }
        if (!found)
            offers.push(offer);
        AbstractLendingTrader.submittedOffers.set(exchange.getClassName(), offers);
    }

    public removeOffer(exchangeName: string, offerNumber: number | string) {
        let found = false;
        let orders = AbstractLendingTrader.submittedOffers.get(exchangeName);
        if (!orders || orders.length === 0)
            return found;
        for (let i = 0; i < orders.length; i++)
        {
            if (orders[i].ID == offerNumber) {
                orders.splice(i, 1);
                found = true;
                break;
            }
        }
        AbstractLendingTrader.submittedOffers.set(exchangeName, orders);
        return found;
    }

    public removeAllOffers(exchangeName: string) {
        AbstractLendingTrader.submittedOffers.set(exchangeName, []);
    }

    public isOpenOrder(exchangeName: string, offerNumber: number | string) {
        let orders = AbstractLendingTrader.submittedOffers.get(exchangeName);
        if (!orders || orders.length === 0)
            return false;
        for (let i = 0; i < orders.length; i++)
        {
            if (orders[i].ID == offerNumber)
                return true;
        }
        return false;
    }

    public sendTick(trades: Funding.FundingTrade[]) {
        // overwrite this to get all trades. mostly useful for backtesting (simulating a market)
    }

    public sendOrderTick(orders: Funding.FundingOrder[]) {
        // TODO place loans if interest rate of orders is above our threshold
        if (!this.config.hideCoins)
            return; // we already placed all our coins
        // TODO sort by interest rate? and volume?
        let placeOps = []
        let notEnoughFunds = false;
        for (let i = 0; i < orders.length; i++)
        {
            let minRate = this.getMinRate(orders[i].currency);
            if (!minRate) {
                const currencyStr = Currency.Currency[orders[i].currency]
                logger.error("Can not place lending offer for %s because no interest rate available", currencyStr)
                continue;
            }
            orders[i] = this.getMaxOfferAmount(orders[i]);
            if (orders[i].rate < minRate || orders[i].rate < this.config.minDailyRate || orders[i].amount < this.config.minLoanSize) {
                notEnoughFunds = notEnoughFunds || orders[i].amount > this.config.minLoanSize;
                continue;
            }

            // we found a loan request with a high enough interest rate
            placeOps.push(this.place(orders[i], "individual loan request"));
            if (placeOps.length >= this.config.maxActiveAmount)
                break;
        }
        Promise.all(placeOps).then(() => {
            if (placeOps.length > 0)
                this.scheduleUpdatePortfolio();
            else if (notEnoughFunds)
                this.emitTakenAll();
            logger.verbose("Placed loan offer for %s loan requests", placeOps.length)
        }).catch((err) => {
            logger.error("Error placing offer for loan requests", err)
        })
    }

    public abstract placeCoinOffers(): Promise<void>;

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    // place an offer on ALL exchanges (usually only 1)
    protected abstract place(offer: Funding.FundingOrder, reason: string): Promise<void>;
    // cancel an offer on a SINGLE exchange
    protected abstract cancel(offer: Funding.FundingOrder, reason: string): Promise<CancelOrderResult>;
    protected abstract updatePortfolio(): Promise<void>;
    protected abstract cancelOpenOffers(cancelAll: boolean): Promise<void>;

    protected syncMarket(strategy: AbstractLendingStrategy) {
        this.marketTime = strategy.getMarketTime(); // assume all markets we listen to in here have the same timezone
    }

    protected scheduleUpdateOffers() {
        // we must update delayed because lending trades don't happen every minute.
        // when they happen we have to prevent to update the interest rate multiple times at once
        clearTimeout(this.updateOffersTimerID);
        this.updateOffersTimerID = setTimeout(() => {
            this.updateOffers();
        }, 1000)
    }

    protected scheduleUpdatePortfolio() {
        clearTimeout(AbstractLendingTrader.updatePortfolioTimerID); // not same function, but calls the same one
        AbstractLendingTrader.updatePortfolioTimerID = setTimeout(this.updatePortfolio.bind(this), nconf.get("serverConfig:updateBalancesImmediatelyTimeSec")*1000)
    }

    protected updateOffers() {
        return new Promise<void>((resolve, reject) => {
            // our strategy interest rate changed or we got new coins in our funding wallet. move our offers to the new interest rate
            this.moveOffers = false;
            if (this.config.hideCoins)
                return resolve(); // no permanent offers should be present
            this.cancelOpenOffers(true).then(() => {
                return this.placeCoinOffers();
            }).then(() => {
                logger.verbose("Updated offers after interest rate change")
                resolve()
            }).catch((err) => {
                logger.error("Error updating offers", err)
                resolve()
            })
        })
    }

    protected getMinRate(currency: Currency.Currency) {
        const currencyStr = Currency.Currency[currency];
        let minRate = this.interestMap.get(currencyStr);
        if (!minRate)
            return 0;
        return minRate;
    }

    protected getOfferParams(exchange: AbstractLendingExchange, offer: Funding.FundingOrder): MarginLendingParams {
        let params: MarginLendingParams = {days: this.config.days}
        if (offer.rate >= this.getMinRate(offer.currency) * this.config.xDayThreshold) {
            params.days = this.config.xDays;
            offer.days = params.days; // modify the offer object too
        }
        return params;
    }

    protected getPublicOffer(exchange: AbstractLendingExchange, currency: Currency.Currency, balance: number) {
        // if we place all our coins (hideCoins == false) we have to generate offers based on our data from strategies + config
        let offer = new Funding.FundingOrder();
        offer.date = new Date();
        offer.amount = balance; // offer all our coins
        offer.type = Funding.FundingType.OFFER;
        offer.rate = this.getMinRate(currency);
        offer.days = this.config.days; // TODO xDays for public offers. detect interest spikes with a 2nd longer EMA?
        offer.exchange = Currency.Exchange.ALL;
        Funding.FundingAction.verify(offer, currency, exchange.getExchangeLabel());
        // enforce config limits
        offer = this.getMaxOfferAmount(offer);
        return offer;
    }

    protected computeBalancesTakenPercent(exchange: AbstractLendingExchange) {
        let exchangeBalances = AbstractLendingTrader.coinBalances.get(exchange.getClassName());
        let exchangeBalancesTaken = AbstractLendingTrader.coinBalancesTaken.get(exchange.getClassName());
        if (!exchangeBalances || !exchangeBalancesTaken)
            return logger.error("Balances to compute are not available from exchange %s", exchange.getClassName());
        let exchangeBalancesTakenPercent = {};
        for (let currency in exchangeBalances)
        {
            let balance = exchangeBalances[currency];
            let balanceTaken = exchangeBalancesTaken[currency];
            exchangeBalancesTakenPercent[currency] = 0.0; // initialize with 0%
            if (!balance || !balanceTaken)
                continue; // no balance
            let balanceAvailable = balance - balanceTaken;
            if (balanceAvailable < 0) { // would result in weird percent values
                logger.warn("Available funding balance can not be below 0 on %s, available %s %s", exchange.getClassName(), balanceAvailable, Currency.Currency[currency]);
                exchangeBalancesTakenPercent[currency] = 100.0;
                continue;
            }
            exchangeBalancesTakenPercent[currency] = Math.round(balanceTaken / balance * 100 * 100) / 100; // 2 decimals
        }
        AbstractLendingTrader.coinBalancesTakenPercent.set(exchange.getClassName(), exchangeBalancesTakenPercent);
        this.computeLendingRates(exchange);
        this.computeTotalEquity(exchange);
        this.computeBalancesAvailable(exchange);
    }

    protected computeLendingRates(exchange: AbstractLendingExchange) {
        let exchangeLoans = AbstractLendingTrader.activeLoans.get(exchange.getClassName());
        if (!exchangeLoans)
            return logger.error("No loans found on exchange %s", exchange.getClassName());
        let rates = new ExchangeLendingRateMap();
        for (let loan of exchangeLoans)
        {
            const currencyStr = loan[0];
            let loans = loan[1];
            // compute the volume weighted average interest rate
            let sum = 0, vol = 0, simplePrice = 0;
            for (let i = 0; i < loans.length; i++)
            {
                sum += loans[i].rate * loans[i].amount;
                vol += loans[i].amount;
                simplePrice += loans[i].rate;
            }
            rates.set(currencyStr, {
                volume: vol,
                volumeAvg: vol / loans.length,
                rate: sum / vol / 100,
                simpleRate: simplePrice / loans.length / 100,
                lendingFee: exchange.getLendingFee()
            })
        }
        AbstractLendingTrader.activeLendingRates.set(exchange.getClassName(), rates);

        // initialize currencies we don't have any active loans with 0
        let exchangeBalances = AbstractLendingTrader.coinBalances.get(exchange.getClassName());
        let exchangeRates = AbstractLendingTrader.activeLendingRates.get(exchange.getClassName());
        let interest = new GlobalExchangeInterest(Currency.Currency[exchange.getGlobalLendingStatsCurrency()]);
        for (let currency in exchangeBalances)
        {
            const currencyStr = Currency.Currency[currency];
            const lendingData = exchangeRates.get(currencyStr);
            if (!lendingData) {
                exchangeRates.set(currencyStr, {
                    volume: 0,
                    volumeAvg: 0,
                    rate: 0,
                    simpleRate: 0,
                    lendingFee: exchange.getLendingFee()
                });
                continue;
            }

            // create global earnings for this exchange
            const balancesTakenPercent = this.getBalancesTakenPercent().get(exchange.getClassName());
            const rateDay = lendingData.rate;
            const rateDayEff = rateDay * (1 - lendingData.lendingFee) * (balancesTakenPercent[currency] / 100.0);
            //const coinCurrency = Currency.Currency[currency];
            const coinCurrencyNr = parseInt(currency);
            let coinInterest = new GlobalExchangeInterest(currencyStr);
            coinInterest.perYear = this.calcEarnings(lendingData.volume, rateDayEff, 365);
            coinInterest.perMonth = this.calcEarnings(lendingData.volume, rateDayEff, 30);
            coinInterest.perWeek = this.calcEarnings(lendingData.volume, rateDayEff, 7);
            //perDay: lendingData.volume * rateDayEff, // equivalent - sum
            coinInterest.perDay = this.calcEarnings(lendingData.volume, rateDayEff, 1)
            coinInterest.perHour = this.calcEarnings(lendingData.volume, rateDayEff, 1/24)
            if (exchange.getGlobalLendingStatsCurrency() != coinCurrencyNr) {
                const conversionPair = new Currency.CurrencyPair(exchange.getGlobalLendingStatsCurrency(), coinCurrencyNr)
                let ticker = exchange.getTickerMap().get(conversionPair.toString())
                if (!ticker) {
                    logger.error("%s %s ticker not available. Ignoring interest for global stats", exchange.getClassName(), conversionPair.toString())
                    continue;
                }
                coinInterest.convert(ticker.last);
            }
            interest.add(coinInterest);
        }
        AbstractLendingTrader.globalInterestStats.set(exchange.getClassName(), interest)
    }

    protected computeTotalEquity(exchange: AbstractLendingExchange) {
        let exchangeBalances = AbstractLendingTrader.coinBalances.get(exchange.getClassName());
        if (!exchangeBalances)
            return;
        let totalEquity = 0;
        for (let currency in exchangeBalances)
        {
            let balance = exchangeBalances[currency];
            if (!balance)
                continue; // no balance
            const coinCurrencyNr = parseInt(currency);
            let equity = balance;
            if (exchange.getGlobalLendingStatsCurrency() != coinCurrencyNr) {
                const conversionPair = new Currency.CurrencyPair(exchange.getGlobalLendingStatsCurrency(), coinCurrencyNr)
                let ticker = exchange.getTickerMap().get(conversionPair.toString())
                if (!ticker) {
                    logger.error("%s %s ticker not available. Total equity will be incomplete", exchange.getClassName(), conversionPair.toString())
                    continue;
                }
                equity *= ticker.last;
            }
            totalEquity += equity;
        }
        AbstractLendingTrader.totalEquityMap.set(exchange.getClassName(), totalEquity)
    }

    protected computeBalancesAvailable(exchange: AbstractLendingExchange) {
        let exchangeBalances = AbstractLendingTrader.coinBalances.get(exchange.getClassName());
        let exchangeBalancesTaken = AbstractLendingTrader.coinBalancesTaken.get(exchange.getClassName());
        if (!exchangeBalances || !exchangeBalancesTaken)
            return;
        let balanceAvailable: Currency.LocalCurrencyList = {};
        for (let currency in exchangeBalances)
        {
            let balance = exchangeBalances[currency];
            let balanceTaken = exchangeBalancesTaken[currency]
            if (!balance || balanceTaken === undefined)
                continue; // no balance
            balanceAvailable[currency] = balance - balanceTaken;
            if (balanceAvailable[currency] < 0.0) {
                logger.warn("Lending balance available can not be lower than 0. total %s, taken %s", balance, balanceTaken);
                balanceAvailable[currency] = 0.0;
            }
        }
        AbstractLendingTrader.coinBalancesAvailable.set(exchange.getClassName(), balanceAvailable)
    }

    protected calcEarnings(sum, rate, timeMultiplier) {
        return sum * Math.pow(1 + rate, timeMultiplier) - sum;
    }

    protected emitPlaced(offer: Funding.FundingOrder, result: OfferResult, info: LendingTradeInfo) {
        this.logTrade(offer, result, info);
        this.emit("placed", offer, result, info);
    }

    protected emitCancelled(offer: Funding.FundingOrder, result: CancelOrderResult, info: LendingTradeInfo) {
        this.logTrade(offer, result, info);
        this.emit("cancelled", offer, result, info);
    }

    /* // TODO track with data from getAllOffers() and submittedOffers map
    protected emitTaken(offer: Funding.FundingOrder) {
        this.emit("taken", offer);
    }
    */

    protected emitTakenAll() {
        // our limits reduce offer.amount, so we have to call this function too if we limit our offers
        this.emit("takenAll", this.config.currency);
    }

    protected emitSynced() {
        this.emit("synced", this.getBalances(), this.getBalancesTaken(), this.getBalancesTakenPercent(), this.getLendingRates(),
            this.getGlobalInterestStats(), this.getMinLendingRates(), this.getCoinStatusMap(), this.getTotalEquity());
    }

    protected balanceChanged(oldCoins: Currency.LocalCurrencyList, newCoins: Currency.LocalCurrencyList) {
        for (let currencyNr in oldCoins)
        {
            if (newCoins[currencyNr] === undefined || oldCoins[currencyNr] !== newCoins[currencyNr])
                return true;
        }
        return false;
    }

    protected getMaxLendingBalance(exchange: AbstractLendingExchange, currency: Currency.Currency) {
        let balanceTaken = AbstractLendingTrader.coinBalancesTaken.get(exchange.getClassName());
        let coinBalanceTaken = balanceTaken[currency];
        if (coinBalanceTaken === undefined)
            return 0.0;
        if (this.config.maxToLend > 0) { // takes precedent over percentage
            let max = this.config.maxToLend - coinBalanceTaken;
            return max < 0.0 ? 0.0 : max;
        }
        else if (this.config.maxPercentToLend < 100) {
            //let balanceTakenPercent = AbstractLendingTrader.coinBalancesTakenPercent.get(exchange.getClassName()); // calc & return absolute values
            let balance = AbstractLendingTrader.coinBalances.get(exchange.getClassName());
            let coinBalance = balance[currency];
            if (coinBalance === undefined)
                return 0.0;
            let maxToLendValue = coinBalance / 100 * this.config.maxPercentToLend;
            let max = maxToLendValue - coinBalanceTaken;
            return max < 0.0 ? 0.0 : max;
        }

        // no config limits, lend everything that's not already lent out
        let balanceAvailable = AbstractLendingTrader.coinBalancesAvailable.get(exchange.getClassName());
        let coinBalanceAvailable = balanceAvailable[currency];
        if (coinBalanceAvailable === undefined)
            return 0.0;
        return coinBalanceAvailable;
    }

    protected getMaxLendingTimeDays(exchange: AbstractLendingExchange, currency: Currency.Currency, originalDays: number) {
        if (!this.config.returnDateUTC) {
            this.setLimited(exchange, currency, false);
            //return 0; // treat no date as "immediately"
            return Number.MAX_VALUE; // tread no date as "infinity"
        }
        let returnDate = new Date(this.config.returnDateUTC);
        if (returnDate.toString() === "Invalid Date") {
            logger.error("Invalid 'returnDateUTC' value %s in lending config", this.config.returnDateUTC);
            this.setLimited(exchange, currency, false);
            return Number.MAX_VALUE; // treat invalid date as "infinity"
        }
        //return returnDate.getTime() + loanDays*utils.constants.DAY_IN_SECONDS*1000 > Date.now();
        const diffMs = returnDate.getTime() - this.marketTime.getTime();
        if (diffMs < 0)
            return 0;
        const limitDays = Math.floor(diffMs / 1000 / utils.constants.DAY_IN_SECONDS);
        this.setLimited(exchange, currency, limitDays < originalDays);
        return limitDays;
    }

    protected getMaxOfferAmount(offer: Funding.FundingOrder) {
        const exchangeName = Currency.getExchangeName(offer.exchange);
        let exchange = this.exchanges.get(exchangeName);
        let maxLendingAmount = this.getMaxLendingBalance(exchange, offer.currency);
        this.setLimited(exchange, offer.currency, maxLendingAmount < offer.amount);
        if (maxLendingAmount < offer.amount)
            offer.amount = maxLendingAmount;
        return offer;
    }

    protected setLimited(exchange: AbstractExchange, currency: Currency.Currency, limited: boolean) {
        const currencyStr = Currency.Currency[currency]
        let coinStatus = AbstractLendingTrader.coinStatusMap.get(exchange.getClassName());
        let currencyCoinStatus = coinStatus.get(currencyStr);
        if (!currencyCoinStatus)
            currencyCoinStatus = new LendingCoinStatus();
        currencyCoinStatus.limited = limited;
        coinStatus.set(currencyStr, currencyCoinStatus);
        if (limited)
            this.emitTakenAll();
    }

    protected logPaused(action: LendingTradeAction, currencyStr: string, reason: string) {
        if (this.pausedTrading) {
            const msg = utils.sprintf("Skipping %s %s in %s because trading is paused: %s", action, currencyStr, this.className, reason)
            logger.info(msg)
            this.writeLogLine(msg)
            return true;
        }
        return false;
    }

    protected logTrade(order: Funding.FundingOrder, result: OfferResult | CancelOrderResult, info: LendingTradeInfo) {
        const currencyStr = Currency.Currency[order.currency]
        let logLine = Funding.FundingType[order.type] + " " + Currency.Exchange[order.exchange]
            + " " + currencyStr + ", amount: " + order.amount + ", rate: " + order.rate.toFixed(3);
        if (info) {
            if (info.strategy)
                logLine += ", " + info.strategy.getClassName();
            if (info.reason)
                logLine += ", reason: " + info.reason;
        }
        this.writeLogLine(logLine)
    }
}
