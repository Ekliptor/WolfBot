import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractTrader, TradeInfo} from "./AbstractTrader";
import {PortfolioTrader, LastTradeMap, MarketExposure, BotEvaluation} from "./PortfolioTrader";
import {TradeConfig} from "../Trade/TradeConfig";
import {OrderResult} from "../structs/OrderResult";
import {AbstractExchange, ExchangeMap, OrderParameters} from "../Exchanges/AbstractExchange";
import {AbstractContractExchange} from "../Exchanges/AbstractContractExchange";
import HistoryDataExchange from "../Exchanges/HistoryDataExchange";
import {HistoryExchangeMap, HistoryDataExchangeOptions} from "../Exchanges/HistoryDataExchange";
import {AbstractStrategy, TradeAction} from "../Strategies/AbstractStrategy";
import {MarginPosition, MarginPositionList} from "../structs/MarginPosition";
import {AbstractOrderTracker, PendingOrder} from "./AbstractOrderTracker";
import {BacktestOrderTracker} from "./BacktestOrderTracker";
import {Currency, Trade, TradeHistory, Order} from "@ekliptor/bit-models";
import * as db from "../database";
import * as helper from "../utils/helper";
import * as _ from "lodash";
import {AbstractTakeProfitStrategy} from "../Strategies/AbstractTakeProfitStrategy";
import {StrategyActionName} from "../TradeAdvisor";
import ExchangeController from "../ExchangeController";

class PendingOrdersBalanceMap extends Map<string, number> { // (orderID, base currency balance)
    constructor() {
        super()
    }
}

export default class Backtester extends PortfolioTrader {
    protected exchanges: HistoryExchangeMap; // (exchange name, instance)
    protected feeFactor: number = 1.0;

    protected tracker = new BacktestOrderTracker(this);
    protected previousTrade: Trade.Trade = null;
    protected pendingOrders = new PendingOrdersBalanceMap();
    protected lastTradeStrategy: AbstractStrategy = null;
    protected tradeImportStarted = false; // the import function in exchange might return (without error) and still not get the whole range. prevent loop
    protected nextParentTick: number = 0;

    constructor(config: TradeConfig) {
        super(config)
        this.recordMyTrades = true;
        // TODO option to partially close open positions (in all Traders)
    }

    public backtest(exchangeController: ExchangeController) {
        if (process.env.IS_CHILD) { // ensure we always exit the child when parent exits
            process.on("disconnect", () => {
                process.exit(0);
            });
        }
        const start = process.env.START_TIME_MS ? new Date(parseInt(process.env.START_TIME_MS)) : utils.date.parseAsGmt0(nconf.get("serverConfig:backtest:from"))
        const end = process.env.END_TIME_MS ? new Date(parseInt(process.env.END_TIME_MS)) : utils.date.parseAsGmt0(nconf.get("serverConfig:backtest:to"))
        let exchange = this.exchanges.get(this.config.exchanges[0])
        // check if we have fully imported that range
        let history = new TradeHistory.TradeHistory(this.config.markets[0], exchange.getExchangeLabel(), start, end);
        TradeHistory.isAvailable(db.get(), history).then((available) => {
            if (available === false) {
                if (this.tradeImportStarted === false) {
                    helper.sendMessageToParent({
                        type: 'startImport', // TODO send import progress
                        exchange: exchange.getClassName()
                    });
                }
                TradeHistory.getAvailablePeriods(db.get(), history.exchange, history.currencyPair).then((periods) => {
                    if (this.tradeImportStarted === true) {
                        logger.error("Trade history to backtest %s on %s from %s to %s is not available. Please run import first. Available periods:", this.config.markets[0].toString(), exchange.getClassName(), start, end)
                        logger.error(JSON.stringify(periods))
                        helper.sendMessageToParent({
                            type: 'errorImport',
                            exchange: exchange.getClassName()
                        });
                        this.exitBacktest();
                        return;
                    }
                    if (periods.length === 0) { // no data yet, import the full range
                        logger.info("No %s trade history for desired range available. Starting full import", exchange.getClassName())
                        this.fetchBacktestRange(exchangeController, exchange.getClassName(), this.config.markets[0], start, end).then(() => {
                            setTimeout(this.backtest.bind(this, exchangeController), 0)
                        }).catch((err) => {
                            logger.error("Import failed. Can't start backtest", err)
                        })
                        return;
                    }
                    let importStart = start, importEnd = end;
                    periods.forEach((period) => {
                        // check for overlaps with existing data and fetch the missing trade history
                        // TODO allow fetching multiple small missing ranges. currently we only fetch 1 range (so we fetch everything again if there is missing data)
                        if (period.end.getTime() > importStart.getTime())
                            importStart = period.end;
                        if (period.start.getTime() < importEnd.getTime() && period.end.getTime() > importEnd.getTime())
                            importEnd = period.start;
                    })
                    if (importEnd.getTime() < importStart.getTime()) { // sanity check
                        logger.error("Error creating partial import range. Fetching full range");
                        importStart = start;
                        importEnd = end;
                    }
                    logger.info("Partial %s trade history for desired range available. Starting import from %s to %s", exchange.getClassName(), importStart, importEnd)
                    // TODO check if exchange supports imports (OKEX date ranges)
                    this.fetchBacktestRange(exchangeController, exchange.getClassName(), this.config.markets[0], importStart, importEnd).then(() => {
                        setTimeout(this.backtest.bind(this, exchangeController), 0)
                    }).catch((err) => {
                        logger.error("Partial Import failed. Can't start backtest", err)
                    })
                })
                return;
            }

            let currencyList: Currency.LocalCurrencyList = {}
            let testNumber = new RegExp("^[0-9]+")
            for (let cur in Currency.Currency)
            {
                // iterates over keys and values as string
                if (testNumber.test(cur) === false)
                    continue
                currencyList[cur] = 0
            }
            const startBalance = process.env.START_BALANCE ? parseFloat(process.env.START_BALANCE) : nconf.get('serverConfig:backtest:startBalance');
            currencyList[Currency.Currency.BTC] = startBalance;
            PortfolioTrader.baseCurrencyBalance = startBalance;
            const baseCurrency = this.config.markets[0].from;
            //if (exchange.isContractExchange())
            if (PortfolioTrader.baseCurrencyBalance < 1000.0) {
                if (baseCurrency === Currency.Currency.USD || baseCurrency === Currency.Currency.EUR || baseCurrency === Currency.Currency.JPY || baseCurrency === Currency.Currency.GBP) {
                    PortfolioTrader.baseCurrencyBalance *= 1000;
                    logger.info("Increased low start balance by factor 1000 to %s", PortfolioTrader.baseCurrencyBalance)
                }
            }
            //if (exchange.marginTradingSupport()) // it get's leveraged when trading
            // PortfolioTrader.baseCurrencyBalance *= exchange.getMaxLeverage();
            const slippage = process.env.SLIPPAGE ? parseFloat(process.env.SLIPPAGE) : nconf.get("serverConfig:backtest:slippage");
            const fee = process.env.TRADING_FEE ? parseFloat(process.env.TRADING_FEE) / 100.0 : exchange.getFee();
            this.feeFactor = 1.0 - (fee + slippage/100)
            let marginPositions = new MarginPositionList(); // no open position on start
            PortfolioTrader.coinBalances.set(exchange.getClassName(), currencyList)
            PortfolioTrader.marginPositions.set(exchange.getClassName(), marginPositions)
            this.setStartBalances();
            exchange.setBalances(currencyList);
            exchange.setMarginPositions(marginPositions);
            // TODO update balances in exchange class. currently not used
            if (this.config.marginTrading === true && this.containsTakeProfitPartialStrategies() === true) {
                helper.sendMessageToParent({
                    type: 'profitPartialWarning'
                });
            }

            let tradeResult: BotEvaluation;
            this.marketTime = new Date(start); // ensure it's not null if we only import very few trades

            exchange.replay(this.config.markets[0], start, end).then(() => {
                this.simulateCloseAllMarginPositions(this.currentCoinRate);
                return this.tradeAdvisor.backtestDone();
            }).then(() => {
                tradeResult = this.evaluateTrades();
                return this.writeTradeGraph(this.config.markets[0], tradeResult);
            }).then((file) => {
                if (process.env.IS_CHILD) {
                    // we are running backfinder. send results back to parent process
                    helper.sendMessageToParent({
                        type: 'result',
                        result: tradeResult,
                        file: file
                    });
                }
                else
                    console.log(tradeResult)
                this.exitBacktest();
            }).catch((err) => {
                logger.error("Error backtesting")
                utils.test.dumpError(err, logger);
                setTimeout(() => { // our log is async
                    process.exit(1)
                }, 500)
            })
        })
    }

    public callAction(action: StrategyActionName, strategy: AbstractStrategy, reason = "", exchange: Currency.Exchange = Currency.Exchange.ALL): void {
        if (action !== "close" && strategy instanceof AbstractTakeProfitStrategy) { // TODO count balances, margin collateral,...
            logger.warn("TakeProfit partial ist currently not supported during backtesting. Ignoring %s trade", action.toUpperCase())
            return;
        }
        super.callAction(action, strategy, reason, exchange);
    }

    public sendTick(trades: Trade.Trade[]) {
        //console.log(trades)
        // trades happened. check if any of those trades crossed the price of our orders and update our portfolio
        if (this.start === 0)
            this.start = trades[0].date.getTime();
        this.marketTime = trades[trades.length-1].date; // should we also update rates? better just on candles
        this.executeOrders(trades);
        this.updatePortfolio();

        if (this.nextParentTick < Date.now()) {
            this.nextParentTick = Date.now() + nconf.get("serverConfig:parentBacktestTickMs"); // here we use real time
            helper.sendMessageToParent({
                type: 'tick',
                data: {
                    timeMs: this.marketTime.getTime()
                }
            });
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected fetchBacktestRange(exchangeController: ExchangeController, exchangeName: string, currencyPair: Currency.CurrencyPair, start: Date, end: Date) {
        return new Promise<void>((resolve, reject) => {
            this.tradeImportStarted = true;
            let exchange: AbstractExchange;
            let timer = setInterval(() => {
                helper.sendMessageToParent({
                    type: 'importTick',
                    data: {
                        percent: 0.0 // TODO add progress from exchange
                    }
                });
            }, nconf.get("serverConfig:importTickIntervalMs"));
            let importDone = () => {
                clearInterval(timer);
                helper.sendMessageToParent({
                    type: 'importTick',
                    data: {
                        percent: 100.0
                    }
                });
            }
            exchangeController.loadSingleExchange(exchangeName).then((ex) => {
                exchange = ex;
                exchange.subscribeToMarkets([currencyPair])
                return utils.promiseDelay(nconf.get("serverConfig:exchangeImportDelayMs"))
            }).then(() => {
                logger.info("Start importing %s history from %s to %s", exchangeName, start, end);
                if (exchange.supportsAutomaticImports() === false) {
                    logger.warn("%s doesn't support automatic imports", exchange.getClassName())
                    return Promise.resolve()
                }
                return exchange.importHistory(currencyPair, start, end);
            }).then(() => {
                logger.info("Imported %s history", exchange.getClassName())
                importDone();
                setTimeout(resolve.bind(this), 3000); // give the DB some time to store it
            }).catch((err) => {
                logger.error("Error importing %s history", exchange.getClassName(), err)
                importDone();
                reject({txt: "error importing history", exchange: exchange.getClassName()})
            })
        })
    }

    protected exitBacktest() {
        setTimeout(() => { // wait for message to parent
            process.exit(0)
        }, 1000)
    }

    protected buy(strategy: AbstractStrategy, reason: string, exchangeLabel: Currency.Exchange) {
        return new Promise<void>((resolve, reject) => {
            const coinPair = strategy.getAction().pair;
            let orderOps = [];
            if (!this.warmUpDone())
                return resolve();

            if (this.config.marginTrading) {
                for (let ex of this.exchanges)
                {
                    let exchange = ex[1];
                    if (this.skipExchange(exchange, exchangeLabel))
                        continue;
                    if (!exchange.marginTradingSupport())
                        continue

                    // this is also helplus because currently the bot just assumes to always have enough balance (so set initial balance higher than totalTradeBtc)
                    let oldPosition = this.getMarginPositionCopy(exchange, coinPair);
                    let buyBtc = strategy.getOrderAmount(this.getTotalTradeBtc(oldPosition, "buy"), exchange.getMaxLeverage());
                    if (this.skipTrade("buy", exchange, strategy, buyBtc) || this.skipTrend("buy"))
                        continue;
                    // there is no need for order parameters because in simulation our order will always go through
                    let orderParameters = {};
                    let rate = strategy.getRate();
                    if (strategy.forceMakeOnly()) {
                        if (rate === -1)
                            rate = strategy.getAvgMarketPrice();
                        orderParameters = {postOnly: true}
                    }
                    else if (rate === -1)
                        rate = strategy.getAvgMarketPrice();
                    const buyAmount = this.getMaxCoinAmount(exchange, strategy, buyBtc / rate, "buy");
                    if (this.skipBuy(exchange, strategy, buyAmount, rate))
                        continue;
                    orderOps.push(new Promise((resolve, reject) => {
                        exchange.marginBuy(coinPair, rate, buyAmount, orderParameters).then((orderResult) => {
                            logger.info("%s margin BUY trade with %s from %s: %s", this.className, coinPair.toString(), strategy.getClassName(), reason);
                            logger.info("rate %s, amount %s", rate, buyAmount);
                            logger.info(JSON.stringify(orderResult))
                            const buyAmountWithFees = this.extractFees(buyAmount, rate, true);
                            let position = this.updateMarginPosition(exchange, coinPair, buyAmountWithFees, rate);
                            this.checkMarginPositionChange(exchange, position, oldPosition);
                            const tradeBtc = strategy.getOrderAmount(this.getTotalTradeBtc(oldPosition, "buy"));
                            let tradeBtcDiff = tradeBtc;
                            if (oldPosition && oldPosition.type === position.type && Math.abs(oldPosition.amount) > Math.abs(position.amount))
                                tradeBtcDiff *= -1; // we reduced the size of our position
                            this.addMarginCollateral(exchange, tradeBtcDiff);
                            this.updateOrderBalance(tradeBtcDiff, orderResult.orderNumber);
                            // margin positions are leveraged. we can only add/deduct coins once we close the position
                            //PortfolioTrader.coinCurrencyBalance += buyAmountWithFees;
                            let order = Order.Order.getOrder(coinPair, exchange.getExchangeLabel(), buyAmountWithFees, rate, Trade.TradeType.BUY, orderResult.orderNumber.toString(), true)
                            order.leverage = exchange.getMaxLeverage();
                            order.marginPosition = position.type === "long" ? "long" : "short";
                            order.date = this.marketTime;
                            this.addOrder(exchange, order);
                            this.emitBuy(order, orderResult.resultingTrades.get(coinPair.toString()), {strategy: strategy, reason: reason, exchange: exchange});
                            this.logBalances();
                            this.lastTrade.setLastTrade(exchange.getClassName(), coinPair.toString(), strategy.getMarketTime());
                            this.totalBuyTrades++;
                            this.marketExposure.addState(coinPair.toString(), new MarketExposure("enter", this.marketTime));
                            this.watchOrder(exchange, strategy, order, orderParameters, orderResult);
                            resolve()
                        }).catch((err) => {
                            logger.error("Error on margin BUY %s in %s", coinPair.toString(), this.className, err);
                            resolve(); // continue
                        })
                    }))
                }
            }
            else {
                for (let balance of PortfolioTrader.coinBalances)
                {
                    let exchange = this.exchanges.get(balance[0]);
                    if (this.skipExchange(exchange, exchangeLabel))
                        continue;
                    let buyBtc = strategy.getOrderAmount(this.getTotalTradeBtc());

                    // safety checks
                    if (buyBtc > PortfolioTrader.baseCurrencyBalance)
                        buyBtc = PortfolioTrader.baseCurrencyBalance;
                    if (buyBtc < 0)
                        buyBtc = 0;

                    if (this.skipTrade("buy", exchange, strategy, buyBtc) || this.skipTrend("buy"))
                        continue;
                    let orderParameters = {};
                    let rate = strategy.getRate();
                    if (strategy.forceMakeOnly()) {
                        if (rate === -1)
                            rate = strategy.getAvgMarketPrice();
                        orderParameters = {postOnly: true}
                    }
                    else if (rate === -1)
                        rate = strategy.getAvgMarketPrice();
                    const buyAmount = this.getMaxCoinAmount(exchange, strategy, buyBtc / rate, "buy");
                    if (this.skipBuy(exchange, strategy, buyAmount, rate))
                        continue;
                    orderOps.push(new Promise((resolve, reject) => {
                        exchange.buy(coinPair, rate, buyAmount, orderParameters).then((orderResult) => {
                            logger.info("%s BUY trade with %s from %s: %s", this.className, coinPair.toString(), strategy.getClassName(), reason);
                            logger.info("rate %s, amount %s", rate, buyAmount);
                            logger.info(JSON.stringify(orderResult))
                            const buyAmountWithFees = this.extractFees(buyAmount, rate, true);
                            this.updateBalance(exchange, coinPair, buyAmountWithFees, rate);
                            PortfolioTrader.coinCurrencyBalance += buyAmountWithFees;
                            this.updateOrderBalance(buyBtc, orderResult.orderNumber);
                            let order = Order.Order.getOrder(coinPair, exchange.getExchangeLabel(), buyAmountWithFees, rate, Trade.TradeType.BUY, orderResult.orderNumber.toString(), false)
                            order.date = this.marketTime;
                            this.addOrder(exchange, order);
                            this.emitBuy(order, orderResult.resultingTrades.get(coinPair.toString()), {strategy: strategy, reason: reason, exchange: exchange});
                            this.logBalances();
                            this.lastTrade.setLastTrade(exchange.getClassName(), coinPair.toString(), strategy.getMarketTime());
                            this.totalBuyTrades++;
                            this.marketExposure.addState(coinPair.toString(), new MarketExposure("enter", this.marketTime));
                            this.watchOrder(exchange, strategy, order, orderParameters, orderResult);
                            resolve()
                        }).catch((err) => {
                            logger.error("Error on BUY %s in %s", coinPair.toString(), this.className, err);
                            resolve(); // continue
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
                for (let ex of this.exchanges)
                {
                    let exchange = ex[1];
                    if (this.skipExchange(exchange, exchangeLabel))
                        continue;
                    if (!exchange.marginTradingSupport())
                        continue
                    if (this.skipShortSell(exchange, coinPair))
                        continue;

                    let oldPosition = this.getMarginPositionCopy(exchange, coinPair);
                    let sellBtc = strategy.getOrderAmount(this.getTotalTradeBtc(oldPosition, "sell"), exchange.getMaxLeverage());
                    if (this.skipTrade("sell", exchange, strategy, sellBtc) || this.skipTrend("sell"))
                        continue;
                    let orderParameters = {};
                    let rate = strategy.getRate();
                    if (strategy.forceMakeOnly()) {
                        if (rate === -1)
                            rate = strategy.getAvgMarketPrice();
                        orderParameters = {postOnly: true}
                    }
                    else if (rate === -1)
                        rate = strategy.getAvgMarketPrice();
                    const sellAmount = this.getMaxCoinAmount(exchange, strategy, sellBtc / rate, "sell");
                    if (this.skipSell(exchange, strategy, sellAmount, rate))
                        continue;
                    orderOps.push(new Promise((resolve, reject) => {
                        exchange.marginSell(coinPair, rate, sellAmount, orderParameters).then((orderResult) => {
                            logger.info("%s margin SELL trade with %s from %s: %s", this.className, coinPair.toString(), strategy.getClassName(), reason);
                            logger.info("rate %s, amount %s", rate, sellAmount);
                            logger.info(JSON.stringify(orderResult))
                            const tradeBtc = strategy.getOrderAmount(this.getTotalTradeBtc(oldPosition, "sell"));
                            const sellAmountWithFees = this.extractFees(tradeBtc, -1, true);

                            let position = this.updateMarginPosition(exchange, coinPair, -1*sellAmount, rate);
                            this.checkMarginPositionChange(exchange, position, oldPosition);
                            let tradeBtcDiff = tradeBtc;
                            let sellAmountWithFeesDiff = sellAmountWithFees;
                            if (oldPosition && oldPosition.type === position.type && Math.abs(oldPosition.amount) > Math.abs(position.amount)) {
                                tradeBtcDiff *= -1; // we reduced the size of our position
                                //sellAmountWithFeesDiff *= -1;
                            }
                            this.addMarginCollateral(exchange, tradeBtcDiff);
                            if (strategy instanceof AbstractTakeProfitStrategy)
                                PortfolioTrader.baseCurrencyBalance += /*Math.abs(sellAmountWithFeesDiff)*/0; // added when closing the position
                            else if (position.type === "short" || sellAmountWithFees > 0)
                                PortfolioTrader.baseCurrencyBalance += -1*sellAmountWithFeesDiff; // we are doing short sells, reduce our assets
                            else
                                PortfolioTrader.baseCurrencyBalance += sellAmountWithFeesDiff;
                            //PortfolioTrader.coinCurrencyBalance -= sellAmount;
                            this.updateOrderBalance(tradeBtcDiff, orderResult.orderNumber, false);

                            let order = Order.Order.getOrder(coinPair, exchange.getExchangeLabel(), sellAmount, rate, Trade.TradeType.SELL, orderResult.orderNumber.toString(), true)
                            order.leverage = exchange.getMaxLeverage();
                            order.marginPosition = position.type === "long" ? "long" : "short";
                            order.date = this.marketTime;
                            this.addOrder(exchange, order);
                            this.emitSell(order, orderResult.resultingTrades.get(coinPair.toString()), {strategy: strategy, reason: reason, exchange: exchange});
                            this.logBalances();
                            this.lastTrade.setLastTrade(exchange.getClassName(), coinPair.toString(), strategy.getMarketTime());
                            this.totalSellTrades++;
                            this.marketExposure.addState(coinPair.toString(), new MarketExposure(position.type === "short" ? "enter" : "exit", this.marketTime));
                            this.watchOrder(exchange, strategy, order, orderParameters, orderResult);
                            resolve()
                        }).catch((err) => {
                            logger.error("Error on margin SELL %s in %s", coinPair.toString(), this.className, err);
                            resolve(); // continue
                        })
                    }))
                }
            }
            else {
                for (let balance of PortfolioTrader.coinBalances)
                {
                    let exchange = this.exchanges.get(balance[0]);
                    if (this.skipExchange(exchange, exchangeLabel))
                        continue;
                    let balances = PortfolioTrader.coinBalances.get(balance[0]);
                    let curBalance = balances[coinPair.to] // from is BTC
                    if (!curBalance) {
                        logger.warn("Nothing to sell for pair %s on %s", coinPair.toString(), exchange.getClassName())
                        continue; // nothing to sell
                    }
                    let orderParameters = {};
                    let rate = strategy.getRate();
                    if (strategy.forceMakeOnly()) {
                        if (rate === -1)
                            rate = strategy.getAvgMarketPrice();
                        orderParameters = {postOnly: true}
                    }
                    else if (rate === -1)
                        rate = strategy.getAvgMarketPrice();

                    if (curBalance * strategy.getAvgMarketPrice() > this.getMaxSellBtc())
                        curBalance = this.getMaxSellBtc() / strategy.getAvgMarketPrice();
                    let sellAmount = this.getMaxCoinAmount(exchange, strategy, strategy.getOrderAmount(curBalance), "sell"); // getMaxCoinAmount shouldn't be needed here
                    if (this.skipTrade("sell", exchange, strategy, sellAmount) || this.skipTrend("sell"))
                        continue;
                    if (this.skipSell(exchange, strategy, sellAmount, rate))
                        continue;
                    orderOps.push(new Promise((resolve, reject) => {
                        exchange.sell(coinPair, rate, sellAmount, orderParameters).then((orderResult) => {
                            logger.info("%s SELL trade with %s from %s: %s", this.className, coinPair.toString(), strategy.getClassName(), reason);
                            logger.info("rate %s, amount %s", rate, sellAmount);
                            logger.info(JSON.stringify(orderResult))
                            const sellBtc = sellAmount * rate;
                            const sellAmountWithFees = this.extractFees(sellBtc, -1, true);
                            this.updateBalance(exchange, coinPair, -1*sellAmount, rate);
                            PortfolioTrader.baseCurrencyBalance += sellAmountWithFees;
                            PortfolioTrader.coinCurrencyBalance -= sellAmount;
                            this.updateOrderBalance(sellBtc, orderResult.orderNumber);
                            let order = Order.Order.getOrder(coinPair, exchange.getExchangeLabel(), sellAmount, rate, Trade.TradeType.SELL, orderResult.orderNumber.toString(), false)
                            order.date = this.marketTime;
                            this.addOrder(exchange, order);
                            this.emitSell(order, orderResult.resultingTrades.get(coinPair.toString()), {strategy: strategy, reason: reason, exchange: exchange});
                            this.logBalances();
                            this.lastTrade.setLastTrade(exchange.getClassName(), coinPair.toString(), strategy.getMarketTime());
                            this.totalSellTrades++;
                            this.marketExposure.addState(coinPair.toString(), new MarketExposure("exit", this.marketTime));
                            this.watchOrder(exchange, strategy, order, orderParameters, orderResult);
                            resolve()
                        }).catch((err) => {
                            logger.error("Error on SELL %s in %s", coinPair.toString(), this.className, err);
                            resolve(); // continue
                        })
                    }))
                }
            }

            this.processTrades(orderOps, resolve)
        })
    }

    protected close(strategy: AbstractStrategy, reason: string, exchangeLabel: Currency.Exchange) {
        return new Promise<void>((resolve, reject) => {
            const coinPair = strategy.getAction().pair;
            let orderOps = [];
            if (!this.warmUpDone())
                return resolve();

            if (this.config.marginTrading) {
                for (let pos of PortfolioTrader.marginPositions)
                {
                    let exchange = this.exchanges.get(pos[0]);
                    if (this.skipExchange(exchange, exchangeLabel))
                        continue;
                    if (this.skipTrade("close", exchange, strategy))
                        continue;
                    let marginPositions = PortfolioTrader.marginPositions.get(pos[0]);
                    let balance = marginPositions.get(coinPair.toString());
                    if (!balance) {
                        logger.warn("Nothing to close for pair %s on %s", coinPair.toString(), exchange.getClassName())
                        continue; // nothing to close
                    }
                    const rate = strategy.getAvgMarketPrice(); // we can only close at the current rate
                    balance.computePl(rate);
                    orderOps.push(new Promise((resolve, reject) => {
                        exchange.closeMarginPosition(coinPair).then((orderResult) => {
                            logger.info("%s margin CLOSE trade with %s from %s: %s", this.className, coinPair.toString(), strategy.getClassName(), reason);
                            logger.info("amount %s, rate %s, profit/loss %s", balance.amount, this.marketRates.get(coinPair.toString()), balance.pl);
                            logger.info(JSON.stringify(orderResult))
                            this.closeMarginPosition(exchange, coinPair, rate)
                            // how about fees on profit/loss? fees in general need to be improved // TODO simulate maker/taker fees?
                            //PortfolioTrader.baseCurrencyBalance += this.extractFees(this.config.tradeTotalBtc, -1, true) + balance.pl;
                            // we always use max leverage
                            //PortfolioTrader.baseCurrencyBalance += this.extractFees((balance.amount * rate) /exchange.getMaxLeverage(), -1, true) + balance.pl;
                            //PortfolioTrader.baseCurrencyBalance += this.extractFees((balance.getPositionValue(rate)), -1, true) / exchange.getMaxLeverage();
                            const amountBtc = this.closeMarginCollateral(exchange);
                            const closeAmountWithFees = this.extractFees(amountBtc, -1, true);
                            PortfolioTrader.baseCurrencyBalance += closeAmountWithFees + balance.pl;
                            PortfolioTrader.coinCurrencyBalance = 0; // we closed the position
                            //this.updateOrderBalance(sellBtc, orderResult.orderNumber); // no possible refund after a close
                            let order = Order.Order.getOrder(coinPair, exchange.getExchangeLabel(), balance.amount, 0, Trade.TradeType.CLOSE, orderResult.orderNumber.toString(), true)
                            order.date = this.marketTime;
                            order.closePosition = balance.type === "long" ? "long" : "short";
                            //this.addOrder(exchange, order); // we don't specify a price. close can either fail or get through at a variable price
                            this.emitClose(order, orderResult.resultingTrades.get(coinPair.toString()), {strategy: strategy, pl: balance.pl, reason: reason, exchange: exchange});
                            this.logBalances();
                            if (!nconf.get('serverConfig:canTradeImmediatelyAfterClose'))
                                this.lastTrade.setLastTrade(exchange.getClassName(), coinPair.toString(), strategy.getMarketTime());
                            this.countMarginTrade(balance);
                            this.marketExposure.addState(coinPair.toString(), new MarketExposure("exit", this.marketTime));
                            resolve()
                        }).catch((err) => {
                            logger.error("Error on margin CLOSE %s in %s", coinPair.toString(), this.className, err);
                            resolve(); // continue
                        })
                    }))
                }
            }
            // else there is nothing to do

            this.processTrades(orderOps, resolve)
        })
    }

    protected processTrades(orderOps: Promise<void>[], resolve) {
        if (process.env.IS_CHILD && PortfolioTrader.marginPositions.getMarginPositionCount() === 0) {
            let startBaseEquivalent = this.startBaseBalance + this.startCoinBalance * this.startCoinRate
            let currentBaseEquivalent = PortfolioTrader.baseCurrencyBalance + PortfolioTrader.coinCurrencyBalance * this.currentCoinRate
            const percentDiff = Math.abs(helper.getDiffPercent(currentBaseEquivalent, startBaseEquivalent))
            // if it's 0 we are "all in"
            if (currentBaseEquivalent > 0.01 && currentBaseEquivalent < startBaseEquivalent && percentDiff > nconf.get("abortBacktestEarlyBalancePercent")) {
                logger.warn("Aborting backtest early because balance is less than %s% of start balance. current: %s", percentDiff, currentBaseEquivalent)
                process.exit(1)
            }
        }
        super.processTrades(orderOps, resolve)
        //this.syncPortfolio(exchange); // TODO make sure balance is updated immediately AFTER the order is executed
    }

    protected updatePortfolio() {
        return new Promise<void>((resolve, reject) => {
            this.cancelOpenOrders().then(() => {
                let updateOps = []
                for (let ex of AbstractTrader.globalExchanges)
                {
                    updateOps.push(this.updateBacktestExchange(ex[1]))
                }
                return Promise.all(updateOps)
            }).then(() => {
                resolve()
            }).catch((err) => {
                logger.error("Error updating portfolio", err)
                resolve()
            })
        })
    }

    protected cancelOpenOrders() {
        return new Promise<void>((resolve, reject) => {
            const now = this.marketTime.getTime();
            let cancelOps = [];
            for (let ord of PortfolioTrader.submittedOrders)
            {
                let exchange = this.exchanges.get(ord[0]);
                ord[1].forEach((order) => {
                    if (order.date.getTime() + nconf.get('serverConfig:orderTimeoutSec')*1000 > now)
                        return;

                    // cancel it and return the balance
                    if (order.marginOrder)
                        cancelOps.push(exchange.marginCancelOrder(order.currencyPair, order.orderID));
                    else
                        cancelOps.push(exchange.cancelOrder(order.currencyPair, order.orderID));
                    this.refundOrder(order, exchange);
                })
            }
            if (cancelOps.length !== 0)
                logger.verbose("Cancelling %s possibly unfilled orders in %s", cancelOps.length, this.className)
            Promise.all(cancelOps).then((results) => {
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

    protected updateBacktestExchange(exchange: AbstractExchange) {
        return new Promise<void>((resolve, reject) => {
            // only forward/sync margin positions to strategies
            // balances are kept and updated in backtester directly
            // static timestamp, but there is only 1 exchange during backtesting
            if (!this.marketTime)
                return resolve() // wait until we have a market time
            else if (!PortfolioTrader.lastMarginPositionUpdateMs.has(exchange.getClassName())) {
                PortfolioTrader.lastMarginPositionUpdateMs.set(exchange.getClassName(), this.marketTime.getTime()); // first
                return resolve()
            }
            else if (!PortfolioTrader.lastMarginPositionUpdateMs.runNextUpdate(exchange.getClassName(), this.marketTime.getTime()))
                return resolve()

            PortfolioTrader.lastMarginPositionUpdateMs.set(exchange.getClassName(), this.marketTime.getTime());
            this.syncPortfolio(exchange);
            resolve()
        })
    }

    protected executeOrders(trades: Trade.Trade[]) {
        // we check if trades passed the price threshold of any of our orders and then simulate our orders as executed
        // TODO also check the volume and only execute our orders partially if we trade large amounts
        // we ignore currencies here for simplicity, simulation only happens with 1 currency pair at a time
        if (this.previousTrade === null) {
            this.previousTrade = trades[0]
            if (trades.length === 1)
                return;
        }

        let execute = (exchangeName, orderID) => {
            this.removeOrder(exchangeName, orderID);
        }
        for (let ord of PortfolioTrader.submittedOrders)
        {
            let exchange = this.exchanges.get(ord[0]);
            ord[1].forEach((order: Order.Order) => {
                trades.forEach((trade) => {
                    if (order.type === Trade.TradeType.BUY) {
                        if (trade.rate <= order.rate)
                            execute(ord[0], order.orderID);
                    }
                    else if (order.type == Trade.TradeType.SELL) {
                        if (trade.rate >= order.rate)
                            execute(ord[0], order.orderID);
                    }
                    this.previousTrade = trade;
                })
            })
        }
        this.tracker.sendTick(trades)
    }

    protected updateOrderBalance(amountBtc: number, orderID: string | number, subtract = true) {
        if (subtract)
            PortfolioTrader.baseCurrencyBalance -= amountBtc;
        //else
            //PortfolioTrader.baseCurrencyBalance += amountBtc;
        if (typeof orderID === "number")
            orderID = orderID.toString();
        if (amountBtc < 0)
            amountBtc *= -1; // only store positive values to make refunds easier
        this.pendingOrders.set(orderID, amountBtc); // we currently don't delete entries here, but order numbers are unique
    }

    protected refundOrder(submittedOrder: Order.Order, exchange: AbstractExchange) {
        // TODO refund with taker fees from specific exchange instead of AbstractExchange.DEFAULT_MAKER_FEE
        // fees in our simulation have already been deducted when we submitted the order
        let order = _.cloneDeep(submittedOrder);
        /*
        if (order.marginOrder) {
            /*
            if (PortfolioTrader.marginPositions.getMarginPositionCount() > 0) {
                // assume TakeProfit // TODO improve
                order.amount *= -1;
                if (order.type === Trade.TradeType.BUY)
                    order.type = Trade.TradeType.SELL;
                else if (order.type === Trade.TradeType.SELL)
                    order.type = Trade.TradeType.BUY;
                logger.verbose("Assuming TakeProfit strategy on margin order and reversing buy/sell for balance calculation with order ID: %s", order.orderID);
            }
            ***
            if (order.type === Trade.TradeType.BUY) {
                PortfolioTrader.baseCurrencyBalance += order.amount * order.rate / order.leverage;
            }
            else if (order.type === Trade.TradeType.SELL) {
                if (order.marginPosition === "short")
                    PortfolioTrader.baseCurrencyBalance -= -1*(order.amount * order.rate / order.leverage); // short sells reduce our assets, now add them back
                else
                    PortfolioTrader.baseCurrencyBalance -= order.amount * order.rate / order.leverage;
            }
            else // margin close is either successful or fails. it can not wait for a taker
                logger.error("Can not refund margin close order in %s", this.className, order)
            this.closeMarginPosition(exchange, order.currencyPair, order.rate) // or use current rate? but doesn't really matter since the order never went through
            this.closeMarginCollateral(exchange);
        }
        else {
            // TODO add trading fees back too
            if (order.type === Trade.TradeType.BUY) {
                PortfolioTrader.baseCurrencyBalance += order.amount * order.rate;
                PortfolioTrader.coinCurrencyBalance -= order.amount;
            }
            else if (order.type === Trade.TradeType.SELL) {
                PortfolioTrader.baseCurrencyBalance -= order.amount * order.rate;
                PortfolioTrader.coinCurrencyBalance += order.amount;
            }
            else
                logger.error("Invalid non-margin order found in %s", this.className, order)
        }
        */
        let refundBalanceBtc = this.pendingOrders.get(order.orderID);
        if (refundBalanceBtc === undefined)
            return logger.error("Order with ID %s to refund doesn't exist. Balances are wrong", order.orderID);
        PortfolioTrader.baseCurrencyBalance += refundBalanceBtc;
        PortfolioTrader.coinCurrencyBalance -= refundBalanceBtc / order.rate;

        //this.emitClose(order, [], {strategy: {}, pl: 0.0, reason: "cancelled order", exchange: exchange});
        //this.emit("close", order, [], {strategy: {}, pl: 0.0, reason: "cancelled order", exchange: exchange});
        // TODO buggy if TakeProfitPartial fires now
        this.closeMarginPosition(exchange, submittedOrder.currencyPair, submittedOrder.rate) // ensure we don't refund twice
        this.closeMarginCollateral(exchange);
        //PortfolioTrader.marginPositions.set(exchange.getClassName(), new MarginPositionList()); // simply clear all
        logger.info("Refunded order:", order);
        this.logBalances("cancelled order");

        // TODO find a way to properly send close event to strategies (also on RealTimeTrader)
        let positions = PortfolioTrader.marginPositions.get(exchange.getClassName())
        if (!positions.has(order.currencyPair.toString()))
            this.emitClose(order, [], {strategy: this.lastTradeStrategy, pl: 0, reason: "cancelled order", exchange: exchange}); // to reset strategy values such as "done"
    }

    /**
     * Update our balance
     * @param exchange
     * @param currencyPair
     * @param amount the amount we bought/sold. Use negative values for sells.
     * @param rate
     */
    protected updateBalance(exchange: AbstractExchange, currencyPair: Currency.CurrencyPair, amount: number, rate: number) {
        let balances = PortfolioTrader.coinBalances.get(exchange.getClassName());
        let curBalance = balances[currencyPair.to] // from is BTC
        curBalance += amount;
        balances[currencyPair.to] = curBalance;
    }

    protected updateMarginPosition(exchange: AbstractExchange, currencyPair: Currency.CurrencyPair, amount: number, rate: number) {
        let position = PortfolioTrader.marginPositions.get(exchange.getClassName()).get(currencyPair.toString())
        if (!position) {
            position = new MarginPosition(exchange.getMaxLeverage());
            PortfolioTrader.marginPositions.get(exchange.getClassName()).set(currencyPair.toString(), position)
        }
        position.amount += amount;
        position.type = position.amount > 0 ? "long" : "short";
        position.addTrade(amount, rate);
        return position;
        // TODO lending fees for margin positions
        // TODO consider forced liquidation (we always work with stop loss for now)
    }

    protected closeMarginPosition(exchange: AbstractExchange, currencyPair: Currency.CurrencyPair, rate: number) {
        let position = PortfolioTrader.marginPositions.get(exchange.getClassName()).get(currencyPair.toString())
        if (position) {
            position.computePl(rate);
            PortfolioTrader.marginPositions.get(exchange.getClassName()).delete(currencyPair.toString());
        }
        return position;
    }

    /**
     * Extract fees from a sell or buy order
     * @param amount the amount in base currency (SELL) or coins (BUY)
     * @param rate for BUY trades. add the rate at which we bought (to calculate fees in base currency)
     * @param updateTotalFees add those fees to our total spent fees
     * @returns {number} the bought/sold amount minus fees
     */
    protected extractFees(amount: number, rate: number = -1, updateTotalFees = false) {
        // most exchanges will cut off balances after 8 decimals
        // TODO count trading volume in btc & coin
        let originalAmount = amount;
        amount *= 100000000;
        amount *= this.feeFactor;
        amount = Math.floor(amount);
        amount /= 100000000;
        if (updateTotalFees === true) {
            let feesBase = originalAmount - amount;
            if (rate !== -1)
                feesBase *= rate;
            this.totalFeesBase += feesBase;
        }
        return amount;
    }

    protected skipTrade(action: TradeAction, exchange: AbstractExchange, strategy: AbstractStrategy, amountBtc: number = -1) {
        const currencyPair = strategy.getAction().pair.toString();
        const exchangeName = exchange.getClassName();

        // check simulation balance
        if (action === "buy") {
            if (this.config.marginTrading) {
                // here we already checked that this exchange supports margin trading
                let position = PortfolioTrader.marginPositions.get(exchangeName).get(currencyPair.toString());
                let totalEquitiyWorth = PortfolioTrader.baseCurrencyBalance; // we can't leverage with the coins we already bought
                if (position && position.type === "short")
                    totalEquitiyWorth += position.getPositionValue(strategy.getAvgMarketPrice());
                if (totalEquitiyWorth*exchange.getMaxLeverage() - amountBtc < 0) {
                    logger.error("Insufficient collateral to simulate margin %s trade from %s in %s, buy %s, available %s, time %s", action, strategy.getClassName(), this.className, amountBtc.toFixed(8), totalEquitiyWorth.toFixed(8), utils.getUnixTimeStr(false, this.marketTime))
                    return true;
                }
            }
            else {
                // we only trade with available balance, otherwise: Insufficient balance to simulate buy trade at rate in 0.000001565056063525146524, buy Backtester, available 1.89120959 1.89120959
                /*
                if (PortfolioTrader.baseCurrencyBalance - amountBtc < 0) {
                    logger.error("Insufficient balance to simulate %s trade in %s, buy %s, available %s", action, this.className, amountBtc.toFixed(8), PortfolioTrader.baseCurrencyBalance.toFixed(8))
                    return true;
                }
                */
            }
        }
        // also see skipSell() below

        const key = LastTradeMap.getKey(exchangeName, currencyPair);
        let lastTrade = this.lastTrade.get(key);
        if (!lastTrade)
            return super.skipTrade(action, exchange, strategy, amountBtc); // we still have to check for other conditions in parent class
        if (action !== "close" || !nconf.get('serverConfig:canAlwaysClose')) {
            if (lastTrade.getTime() + nconf.get('serverConfig:holdMin') * utils.constants.MINUTE_IN_SECONDS * 1000 > strategy.getMarketTime().getTime()) {
                const passed = utils.test.getPassedTime(lastTrade.getTime(), strategy.getMarketTime().getTime())
                logger.info("Skipping %s trade in %s on %s for %s because we traded recently. last trade %s ago", action, this.className, exchangeName, currencyPair, passed)
                return true;
            }
        }
        return super.skipTrade(action, exchange, strategy, amountBtc);
    }

    protected skipBuy(exchange: AbstractExchange, strategy: AbstractStrategy, buyCoinAmount: number, rate: number) {
        // in simulation we have to check if we can actually afford to buy those coins at the given rate
        const currencyPair = strategy.getAction().pair.toString();
        const exchangeName = exchange.getClassName();

        const buyBaseAmount = buyCoinAmount*rate;
        if (this.config.marginTrading) {
            let position = PortfolioTrader.marginPositions.get(exchangeName).get(currencyPair.toString());
            let totalEquitiyWorth = PortfolioTrader.baseCurrencyBalance; // we can't leverage with the coins we already bought
            if (position && position.type === "short")
                totalEquitiyWorth += position.getPositionValue(strategy.getAvgMarketPrice());
            if (totalEquitiyWorth*exchange.getMaxLeverage() - buyBaseAmount < 0) {
                logger.error("SkipBuy - Insufficient collateral to simulate margin buy trade from %s at rate %s in %s, buy %s, available %s, time %s", strategy.getClassName(), rate.toString(8), this.className, buyBaseAmount.toFixed(8), totalEquitiyWorth.toFixed(8), utils.getUnixTimeStr(false, this.marketTime))
                return true;
            }
        }
        else {
            /*
            if (PortfolioTrader.baseCurrencyBalance - buyBaseAmount < 0) {
                logger.error("Insufficient balance to simulate buy trade at rate in %s, buy %s, available %s", rate.toString(8), this.className, buyBaseAmount.toFixed(8), PortfolioTrader.baseCurrencyBalance.toFixed(8))
                return true;
            }
            */
        }
        return false;
    }

    protected skipSell(exchange: AbstractExchange, strategy: AbstractStrategy, sellCoinAmount: number, rate: number) {
        const currencyPair = strategy.getAction().pair.toString();
        const exchangeName = exchange.getClassName();

        if (this.config.marginTrading) {
            // check if we have enough collateral to do short selling
            // TODO really correct? also depends on how exchanges handle the currently borrowed coins
            // this assumes we always sell the same coins we bought
            let position = PortfolioTrader.marginPositions.get(exchangeName).get(currencyPair.toString());
            let totalEquitiyWorth = PortfolioTrader.baseCurrencyBalance/* + PortfolioTrader.coinCurrencyBalance*rate*/;
            if (position && position.type === "long")
                totalEquitiyWorth += position.getPositionValue(strategy.getAvgMarketPrice()); // here use the actual current rate and not the price we want to sell for
            // TODO multiple positions
            let sellBaseAmount = sellCoinAmount*rate;
            if (totalEquitiyWorth*exchange.getMaxLeverage() - sellBaseAmount < 0) {
                logger.error("Insufficient collateral to simulate short sell trade in %s, sell %s, available %s, time %s", this.className, sellBaseAmount.toFixed(8), totalEquitiyWorth.toFixed(8), utils.getUnixTimeStr(false, this.marketTime))
                return true;
            }
        }
        else {
            // check if we have enough coins
            // on non-margin we only sell as much coins as we have
            // with this check we get: Insufficient balance to simulate sell trade in Backtester, sell 9.70811201, available 9.67898761
            /*
            if (PortfolioTrader.coinCurrencyBalance - sellCoinAmount < 0) {
                logger.error("Insufficient balance to simulate sell trade in %s, sell %s, available %s", this.className, sellCoinAmount.toFixed(8), PortfolioTrader.coinCurrencyBalance.toFixed(8))
                return true;
            }
            */
        }
        return false;
    }

    protected watchOrder(exchange: AbstractExchange, strategy: AbstractStrategy, order: Order.Order, orderParameters: OrderParameters, orderResult: OrderResult) {
        const pendingOrder = new PendingOrder(exchange, strategy, order, orderParameters, orderResult);
        this.tracker.track(pendingOrder);
    }

    protected getTotalTradeBtc(existingMarginPosition: MarginPosition = null, action: TradeAction = null) {
        // for simulation the option to go "all in" makes more sence
        // we always want to use the currently max available balance instead of tradeTotalBtc to be able to
        // evaluate our portfolio against buy & hold in the end
        if (this.config.tradeTotalBtc !== 0)
            return this.config.tradeTotalBtc;
        let amountBtc = PortfolioTrader.baseCurrencyBalance;
        if (existingMarginPosition && action) {
            if (action === "buy" && existingMarginPosition.type === "short")
                amountBtc += existingMarginPosition.getPositionValue(this.currentCoinRate) / existingMarginPosition.leverage;
            else if (action === "sell" && existingMarginPosition.type === "long")
                amountBtc += existingMarginPosition.getPositionValue(this.currentCoinRate) / existingMarginPosition.leverage;
        }
        return amountBtc;
    }

    protected checkMarginPositionChange(exchange: AbstractExchange, position: MarginPosition, oldPosition: MarginPosition) {
        if (oldPosition && position.type !== oldPosition.type) {
            // simply treat our balance as if we closed the old position. coins stay at the same value until close
            const msg = utils.sprintf("Margin position changed from %s to %s, new amount %s", oldPosition.type, position.type, position.amount.toFixed(8))
            logger.warn(msg);
            this.writeLogLine(msg);
            let tradeBtc = PortfolioTrader.marginCollateral.get(exchange.getClassName());
            this.closeMarginCollateral(exchange);
            if (tradeBtc) { // free our collateral
                const closeAmountWithFees = this.extractFees(tradeBtc, -1, true);
                PortfolioTrader.baseCurrencyBalance += closeAmountWithFees + oldPosition.pl;
            }
        }
    }

    protected simulateCloseAllMarginPositions(closeRate: number) {
        // TODO support for multiple rates in case we run multiple backtests in parallel
        for (let pos of PortfolioTrader.marginPositions)
        {
            let exchange = this.exchanges.get(pos[0]);
            let marginPositions = PortfolioTrader.marginPositions.get(pos[0]); // all positions of 1 exchange
            for (let bal of marginPositions)
            {
                let balance = bal[1];
                balance.computePl(closeRate);
                logger.info("Simulate %s margin CLOSE trade with %s", this.className, bal[0]);
                const amountBtc = this.closeMarginCollateral(exchange);
                const closeAmountWithFees = this.extractFees(amountBtc, -1, true);
                PortfolioTrader.baseCurrencyBalance += closeAmountWithFees + balance.pl;
                PortfolioTrader.coinCurrencyBalance = 0; // we closed the position
                // should we emit close() to write it into the trade log?
            }
        }
    }

    protected containsTakeProfitPartialStrategies() {
        let strategies = this.tradeAdvisor.getStrategies();
        for (let strat of strategies)
        {
            if (strat[1] instanceof AbstractTakeProfitStrategy) {
                if (strat[0].toLocaleLowerCase().indexOf("partial") !== -1)
                    return true; // TODO improve this, actually checking the strategy config
            }
        }
        return false;
    }

    protected emitBuy(order: Order.Order, trades: Trade.Trade[], info?: TradeInfo) {
        this.lastTradeStrategy = info.strategy;
        super.emitBuy(order, trades, info);
    }

    protected emitSell(order: Order.Order, trades: Trade.Trade[], info?: TradeInfo) {
        this.lastTradeStrategy = info.strategy;
        super.emitSell(order, trades, info);
    }

    protected emitClose(order: Order.Order, trades: Trade.Trade[], info?: TradeInfo) {
        this.lastTradeStrategy = info.strategy;
        super.emitClose(order, trades, info);
    }
}