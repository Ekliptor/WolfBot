import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {PendingOrder} from "../Trade/AbstractOrderTracker";

export class SimpleOrder {
    public rate: number;
    public amount: number;
    public filledAmount: number = 0.0;
    public pendingOrder: PendingOrder = null;

    constructor(rate: number, amount: number) {
        this.rate = rate;
        this.amount = amount;
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

    constructor(date: Date, buyOrder: SimpleOrder, sellOrder: SimpleOrder) {
        this.date = date;
        this.buyOrder = buyOrder;
        this.sellOrder = sellOrder;
    }

    public toString(marketTime?: Date) {
        if (!marketTime)
            marketTime = new Date();
        return utils.sprintf("when: %s ago, buy: %s, sell: %s", utils.test.getPassedTime(this.date.getTime(), marketTime.getTime()),
            this.buyOrder ? this.buyOrder.toString() : "-",
            this.sellOrder ? this.sellOrder.toString() : "-");
    }
}
