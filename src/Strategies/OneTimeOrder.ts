import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

interface OneTimeAction extends StrategyAction {
    order: "buy" | "sell"; // The type of the order.
    stop: number; // 0.05226790 BTC // The trigger (and price) at which to place the order.

    // optional. default buy <, sell >
    // Does the price have to be higher or lower than the stop?
    // 'pass' means the price has to pass this threshold.
    comp: "<" | ">" | "pass";

    forceMaker: boolean; // optional. default false. Only place a maker order (not paying the higher taker fee).
    // TODO stop % - option to trigger the order at x% away from the moment the bot starts
}

/**
 * Place a one-time order once the price reaches a certain level
 * can not be done with a stop because a buy stop triggers at increasing price (and sell at decreasing).
 * Also useful with a trade strategy such as RSIScalpOrderer to wait for the order to be put in at the right moment.
 */
export default class OneTimeOrder extends AbstractStrategy {
    protected action: OneTimeAction;
    protected lastStop = 0;
    protected previousTrade: Trade.Trade = null;

    constructor(options) {
        super(options)
        if (this.action.comp !== "<" && this.action.comp !== ">") {
            if (this.action.order === "buy")
                this.action.comp = "<";
            else
                this.action.comp = ">";
        }
        if (this.action.order !== "buy" && this.action.order !== "sell")
            throw new Error("Invalid order type: " + this.action.order)
        this.lastStop = this.action.stop;

        this.addInfo("done", "done");
        this.runOnce = true;
    }

    public forceMakeOnly() {
        return this.action.forceMaker === true;
    }

    public serialize() {
        let state = super.serialize();
        delete state.strategyOrder; // don't keep the current order as state. load it again from config
        return state;
    }

    public onConfigChanged() {
        super.onConfigChanged();
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            if (this.lastStop !== this.action.stop) { // TODO move to onConfigChanged() once it works for all cases
                this.done = false; // allow trading again at new price
                this.lastStop = this.action.stop;
                this.log("Allowing to trade again because stop config value changed");
            }
            if (this.done)
                return resolve();

            if (this.action.comp !== "pass")
                this.checkComparatorOrder();
            else
                this.checkPassByOrder(trades);

            resolve()
        })
    }

    protected checkComparatorOrder() {
        if (this.action.comp === "<") {
            if (this.avgMarketPrice < this.action.stop)
                this.executeTrade();
        }
        else if (this.action.comp === ">") {
            if (this.avgMarketPrice > this.action.stop)
                this.executeTrade();
        }
    }

    protected checkPassByOrder(trades: Trade.Trade[]) {
        trades.forEach((trade) => {
            // we trigger it if any of the trades pass our threshold
            // this guarantees to buy into sharp temporary drops
            if (this.done)
                return;
            if (!this.previousTrade) {
                this.previousTrade = trade;
                return;
            }
            // TODO always check the closing price too? sometimes this is too slow for trading because the latest price is already up again
            if (this.previousTrade.rate >= this.action.stop && trade.rate <= this.action.stop)
                this.executeTrade();
            else if (this.previousTrade.rate <= this.action.stop && trade.rate >= this.action.stop)
                this.executeTrade();
            this.previousTrade = trade;
        })
    }

    protected executeTrade() {
        let msg = utils.sprintf("Price %s %s for %s", this.action.comp, this.action.stop, this.action.order);
        this.log(msg);
        if (this.action.order === "buy")
            this.emitBuy(Number.MAX_VALUE, msg);
        else if (this.action.order === "sell")
            this.emitSell(Number.MAX_VALUE, msg);
        else
            this.log("Can not execute unknown order type: " + this.action.order);
        this.done = true;
    }

    protected adjustStaticOrder() {
        // do nothing, don't change the order
    }
}