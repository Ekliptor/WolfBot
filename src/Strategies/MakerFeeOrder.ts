import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";

interface MakerFeeAction extends StrategyAction {
    order: "buy" | "sell";
    // rate is always the current market price
    //rate: number; // 0.05226790 BTC // the price at which to place the order

    // to trigger an order at a specific rate (stop) use OneTimeOrder strategy
}

/**
 * A strategy that makes a one order as maker (not paying taker fee).
 * It uses "forceMakeOnly()" function in AbstractStrategy.
 */
export default class MakerFeeOrder extends AbstractStrategy {
    protected action: MakerFeeAction;
    protected started = false;

    constructor(options) {
        super(options)
        this.runOnce = true;
    }

    public getRate() {
        return -1;
    }

    public forceMakeOnly() {
        return true;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            if (this.done)
                return resolve();
            this.executeTrade();
            resolve()
        })
    }

    protected executeTrade() {
        let msg = utils.sprintf("Executing %s %s order", this.action.order, this.action.pair.toString());
        this.log(msg);
        if (this.action.order === "buy")
            this.emitBuy(Number.MAX_VALUE, msg);
        else
            this.emitSell(Number.MAX_VALUE, msg);
        this.done = true;
    }
}