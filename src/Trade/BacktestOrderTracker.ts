import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Order} from "@ekliptor/bit-models";
import {AbstractTrader} from "./AbstractTrader";
import {PortfolioTrader, LastTradeMap} from "./PortfolioTrader";
import {TradeConfig} from "../Trade/TradeConfig";
import {OrderResult} from "../structs/OrderResult";
import {AbstractExchange, ExchangeMap, OrderParameters, OpenOrders} from "../Exchanges/AbstractExchange";
import {AbstractStrategy, TradeAction} from "../Strategies/AbstractStrategy";
import {AbstractOrderTracker, PendingOrder} from "./AbstractOrderTracker";
import * as helper from "../utils/helper";

export class BacktestOrderTracker extends AbstractOrderTracker {
    protected lastTick: Date = new Date(Date.now() + 365*utils.constants.DAY_IN_SECONDS*1000);
    protected pendingOrders: PendingOrder[] = [];

    constructor(trader: PortfolioTrader) {
        super(trader)
    }

    public track(pendingOrder: PendingOrder) {
        // in simulation we can only track if the market price reaches the rate of the order
        // TODO simulate maker/taker fees in backtesting?

        if (!pendingOrder.orderParameters.postOnly)
            return; // will get taken in backtester or expire. speed up backtesting
        this.pendingOrders.push(pendingOrder)
    }

    public sendTick(trades: Trade.Trade[]) {
        // just check if 20 seconds passed and move our order closer to the market price
        let last = trades[trades.length-1];
        // we only track postOnly orders
        if (this.pendingOrders.length !== 0 && last.date.getTime() + this.getTimeoutMs(/*true*/this.pendingOrders[0]) < this.lastTick.getTime()) {
            this.lastTick = last.date;
            this.trackOrders();
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected trackOrders() {
        let remainingOrders = []
        this.pendingOrders.forEach((pendingOrder) => {
            let rate = -1;
            const exchangeName = pendingOrder.exchange.getClassName();
            const pairStr = pendingOrder.order.currencyPair.toString();
            if (!this.trader.isOpenOrder(exchangeName, pendingOrder.order.orderID))
                return;
            this.resetOrderTimeout(pendingOrder);

            // we are in simulation. all orders submitted are still open unless they have been removed from our local map
            rate = this.getNewRate(pendingOrder);
            if (rate === -1) {
                this.cancelOrder(pendingOrder);
                return
            }
            else if (rate === pendingOrder.order.rate) {
                logger.verbose("Rate of pending %s %s order remains unchanged at %s", exchangeName, pairStr, rate.toFixed(8))
                //this.track(pendingOrder);
                remainingOrders.push(pendingOrder)
                return;
            }
            pendingOrder.order.rate = rate;
            logger.verbose("Moved pending %s order on %s", pairStr, exchangeName);
            //pendingOrder.order.orderID = result.orderNumber.toString(); // moving the order changes the order ID (on poloniex)
            //this.track(pendingOrder);
            remainingOrders.push(pendingOrder)
        })
        this.pendingOrders = remainingOrders;
    }

    protected cancelOrder(pendingOrder: PendingOrder) {
        const exchangeName = pendingOrder.exchange.getClassName();
        this.trader.removeOrder(exchangeName, pendingOrder.order.orderID);
        logger.verbose("Cancelled pending order")
    }

    protected getNewRate(pendingOrder: PendingOrder) {
        const pairStr = pendingOrder.order.currencyPair.toString();
        const marketRate = this.trader.getMarketRates().get(pairStr);
        //let orderParameters = {}; // parameters stay the same
        let rate = pendingOrder.strategy.getRate(pendingOrder.order.type === Trade.TradeType.BUY ? "buy" : "sell");
        let changePercent = helper.getDiffPercent(rate, pendingOrder.order.rate);
        if (rate !== -1 && Math.abs(changePercent) > AbstractOrderTracker.MAX_PERCENT_CHANGE_RATE) {
            logger.warn("Rate of order to update changed %s% from %s to %s. Strategy probably lost state.", changePercent.toFixed(2), pendingOrder.order.rate.toFixed(8), rate.toFixed(8))
            return -1;
        }
        if (pendingOrder.strategy.forceMakeOnly()) {
            if (rate === -1)
                rate = marketRate;
            //orderParameters = {postOnly: true}
        }
        else if (rate === -1) {
            if (pendingOrder.order.type === Trade.TradeType.BUY)
                rate = marketRate + marketRate / 100 * nconf.get('serverConfig:maxPriceDiffPercent')
            else
                rate = marketRate - marketRate / 100 * nconf.get('serverConfig:maxPriceDiffPercent')
        }
        return rate;
    }
}