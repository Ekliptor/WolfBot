import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractTrader} from "./AbstractTrader";
import {PortfolioTrader, LastTradeMap} from "./PortfolioTrader";
import {TradeConfig} from "../Trade/TradeConfig";
import {OrderResult} from "../structs/OrderResult";
import {AbstractExchange, CancelOrderResult, ExchangeMap, OrderParameters} from "../Exchanges/AbstractExchange";
import {AbstractStrategy, TradeAction} from "../Strategies/AbstractStrategy";
import {MarginPosition, MarginPositionList} from "../structs/MarginPosition";
import {AbstractOrderTracker, PendingOrder} from "./AbstractOrderTracker";
import {RealTimeOrderTracker} from "./RealTimeOrderTracker";
import {Currency, Trade, Order} from "@ekliptor/bit-models";

export enum RealTimeTradeMode {
    SIMULATION = 1,
    LIVE = 2
}

// ToDo resetValues button (for strategies)
export default class RealTimeTrader extends PortfolioTrader {
    public static readonly REALTIME_SIMULATION_TRADE_DELAY_SEC = 5;
    public static readonly RETRY_FAILED_TRADE_SEC = 10;
    // TODO investiage memory leak here (or in Bitfinex class) when exchange is down

    protected readonly tradeMode: RealTimeTradeMode = nconf.get('tradeMode');
    protected tracker = new RealTimeOrderTracker(this);

    constructor(config: TradeConfig) {
        super(config)
        this.start = Date.now() - 10*1000; // give it some bonus because the first trades that come in might be a few seconds back
        this.config.exchanges.forEach((exchange) => {
            // update after the first 1min tick only to ensure strategies are (partially) initialized
            // TODO this means balance will not be shown on startup until 2nd sync. ok?
            PortfolioTrader.lastMarginPositionUpdateMs.set(exchange, Date.now() - nconf.get("serverConfig:updateMarginPositionsSec")*1000 + nconf.get("serverConfig:delayFirstEmitSyncSec")*1000);
        })
        PortfolioTrader.updatePortfolioTimerID = setTimeout(this.updatePortfolio.bind(this), 4000) // wait until exchanges are attached to this class and exchanges are ready

        /*
        setTimeout(() => {
            let coinPair = new Currency.CurrencyPair(Currency.Currency.BTC, Currency.Currency.ETH);
            let exchange = this.exchanges.get("Poloniex");
            let sellAmount = 1.0;
            let rate = 0.01;
            const reason = "test trade event";
            let order = Order.getOrder(coinPair, exchange.getExchangeLabel(), sellAmount, rate, Trade.TradeType.SELL)
            this.emitSell(order, [], {reason: reason, exchange: exchange});
        }, 1000)
        */
    }

    // to be able to resume the app and be compatible with manual user interactions on the exchange website
    // we have to call getAllMarginPositions() resp getBalances() on startup and every x minutes
    // (not before every action to do realtime trading faster)

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected buy(strategy: AbstractStrategy, reason: string, exchangeLabel: Currency.Exchange) {
        return new Promise<void>((resolve, reject) => {
            const coinPair = strategy.getAction().pair;
            let orderOps = [];
            if (!this.warmUpDone())
                return resolve();

            if (this.config.marginTrading) {
                // check our margin positions
                //for (let pos of this.marginPositions) // we want to be able to open new margin positions
                for (let ex of this.exchanges)
                {
                    //let exchange = this.exchanges.get(pos[0]);
                    if (this.config.exchanges.indexOf(ex[0]) === -1)
                        continue;
                    let exchange = ex[1];
                    if (this.skipExchange(exchange, exchangeLabel))
                        continue;
                    if (!exchange.marginTradingSupport())
                        continue // TODO should we fallback to normal trading below?
                    let buyBtc = strategy.getOrderAmount(this.getMarginPositionOrderAmount(strategy), exchange.getMaxLeverage());
                    if (this.skipTrade("buy", exchange, strategy, buyBtc) || this.skipTrend("buy"))
                        continue;
                    /*
                    let tickerData = exchange.getTickerData(coinPair)
                    if (!tickerData) {
                        logger.warn("No ticker data availble on %s for pair %s - skipping margin BUY in %s", exchange.getClassName(), coinPair.toString(), this.className)
                        continue;
                    }
                    */
                    let orderBook = exchange.getOrderBook().get(coinPair.toString())
                    let orderParameters: OrderParameters = {};
                    let rate = strategy.getRate();
                    if (strategy.forceMakeOnly()) {
                        if (rate === -1)
                            rate = orderBook.getLast();
                        orderParameters = {postOnly: true}
                    }
                    else if (rate <= -1) {
                        if (rate === -2)
                            orderParameters.matchBestPrice = true;
                        //rate = tickerData.last + tickerData.last / 100 * nconf.get('serverConfig:maxPriceDiffPercent')
                        rate = orderBook.getLast() + orderBook.getLast() / 100 * nconf.get('serverConfig:maxPriceDiffPercent') // TODO or should we use bid/ask?
                    }
                    const buyAmount = this.getMaxCoinAmount(exchange, strategy, buyBtc / rate, "buy");
                    if (this.tradeMode === RealTimeTradeMode.SIMULATION) {
                        orderOps.push(new Promise((resolve, reject) => {
                            logger.info("%s margin BUY simulation trade with %s from %s: %s", this.className, coinPair.toString(), strategy.getClassName(), reason);
                            logger.info("rate %s, amount %s", rate, buyAmount);
                            let order = Order.Order.getOrder(coinPair, exchange.getExchangeLabel(), buyAmount, rate, Trade.TradeType.BUY, "", true)
                            order.leverage = exchange.getMaxLeverage();
                            //order.marginPosition = position.type === "long" ? "long" : "short"; // needed for simulating refunds
                            this.emitBuy(order, [], {strategy: strategy, reason: reason, exchange: exchange});
                            this.lastTrade.setLastTrade(exchange.getClassName(), coinPair.toString());
                            this.totalBuyTrades++;
                            setTimeout(resolve, RealTimeTrader.REALTIME_SIMULATION_TRADE_DELAY_SEC*1000);
                        }))
                        continue;
                    }
                    orderOps.push(new Promise((resolve, reject) => {
                        exchange.marginBuy(coinPair, rate, buyAmount, orderParameters).then((orderResult) => {
                            logger.info("%s margin BUY trade with %s from %s: %s", this.className, coinPair.toString(), strategy.getClassName(), reason);
                            logger.info("rate %s, amount %s", rate, buyAmount);
                            logger.info(JSON.stringify(orderResult))
                            let order = Order.Order.getOrder(coinPair, exchange.getExchangeLabel(), buyAmount, rate, Trade.TradeType.BUY, orderResult.orderNumber.toString(), true)
                            order.leverage = exchange.getMaxLeverage();
                            this.addOrder(exchange, order);
                            this.emitBuy(order, orderResult.resultingTrades.get(coinPair.toString()), {strategy: strategy, reason: reason, exchange: exchange});
                            this.lastTrade.setLastTrade(exchange.getClassName(), coinPair.toString());
                            this.totalBuyTrades++;
                            this.watchOrder(exchange, strategy, order, orderParameters, orderResult);
                            resolve()
                        }).catch((err) => {
                            logger.error("Error on margin BUY %s (rate %s, amount %s) in %s", coinPair.toString(), rate, buyAmount, this.className, err);
                            resolve(); // continue
                            this.retryFailedAction(this.buy, strategy, reason, exchange, err);
                        })
                    }))
                }
            }
            else {
                // check our coin balances
                for (let balance of PortfolioTrader.coinBalances)
                {
                    let exchange = this.exchanges.get(balance[0]);
                    if (this.skipExchange(exchange, exchangeLabel))
                        continue;
                    if (this.config.exchanges.indexOf(exchange.getClassName()) === -1)
                        continue;
                    // TODO trading in other pairs such as ETH_DASH, also in skipTrade()
                    //let amount = balance[1][coinPair.to] // "from" is always BTC here
                    //console.log("BALANCE", exchange.getClassName(), amount)
                    let buyBtc = strategy.getOrderAmount(this.config.tradeTotalBtc);
                    if (this.skipTrade("buy", exchange, strategy, buyBtc) || this.skipTrend("buy"))
                        continue;
                    let orderBook = exchange.getOrderBook().get(coinPair.toString())
                    let orderParameters: OrderParameters = {};
                    let rate = strategy.getRate();
                    if (strategy.forceMakeOnly()) {
                        if (rate === -1)
                            rate = orderBook.getLast();
                        orderParameters = {postOnly: true}
                    }
                    else if (rate <= -1) {
                        if (rate === -2)
                            orderParameters.matchBestPrice = true;
                        rate = orderBook.getLast() + orderBook.getLast() / 100 * nconf.get('serverConfig:maxPriceDiffPercent')
                    }
                    // TODO check actual tradable balance on exchange and store it in map in advance (for faster real time trading)
                    const buyAmount = this.getMaxCoinAmount(exchange, strategy, buyBtc / rate, "buy");
                    if (this.tradeMode === RealTimeTradeMode.SIMULATION) {
                        orderOps.push(new Promise((resolve, reject) => {
                            logger.info("%s BUY simulation trade with %s from %s: %s", this.className, coinPair.toString(), strategy.getClassName(), reason);
                            logger.info("rate %s, amount %s", rate, buyAmount);
                            let order = Order.Order.getOrder(coinPair, exchange.getExchangeLabel(), buyAmount, rate, Trade.TradeType.BUY, "", false)
                            this.emitBuy(order, [], {strategy: strategy, reason: reason, exchange: exchange});
                            this.lastTrade.setLastTrade(exchange.getClassName(), coinPair.toString());
                            this.totalBuyTrades++;
                            setTimeout(resolve, RealTimeTrader.REALTIME_SIMULATION_TRADE_DELAY_SEC*1000);
                        }))
                        continue;
                    }
                    orderOps.push(new Promise((resolve, reject) => {
                        exchange.buy(coinPair, rate, buyAmount, orderParameters).then((orderResult) => {
                            logger.info("%s BUY trade with %s from %s: %s", this.className, coinPair.toString(), strategy.getClassName(), reason);
                            logger.info("rate %s, amount %s", rate, buyAmount);
                            logger.info(JSON.stringify(orderResult))
                            let order = Order.Order.getOrder(coinPair, exchange.getExchangeLabel(), buyAmount, rate, Trade.TradeType.BUY, orderResult.orderNumber.toString(), false)
                            this.addOrder(exchange, order);
                            this.emitBuy(order, orderResult.resultingTrades.get(coinPair.toString()), {strategy: strategy, reason: reason, exchange: exchange});
                            this.lastTrade.setLastTrade(exchange.getClassName(), coinPair.toString());
                            this.totalBuyTrades++;
                            this.watchOrder(exchange, strategy, order, orderParameters, orderResult);
                            resolve()
                        }).catch((err) => {
                            logger.error("Error on BUY %s (rate %s, amount %s) in %s", coinPair.toString(), rate, buyAmount, this.className, err);
                            resolve(); // continue
                            this.retryFailedAction(this.buy, strategy, reason, exchange, err);
                        })
                    }))
                }
            }

            this.processTrades(orderOps, resolve)
        })
    }

    protected sell(strategy: AbstractStrategy, reason: string, exchangeLabel: Currency.Exchange) {
        return new Promise<void>((resolve, reject) => {
            const coinPair = strategy.getAction().pair;
            let orderOps = [];
            if (!this.warmUpDone())
                return resolve();

            if (this.config.marginTrading) {
                // check our margin positions
                for (let ex of this.exchanges)
                {
                    if (this.config.exchanges.indexOf(ex[0]) === -1)
                        continue;
                    let exchange = ex[1];
                    if (this.skipExchange(exchange, exchangeLabel))
                        continue;
                    if (!exchange.marginTradingSupport())
                        continue
                    if (this.skipShortSell(exchange, coinPair))
                        continue;

                    let sellBtc = strategy.getOrderAmount(this.getMarginPositionOrderAmount(strategy), exchange.getMaxLeverage());
                    if (this.skipTrade("sell", exchange, strategy, sellBtc) || this.skipTrend("sell"))
                        continue;
                    let orderBook = exchange.getOrderBook().get(coinPair.toString())
                    let orderParameters: OrderParameters = {};
                    let rate = strategy.getRate();
                    if (strategy.forceMakeOnly()) {
                        if (rate === -1)
                            rate = orderBook.getLast();
                        orderParameters = {postOnly: true}
                    }
                    else if (rate <= -1) {
                        if (rate === -2)
                            orderParameters.matchBestPrice = true;
                        rate = orderBook.getLast() - orderBook.getLast() / 100 * nconf.get('serverConfig:maxPriceDiffPercent')
                    }
                    const sellAmount = this.getMaxCoinAmount(exchange, strategy, sellBtc / rate, "sell");
                    if (this.tradeMode === RealTimeTradeMode.SIMULATION) {
                        orderOps.push(new Promise((resolve, reject) => {
                            logger.info("%s margin SELL simulation trade with %s from %s: %s", this.className, coinPair.toString(), strategy.getClassName(), reason);
                            logger.info("rate %s, amount %s", rate, sellAmount);
                            let order = Order.Order.getOrder(coinPair, exchange.getExchangeLabel(), sellAmount, rate, Trade.TradeType.SELL, "", true)
                            order.leverage = exchange.getMaxLeverage();
                            //order.marginPosition = position.type === "long" ? "long" : "short";
                            this.emitSell(order, [], {strategy: strategy, reason: reason, exchange: exchange});
                            this.lastTrade.setLastTrade(exchange.getClassName(), coinPair.toString());
                            this.totalSellTrades++;
                            setTimeout(resolve, RealTimeTrader.REALTIME_SIMULATION_TRADE_DELAY_SEC*1000);
                        }))
                        continue;
                    }
                    orderOps.push(new Promise((resolve, reject) => {
                        exchange.marginSell(coinPair, rate, sellAmount, orderParameters).then((orderResult) => {
                            logger.info("%s margin SELL trade with %s from %s: %s", this.className, coinPair.toString(), strategy.getClassName(), reason);
                            logger.info("rate %s, amount %s", rate, sellAmount);
                            logger.info(JSON.stringify(orderResult))
                            let order = Order.Order.getOrder(coinPair, exchange.getExchangeLabel(), sellAmount, rate, Trade.TradeType.SELL, orderResult.orderNumber.toString(), true)
                            order.leverage = exchange.getMaxLeverage();
                            this.addOrder(exchange, order);
                            this.emitSell(order, orderResult.resultingTrades.get(coinPair.toString()), {strategy: strategy, reason: reason, exchange: exchange});
                            this.lastTrade.setLastTrade(exchange.getClassName(), coinPair.toString());
                            this.totalSellTrades++;
                            this.watchOrder(exchange, strategy, order, orderParameters, orderResult);
                            resolve()
                        }).catch((err) => {
                            logger.error("Error on margin SELL %s (rate %s, amount %s) in %s", coinPair.toString(), rate, sellAmount, this.className, err);
                            resolve(); // continue
                            this.retryFailedAction(this.sell, strategy, reason, exchange, err);
                        })
                    }))
                }
            }
            else {
                // check our coin balances
                for (let balance of PortfolioTrader.coinBalances)
                {
                    let exchange = this.exchanges.get(balance[0]);
                    if (this.skipExchange(exchange, exchangeLabel))
                        continue;
                    if (this.config.exchanges.indexOf(exchange.getClassName()) === -1)
                        continue;
                    let balances = PortfolioTrader.coinBalances.get(balance[0]);
                    let curBalance = balances[coinPair.to] // from is BTC
                    if (!curBalance) {
                        logger.warn("Nothing to sell for pair %s on %s", coinPair.toString(), exchange.getClassName())
                        continue; // nothing to sell
                    }
                    let orderBook = exchange.getOrderBook().get(coinPair.toString())
                    let orderParameters: OrderParameters = {};
                    let rate = strategy.getRate();
                    if (strategy.forceMakeOnly()) {
                        if (rate === -1)
                            rate = orderBook.getLast();
                        orderParameters = {postOnly: true}
                    }
                    else if (rate <= -1) {
                        if (rate === -2)
                            orderParameters.matchBestPrice = true;
                        rate = orderBook.getLast() - orderBook.getLast() / 100 * nconf.get('serverConfig:maxPriceDiffPercent')
                    }

                    if (curBalance * orderBook.getLast() > this.getMaxSellBtc())
                        curBalance = this.getMaxSellBtc() / orderBook.getLast();
                    let sellAmount = this.getMaxCoinAmount(exchange, strategy, strategy.getOrderAmount(curBalance), "sell"); // getMaxCoinAmount shouldn't be needed here
                    if (this.skipTrade("sell", exchange, strategy, sellAmount) || this.skipTrend("sell"))
                        continue;
                    if (this.tradeMode === RealTimeTradeMode.SIMULATION) {
                        orderOps.push(new Promise((resolve, reject) => {
                            logger.info("%s SELL simulation trade with %s from %s: %s", this.className, coinPair.toString(), strategy.getClassName(), reason);
                            logger.info("rate %s, amount %s", rate, sellAmount);
                            let order = Order.Order.getOrder(coinPair, exchange.getExchangeLabel(), sellAmount, rate, Trade.TradeType.SELL, "", false)
                            this.emitSell(order, [], {strategy: strategy, reason: reason, exchange: exchange});
                            this.lastTrade.setLastTrade(exchange.getClassName(), coinPair.toString());
                            this.totalSellTrades++;
                            setTimeout(resolve, RealTimeTrader.REALTIME_SIMULATION_TRADE_DELAY_SEC*1000);
                        }))
                        continue;
                    }
                    orderOps.push(new Promise((resolve, reject) => {
                        exchange.sell(coinPair, rate, sellAmount, orderParameters).then((orderResult) => {
                            logger.info("%s SELL trade with %s from %s: %s", this.className, coinPair.toString(), strategy.getClassName(), reason);
                            logger.info("rate %s, amount %s", rate, sellAmount);
                            logger.info(JSON.stringify(orderResult))
                            let order = Order.Order.getOrder(coinPair, exchange.getExchangeLabel(), sellAmount, rate, Trade.TradeType.SELL, orderResult.orderNumber.toString(), false)
                            this.addOrder(exchange, order);
                            this.emitSell(order, orderResult.resultingTrades.get(coinPair.toString()), {strategy: strategy, reason: reason, exchange: exchange});
                            this.lastTrade.setLastTrade(exchange.getClassName(), coinPair.toString());
                            this.totalSellTrades++;
                            this.watchOrder(exchange, strategy, order, orderParameters, orderResult);
                            resolve()
                        }).catch((err) => {
                            logger.error("Error on SELL %s (rate %s, amount %s) in %s", coinPair.toString(), rate, sellAmount, this.className, err);
                            resolve(); // continue
                            this.retryFailedAction(this.sell, strategy, reason, exchange, err);
                        })
                    }))
                }
            }

            this.processTrades(orderOps, resolve)
        })
    }

    protected close(strategy: AbstractStrategy, reason: string, exchangeLabel: Currency.Exchange) {
        // TODO implement a "softClose" parameter. this will place a buy/sell order instead of closing.
        // the price is then slightly below/above market price to pay only the maker fee. see watchOrder()
        return new Promise<void>((resolve, reject) => {
            const coinPair = strategy.getAction().pair;
            let orderOps = [];
            if (!this.warmUpDone())
                return resolve();

            if (this.config.marginTrading) {
                // check our margin positions
                for (let pos of PortfolioTrader.marginPositions)
                {
                    if (this.config.exchanges.indexOf(pos[0]) === -1)
                        continue;
                    let exchange = this.exchanges.get(pos[0]);
                    if (this.skipExchange(exchange, exchangeLabel))
                        continue;
                    if (this.skipTrade("close", exchange, strategy))
                        continue;
                    if (this.tradeMode === RealTimeTradeMode.SIMULATION) { // simulation should work even if we don't have coins on the exchange
                        orderOps.push(new Promise((resolve, reject) => {
                            let balance: any = {} // TODO follow entry price to compute balance
                            logger.info("%s margin CLOSE simulation trade with %s from %s: %s", this.className, coinPair.toString(), strategy.getClassName(), reason);
                            logger.info("amount %s, rate %s, profit/loss %s", balance.amount, this.marketRates.get(coinPair.toString()), balance.pl);
                            let order = Order.Order.getOrder(coinPair, exchange.getExchangeLabel(), balance.amount, 0, Trade.TradeType.CLOSE, "", true)
                            this.emitClose(order, [], {strategy: strategy, pl: balance.pl, reason: reason, exchange: exchange});
                            if (!nconf.get('serverConfig:canTradeImmediatelyAfterClose'))
                                this.lastTrade.setLastTrade(exchange.getClassName(), coinPair.toString());
                            this.countMarginTrade(balance);
                            setTimeout(resolve, RealTimeTrader.REALTIME_SIMULATION_TRADE_DELAY_SEC*1000);
                        }))
                        continue;
                    }
                    let marginPositions = PortfolioTrader.marginPositions.get(pos[0]);
                    let balance = marginPositions.get(coinPair.toString());
                    if (!balance) {
                        logger.warn("Nothing to close for pair %s on %s", coinPair.toString(), exchange.getClassName())
                        continue; // nothing to close
                    }
                    orderOps.push(new Promise((resolve, reject) => {
                        exchange.closeMarginPosition(coinPair).then((orderResult) => {
                            logger.info("%s margin CLOSE trade with %s from %s: %s", this.className, coinPair.toString(), strategy.getClassName(), reason);
                            logger.info("amount %s, rate %s, profit/loss %s", balance.amount, this.marketRates.get(coinPair.toString()), balance.pl);
                            logger.info(JSON.stringify(orderResult))
                            let order = Order.Order.getOrder(coinPair, exchange.getExchangeLabel(), balance.amount, 0, Trade.TradeType.CLOSE, orderResult.orderNumber.toString(), true)
                            order.closePosition = balance.type === "long" ? "long" : "short";
                            //this.addOrder(exchange, order); // we don't specify a price. close can either fail or get through at a variable price
                            this.emitClose(order, orderResult.resultingTrades.get(coinPair.toString()), {strategy: strategy, pl: balance.pl, reason: reason, exchange: exchange});
                            if (!nconf.get('serverConfig:canTradeImmediatelyAfterClose'))
                                this.lastTrade.setLastTrade(exchange.getClassName(), coinPair.toString());
                            this.countMarginTrade(balance);
                            resolve()
                        }).catch((err) => {
                            logger.error("Error on margin CLOSE %s in %s", coinPair.toString(), this.className, err);
                            resolve(); // continue
                            this.retryFailedAction(this.close, strategy, reason, exchange, err);
                        })
                    }))
                }
            }
            // else there is nothing to do

            this.processTrades(orderOps, resolve)
        })
    }

    protected retryFailedAction(tradeFunction, strategy: AbstractStrategy, reason: string, exchange: AbstractExchange, err: any) {
        if (!exchange.repeatFailedTrade(err, strategy.getAction().pair))
            return;
        // TODO add a counter and only repeat x times

        setTimeout(() => { // mostly fails because of server overload. retry after a few seconds
            const coinPair = strategy.getAction().pair;
            logger.info("Retrying failed trade action: %s %s on %s", tradeFunction.name, coinPair.toString(), exchange.getClassName());
            // TODO this retries the trade on all exchanges, add another param to buy/sell to only trade on the failed exchanges
            tradeFunction.call(this, strategy, reason);
        }, RealTimeTrader.RETRY_FAILED_TRADE_SEC * 1000)
    }

    protected updatePortfolio() {
        return new Promise<void>((resolve, reject) => {
            if (!this.exchanges || AbstractTrader.globalExchanges.size === 0)
                return resolve(); // temporary instance
            if (PortfolioTrader.updatePortfolioTimerID === null)
                return; // another instance is currently updating
            clearTimeout(PortfolioTrader.updatePortfolioTimerID)
            PortfolioTrader.updatePortfolioTimerID = null;
            let scheduleNextUpdate = () => {
                clearTimeout(PortfolioTrader.updatePortfolioTimerID)
                PortfolioTrader.updatePortfolioTimerID = setTimeout(this.updatePortfolio.bind(this), nconf.get("serverConfig:updatePortfolioSec")*1000)
                resolve();
            }
            logger.verbose("Updating portfolio of %s exchanges in %s", AbstractTrader.globalExchanges.size, this.className)
            let updateOps = []
            for (let ex of AbstractTrader.globalExchanges)
            {
                updateOps.push(this.updateRealtimeExchange(ex[1]))
            }
            Promise.all(updateOps).then(() => {
                return this.cancelOpenOrders();
            }).then(() => {
                scheduleNextUpdate();
            }).catch((err) => {
                logger.error("Error updating porftolio in %s", this.className, err)
                scheduleNextUpdate(); // continue
            })
        })
    }

    protected cancelOpenOrders() {
        return new Promise<void>((resolve, reject) => {
            // we don't implement the API to get our open orders from an exchange
            // but cancelling an order that has already been filled shouldn't be a problem
            // this is also more safe than checking "resultingTrades" to see if the order filled completely immediately (fees might be
            // expressed differently on exchanges)
            const now = Date.now();
            let cancelOps = [];
            for (let ord of PortfolioTrader.submittedOrders)
            {
                let exchange = this.exchanges.get(ord[0]);
                ord[1].forEach((order) => {
                    if (order.date.getTime() + nconf.get('serverConfig:orderTimeoutSec')*1000 > now)
                        return;
                    if (order.marginOrder)
                        cancelOps.push(exchange.marginCancelOrder(order.currencyPair, order.orderID));
                    else
                        cancelOps.push(exchange.cancelOrder(order.currencyPair, order.orderID));
                })
            }
            if (cancelOps.length !== 0)
                logger.verbose("Cancelling %s possibly unfilled orders in %s", cancelOps.length, this.className)
            Promise.all(cancelOps).then((results: CancelOrderResult[]) => {
                for (let i = 0; i < results.length; i++)
                {
                    if (results[i].cancelled == true)
                        this.removeOrder(results[i].exchangeName, results[i].orderNumber);
                }
                resolve()
            }).catch((err) => {
                logger.error("Error cancelling orders in %s", this.className, err)
                resolve() // continue
            })
        })
    }

    protected updateRealtimeExchange(exchange: AbstractExchange) {
        return new Promise<void>((resolve, reject) => {
            let exchangeOps = []
            // we have maps with the exchange name as key. so if we close an open position it is implicitly removed from
            // the map on update by overwriting all data for that exchange (adds aditional security against failed trade requests)
            //if (this.config.marginTrading) { // update both because this call is shared among all RealTimeTrader instances
                exchangeOps.push(new Promise((resolve, reject) => {
                    if (exchange.marginTradingSupport() === false)
                        return resolve();
                    exchange.getAllMarginPositions().then((marginPositionList) => {
                        PortfolioTrader.marginPositions.set(exchange.getClassName(), marginPositionList)
                        resolve()
                    }).catch((err) => {
                        logger.error("Error updating margin positions for realtime exchange %s", exchange.getClassName(), err)
                        resolve() // continue
                    })
                }))
            //}
            //else {
                exchangeOps.push(new Promise((resolve, reject) => {
                    /*
                    if (exchange.isContractExchange()) {
                        const list: Currency.LocalCurrencyList = {}
                        list[Currency.Currency.BTC] = 0; // dummy so that it is considered "initialized"
                        PortfolioTrader.coinBalances.set(exchange.getClassName(), list) // can only trade contracts
                        return resolve()
                    }
                    */
                    exchange.getBalances().then((currencyList) => {
                        PortfolioTrader.coinBalances.set(exchange.getClassName(), currencyList)
                        resolve()
                    }).catch((err) => {
                        logger.error("Error updating balances for realtime exchange %s", exchange.getClassName(), err)
                        resolve() // continue
                    })
                }))
            //}

            Promise.all(exchangeOps).then(() => {
                //const marketTImeMs = this.marketTime.getTime(); // is null until we receive trades. Date.now() ok here
                const marketTimeMs = Date.now();
                if (PortfolioTrader.lastMarginPositionUpdateMs.runNextUpdate(exchange.getClassName(), marketTimeMs)) {
                    PortfolioTrader.lastMarginPositionUpdateMs.set(exchange.getClassName(), marketTimeMs)
                    //exchange.getAllMarginPositions().then((positions) => { // save 1 http call and use the positions we just loaded above
                    this.syncPortfolio(exchange);
                }
                else if (PortfolioTrader.lastMarginPositionUpdateMs.isFirstApiCall === true) {
                    PortfolioTrader.lastMarginPositionUpdateMs.isFirstApiCall = false;
                    const emitSec = Math.min(nconf.get("serverConfig:updateMarginPositionsSec"), nconf.get("serverConfig:delayFirstEmitSyncSec"));
                    setTimeout(() => {
                        this.syncPortfolio(exchange);
                    }, emitSec*1000);
                }

                resolve()
            })
        })
    }

    protected syncMarket(strategy: AbstractStrategy) {
        super.syncMarket(strategy); // call this first
        const now = Date.now();
        const marketTime = this.marketTime.getTime();
        const offsetMs = nconf.get("serverConfig:maxRealtimeMarketOffsetSec") * 1000;
        if (now - offsetMs > marketTime/* && marketTime > now*/) {
            logger.warn("Updating out of sync market time (market behind) in %s. old value: %s", this.className, utils.getUnixTimeStr(true, this.marketTime))
            this.marketTime = new Date();
        }
        else if (now + offsetMs < marketTime) {
            logger.warn("Updating out of sync market time (market ahead) in %s. old value: %s", this.className, utils.getUnixTimeStr(true, this.marketTime))
            this.marketTime = new Date();
        }
    }

    protected skipTrade(action: TradeAction, exchange: AbstractExchange, strategy: AbstractStrategy, amountBtc: number = -1) {
        const currencyPair = strategy.getAction().pair.toString();
        const exchangeName = exchange.getClassName();
        const key = LastTradeMap.getKey(exchangeName, currencyPair);
        let lastTrade = this.lastTrade.get(key)
        if (!lastTrade)
            return super.skipTrade(action, exchange, strategy, amountBtc); // we still have to check for other conditions in parent class
        if (action !== "close" || !nconf.get('serverConfig:canAlwaysClose')) {
            if (lastTrade.getTime() + nconf.get('serverConfig:holdMin') * utils.constants.MINUTE_IN_SECONDS * 1000 > Date.now()) {
                const passed = utils.test.getPassedTime(lastTrade.getTime())
                logger.info("Skipping %s trade in %s on %s for %s because we traded recently. last trade %s ago", action, this.className, exchangeName, currencyPair, passed)
                return true;
            }
        }
        return super.skipTrade(action, exchange, strategy, amountBtc);
    }

    protected watchOrder(exchange: AbstractExchange, strategy: AbstractStrategy, order: Order.Order, orderParameters: OrderParameters, orderResult: OrderResult) {
        const pendingOrder = new PendingOrder(exchange, strategy, order, orderParameters, orderResult);
        this.tracker.track(pendingOrder);
    }

    protected isStarting() {
        return this.config.warmUpMin == 0;
    }
}