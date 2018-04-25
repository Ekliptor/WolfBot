import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";

/**
 * A strategy that times out given market orders. Useful if an order doesn't get through for unknown reasons (buggy exchange?).
 * You have to call checkTimeout() (for example in tick() ).
 */
export abstract class AbstractTimeoutStrategy extends AbstractStrategy {
    protected orderTimeoutStart: Date = null;

    constructor(options) {
        super(options)
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected abstract onTimeout(): void;

    protected startTimeout() {
        this.orderTimeoutStart = this.marketTime;
    }

    protected clearTimeout() {
        this.orderTimeoutStart = null;
    }

    protected checkTimeout() {
        if (this.orderTimeoutStart === null || this.orderTimeoutStart.getTime() + nconf.get('serverConfig:orderTimeoutSec')*1000 > this.marketTime.getTime())
            return;
        //const pairStr = this.action.pair.toString();
        this.warn(utils.sprintf("order timeout - started: %s ago",
            utils.test.getPassedTime(this.orderTimeoutStart.getTime(), this.marketTime.getTime())))
        this.orderTimeoutStart = null;
        this.onTimeout();
    }
}