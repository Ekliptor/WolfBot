import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {PendingOrder} from "../Trade/AbstractOrderTracker";
import {AbstractStrategy} from "../Strategies/AbstractStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";

export class SimpleOrder {
    public rate: number;
    public amount: number;
    public filledAmount: number = 0.0;
    public pendingOrder: PendingOrder = null;

    constructor(rate: number, amount: number) {
        this.rate = rate;
        this.amount = amount;
    }

    public serialize() {
        return {
            rate: this.rate,
            amount: this.amount,
            filledAmount: this.filledAmount,
            pendingOrder: {
                exchange: null, // recursive references, don't serialize
                strategy: null,
                order: this.pendingOrder.order,
                orderParameters: this.pendingOrder.orderParameters,
                orderResult: this.pendingOrder.orderResult
            }
        }
    }

    public addFilled(filledAmountAdditional: number) {
        this.filledAmount += filledAmountAdditional;
        if (this.filledAmount > this.amount)
            this.filledAmount = this.amount;
    }

    public toString() {
        return utils.sprintf("%s@%s", this.amount.toFixed(8), this.rate.toFixed(8));
    }
}

export class OrderPair {
    //orderID: string;
    //order: Order.Order;
    public date: Date;
    public buyOrder: SimpleOrder;
    public sellOrder: SimpleOrder;

    constructor(date: Date, buyOrder: SimpleOrder, sellOrder: SimpleOrder, fromStrategy?: AbstractStrategy) {
        this.date = date;
        this.buyOrder = buyOrder;
        this.sellOrder = sellOrder;
        if (!fromStrategy)
            return;
        if (this.buyOrder && this.buyOrder.pendingOrder)
            this.buyOrder.pendingOrder = new PendingOrder(null, fromStrategy, Object.assign(new Order.Order(), this.buyOrder.pendingOrder.order), this.buyOrder.pendingOrder.orderParameters, this.buyOrder.pendingOrder.orderResult);
        if (this.sellOrder && this.sellOrder.pendingOrder)
            this.sellOrder.pendingOrder = new PendingOrder(null, fromStrategy, Object.assign(new Order.Order(), this.sellOrder.pendingOrder.order), this.sellOrder.pendingOrder.orderParameters, this.sellOrder.pendingOrder.orderResult);
    }

    public serialize() {
        return {
            date: this.date,
            buyOrder: this.buyOrder ? this.buyOrder.serialize() : null,
            sellOrder: this.sellOrder ? this.sellOrder.serialize() : null
        }
    }

    public static unserialize(order: any, strategy: AbstractStrategy): OrderPair {
        let pair = new OrderPair(order.date, order.buyOrder, order.sellOrder, strategy);
        if (pair.buyOrder)
            pair.buyOrder = Object.assign(new SimpleOrder(pair.buyOrder.rate, pair.buyOrder.amount), pair.buyOrder);
        if (pair.sellOrder)
            pair.sellOrder = Object.assign(new SimpleOrder(pair.sellOrder.rate, pair.sellOrder.amount), pair.sellOrder);
        return pair;
    }

    public toString(marketTime?: Date) {
        if (!marketTime)
            marketTime = new Date();
        return utils.sprintf("when: %s ago, buy: %s, sell: %s", utils.test.getPassedTime(this.date.getTime(), marketTime.getTime()),
            this.buyOrder ? this.buyOrder.toString() : "-",
            this.sellOrder ? this.sellOrder.toString() : "-");
    }
}
