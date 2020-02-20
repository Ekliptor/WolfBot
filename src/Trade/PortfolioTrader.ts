import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractTrader, BotTrade, TradeInfo} from "./AbstractTrader";
import {ConfigCurrencyPair, TradeConfig} from "../Trade/TradeConfig";
import {AbstractStrategy, TradeAction} from "../Strategies/AbstractStrategy";
import {AbstractExchange, ExchangeMap} from "../Exchanges/AbstractExchange";
import {MarginPosition, MarginPositionList} from "../structs/MarginPosition";
import TradeAdvisor from "../TradeAdvisor";
import {Currency, Order, Candle, Trade} from "@ekliptor/bit-models";
import * as path from "path";
import * as fs from "fs";
import {AbstractTakeProfitStrategy} from "../Strategies/AbstractTakeProfitStrategy";
import {AbstractStopStrategy} from "../Strategies/AbstractStopStrategy";
import {AbstractArbitrageStrategy} from "../Arbitrage/Strategies/AbstractArbitrageStrategy";
import {ArbitrageConfig} from "../Arbitrage/ArbitrageConfig";
import {TradePosition} from "../structs/TradePosition";
import {PendingOrder} from "./AbstractOrderTracker";
import {Portfolio} from "../structs/Portfolio";

//export type BotEvaluation = any;
export type BotTradeFullDay = string; // 2017-11-01 - unix time string, see utils.getUnixTimeStr()
export interface BotEvaluation {
    startCoinEquivalent: number;
    currentCoinEquivalent: number;
    startBaseEquivalent: number;
    currentBaseEquivalent: number;
    totalFeesBase: number;
    trades: {
        totalBuy: number;
        winningBuy: number;
        losingBuy: number;
        totalSell: number;
        winningSell: number;
        losingSell: number;
    }
    marketExposureTime: {
        start: BotTradeFullDay;
        end: BotTradeFullDay;
        hours: number;
        days: number;
        percent: number;
    }
    strategies: {
        [pair: string/*ConfigCurrencyPair*/]: {
            [strategyName: string]: {
                [strategyInfo: string]: any
            }
        }
    }
    efficiency: number;
    efficiencyPercent: number;
    marketEfficiencyPercent: number;
    startCoinRate: number;
    endCoinRate: number;
    botEfficiencyPercent: number;
    botVsMarketPercent: number;
}

export class CoinMap extends Map<string, Currency.LocalCurrencyList> { // (exchange name, balance)
    constructor(iterable?: Iterable<[string, Currency.LocalCurrencyList]>) {
        super(iterable)
    }

    public getCoinBalanceCount() {
        let count = 0;
        for (let coin of this)
        {
            let exchangeCoins: Currency.LocalCurrencyList = coin[1];
            for (let key in exchangeCoins)
            {
                const balance = exchangeCoins[key];
                if (balance != 0.0)
                    count++;
            }
        }
        return count;
    }
}
export class MarginPositionMap extends Map<string, MarginPositionList> { // (exchange name, balance)
    constructor(iterable?: Iterable<[string, MarginPositionList]>) {
        super(iterable)
        for (let pos of this) // ensure proper class after serialization
        {
            if (pos[1] instanceof MarginPositionList === false) {
                let list = new MarginPositionList();
                pos[1].forEach((arr) => {
                    const pairStr = arr[0];
                    const currentPos = arr[1];
                    let singleMarginPosition: MarginPosition = Object.assign(new MarginPosition(currentPos.leverage), currentPos);
                    singleMarginPosition.initTrades();
                    list.set(pairStr, singleMarginPosition);
                });
                utils.objects.OBJECT_OVERWRITES.forEach((key) => {
                    for (let entry of list) {
                        if (entry[0] === key)
                            list.delete(key);
                    }
                });
                this.set(pos[0], list); // (exchange name, positions)
            }
        }
    }

    public getMarginPositionCount() {
        let count = 0;
        for (let pos of this)
            count += pos[1].size;
        return count;
    }

    public listPositions() {
        let positions = "";
        for (let pos of this)
        {
            let marginList = pos[1];
            for (let pairPos of marginList)
            {
                if (positions != "")
                    positions += ", ";
                positions += utils.sprintf("%s %s %s", pairPos[0], pairPos[1].amount, pairPos[1].type)
            }
        }
        return positions;
    }
}
export class MarginCollateralMap extends Map<string, number> { // (exchange name, collateral in base currency)
    constructor() {
        super()
    }
}
export class OrderMap extends Map<string, Order.Order[]> { // (exchange name, orders)
    constructor() {
        super()
    }
}

export class LastTradeMap extends Map<string, Date> { // (getKey(), lastTrade)
    constructor() {
        super()
    }
    public setLastTrade(exchangeName: string, currencyPair: string, date = null) {
        if (!date)
            date = new Date();
        const key = LastTradeMap.getKey(exchangeName, currencyPair);
        this.set(key, date);
    }
    public static getKey(exchangeName: string, currencyPair: string) {
        return exchangeName + "-" + currencyPair;
    }
}

export class MarketExposure {
    type: "enter" | "exit";
    date: Date;
    constructor(type: "enter" | "exit", date) {
        this.type = type;
        this.date = date;
    }
}
export class MarketExposureMap extends Map<string, MarketExposure[]> { // (currency pair, orders)
    constructor() {
        super()
    }

    public addState(currencyPair: string, state: MarketExposure) {
        let states = this.get(currencyPair)
        if (!states) {
            states = [state]
            this.set(currencyPair, states)
            return true;
        }

        let lastState = states[states.length-1];
        if (lastState.type === state.type)
            return false; // we already are in that state
        states.push(state)
        this.set(currencyPair, states)
        return true;
    }

    public getTotalExposureTimeMin() {
        let total = 0;
        for (let exp of this)
            total += this.getExposureTimeMin(exp[0])
        return total;
    }

    public getExposureTimeMin(currencyPair: string) {
        let total = 0;
        let states = this.get(currencyPair)
        for (let i = 1; i < states.length; i += 2)
        {
            if (states[i-1].type === "enter" && states[i].type === "exit") {
                let exposure = states[i].date.getTime() - states[i-1].date.getTime();
                if (exposure > 0)
                    total += exposure / (utils.constants.MINUTE_IN_SECONDS * 1000);
            }
            else
                logger.error("Inconsistent states for market exposure time found", states)
        }
        return total;
    }
}

export class ExchangePairMap extends Map<string, string[]> { // (exchange name, supported pairs)
    protected traderMap = new Map<string, PortfolioTrader>(); // (exchange-pair, instance)

    constructor() {
        super()
    }

    public addPair(exchangeName: string, pairStr: string) {
        let pairs = this.get(exchangeName);
        if (!pairs)
            pairs = [];
        if (pairs.indexOf(pairStr) === -1)
            pairs.push(pairStr);
        this.set(exchangeName, pairs);
    }

    public addInstance(exchangeName: string, pairStr: string, trader: PortfolioTrader) {
        const key = this.getInstanceKey(exchangeName, pairStr);
        if (this.traderMap.has(key))
            logger.error("There is already a trading pair %s on %s. Multiple trading pairs on the same exchange are not supported (even with margin trading)", pairStr, exchangeName)
        this.traderMap.set(key, trader);
    }

    public getInstance(exchangeName: string, pairStr: string): PortfolioTrader {
        const key = this.getInstanceKey(exchangeName, pairStr);
        return this.traderMap.get(key);
    }

    public getExchangeInstanceByLabel(exchangeLabel: Currency.Exchange, pairStr: string): AbstractExchange {
        for (let tr of this.traderMap)
        {
            let exchangePair = tr[0].split("-")[1];
            if (exchangePair === pairStr) {
                let trader: PortfolioTrader = tr[1];
                let exchanges = trader.getExchanges();
                for (let ex of exchanges)
                {
                    if (ex[1].getExchangeLabel() === exchangeLabel)
                        return ex[1];
                }
            }
        }
        return null;
    }

    public hasPair(exchangeName: string, pairStr: string) {
        let pairs = this.get(exchangeName);
        return pairs && pairs.indexOf(pairStr) !== -1;
    }

    protected getInstanceKey(exchangeName: string, pairStr: string/*, configNr: number*/) {
        return exchangeName + "-" + pairStr;
    }
}
export class MarginPositionUpdateMap extends Map<string, number> { // (exchange name, timestamp)
    public isFirstApiCall = true;

    constructor() {
        super()
    }

    public runNextUpdate(exchangeName: string, marketTimeMs: number) {
        let lastMs = this.get(exchangeName);
        if (!lastMs)
            lastMs = 0;
        return lastMs + nconf.get("serverConfig:updateMarginPositionsSec")*1000 < marketTimeMs;
    }
}

export abstract class PortfolioTrader extends AbstractTrader {
    // we use 1 Trader instance per currency config. however, for balances, margin positions etc we fetch the data from the exchange together
    // so we use static variables
    protected static coinBalances = new CoinMap();
    protected static marginPositions = new MarginPositionMap();
    protected static marginCollateral = new MarginCollateralMap();
    protected static submittedOrders = new OrderMap(); // to cancel orders that don't fill in time
    protected static updatePortfolioTimerID: NodeJS.Timer = null;
    protected static lastMarginPositionUpdateMs = new MarginPositionUpdateMap();
    protected static baseCurrencyBalance = 1.0; // BTC or USD usually. currently only used for backtesting // TODO follow balance in real mode
    protected static coinCurrencyBalance = 0.0;
    protected static allMarkets = new Set<string>(); // set with all currencies
    protected static allExchangePairs = new ExchangePairMap();

    // stats
    protected startBaseBalance = -1;
    protected startCoinBalance = -1;
    protected startCoinRate = -1;
    //protected startTime: Date = null; // use start and marketTime
    protected currentCoinRate = -1;
    protected totalFeesBase = 0;

    // count total trades separately cause the simulation might end with an open position
    // winning/losing only counts margin positions (when closing them) because our strategy might buy repeatedly without ever selling
    protected totalBuyTrades = 0;
    protected winningBuyTrades = 0;
    protected losingBuyTrades = 0;
    protected totalSellTrades = 0;
    protected winningSellTrades = 0;
    protected losingSellTrades = 0;
    protected marketExposure = new MarketExposureMap();

    protected maxCandles = new Map<string, Candle.Candle[]>(); // (currency pair, candles with max interval)
    protected myTrades = new Map<string, BotTrade[]>();
    protected savePortfolioQueue = Promise.resolve(); // mutex

    protected lastTrade = new LastTradeMap(); // a map with the date of the last trade. use strategy.getMarketTime() if not in realtime mode

    constructor(config: TradeConfig) {
        super(config)
        if (process.env.IS_CHILD && process.env.BACKFINDER)
            this.logPath = path.join(utils.appDir, nconf.get("tradesDir"), nconf.get("backfindDir")); // relative to working dir
        else
            this.logPath = path.join(utils.appDir, nconf.get("tradesDir"));
        this.logPath = path.join(this.logPath, this.className + "-" + config.name + ".log")
        if (this.className !== nconf.get("serverConfig:tradeNotifierClass")) {
            let markets = this.config.markets.map(m => m.toString()); // usually only 1 pair per instance
            markets.forEach((pairStr) => {
                PortfolioTrader.allMarkets.add(pairStr)
                this.config.exchanges.forEach((exchange) => {
                    PortfolioTrader.allExchangePairs.addPair(exchange, pairStr)
                    PortfolioTrader.allExchangePairs.addInstance(exchange, pairStr, /*this.config.configNr,*/ this) // multiple entries for instance // TODO ok?
                })
            });

            setTimeout(async () => {
                await this.loadPortfolio();
                // can not be empty (or else assumed not initialized)
                this.config.exchanges.forEach((exchange) => {
                    if (PortfolioTrader.marginPositions.has(exchange) === false)
                        PortfolioTrader.marginPositions.set(exchange, new MarginPositionList());
                    if (PortfolioTrader.coinBalances.has(exchange) === false) {
                        let coins = {}
                        this.config.markets.forEach((market) => {
                            let baseCurrency = market.from;
                            let startBalance = nconf.get('serverConfig:backtest:startBalance');
                            if (Currency.isFiatCurrency(baseCurrency) === true)
                                startBalance *= 1000;
                            coins[baseCurrency] = startBalance;
                        });
                        PortfolioTrader.coinBalances.set(exchange, coins);
                    }
                });
            }, 5000);
        }
    }

    public sendCandleTick(candle: Candle.Candle) {
        let storeCandle = Object.assign(new Candle.Candle(candle.currencyPair), candle)
        if (storeCandle.tradeData)
            delete storeCandle.tradeData;
        const pairStr = candle.currencyPair.toString();
        let existingCandles = this.maxCandles.get(pairStr);
        if (!existingCandles)
            existingCandles = [];
        existingCandles.push(storeCandle);
        this.maxCandles.set(pairStr, existingCandles);

        // has to be set in here because syncMarket() is only called when a trade is done
        if (this.startCoinRate === -1) {
            this.startCoinRate = candle.close;
            //this.startTime = candle.start;
        }
        this.currentCoinRate = candle.close;
    }

    public evaluateTrades(): BotEvaluation {
        // values such as -105% botEfficiencyPercent are ok because we do margin trading and the markets might also go down simultaneously
        const exposureTimeMin = this.marketExposure.getTotalExposureTimeMin();
        let result: BotEvaluation = {
            // as coin prices
            startCoinEquivalent: this.startCoinBalance + this.startBaseBalance / this.startCoinRate,
            currentCoinEquivalent: PortfolioTrader.coinCurrencyBalance + PortfolioTrader.baseCurrencyBalance / this.currentCoinRate,
            // as base (fiat or BTC) prices
            startBaseEquivalent: this.startBaseBalance + this.startCoinBalance * this.startCoinRate,
            currentBaseEquivalent: PortfolioTrader.baseCurrencyBalance + PortfolioTrader.coinCurrencyBalance * this.currentCoinRate,
            totalFeesBase: this.totalFeesBase,
            trades: {
                totalBuy: this.totalBuyTrades,
                winningBuy: this.winningBuyTrades,
                losingBuy: this.losingBuyTrades,
                totalSell: this.totalSellTrades,
                winningSell: this.winningSellTrades,
                losingSell: this.losingSellTrades
            },
            marketExposureTime: {
                start: utils.getUnixTimeStr(false, new Date(this.start)),
                end: utils.getUnixTimeStr(false, new Date(this.marketTime)),
                hours: utils.calc.round(exposureTimeMin / 60, 2),
                days: utils.calc.round(exposureTimeMin / (60*24), 2),
                percent: utils.calc.round(exposureTimeMin / ((this.marketTime.getTime() - this.start) / (60*1000)) * 100, 2)
            },
            strategies: {},

            // added below
            efficiency: 0,
            efficiencyPercent: 0,
            marketEfficiencyPercent: 0,
            startCoinRate: 0,
            endCoinRate: 0,
            botEfficiencyPercent: 0,
            botVsMarketPercent: 0
        }

        // add final output of strategies (same as we see on the website during live mode)
        let pairs = this.config.listConfigCurrencyPairs();
        pairs.forEach((configCurrencyPair) => {
            let strategies = this.tradeAdvisor.getStrategies().get(configCurrencyPair);
            result.strategies[configCurrencyPair] = {}
            strategies.forEach((strategy) => {
                result.strategies[configCurrencyPair][strategy.getClassName()] = strategy.getInfo();
            })
        });

        // do we now have more or less total assets (base + coin)? // < 1 = less, > 1 = more
        result.efficiency = Math.round((result.currentCoinEquivalent / result.startCoinEquivalent) * 1000) / 1000;
        result.efficiencyPercent = Math.round((((result.currentCoinEquivalent / result.startCoinEquivalent) - 1) * 100) * 10) / 10;
        result.marketEfficiencyPercent = Math.round((((this.currentCoinRate / this.startCoinRate) - 1) * 100) * 10) / 10;
        result.startCoinRate = this.startCoinRate;
        result.endCoinRate = this.currentCoinRate;

        // compare bot vs market (buy and hold)
        result.botEfficiencyPercent = Math.round((((result.currentBaseEquivalent / result.startBaseEquivalent) - 1) * 100) * 10) / 10;
        if (result.marketEfficiencyPercent > 0) { // rising market
            if (result.botEfficiencyPercent > 0)
                result.botVsMarketPercent = result.botEfficiencyPercent - result.marketEfficiencyPercent;
            else
                result.botVsMarketPercent = result.botEfficiencyPercent - result.marketEfficiencyPercent;
        }
        else { // falling market
            if (result.botEfficiencyPercent > 0)
                result.botVsMarketPercent = result.botEfficiencyPercent + Math.abs(result.marketEfficiencyPercent); // 3 + abs(-4) = +7
            else
                result.botVsMarketPercent = result.botEfficiencyPercent - result.marketEfficiencyPercent; // -2 --5 = +3, -6 --1 = -5
        }
        result.botVsMarketPercent = utils.calc.round(result.botVsMarketPercent, 3)
        return result;
    }

    public addOrder(exchange: AbstractExchange, order: Order.Order) {
        let orders = PortfolioTrader.submittedOrders.get(exchange.getClassName());
        if (!orders)
            orders = [];
        orders.push(order);
        PortfolioTrader.submittedOrders.set(exchange.getClassName(), orders);
    }

    public removeOrder(exchangeName: string, orderNumber: number | string) {
        // TODO conflicts if we do margin + normal trading on the same exchange and the exchange doesn't have unique IDs? very unlikely
        let found = false;
        let orders = PortfolioTrader.submittedOrders.get(exchangeName);
        if (!orders || orders.length === 0)
            return found;
        for (let i = 0; i < orders.length; i++)
        {
            if (orders[i].orderID == orderNumber) {
                orders.splice(i, 1);
                found = true;
                break;
            }
        }
        PortfolioTrader.submittedOrders.set(exchangeName, orders);
        return found;
    }

    public isOpenOrder(exchangeName: string, orderNumber: number | string) {
        let orders = PortfolioTrader.submittedOrders.get(exchangeName);
        if (!orders || orders.length === 0)
            return false;
        for (let i = 0; i < orders.length; i++)
        {
            if (orders[i].orderID == orderNumber)
                return true;
        }
        return false;
    }

    public warmUpDone(trade = true) {
        // we will have at least 1 exchange. coins are always loaded, margin positions only for margin trading
        if (PortfolioTrader.coinBalances.size === 0 || (this.config.marginTrading && PortfolioTrader.marginPositions.size === 0)) {
            if (trade)
                logger.warn("Skipping trade because warmup is not done - portfolio not initialized")
            return false;
        }
        return super.warmUpDone(trade);
    }

    public getBalances() {
        return PortfolioTrader.coinBalances;
    }

    public async requestUpdatePortfolio(reason: string, exchange: Currency.Exchange): Promise<void> {
        logger.verbose("Processing event to update %s portfolio in %s: %s", Currency.getExchangeName(exchange), this.className, reason);
        return this.updatePortfolio();
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    /**
     * Update our portfolio on all exchanges.
     * Depending if we use RealTimeTrader or some simulation this function has to be implemented accordingly.
     * Make sure to call this function every x trades and/or after x minutes marketTime have passed (no setTimeout() if not in real time).
     */
    protected abstract updatePortfolio(): Promise<void>;

    /**
     * Cancel orders that haven't been filled after serverConfig:orderTimeoutSec.
     * Make sure to call this function every x trades and/or after x minutes marketTime have passed (no setTimeout() if not in real time).
     */
    protected abstract cancelOpenOrders(): Promise<void>;

    protected skipTrade(action: TradeAction, exchange: AbstractExchange, strategy: AbstractStrategy, amountBtc: number = -1) {
        const currencyPair = strategy.getAction().pair.toString();
        const exchangeName = exchange.getClassName();
        if (this.config.marginTrading && strategy.canOpenOppositePositions() === false && this.isStopOrTakeProfitStrategy(strategy) === false) {
            let positions = PortfolioTrader.marginPositions.get(exchangeName);
            if (positions && positions.has(currencyPair)) {
                let position = positions.get(currencyPair);
                if ((action === "buy" && position.type === "short") || (action === "sell" && position.type === "long")) {
                    const msg = utils.sprintf("Skipping %s trade in %s on %s for %s because we have an open %s position", action, this.className, exchangeName, currencyPair, position.type);
                    logger.warn(msg);
                    this.writeLogLine(msg);
                    return true;
                }
            }
        }
        /* // only makes really sense with margin trading?
        else {
            let balances = this.coinBalances.get(exchangeName);
            let pair = Currency.CurrencyPair.fromString(currencyPair);
            if (balances) {
                let curBalance = balances[pair.to]; // number, 0 if no balance
                if ((action === "buy" && position.type === "short") || (action === "sell" && position.type === "long")) {
                    logger.info("Skipping %s trade in %s on %s for %s because we have an open %s position", action, this.className, exchangeName, currencyPair, position.type)
                    return true;
                }
            }
        }
        */
        return super.skipTrade(action, exchange, strategy, amountBtc);
    }

    protected skipShortSell(exchange: AbstractExchange, coinPair: Currency.CurrencyPair) {
        // on margin trading we want to do short selling, but we will skip it if our config prohibits it (if we have a long position we can sell)
        // for non-margin trading we always skip selling if the config prohibits it
        let marginPositions = PortfolioTrader.marginPositions.get(exchange.getClassName());
        let balance = marginPositions.get(coinPair.toString());
        if (!balance && this.skipTrend("sell"))
            return true; // nothing to sell, skip short selling
        return false;
    }

    protected logTrade(order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        if (this.recordMyTrades === true) {
            let myTrades = this.myTrades.get(order.currencyPair.toString());
            if (!myTrades)
                myTrades = [];
            let myTrade: BotTrade = {
                date: order.date,
                execution_time: 0, // TODO get real execution time, fee, slippage,...
                fee: 0,
                price: order.rate,
                size: order.amount,
                slippage: 0,
                time: order.date.getTime(), // TODO move it 1 candle size backwards to show corresponding to the candle the strategy reacted?
                type: order.type === Trade.TradeType.BUY ? "buy" : "sell"
            }
            if (order.type === Trade.TradeType.CLOSE) {
                myTrade.price = this.marketRates.get(order.currencyPair.toString())
                myTrade.type = order.closePosition === "long" ? "sell" : "buy";
            }
            myTrades.push(myTrade);
            this.myTrades.set(order.currencyPair.toString(), myTrades);
        }
        super.logTrade(order, trades, info);
    }

    protected processTrades(orderOps: Promise<void>[], resolve) {
        //if (orderOps.length === 0)
            //logger.warn("No orders have been defined in %s", this.className)
        // TODO static map to postpone them a few sec to avoid IP ban in realtime trader?
        const arbitrage = nconf.get("arbitrage") === true;
        if (arbitrage === true)
            resolve();
        Promise.all(orderOps).then(() => {
            if (orderOps.length !== 0 && arbitrage === false) {
                // if we did any trades we have to update our portfolio. for arbitrage we must finish trades quickly
                // and there is no need to update our portfolio after every trade we place
                return this.updatePortfolio()
            }
            return Promise.resolve();
        }).then(() => {
            // TODO move this resolve call to RealTimeOrderTracker? strategy gets callback to early with postOnly orders
            // for this we need to bundle references to all orders on PendingOrders and call resolve() once they are all filled
            if (arbitrage === false)
                resolve();
        }).catch((err) => {
            logger.error("Error processing trades", err)
            if (arbitrage === false)
                resolve(); // continue
        })
    }

    protected setStartBalances() {
        this.startBaseBalance = PortfolioTrader.baseCurrencyBalance;
        this.startCoinBalance = PortfolioTrader.coinCurrencyBalance;
    }

    protected addSimulatedPosition(pendingOrder: PendingOrder) {
        if (nconf.get("tradeMode") !== 1)
            return; // not in paper trading mode

        if (!pendingOrder.exchange) {
            logger.error("Can not add simulated position without exchange in %s", this.className);
            return;
        }
        const positions = PortfolioTrader.marginPositions.get(pendingOrder.exchange.getClassName());
        const coinBalance = PortfolioTrader.coinBalances.get(pendingOrder.exchange.getClassName());
        const coinPair = pendingOrder.order.currencyPair;
        const pairStr = pendingOrder.order.currencyPair.toString();
        const tradeAmount = pendingOrder.order.type === Trade.TradeType.SELL ? -1*Math.abs(pendingOrder.order.amount) : Math.abs(pendingOrder.order.amount);
        if (this.config.marginTrading) {
            let position = positions.get(pairStr);
            if (pendingOrder.order.type === Trade.TradeType.CLOSE) {
                if (position) {
                    position.computePl(this.marketRates.get(pairStr));
                    positions.delete(pairStr);
                }
            }
            else {
                if (!position) {
                    position = new MarginPosition(pendingOrder.exchange.getMaxLeverage());
                    positions.set(pairStr, position);
                }
                position.addTrade(tradeAmount, pendingOrder.order.rate);
                position.addAmount(tradeAmount);
            }
            PortfolioTrader.marginPositions.set(pendingOrder.exchange.getClassName(), positions);
        }
        else {
            let curBalance = coinBalance[coinPair.to] // from is BTC
            if (!curBalance)
                curBalance = 0.0;
            if (pendingOrder.order.type !== Trade.TradeType.CLOSE) { // CLOSE shouldn't happen here
                curBalance += tradeAmount;
                if (curBalance < 0.0)
                    curBalance = 0.0;
            }
            coinBalance[coinPair.to] = curBalance;
            PortfolioTrader.coinBalances.set(pendingOrder.exchange.getClassName(), coinBalance);
        }
        this.savePortfolio();
    }

    protected async savePortfolio(): Promise<void> {
        if (nconf.get("tradeMode") !== 1)
            return; // not in paper trading mode
        await this.savePortfolioQueue;
        this.savePortfolioQueue = this.savePortfolioQueue.then(async () => {
            return new Promise<void>(async (resolve, reject) => {
                const filePath = this.tradeAdvisor.getSavePortfolioFile();
                const portfolio = new Portfolio(PortfolioTrader.marginPositions, PortfolioTrader.coinBalances);
                try {
                    await fs.promises.writeFile(filePath, portfolio.serialize(), {encoding: "utf8"});
                }
                catch (err) {
                    logger.error("Error saving portfolio in %s", this.className, err);
                }
                resolve();
            })
        });
    }

    protected async loadPortfolio(): Promise<void> {
        if (nconf.get("tradeMode") !== 1)
            return; // not in paper trading mode
        // TODO also delete files from temp dir if we restore config
        const filePath = this.tradeAdvisor.getSavePortfolioFile();
        try {
            let data = await fs.promises.readFile(filePath, {encoding: "utf8"});
            const portfolio = Portfolio.unserialize(data);
            PortfolioTrader.marginPositions = portfolio.marginPositions;
            PortfolioTrader.coinBalances = portfolio.coinBalances;
            logger.verbose("Loaded paper trading portfolio: %s margin positions, %s coin balances",
                PortfolioTrader.marginPositions.getMarginPositionCount(), PortfolioTrader.coinBalances.getCoinBalanceCount());
            // balances will show up after the next portfolio sync // emit loaded positions to strategies on first sync (after profit/loss calculation is possible)
            setTimeout(() => { // wait a bit to be sure we have data for other currencies too
                for (let ex of AbstractTrader.globalExchanges)
                    this.syncPortfolio(ex[1]);
            }, nconf.get("serverConfig:minPortfolioUpdateMs"));
        }
        catch (err) {
            if (err && err.code === "ENOENT")
                return; // no state saved (yet)
            logger.error("Error loading portfolio in %s", this.className, err);
        }
    }

    protected syncMarket(strategy: AbstractStrategy) {
        super.syncMarket(strategy);
        /*
        let candle = strategy.getCandle();
        if (!candle) // prefer candles from longer strategies. what if no strategy has candleSize? (unlikely)
            return;
        */
    }

    /**
     * Return a copy of the specified margin position. Helpful for modyfing positions and comparison.
     * @param exchange
     * @param currencyPair
     * @returns {MarginPosition}
     */
    protected getMarginPositionCopy(exchange: AbstractExchange, currencyPair: Currency.CurrencyPair): MarginPosition {
        let position = PortfolioTrader.marginPositions.get(exchange.getClassName()).get(currencyPair.toString())
        if (position)
            return Object.assign(new MarginPosition(position.leverage), position);
        return null;
    }

    protected logBalances(reason = "") {
        if (reason)
            reason = " (" + reason + ")"
        let msg = utils.sprintf("BALANCES%s: base %s, coin %s (%s open margin positions: %s)", reason, PortfolioTrader.baseCurrencyBalance.toFixed(8), PortfolioTrader.coinCurrencyBalance.toFixed(8),
            PortfolioTrader.marginPositions.getMarginPositionCount(), PortfolioTrader.marginPositions.listPositions())
        logger.info(msg);
        if (this.marketTime)
            logger.info("Market time: %s", utils.getUnixTimeStr(true, this.marketTime))
        this.writeLogLine(msg);
    }

    /**
     * Add or remove collateral
     * @param exchange
     * @param amountBtc use negative amounts to reduce the collateral
     */
    protected addMarginCollateral(exchange: AbstractExchange, amountBtc: number) {
        let collateral = PortfolioTrader.marginCollateral.get(exchange.getClassName());
        if (!collateral)
            collateral = 0;
        collateral += amountBtc;
        if (collateral < 0) {
            logger.error("Margin collateral droppped below 0 on %s. Error in trading logic. Value %s", exchange.getClassName(), collateral)
            utils.test.dumpError(new Error("negative margin collateral"), logger)
            collateral = 0;
        }
        PortfolioTrader.marginCollateral.set(exchange.getClassName(), collateral);
    }

    protected closeMarginCollateral(exchange: AbstractExchange) {
        let amountBtc = PortfolioTrader.marginCollateral.get(exchange.getClassName());
        PortfolioTrader.marginCollateral.delete(exchange.getClassName());
        if (!amountBtc)
            amountBtc = 0;
        return amountBtc;
    }

    protected countMarginTrade(position: MarginPosition) {
        if (position.type === "long") {
            if (position.pl > 0)
                this.winningBuyTrades++;
            else
                this.losingBuyTrades++;
        }
        else if (position.type === "short") {
            if (position.pl > 0)
                this.winningSellTrades++;
            else
                this.losingSellTrades++;
        }
        else
            logger.warn("Can not count stats for unknown margin position type %s in %s", position.type, this.className, position)
    }

    protected syncPortfolio(exchange: AbstractExchange) {
        const positions = PortfolioTrader.marginPositions.get(exchange.getClassName());
        const coinBalance = PortfolioTrader.coinBalances.get(exchange.getClassName());
        //let remainingMarketPairs = new Set<Currency.CurrencyPair>(this.config.markets) // safer as string
        let remainingMarketPairs = new Set<string>(PortfolioTrader.allMarkets);
        const isBacktest = nconf.get("trader") === "Backtester";
        const isSimulation = nconf.get("tradeMode") === 1;

        if (!positions) {
            logger.verbose("No open margin positions on %s to sync", exchange.getClassName())
        }
        else {
            for (let pos of positions)
            {
                const marginPos: MarginPosition = pos[1];
                remainingMarketPairs.delete(pos[0]) // remove it first (even if coins are not loaded)
                let pair = Currency.CurrencyPair.fromString(pos[0])
                if (!pair || !pair.to || !coinBalance) {
                    logger.error("Can not sync portfolio for %s. %s currencies not loaded", pos[0], exchange.getClassName())
                    continue; // happens on startup
                }
                let coins = coinBalance[pair.to] || 0.0; // from is BTC
                if (isBacktest === true || isSimulation === true) // otherwise we get the actual profit/loss value from the exchange
                    marginPos.computePl(this.marketRates.get(pair.toString()));
                this.emitSyncExchangePortfolio(exchange.getClassName(), pair, coins, marginPos);
            }
        }
        for (let pairStr of remainingMarketPairs)
        {
            let emptyPosition = new MarginPosition(exchange.getMaxLeverage());
            let pair = Currency.CurrencyPair.fromString(pairStr)
            let coins = 0.0;
            if (!coinBalance) // possible on startup
                logger.error("Unable to get %s %s coins to sync porftfolio", exchange.getClassName(), pairStr)
            else
                coins = coinBalance[pair.to] || 0.0; // from is BTC
            this.emitSyncExchangePortfolio(exchange.getClassName(), pair, coins, emptyPosition)
        }
    }

    protected emitSyncExchangePortfolio(exchangeName: string, currencyPair: Currency.CurrencyPair, coins: number, position: MarginPosition) {
        if (!PortfolioTrader.allExchangePairs.hasPair(exchangeName, currencyPair.toString())) {
            //logger.verbose("Skipping sync because coin is not on exchange/config: %s %s: %s coins, %s margin amount", exchangeName, currencyPair.toString(), coins, position.amount)
            return;
        }
        if (nconf.get("trader") !== "Backtester")
            logger.verbose("Synced %s %s portfolio: %s coins, %s margin amount", exchangeName, currencyPair.toString(), coins, position.amount);
        // we sync all positions of an exchange together (to save http requests). but we have to call emit
        // on the correct instance (else the corresponding config, margin trading,... is wrong)
        let traderInstance = PortfolioTrader.allExchangePairs.getInstance(exchangeName, currencyPair.toString())
        if (traderInstance) {
            let exchangeInstance = traderInstance.getExchangeByName(exchangeName);
            let exchangeLabel = Currency.Exchange.ALL;
            if (exchangeInstance)
                exchangeLabel = exchangeInstance.getExchangeLabel();
            else
                logger.error("Error getting exchange instance %s on portfolio sync", exchangeName)
            traderInstance.emitSyncPortfolio(currencyPair, coins, position, exchangeLabel)
        }
        else
            logger.error("Unable to get trader instance to sync portfolio. exchange %s, currencyPair %s", exchangeName, currencyPair)
    }

    protected getMaxCoinAmount(exchange: AbstractExchange, strategy: AbstractStrategy, coinAmount: number, trade: TradeAction) {
        if (nconf.get("arbitrage") && strategy instanceof AbstractArbitrageStrategy) {
            let exchangeLabels = strategy.getCurrentArbitrageExchangePair();
            const coinPair = strategy.getAction().pair;
            const pairStr = coinPair.toString();
            const buyRate = strategy.getArbitrageRate(Trade.TradeType.BUY);
            const sellRate = strategy.getArbitrageRate(Trade.TradeType.SELL);
            let buyExchange = PortfolioTrader.allExchangePairs.getExchangeInstanceByLabel(exchangeLabels[0], pairStr);
            let sellExchange = PortfolioTrader.allExchangePairs.getExchangeInstanceByLabel(exchangeLabels[1], pairStr);
            if (!buyExchange || !sellExchange)
                throw new Error(utils.sprintf("Can not get buy and sell exchange to perform arbitrage. exchanges: %s, currencyPair %s", exchangeLabels, pairStr));

            // get the max arbitrage amount based on our exchange balances
            // TODO add support for longShortRatio and followExchange config
            if (this.config.marginTrading) {
                // TODO exchange API calls to get max tradable leveraged balance. currently must assume to have enough collateral for configured amount
                // we can't check our coinBalances because they are in a different wallet (not used as collateral)
            }
            else {
                const minBalance = nconf.get("arbitrage") === true ? nconf.get("serverConfig:arbitragePaperTradingBalance") : 0.0;
                let buyBalances = PortfolioTrader.coinBalances.get(buyExchange.getClassName());
                let sellBalances = PortfolioTrader.coinBalances.get(sellExchange.getClassName());
                const maxTradeFactor = (this.config as ArbitrageConfig).maxTradeBalancePercentage / 100.0;
                if (!buyBalances || !sellBalances)
                    throw new Error(utils.sprintf("Can not get buy and sell exchange to perform arbitrage. exchanges: %s, currencyPair %s", exchangeLabels, pairStr));
                let curBuyBalance = buyBalances[coinPair.from] // check our base capital (USD, BTC,...) to see how many coins we can buy max
                if (curBuyBalance === undefined)
                    curBuyBalance = 0.0;
                if (curBuyBalance < minBalance)
                    curBuyBalance = minBalance;
                let maxBuyCoins = curBuyBalance / buyRate; // how many coins we can buy with our base balance
                if (coinAmount > maxBuyCoins)
                    coinAmount = maxBuyCoins * maxTradeFactor;
                let curSellBalance = sellBalances[coinPair.to]
                if (curSellBalance === undefined)
                    curSellBalance = 0.0;
                if (curSellBalance < minBalance)
                    curSellBalance = minBalance;
                if (coinAmount > curSellBalance)
                    coinAmount = curSellBalance * maxTradeFactor; // no short selling, we can trade with at most the coins we have to sell on one exchange
            }
            return coinAmount; // the checks below are for trading, not arbitrage
        }

        if (this.config.flipPosition === true && strategy.getStrategyPosition() !== "none") {
            if ((trade === "sell" && strategy.getStrategyPosition() === "long") || (trade === "buy" && strategy.getStrategyPosition() === "short")) {
                coinAmount *= 2.0; // TODO if we traded multiple times in the same direction (multiple buys) this amount from config is too low. always sync before?
                logger.info("%s: Trading twice the amount because flipPosition is enabled in config on %s trade", this.className, trade.toUpperCase());
            }
        }

        // if it's TakeProfit we have to ensure to not sell/close more coins than we hold
        //if (!(strategy instanceof AbstractTakeProfitStrategy)) {
        if (this.isTakeProfitStrategy(strategy) === false) {
            // don't use the strategy order - for StopLossTurnPartial it might always contain "close"
            //if (!(strategy instanceof AbstractStopStrategy) || /*strategy.getAction().order*/trade.indexOf("close") !== -1)
            if (this.isStopStrategy(strategy) === false || /*strategy.getAction().order*/trade.indexOf("close") !== -1)
                return coinAmount;
            // TODO AbstractOrderer for takeprofit
        }
        else if (strategy.isMainStrategy())
            return coinAmount;

        const coinPair = strategy.getAction().pair;
        const maxClosePartialFactor = nconf.get("serverConfig:maxClosePartialPercentage") / 100.0;
        if (this.config.marginTrading) {
            let holdingCoinsList = PortfolioTrader.marginPositions.get(exchange.getClassName());
            if (holdingCoinsList) {
                let position = holdingCoinsList.get(coinPair.toString());
                if (position) {
                    let holdingCoins = Math.abs(position.amount);
                    return Math.min(coinAmount, holdingCoins * maxClosePartialFactor); // TODO option to close x% of position (instead of %x of config value)
                }
            }
            else
                logger.warn("No margin trading portfolio found for exchange %s. Closing with config coin amount")
        }
        else {
            let holdingCoinsList = PortfolioTrader.coinBalances.get(exchange.getClassName());
            let holdingCoins = holdingCoinsList[coinPair.to]; // always positive
            if (holdingCoins)
                return Math.min(coinAmount, holdingCoins * maxClosePartialFactor);
            else if (!holdingCoinsList)
                logger.warn("No trading portfolio found for exchange %s. Closing with config coin amount")
        }
        return coinAmount;
    }

    protected getMarginPositionOrderAmount(strategy: AbstractStrategy) {
        if (nconf.get("serverConfig:marginTradingPartialAmountFromRealBalance") !== true || this.isStopOrTakeProfitStrategy(strategy) === false)
            return this.config.tradeTotalBtc;
        let realAmount = strategy.getPositionAmount();
        return realAmount > 0.0 ? realAmount : this.config.tradeTotalBtc;
    }

    /**
     * Write a trade graph html file for the current trading state (used for backtesting).
     * @param {Currency.CurrencyPair} currencyPair
     * @param {BotEvaluation} tradeResult
     * @returns {Promise<string>} the path to the graph file on disk
     */
    protected writeTradeGraph(currencyPair: Currency.CurrencyPair, tradeResult: BotEvaluation) {
        return new Promise<string>((resolve, reject) => {
            if (!this.logPath)
                return reject({txt: "Log path has to be set to write a trade graph."})
            const pairStr = currencyPair.toString();
            let htmlOutput = utils.stringifyBeautiful(tradeResult) + "\r\n\r\n" + this.tradesLog.join("\r\n");
            let candles = this.maxCandles.get(pairStr);
            if (candles === undefined)
                candles =[];
            const timeOffsetMs: number = nconf.get("serverConfig:backtest:timeOffsetMin") * utils.constants.MINUTE_IN_SECONDS*1000;
            let data = candles.map((period) => {
                return {
                    time: period.start.getTime() + timeOffsetMs,
                    open: period.open,
                    high: period.high,
                    low: period.low,
                    close: period.close,
                    volume: period.volume
                }
            })
            // add trades (main data)
            let trades = this.myTrades.get(pairStr) || [];
            if (timeOffsetMs !== 0) {
                trades.forEach((tr) => {
                    tr.date = new Date(tr.date.getTime() + timeOffsetMs);
                    //tr.time =
                    //tr.execution_time =
                });
            }
            let code = 'var data = ' + JSON.stringify(data) + ';\n'
            code += 'var trades = ' + JSON.stringify(trades) + ';\n';

            // add custom mark data
            const confPair = this.config.getConfigCurrencyPair(currencyPair);
            let strategy = this.tradeAdvisor.getMainStrategy(confPair);
            let plotData = strategy.getPlotData();
            let keys = plotData.getMarkKeys();
            let marks = {}
            keys.forEach((key) => {
                marks[key] = plotData.getMarkData(key)
            })
            code += 'var marks = ' + JSON.stringify(marks) + ';\n';

            fs.readFile(path.join(utils.appDir, "views", "Trader", "trades.html"), "utf8", (err, data) => {
                if (err)
                    return reject({txt: "Error opening template file", err: err})

                const libs = fs.readFileSync(path.join(utils.appDir, "views", "Trader", "trades.js"), "utf8");
                let output = data
                    .replace('{{trades_js_libs}}', libs) // IDE is faster if put in another file
                    .replace('{{code}}', code)
                    .replace('{{trend_ema_period}}', nconf.get("serverConfig:plot:emaPeriod"))
                    .replace('{{output}}', htmlOutput)
                    .replace(/\{\{symbol\}\}/g, this.config.exchanges.toString() + ' ' + pairStr + " " + nconf.get("projectNameLong"));
                let target = this.logPath.replace(/\.log$/, ".html");

                fs.writeFile(target, output, (err) => {
                    if (err)
                        return reject({txt: "Error writing trade graph", err: err})
                    logger.info("Wrote trade graph to %s", target)

                    let state = {}
                    state[confPair] = this.tradeAdvisor.serializeStrategyData(confPair);
                    state[confPair].performance = JSON.stringify(tradeResult);
                    // don't serialize all states during backfind
                    if ((!process.env.IS_CHILD || process.env.SAVE_STATE) && Object.keys(state).length !== 0 && Object.keys(state[confPair]).length !== 0) {
                        target = target.replace(/\.html/, ".json")
                        // use EJSON so Date objects are serialized to preverve the timezone
                        let stateStr = utils.EJSON.stringify(state)
                        let packState = nconf.get("serverConfig:gzipState") ? utils.text.packGzip(stateStr) : Promise.resolve(stateStr)
                        packState.then((packedStateStr) => {
                            fs.writeFile(target, packedStateStr, (err) => {
                                if (err)
                                    return reject({txt: "Error writing strategy state", err: err})
                                logger.verbose("Serialized strategy state to %s", target)
                                resolve(target)
                            })
                        }).catch((err) => {
                            logger.error("Error packing state string", err)
                        })
                    }
                    else
                        resolve(target)
                })
            })
        })
    }
}
