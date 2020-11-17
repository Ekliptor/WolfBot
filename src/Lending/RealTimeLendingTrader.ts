import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractLendingTrader} from "./AbstractLendingTrader";
import {AbstractExchange, CancelOrderResult, ExchangeMap, OrderParameters} from "../Exchanges/AbstractExchange";
import {Trade, Order, Currency, Candle, Funding} from "@ekliptor/bit-models";
import {LendingConfig} from "./LendingConfig";
import {AbstractLendingStrategy} from "./Strategies/AbstractLendingStrategy";
import {AbstractLendingExchange, ExchangeActiveLoanMap, LoanOffers} from "../Exchanges/AbstractLendingExchange";

export default class RealTimeLendingTrader extends AbstractLendingTrader {
    // TODO better error handling & retries

    constructor(config: LendingConfig) {
        super(config)
        setTimeout(this.updatePortfolio.bind(this), 0) // wait until exchanges are attached to this class
    }

    public placeCoinOffers() {
        return new Promise<void>((resolve, reject) => {
            // check our coin balances + place all our coins
            let placeOps = []
            for (let balance of AbstractLendingTrader.coinBalances)
            {
                let exchange = this.exchanges.get(balance[0]);
                let balances = AbstractLendingTrader.coinBalances.get(balance[0]);
                let balancesTaken = AbstractLendingTrader.coinBalancesTaken.get(balance[0]);
                // loop through all balances of this exchange
                for (let currencyNr in balances)
                {
                    if (!balances[currencyNr] || balancesTaken[currencyNr] === undefined) // balancesTaken might be 0
                        continue; // no coins available

                    // filter per currency. each coin has it's own trader + config instance
                    const coinCurrencyNr = parseInt(currencyNr);
                    const currencyStr = Currency.Currency[currencyNr];
                    if (this.config.markets.indexOf(coinCurrencyNr) === -1)
                        continue;

                    const offerAmount = AbstractLendingTrader.submittedOffers.getOfferAmount(exchange.getClassName(), coinCurrencyNr);
                    const balanceAvailable = balances[currencyNr] - balancesTaken[currencyNr] - offerAmount;
                    if (balanceAvailable <= 0) {
                        if (offerAmount === 0)
                            this.emitTakenAll();
                        continue; // all coins lent out
                    }
                    if (balanceAvailable < this.config.minLoanSize) {
                        if (offerAmount === 0)
                            this.emitTakenAll();
                        continue;
                    }
                    if (this.logPaused("place", currencyStr, "placing all coins"))
                        continue;

                    // check if we have enough coins for min lending value
                    let offer = this.getPublicOffer(exchange, coinCurrencyNr, balanceAvailable);
                    let lendingAmountBase = offer.amount;
                    const currencyPairStr = new Currency.CurrencyPair(exchange.getMinLendingValueCurrency(), coinCurrencyNr).toString();
                    if (coinCurrencyNr !== exchange.getMinLendingValueCurrency()) {
                        let ticker = exchange.getExchangeTicker().get(currencyPairStr)
                        if (!ticker) {
                            logger.error("Unable to get %s %s ticker to convert lending amount in trader. Skipped placing offers", currencyPairStr, exchange.getClassName())
                            continue;
                        }
                        else
                            lendingAmountBase *= ticker.last;
                    }
                    if (lendingAmountBase < exchange.getMinLendingValue()) {
                        logger.verbose("Skipping to place %s %s offers because balance %s %s is below min lending value %s %s", currencyStr, exchange.getClassName(), balanceAvailable,
                            currencyStr, exchange.getMinLendingValue(), Currency.Currency[exchange.getMinLendingValueCurrency()])
                        continue;
                    }
                    if (this.lastPlacedCoinOffers.getTime() + nconf.get("serverConfig:minPlaceAllCoinsDiffSec")*1000 >= Date.now()) {
                        logger.verbose("Skipped placing %s offers because they have been placed recently", Currency.Currency[currencyNr]);
                        continue;
                    }

                    if (offer.rate > 0 && offer.rate > this.config.minDailyRate) { // otherwise lending strategies are not ready yet
                        placeOps.push(this.place(offer, "updating all offers"))
                        this.lastPlacedCoinOffers = new Date();
                    }
                }
            }
            Promise.all(placeOps).then(() => {
                resolve()
            }).catch((err) => {
                logger.error("Error placing public coin offers", err);
                resolve()
            })
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected place(offer: Funding.FundingOrder, reason: string) {
        return new Promise<void>((resolve, reject) => {
            let offerOps = []
            for (let ex of this.exchanges)
            {
                // there is only 1 exchange allowed in lending mode
                if (!offer.rate || offer.rate === Number.NaN)
                    continue; // strategy not ready

                const currencyStr = Currency.Currency[offer.currency]
                if (this.logPaused("place", currencyStr, reason))
                    continue;
                let exchange = ex[1];
                if (offer.exchange !== Currency.Exchange.ALL && offer.exchange !== exchange.getExchangeLabel())
                    continue;
                let params = this.getOfferParams(exchange, offer);
                const maxLendingDays = this.getMaxLendingTimeDays(exchange, offer.currency, offer.days);
                if (offer.days > maxLendingDays) {
                    if (maxLendingDays < exchange.getMinLendingDays())
                        continue;
                    offer.days = maxLendingDays;
                    params.days = maxLendingDays;
                }

                offerOps.push(new Promise((resolve, reject) => {
                    exchange.placeOffer(offer.currency, offer.rate, offer.amount, params).then((offerResult) => {
                        logger.info("%s PLACE %s loan: %s", this.className, currencyStr, reason);
                        logger.info("rate %s, amount %s, days %s", offer.rate, offer.amount, offer.days);
                        logger.info(JSON.stringify(offerResult))
                        this.emitPlaced(offer, offerResult, {reason: reason, exchange: exchange});
                        resolve()
                    }).catch((err) => {
                        logger.error("Error placing %s offer on %s (rate: %s, amount %s)", currencyStr, exchange.getClassName(), offer.rate, offer.amount)
                        logger.error(err);
                        resolve(); // continue
                    })
                }))
            }
            Promise.all(offerOps).then(() => {
                if (offerOps.length !== 0) // if we placed any loans we have to update our portfolio
                    return this.updatePortfolio()
                return Promise.resolve();
            }).then(() => {
                resolve()
            }).catch((err) => {
                logger.error("Error processing offers", err)
                if (offerOps.length !== 0) // if we placed any loans we have to update our portfolio
                    return this.updatePortfolio()
                resolve()
            })
        })
    }

    protected cancel(offer: Funding.FundingOrder, reason: string) {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            let offerOps = []
            let exchangeName = this.getExchangeName(offer.exchange);
            if (!exchangeName)
                return resolve(null); // shouldn't happen
            let exchange = this.exchanges.get(exchangeName);
            if (!exchange) {
                logger.error("Exchange %s isn't loaded", exchangeName);
                return resolve(null);
            }
            if (!offer.ID) {
                logger.error("ID must be present to cancel an offer", offer);
                return resolve(null);
            }
            const currencyStr = Currency.Currency[offer.currency];
            if (this.logPaused("cancel", currencyStr, reason))
                return resolve(null);
            exchange.cancelOffer(offer.ID).then((cancelOrderResult) => {
                logger.info("%s CANCEL %s %s loan: %s", this.className, offer.amount.toFixed(8), currencyStr, reason);
                //logger.info("rate %s, amount %s", offer.rate, offer.amount);
                logger.info(JSON.stringify(cancelOrderResult))
                this.emitCancelled(offer, cancelOrderResult, {reason: reason, exchange: exchange});
                resolve(cancelOrderResult)
            }).catch((err) => {
                logger.error("Error cancelling %s offer on %s (rate: %s, amount %s)", currencyStr, exchange.getClassName(), offer.rate, offer.amount)
                logger.error(err);
                resolve(null); // continue
            })
        })
    }

    protected updatePortfolio() {
        return new Promise<void>((resolve, reject) => {
            if (!this.exchanges || AbstractLendingTrader.globalExchanges.size === 0)
                return resolve(); // temporary instance
            if (AbstractLendingTrader.updatePortfolioTimerID === null)
                return resolve(); // another instance is currently updating
            clearTimeout(AbstractLendingTrader.updatePortfolioTimerID)
            //AbstractLendingTrader.updatePortfolioTimerID = 0; // removed for now to avoid ignoring this function forever // TODO bug?
            let scheduleNextUpdate = (immediately = false) => {
                const nextSec = immediately ? nconf.get("serverConfig:updateBalancesImmediatelyTimeSec") : nconf.get("serverConfig:updateBalancesTimeSec");
                clearTimeout(AbstractLendingTrader.updatePortfolioTimerID)
                AbstractLendingTrader.updatePortfolioTimerID = setTimeout(this.updatePortfolio.bind(this), nextSec*1000)
                resolve();
            }
            if (AbstractLendingTrader.lastPortfolioUpdate.getTime() + nconf.get("serverConfig:minPortfolioUpdateMs") >= Date.now())
                return scheduleNextUpdate();
            AbstractLendingTrader.lastPortfolioUpdate = new Date();
            logger.verbose("Updating lending portfolio of %s exchanges in %s", AbstractLendingTrader.globalExchanges.size, this.className)
            let updateOps = []
            for (let ex of AbstractLendingTrader.globalExchanges)
            {
                updateOps.push(this.updateRealtimeExchange(ex[1]))
            }
            Promise.all(updateOps).then(() => {
                // we cancel after updating balances, so new loans will be placed after next portfolio update. // TODO update twice immediately?
                return this.cancelOpenOffers(this.moveOffers ? true : false);
            }).then(() => {
                let placeOps = [];
                if (!this.config.hideCoins) {
                    //return this.placeCoinOffers();
                    // this function has to be called on all trader instances. if we don't hide our coins LendingAdvisor will forward a loan
                    // request to the correct instance
                    for (let inst of AbstractLendingTrader.instances)
                        placeOps.push((inst[1].placeCoinOffers()))
                }
                return Promise.all(placeOps)
            }).then((placeResults) => {
                scheduleNextUpdate(placeResults.length > 0);
                this.emitSynced();
            }).catch((err) => {
                logger.error("Error updating lending porftolio in %s", this.className, err)
                scheduleNextUpdate(); // continue
            })
        })
    }

    protected cancelOpenOffers(cancelAll: boolean) {
        return new Promise<void>((resolve, reject) => {
            // we don't implement the API to get our open orders from an exchange
            // but cancelling an order that has already been filled shouldn't be a problem
            // this is also more safe than checking "resultingTrades" to see if the order filled completely immediately (fees might be
            // expressed differently on exchanges)

            // if we show all our coins, only cancel offers if we move all our offers to a new rate
            if (!cancelAll && !this.config.hideCoins)
                return resolve()

            const now = Date.now();
            let cancelOps = [];
            const reason = cancelAll ? "updating all offers" : "cancelling timed out offer";
            let removeCurrenyOffers: string[] = [];
            for (let off of AbstractLendingTrader.submittedOffers)
            {
                //let exchange = this.exchanges.get(off[0]);
                off[1].forEach((offer: Funding.FundingOrder) => {
                    if (!cancelAll && offer.date.getTime() + nconf.get('serverConfig:offerTimeoutSec')*1000 > now)
                        return;
                    const currencyStr = Currency.Currency[offer.currency];
                    if (cancelAll) { // cancelAll only applies to the currencies of which we updated the interest rate
                        if (!this.updateCurrencyOffers.has(currencyStr))
                            return;
                        removeCurrenyOffers.push(currencyStr);
                    }
                    cancelOps.push(this.cancel(offer, reason));
                })
            }
            removeCurrenyOffers.forEach((currencyStr) => {
                this.updateCurrencyOffers.delete(currencyStr)
            })
            if (cancelOps.length !== 0)
                logger.verbose("Cancelling %s possibly unfilled%s loan offers in %s", cancelOps.length, (cancelAll ? " (all)" : ""), this.className)
            Promise.all(cancelOps).then((results: CancelOrderResult[]) => {
                for (let i = 0; i < results.length; i++)
                {
                    if (results[i] && results[i].cancelled == true)
                        this.removeOffer(results[i].exchangeName, results[i].orderNumber);
                }
                resolve()
            }).catch((err) => {
                logger.error("Error cancelling unfilled orders in %s", this.className, err)
                resolve() // continue
            })
        })
    }

    protected updateRealtimeExchange(exchange: AbstractLendingExchange) {
        return new Promise<void>((resolve, reject) => {
            const exchangeName = exchange.getClassName();
            let exchangeOps = []
            exchangeOps.push(new Promise((resolve, reject) => {
                exchange.getAllOffers().then((offers) => {
                    let loanOrders = LoanOffers.toFundingOrders(offers, exchange.getExchangeLabel());
                    this.removeAllOffers(exchangeName);
                    loanOrders.forEach((offer) => {
                        this.addOffer(exchange, offer);
                    })
                    return exchange.getFundingBalances();
                }).then((currencyList) => {
                    let totalBalances = exchange.getTotalLendingBalances();
                    if (this.balanceChanged(AbstractLendingTrader.coinBalances.get(exchangeName), totalBalances))
                        this.moveOffers = true;
                    AbstractLendingTrader.coinBalances.set(exchangeName, totalBalances)
                    // we get available + total balances returned. convert "available" to "taken"
                    // and remove offers (provided but not yet taken)
                    for (let currency in currencyList)
                    {
                        const offerAmount = AbstractLendingTrader.submittedOffers.getOfferAmount(exchangeName, parseInt(currency));
                        currencyList[currency] = totalBalances[currency] - currencyList[currency] - offerAmount;
                        if (currencyList[currency] < 0) {
                            logger.warn("Error computing 'available' to 'taken' balance for exchange %s, currency %s", exchangeName, Currency.Currency[currency])
                            currencyList[currency] = 0;
                        }
                    }
                    AbstractLendingTrader.coinBalancesTaken.set(exchangeName, currencyList)
                    return exchange.getActiveLoans();
                }).then((loans: ExchangeActiveLoanMap) => {
                    AbstractLendingTrader.activeLoans.set(exchangeName, loans)
                    this.computeBalancesTakenPercent(exchange);
                    resolve()
                }).catch((err) => {
                    const msg = utils.sprintf("Error updating lending balances for realtime exchange %s", exchangeName);
                    logger.error(msg, err)
                    this.sendApiErrorNotification(msg, exchange);
                    resolve() // continue
                })
            }))

            Promise.all(exchangeOps).then(() => {
                resolve()
            })
        })
    }
}
