import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Order} from "@ekliptor/bit-models";
import {AbstractTrader} from "./AbstractTrader";
import {PortfolioTrader, LastTradeMap} from "./PortfolioTrader";
import {TradeConfig} from "../Trade/TradeConfig";
import {OrderResult} from "../structs/OrderResult";
import {AbstractExchange, ExchangeMap, OrderParameters} from "../Exchanges/AbstractExchange";
import {AbstractStrategy, TradeAction} from "../Strategies/AbstractStrategy";
import * as helper from "../utils/helper";

/**
 * Class represending an order waiting to be executed in the market.
 * This class makes it easy for us to only pay the maker fee on orders. Just set "postOnly"
 * in orderParameters.
 * Furthermore this class allows strategies to set custom buy/sell rates by calling strategy.getRate().
 * But that is more complicated than just setting "postOnly" because it is the responsibility of the strategy
 * to keep it's internal state until the order has been filled.
 */
export class PendingOrder {
    public readonly exchange: AbstractExchange;
    public readonly strategy: AbstractStrategy;
    public readonly order: Order.Order;
    public readonly orderParameters: OrderParameters;
    public readonly orderResult: OrderResult;

    constructor(exchange: AbstractExchange, strategy: AbstractStrategy, order: Order.Order, orderParameters: OrderParameters, orderResult: OrderResult) {
        this.exchange = exchange;
        this.strategy = strategy;
        this.order = order;
        this.orderParameters = orderParameters;
        this.orderResult = orderResult;
    }
}

export abstract class AbstractOrderTracker {
    protected static readonly MAX_PERCENT_CHANGE_RATE = 3.0;

    protected trader: PortfolioTrader;

    constructor(trader: PortfolioTrader) {
        this.trader = trader;
    }

    public abstract track(pendingOrder: PendingOrder): void;

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected resetOrderTimeout(pendingOrder: PendingOrder) {
        const exchangeName = pendingOrder.exchange.getClassName();
        if (this.trader.removeOrder(exchangeName, pendingOrder.order.orderID))
            this.trader.addOrder(pendingOrder.exchange, pendingOrder.order) // only re-add it if it still existed
    }

    protected cancelOrder(pendingOrder: PendingOrder) {
        const exchangeName = pendingOrder.exchange.getClassName();
        pendingOrder.exchange.cancelPendingOrder(pendingOrder).then((result) => {
            this.trader.removeOrder(exchangeName, pendingOrder.order.orderID);
            logger.verbose("Cancelled pending order", result)
        }).catch((err) => {
            logger.error("Error cancelling pending order", err)
        })
    }

    protected getNewRate(pendingOrder: PendingOrder) {
        let orderBook = pendingOrder.exchange.getOrderBook().get(pendingOrder.order.currencyPair.toString())
        if (!orderBook)
            return -1; // probably not in realtime trader
        //let orderParameters = {}; // parameters stay the same
        let rate = pendingOrder.strategy.getRate(pendingOrder.order.type === Trade.TradeType.BUY ? "buy" : "sell");
        let changePercent = helper.getDiffPercent(rate, pendingOrder.order.rate);
        if (rate !== -1 && Math.abs(changePercent) > AbstractOrderTracker.MAX_PERCENT_CHANGE_RATE) {
            logger.warn("Rate of order to update changed %s% from %s to %s. Strategy probably lost state.", changePercent.toFixed(2), pendingOrder.order.rate.toFixed(8), rate.toFixed(8))
            return -1;
        }
        if (pendingOrder.strategy.forceMakeOnly()) {
            if (rate === -1)
                rate = orderBook.getLast();
            //orderParameters = {postOnly: true}
        }
        else if (rate === -1) {
            if (pendingOrder.order.type === Trade.TradeType.BUY)
                rate = orderBook.getLast() + orderBook.getLast() / 100 * nconf.get('serverConfig:maxPriceDiffPercent')
            else
                rate = orderBook.getLast() - orderBook.getLast() / 100 * nconf.get('serverConfig:maxPriceDiffPercent')
        }
        return rate;
    }

    protected getTimeoutMs(pendingOrder: PendingOrder) {
        // also see getOrderTimeoutSec()
        if (pendingOrder.exchange.isContractExchange())
            return nconf.get("serverConfig:orderContractExchangeAdjustSec") * 1000
        if (pendingOrder.orderParameters.postOnly)
            return nconf.get('serverConfig:orderMakerAdjustSec') * 1000
        return (nconf.get('serverConfig:orderTimeoutSec')/nconf.get("serverConfig:orderAdjustBeforeTimeoutFactor")) * 1000
    }
}