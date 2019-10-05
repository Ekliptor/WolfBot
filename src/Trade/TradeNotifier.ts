import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractTrader} from "./AbstractTrader";
import {TradeConfig} from "../Trade/TradeConfig";
import {AbstractNotification} from "../Notifications/AbstractNotification";
import Notification from "../Notifications/Notification";
import {AbstractStrategy} from "../Strategies/AbstractStrategy";
import * as path from "path";
import {CoinMap, PortfolioTrader} from "./PortfolioTrader";
import {Candle, Order, Currency, Trade} from "@ekliptor/bit-models";
import {StrategyActionName} from "../TradeAdvisor";
import {MarginPosition} from "../structs/MarginPosition";


export default class TradeNotifier extends PortfolioTrader/*AbstractTrader*/ { // use PortfolioTrader so we have access to our Portfolio data
    protected notifier: AbstractNotification;
    protected lastNotification = new Map<AbstractStrategy, Date>();

    constructor(config: TradeConfig) {
        super(config)
        this.start = Date.now() - 10*1000;
        this.notifier = AbstractNotification.getInstance();
    }

    public getBalances(): CoinMap {
        return null;
    }

    public callAction(action: StrategyActionName, strategy: AbstractStrategy, reason = "", exchange: Currency.Exchange = Currency.Exchange.ALL): void {
        // in our notifier class we only check if paused and ignore all other safety checks
        const pairStr = strategy.getAction().pair.toString();
        /* // already checked in callAction of main trader. boolean not set here
        if (this.pausedTrading) {
            const msg = utils.sprintf("Skipping %s %s in %s because trading is paused: %s - %s", action, pairStr, this.className, strategy.getClassName(), reason)
            logger.info(msg)
            this.writeLogLine(msg)
            return;
        }
        */
        this.syncMarket(strategy);

        switch (action)
        {
            case "buy":
            case "sell":
            case "close":
                this[action](strategy, reason, exchange).then(() => {
                    //this.isTrading.delete(pairStr);
                    logger.verbose("Trading action %s %s has finished in %s", action, pairStr, this.className)
                }).catch((err) => {
                    logger.error("Error executing %s %s in %s", action, pairStr, this.className, err);
                    //this.isTrading.delete(pairStr);
                })
                return;
            case "hold":
                return;
            default:
                logger.error("Trader can not act on unknown action %s %s", action, pairStr)
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected updatePortfolio() {
        return new Promise<void>((resolve, reject) => {
            resolve() // done in our RealTimeTrader instance
        })
    }

    protected cancelOpenOrders() {
        return new Promise<void>((resolve, reject) => {
            resolve() // done in our RealTimeTrader instance
        })
    }

    protected buy(strategy: AbstractStrategy, reason: string, exchangeLabel: Currency.Exchange) {
        return new Promise<void>((resolve, reject) => {
            const coinPair = strategy.getAction().pair.toString();
            const rate = strategy.getMarketPrice();
            let balance = this.getExchangeBalance(strategy.getAction().pair);
            this.sendNotification(strategy, "BUY Signal", this.getStrategyDisplayName(strategy) + " triggered for " + coinPair, reason, rate, balance.pl);
            let order = Order.Order.getOrder(strategy.getAction().pair, Currency.Exchange.ALL, 1, rate, Trade.TradeType.BUY, "", false)
            this.emitBuy(order, [], {strategy: strategy, pl: balance.pl, reason: reason, exchange: null});
            resolve();
        })
    }

    protected sell(strategy: AbstractStrategy, reason: string, exchangeLabel: Currency.Exchange) {
        return new Promise<void>((resolve, reject) => {
            const coinPair = strategy.getAction().pair.toString();
            const rate = strategy.getMarketPrice();
            let balance = this.getExchangeBalance(strategy.getAction().pair);
            this.sendNotification(strategy, "SELL Signal", this.getStrategyDisplayName(strategy) + " triggered for " + coinPair, reason, rate, balance.pl);
            let order = Order.Order.getOrder(strategy.getAction().pair, Currency.Exchange.ALL, 1, rate, Trade.TradeType.SELL, "", false)
            this.emitSell(order, [], {strategy: strategy, pl: balance.pl, reason: reason, exchange: null});
            resolve();
        })
    }

    protected close(strategy: AbstractStrategy, reason: string, exchangeLabel: Currency.Exchange) {
        return new Promise<void>((resolve, reject) => {
            const coinPair = strategy.getAction().pair.toString();
            const rate = strategy.getMarketPrice();
            let balance = this.getExchangeBalance(strategy.getAction().pair);
            this.sendNotification(strategy, "CLOSE Signal", this.getStrategyDisplayName(strategy) + " triggered for " + coinPair, reason, rate, balance.pl);
            let order = Order.Order.getOrder(strategy.getAction().pair, Currency.Exchange.ALL, balance.amount, rate, Trade.TradeType.CLOSE, "", true)
            this.emitClose(order, [], {strategy: strategy, pl: balance.pl, reason: reason, exchange: null});
            resolve();
        })
    }

    protected cancelOrder(strategy: AbstractStrategy, reason: string, exchangeLabel: Currency.Exchange) {
        return new Promise<void>((resolve, reject) => {
            // no need to send notifications here
            resolve();
        })
    }

    protected cancelAllOrders(strategy: AbstractStrategy, reason: string, exchangeLabel: Currency.Exchange) {
        return new Promise<void>((resolve, reject) => {
            // no need to send notifications here
            resolve();
        })
    }

    protected sendNotification(strategy: AbstractStrategy, headline: string, text: string, reason: string, marketPrice = 0.0, profitLoss = 0.0, forceSend: boolean = false) {
        if ((nconf.get("trader") === "RealTimeTrader" && nconf.get("tradeMode") === 1 && reason.toLowerCase().indexOf("out of sync") !== -1)
            || this.config.tradeTotalBtc === 0.0 || this.pausedTrading) {
            logger.verbose("Skipped sending 'out of sync' notifcation in paper trading mode")
            return;
        }

        const pauseMs = nconf.get('serverConfig:tradeNotificationPauseMin') * utils.constants.MINUTE_IN_SECONDS * 1000;
        const last = this.lastNotification.get(strategy);
        if (forceSend === false && last && last.getTime() + pauseMs > Date.now())
            return;
        text += "\nPosition: " + strategy.getStrategyPosition();
        if (reason)
            text += "\n" + reason;
        if (marketPrice)
            text += "\nPrice: " + marketPrice.toFixed(8);
        if (profitLoss)
            text += "\np/l: " + profitLoss.toFixed(8) + " " + strategy.getAction().pair.getBase();
        headline = utils.sprintf("%s: %s", this.getFirstExchange(), headline);
        let notification = new Notification(headline, text, false);
        logger.info("NOTIFICATION", headline, text);
        this.notifier.send(notification).then(() => {
        }).catch((err) => {
            logger.error("Error sending %s notification", this.className, err)
        });
        this.lastNotification.set(strategy, new Date()); // here we can use the current date
    }

    protected getStrategyDisplayName(strategy: AbstractStrategy) {
        let name = strategy.getLastTradeFromClass();
        if (!name)
            name = strategy.getClassName();
        return name;
    }

    protected getFirstExchange() {
        return this.config.exchanges[0]; // we only have 1 anyway
    }

    protected getExchangeBalance(currencyPair: Currency.CurrencyPair, exchangeName = ""): MarginPosition {
        if (!exchangeName)
            exchangeName = this.getFirstExchange(); // TODO fails for a bot with multiple exchanges (which we don't do per config part). loop?
        let marginPositions = PortfolioTrader.marginPositions.get(exchangeName);
        if (!marginPositions) // not in RealTime mode
            return new MarginPosition(2.0);
        let balance = marginPositions.get(currencyPair.toString());
        if (!balance)
            return new MarginPosition(2.0);
        return balance;
    }
}
