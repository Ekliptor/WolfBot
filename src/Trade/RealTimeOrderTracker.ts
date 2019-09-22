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

export class RealTimeOrderTracker extends AbstractOrderTracker {
    constructor(trader: PortfolioTrader) {
        super(trader)
    }

    public track(pendingOrder: PendingOrder) {
        // for pendingOrder.orderParameters.postOnly === true:
        // we don't want to pay the taker fee
        // to do this we need a map of our open offers and have to constantly cancel/adjust them until they are being taken

        // it would be nice if the push API orders would tell us when our own orders have been filled. but at least on poloniex we could only
        // guess that, but there is no orderID to be sure. So it's safer to call getOpenOrders()

        //if (this.skipTrackingOrder(pendingOrder) === true)
            //return; // we still have to track when it's filled (just not move it)

        setTimeout(() => {
            this.resetOrderTimeout(pendingOrder);
            let rate = -1;
            const exchangeName = pendingOrder.exchange.getClassName();
            const pairStr = pendingOrder.order.currencyPair.toString();
            pendingOrder.exchange.getOpenOrders(pendingOrder.order.currencyPair).then((orders) => {
                this.sendOpenOrders(pendingOrder, orders);
                if (!orders.isOpenOrder(pendingOrder.order.orderID)) {
                    const typeStr = Trade.TradeType[pendingOrder.order.type]
                    // TODO once poloniex just cancelled an order. wtf?
                    logger.info("Order %s %s at %s with ID %s has filled completely", typeStr, pairStr,
                        exchangeName, pendingOrder.order.orderID)
                    this.sendOrderFilled(pendingOrder);
                    return
                }
                if (this.skipTrackingOrder(pendingOrder) === true)
                    return;

                rate = this.getNewRate(pendingOrder);
                if (rate == 0) { // TODO why?
                    logger.error("Rate of %s order to move is 0 in %s. Setting to last price", pairStr, exchangeName);
                    rate = pendingOrder.exchange.getOrderBook().get(pairStr).getLast();
                }
                if (rate === -1) {
                    this.cancelOrder(pendingOrder);
                    return
                }
                else if (rate === pendingOrder.order.rate) {
                    logger.verbose("Rate of pending %s %s order remains unchanged at %s", exchangeName, pairStr, rate.toFixed(8))
                    this.track(pendingOrder);
                    return;
                }
                // TODO add an expiration time if the price "moves away" constantly? unlikely
                pendingOrder.order.rate = rate;
                pendingOrder.exchange.movePendingOrder(pendingOrder).then((result) => {
                    logger.info("Moved pending %s order on %s", pairStr, exchangeName, result);
                    pendingOrder.order.orderID = result.orderNumber.toString(); // moving the order changes the order ID (on poloniex)
                    // TODO when a margin order on poloniex gets split up (because of lending) we have 2 order IDs but only track 1
                    this.track(pendingOrder);
                }).catch((err) => {
                    // TODO reset the old rate if moving failed? but repeating "unable to move to this price" errors then don't get caught above
                    logger.error("Error moving %s order on %s", pairStr, exchangeName, err)
                    if (pendingOrder.exchange.repeatFailedTrade(err, pendingOrder.strategy.getAction().pair))
                        this.track(pendingOrder); // most likely a postOnly order we can't move to this price. try again
                })
            }).catch((err) => {
                logger.error("Error tracking %s order on %s", pairStr, exchangeName, err)
                this.track(pendingOrder); // mostly API error
            })
        }, this.getTimeoutMs(pendingOrder))
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}
