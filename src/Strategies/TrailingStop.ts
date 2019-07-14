import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {AbstractTrailingStop, AbstractTrailingStopAction} from "./AbstractTrailingStop";
import {ClosePositionState} from "./AbstractStopStrategy";
import {TradeAction} from "./AbstractStrategy";
import {TradeInfo} from "../Trade/AbstractTrader";


interface TrailingStopAction extends AbstractTrailingStopAction {
    rate: number; // The rate at which this trailing stop is activated.
    comp: "<" | ">"; // Does the market rate have to cross above or below that rate for the stop to get activated?  Values: <|>
    // TODO add "percentage" to close parameter and expand parent class

    trailingStopPerc: number; // optional, default 0.5% - The trailing stop percentage that will be placed after the configured rate has been crossed.
    closePosition: ClosePositionState; // optional, default always - Only close a position if its profit/loss is in that defined state. Values: always|profit|loss

    time: number; // optional, default 0 = immediately - The time in seconds until the stop gets executed after the trailing stop has been reached.
}

/**
 * Strategy places a trailing stop (in percent) after a user-defined price level has been crossed.
 * This can be used both to take profit or as a stop-loss.
 */
export default class TrailingStop extends AbstractTrailingStop {
    public action: TrailingStopAction;
    protected lastRate: number = -1.0;

    constructor(options) {
        super(options)
        this.validateConfig();
        this.saveState = true;
    }

    public onConfigChanged() {
        super.onConfigChanged();
        this.validateConfig();
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        //if (action === "close") {
        //}
    }

    public serialize() {
        let state = super.serialize();
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        if (this.trailingStopPrice !== -1)
            this.updateStop(false);
        else if (this.action.rate !== 0.0)
            this.checkForStopPlacement();
        return super.tick(trades);
    }

    protected checkIndicators() {
        // nothing to do here
    }

    protected checkForStopPlacement() {
        if (this.strategyPosition === "none")
            return;
        if (this.action.comp === "<" && this.avgMarketPrice < this.action.rate) {
            this.log(utils.sprintf("Placing initial stop at rate %s < %s", this.avgMarketPrice.toFixed(8), this.action.rate));
            this.updateStop(true);
        }
        else if (this.action.comp === ">" && this.avgMarketPrice > this.action.rate) {
            this.log(utils.sprintf("Placing initial stop at rate %s > %s", this.avgMarketPrice.toFixed(8), this.action.rate));
            this.updateStop(true);
        }
    }

    protected validateConfig() {
        if (this.action.rate < 0.0)
            this.action.rate = 0.0; // disabled
        if (this.action.comp !== "<" && this.action.comp !== ">")
            this.action.comp = this.strategyPosition === "long" ? "<" : ">";

        if (this.lastRate !== this.action.rate && this.trailingStopPrice !== -1) {
            this.log("Resetting trailing stop rate %s because of initial rate config change");
            this.trailingStopPrice = -1;
        }
        this.lastRate = this.action.rate;
        // TODO check again on execution we are still below the configured initial price?
    }
}