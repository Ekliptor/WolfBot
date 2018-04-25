import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";

interface WhaleWatcherAction extends StrategyAction {
    triggerAmountBtc: number; // 130 BTC
}

/**
 * detect orders with total amount > x aka orders from big fish and follow them
 * often somebody sells > 130 BTC worth of coins on the market to bring the price down for a few seconds
 * detect this. also see SpikeDetector
 */
export default class WhaleWatcher extends AbstractStrategy {
    protected action: WhaleWatcherAction;

    constructor(options) {
        super(options)
        this.defaultWeight = 110;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            trades.forEach((trade) => {
                this.checkWhaleOrder(trade)
            })

            resolve()
        })
    }

    protected checkWhaleOrder(trade: Trade.Trade) {
        if (trade.total < this.action.triggerAmountBtc)
            return;
        let msg = "Whale found (BTC): " + trade.total + " " + Trade.TradeType[trade.type];
        this.log(msg)
        if (trade.type === Trade.TradeType.SELL)
            this.emitSell(this.defaultWeight, msg);
        else
            this.emitBuy(this.defaultWeight, msg);
    }
}