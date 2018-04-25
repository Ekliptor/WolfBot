import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {AbstractStopStrategy, AbstractStopStrategyAction} from "./AbstractStopStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";

interface StopLossAction extends AbstractStopStrategyAction {
    stop: number;
    time: number; // in seconds
    limit: number;
}

/**
 * A regular stop loss strategy with an additional parameter "time".
 * The stop loss will only be triggered after the "stop" value has passed for the specified amount of time.
 */
export default class StopLossTime extends AbstractStopStrategy {
    public action: StopLossAction;

    constructor(options) {
        super(options)
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
                if (this.action.order === "sell" || this.action.order === "closeLong")
                    this.checkStopSell();
                else if (this.action.order === "buy" || this.action.order === "closeShort")
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