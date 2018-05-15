import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {TradeConfig} from "../Trade/TradeConfig";
import {StrategyActionName, default as TradeAdvisor} from "../TradeAdvisor";
import {AbstractStrategy, TradeAction} from "../Strategies/AbstractStrategy";
import {OrderResult} from "../structs/OrderResult";
import {AbstractExchange, ExchangeMap, OrderParameters} from "../Exchanges/AbstractExchange";
import {Trade, Order, Currency, Candle} from "@ekliptor/bit-models";
import * as fs from "fs";
import * as path from "path";
import {MarginPosition} from "../structs/MarginPosition";
import {controller, controller as Controller} from '../Controller';
import {AbstractGenericTrader} from "./AbstractGenericTrader";
import {AbstractStopStrategy} from "../Strategies/AbstractStopStrategy";
import {AbstractTakeProfitStrategy} from "../Strategies/AbstractTakeProfitStrategy";

export type TradeDirection = "up" | "down" | "both";

export interface TradeInfo {
    strategy: AbstractStrategy;
    reason?: string;
    pl?: number;
    exchange?: AbstractExchange;
}

export interface BotTrade { // a trade by our bot, Trade.Trade is a trade by everyone
    date: Date;
    execution_time: number; // in ms
    fee: number;
    price: number // as string originally in graph
    size: number; // volume, as string originally in graph
    slippage: number; // 0 for now
    time: number; // date in ms
    type: "buy" | "sell";
}

export abstract class AbstractTrader extends AbstractGenericTrader {
    protected config: TradeConfig;
    protected tradeAdvisor: TradeAdvisor;
    protected static globalExchanges: ExchangeMap = new ExchangeMap() // (exchange name, instance), all exchanges (needed to save HTTP requests to deduplicate requests)
    protected start: number = 0;
    protected pausedOpeningPositions: boolean = false;

    protected marketRates = new Map<string, number>(); // (currency pair, rate)

    constructor(config: TradeConfig) {
        super();
        this.config = config;
        if (this.config.notifyTrades && this.className !== nconf.get("serverConfig:tradeNotifierClass") && nconf.get('trader') !== "Backtester") {
            const modulePath = path.join(__dirname, nconf.get("serverConfig:tradeNotifierClass"));
            this.tradeNotifier = this.loadModule(modulePath, config)
            if (this.tradeNotifier && this.getClassName() === this.tradeNotifier.getClassName())
                this.tradeNotifier = null; // don't notify twice, shouldn't be needed because of check above
        }
    }

    public setExchanges(tradeAdvisor: TradeAdvisor) {
        this.tradeAdvisor = tradeAdvisor;
        this.exchanges = tradeAdvisor.getExchanges();
        for (let exchange of this.exchanges)
        {
            if (!AbstractTrader.globalExchanges.has(exchange[0]))
                AbstractTrader.globalExchanges.set(exchange[0], exchange[1])
        }
    }

    /**
     * Return an exchange by name. Make sure to call this on the correct AbstractTrader instance.
     * Use PortfolioTrader.allExchangePairs map to find the right instance.
     * @param {string} exchange
     * @returns {AbstractExchange}
     */
    public getExchangeByName(exchange: string): AbstractExchange {
        return this.exchanges.get(exchange);
    }

    public getConfig() {
        return this.config;
    }

    public getMarketRates() {
        return this.marketRates;
    }

    public callAction(action: StrategyActionName, strategy: AbstractStrategy, reason = "", exchange: Currency.Exchange = Currency.Exchange.ALL): void {
        const pairStr = strategy.getAction().pair.toString() + "-" + Currency.Exchange[exchange]; // add the exchange because for arbitrage we call it twice
        if (this.pausedTrading) {
            const msg = utils.sprintf("Skipping %s %s in %s because trading is paused: %s - %s", action, pairStr, this.className, strategy.getClassName(), reason)
            logger.info(msg)
            this.writeLogLine(msg)
            return;
        }
        if (this.pausedOpeningPositions && action !== "close" && !this.isStopOrTakeProfitStrategy(strategy)) {
            const msg = utils.sprintf("Skipping %s %s in %s because opening positions is paused: %s - %s", action, pairStr, this.className, strategy.getClassName(), reason)
            logger.info(msg)
            this.writeLogLine(msg)
            return;
        }
        if (this.isTrading.has(pairStr)) {
            logger.warn("Ignoring action %s %s in %s because last action hasn't finished", action, pairStr, this.className)
            return; // ignoring should be better (safer) than queueing actions
        }
        this.syncMarket(strategy);
        if (!this.warmUpDone() && this.isStarting()) {
            logger.verbose("Scheduling retry of %s trade because %s is currently starting", action, this.className)
            setTimeout(this.callAction.bind(this, action, strategy, reason, exchange), 10000);
            return;
        }

        if (this.tradeNotifier instanceof AbstractTrader)
            this.tradeNotifier.callAction(action, strategy, reason, exchange); // TODO call this only if we actually executed the trade
        switch (action)
        {
            case "buy":
            case "sell":
            case "close":
                this.isTrading.set(pairStr, true);
                setTimeout(() => {
                    this.isTrading.delete(pairStr); // just to be sure
                }, nconf.get("serverConfig:orderTimeoutSec")*1000)
                // for non-margin trading there is not short-selling. so if we bought coins this "close" order can only mean sell
                if (action === "close" && !this.config.marginTrading)
                    action = "sell";

                this[action](strategy, reason, exchange).then(() => {
                    this.isTrading.delete(pairStr);
                    logger.verbose("Trading action %s %s has finished in %s", action, pairStr, this.className)
                }).catch((err) => {
                    logger.error("Error executing %s %s in %s", action, pairStr, this.className, err);
                    this.isTrading.delete(pairStr);
                })
                return;
            case "hold":
                return;
            default:
                logger.error("Trader can not act on unknown action %s %s", action, pairStr)
        }
    }

    public warmUpDone(trade = true) {
        if (!this.start || !this.marketTime) {
            if (trade)
                logger.warn("Skipping trade because warmup is not done - variables not initialized")
            return false;
        }
        if (this.config.warmUpMin != 0 && this.start + this.config.warmUpMin * utils.constants.MINUTE_IN_SECONDS * 1000 > this.marketTime.getTime()) {
            // TODO on okex we got the wrong marketTime once and ended up stuck here. not reproducable, even with same timezone
            if (trade)
                logger.warn("Skipping trade because warmup is not done - warmup time (%s min) not over. market time: %s", this.config.warmUpMin, utils.getUnixTimeStr(true, this.marketTime))
            return false;
        }
        return true;
    }

    public setPausedOpeningPositions(paused: boolean) {
        this.pausedOpeningPositions = paused;
    }

    public getPausedOpeningPositions() {
        return this.pausedOpeningPositions;
    }

    public sendTick(trades: Trade.Trade[]) {
        // overwrite this to get all trades. mostly useful for backtesting (simulating a market)
    }

    // TODO it would be useful to listen to the order book in here too for RealTime trader (faster than pulling HTTP updates)

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected abstract buy(strategy: AbstractStrategy, reason: string, exchangeLabel: Currency.Exchange): Promise<void>;
    protected abstract sell(strategy: AbstractStrategy, reason: string, exchangeLabel: Currency.Exchange): Promise<void>;
    protected abstract close(strategy: AbstractStrategy, reason: string, exchangeLabel: Currency.Exchange): Promise<void>;

    protected emitBuy(order: Order.Order, trades: Trade.Trade[], info?: TradeInfo) {
        this.logTrade(order, trades, info);
        this.emit("buy", order, trades, info);
    }

    protected emitSell(order: Order.Order, trades: Trade.Trade[], info?: TradeInfo) {
        this.logTrade(order, trades, info);
        this.emit("sell", order, trades, info);
    }

    protected emitClose(order: Order.Order, trades: Trade.Trade[], info?: TradeInfo) {
        this.logTrade(order, trades, info);
        this.emit("close", order, trades, info);
    }

    protected emitSyncPortfolio(currencyPair: Currency.CurrencyPair, coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange) {
        if (!coins || this.config.marginTrading)
            coins = 0.0; // set coins to 0 if margin trading, otherwise strategies might get the wrong balance
        else if (!this.config.marginTrading)
            position = new MarginPosition(position.leverage); // empty position
        this.emit("syncPortfolio", currencyPair, coins, position, exchangeLabel);
    }

    protected syncMarket(strategy: AbstractStrategy) {
        this.marketTime = strategy.getMarketTime(); // assume all markets we listen to in here have the same timezone
        let candle = strategy.getCandle(); // if we have a candle we use it because it will smoothen spikes
        let price = strategy.getAvgMarketPrice();
        if (price !== -1) // don't reset it if strategy resets
            this.marketRates.set(strategy.getAction().pair.toString(), candle ? candle.close : strategy.getAvgMarketPrice())
    }

    protected skipExchange(currentExchange: AbstractExchange, requestedExchangeLabel: Currency.Exchange) {
        if (requestedExchangeLabel && requestedExchangeLabel !== Currency.Exchange.ALL && currentExchange.getExchangeLabel() !== requestedExchangeLabel)
            return true;
        return false;
    }

    protected skipTrade(action: TradeAction, exchange: AbstractExchange, strategy: AbstractStrategy, amountBtc: number = -1) {
        const exchangeName = exchange.getClassName();
        const pairStr = strategy.getAction().pair.toString();
        if (amountBtc !== -1) {
            // for contract exchanges we always trade 1 contract at least
            if (/*exchange.isContractExchange() === false && */amountBtc < exchange.getMinTradingBtc()) {
                // during backtesting 0 means "all funds"
                logger.warn("Skipping %s %s trade of %s BTC on %s because it's below the min trading balance %s", action, pairStr, amountBtc, exchangeName, exchange.getMinTradingBtc())
                return true;
            }
        }
        if (/*action === "close" && */this.config.tradeTotalBtc == 0.0) {
            logger.warn("Skipping %s trade because %s trading is disabled", action.toUpperCase(), pairStr);
            return true;
        }
        return false;
    }

    protected skipTrend(action: TradeAction) {
        if ((action === "buy" && this.config.tradeDirection === "down") || (action === "sell" && this.config.tradeDirection === "up")) {
            const msg = utils.sprintf("Skipping %s trade in %s because config is set to only trade in the other direction", action, this.className);
            logger.warn(msg);
            this.writeLogLine(msg);
            return true;
        }
        return false;
    }

    protected watchOrder(exchange: AbstractExchange, strategy: AbstractStrategy, order: Order.Order, orderParameters: OrderParameters, orderResult: OrderResult) {
        // overwrite this in subclass to watch posted orders. useful for adjusting orders to pay only maker fee
    }

    protected logTrade(order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        // TODO compute actual profit/loss. for this we have to store all buys/sell we make in database
        let logLine = Trade.TradeType[order.type] + " " + Currency.Exchange[order.exchange]
            + " " + order.currencyPair.toString() + ", amount: " + order.amount;
        if (info) {
            const currencyDisplay = Currency.Currency[order.currencyPair.from]
            if (info.pl)
                logLine += (", p/l: " + info.pl + /*" BTC"*/ " " + currencyDisplay); // TODO get the current value. this is the last value (1min ago). but we want our bot to close immediately
            logLine += ", " + info.strategy.getClassName();
            if (info.reason)
                logLine += ", reason: " + info.reason;
            if (info.exchange) {
                let tickerData = info.exchange.getTickerData(order.currencyPair)
                if (tickerData)
                    logLine += ", last price: " + tickerData.last;
                else
                    logLine += ", last price: " + info.strategy.getAvgMarketPrice();
            }
        }
        this.writeLogLine(logLine)
    }

    protected isStarting() {
        return false; // customize this to retry failed trades on startup while warmup
    }

    protected getMaxSellBtc() {
        // sell at most the amount this trader is allowed to sell per config
        // but if we bought those coins before we have to also allow for a prise rise
        // on margin trading we do short selling of exactly tradeTotalBtc (so buy and sell repeatedly until close)
        if (this.config.tradeTotalBtc <= 0)
            return Number.POSITIVE_INFINITY; // during backtesting
        return this.config.tradeTotalBtc * nconf.get("serverConfig:maxSellPriseRise")
    }

    protected isStopOrTakeProfitStrategy(strategy: AbstractStrategy) {
        if (strategy.isMainStrategy()) // stop strategy can be main (but then we would use "pauseTrading"). currently only used to check for closing a position
            return false;
        return this.isStopStrategy(strategy) == true || this.isTakeProfitStrategy(strategy) === true;
    }

    protected isStopStrategy(strategy: AbstractStrategy) {
        if (strategy instanceof AbstractStopStrategy)
            return true;
        if (strategy instanceof AbstractOrderer) {
            if (strategy.isStopOrder() === true)
                return true;
        }
        return false;
    }

    protected isTakeProfitStrategy(strategy: AbstractStrategy) {
        if (strategy instanceof AbstractTakeProfitStrategy)
            return true;
        if (strategy instanceof AbstractOrderer) {
            if (strategy.isTakeProfitOrder() === true)
                return true;
        }
        return false;
    }
}

// force loading dynamic imports for TypeScript
import "./PortfolioTrader";
import "./RealTimeTrader";
import "./TradeNotifier";
import "../Lending/RealTimeLendingTrader";
import {AbstractOrderer} from "../Strategies/AbstractOrderer";