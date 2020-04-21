import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {AbstractStopStrategy, AbstractStopStrategyAction} from "./AbstractStopStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";

interface StopLossAction extends AbstractStopStrategyAction {
    stop: number; // The price at which the stop shall be triggered. For long positions the price has to move below this value, for short positions above.
    time: number; // default 0. in seconds
    //limit: number; // Price will be the price of the last trade. Order gets moved if not filled.
}

/**
 * A simple stop loss strategy with an additional parameter 'time'.
 * It will start a counter down to 0 seconds if the stop price is reached. The stop will only be triggered after the counter reaches 0.
 * The counter gets reset every time the price moves above the stop.
 */
export default class StopLossTime extends AbstractStopStrategy {
    public action: StopLossAction;

    constructor(options) {
        super(options)
        if (!this.action.time)
            this.action.time = 0;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            if (this.tradeTick >= nconf.get('serverConfig:tradeTickLog')) {
                this.tradeTick -= nconf.get('serverConfig:tradeTickLog');
                // TODO poloniex sometimes (when high load) has different prices on API and website (api lower while bouncing back up). WTF?
                // their website uses wss://api2.poloniex.com/ - connect to both and detect differences to profit?
                this.log("market price", this.avgMarketPrice)
            }
            if (this.strategyPosition !== "none") {
                if (this.isCloseLongPending() === true)
                    this.checkStopSell();
                else if (this.isCloseShortPending() === true)
                    this.checkStopBuy();
            }
            resolve()
        })
    }

    protected getStopPrice() {
        return this.action.stop
    }

    protected checkStopSell() {
        if (this.avgMarketPrice > this.action.stop) {
            this.stopCountStart = null;
            return;
        }
        if (!this.stopCountStart)
            this.stopCountStart = this.marketTime;
        else if (this.stopCountStart.getTime() + this.action.time * 1000 <= this.marketTime.getTime()) {
            this.log("emitting sell because price dropped to", this.avgMarketPrice);
            this.emitSellClose(Number.MAX_VALUE, "price dropped");
        }
    }

    protected checkStopBuy() {
        if (this.avgMarketPrice < this.action.stop) {
            this.stopCountStart = null;
            return;
        }
        if (!this.stopCountStart)
            this.stopCountStart = this.marketTime; // TODO time doesn't trigger if there are no new trades. but very unrealistic
        else if (this.stopCountStart.getTime() + this.action.time * 1000 <= this.marketTime.getTime()) {
            this.log("emitting buy because price rose to", this.avgMarketPrice);
            this.emitBuyClose(Number.MAX_VALUE, "price rose");
        }
    }

    protected resetValues() {
        this.stopCountStart = null;
        super.resetValues();
    }
}
