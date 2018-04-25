import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {
    AbstractStrategy, ScheduledTrade, StrategyAction, StrategyOrder, StrategyPosition,
    TradeAction
} from "./AbstractStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {AbstractOrderer} from "./AbstractOrderer";


export class TriggerOrderCommand {
    action: StrategyOrder; // the order to execute
    comp: "<" | ">"; // comparator: if the price has to be greater or less to execute the order
    rate: number; // the min/max rate for the buy/sell/close order
    time: number = 0; // optional. time in seconds to wait before executing the order. 0 = immediately
    keepTrendOpen: boolean = false; // don't close a position if the last candle moved in our direction
    verifyCloseFn?: () => boolean; // a function to call after "time" passed to decide if we really should close the position
    closeOnly: boolean = false; // don't trade if strategyPosition === "none"
    reason: string; // optional, for display
    constructor(action: StrategyOrder, comp: "<" | ">", rate: number, reason = "") {
        this.action = action;
        this.comp = comp;
        this.rate = rate;
        this.reason = reason;
    }
}

export abstract class AbstractTriggerOrder extends AbstractOrderer {
    protected pendingTriggerOrder: TriggerOrderCommand = null;

    constructor(options) {
        super(options)

        this.addInfoFunction("pendingTriggerOrder", () => {
            if (!this.pendingTriggerOrder)
                return "";
            return this.pendingTriggerOrder.action + "@" + this.pendingTriggerOrder.rate;
        });
    }

    public addTriggerOrder(tradeCmd: TriggerOrderCommand, scheduledTrade: ScheduledTrade = null) {
        this.pendingOrder = null; // to ensure our new order gets set
        this.pendingTriggerOrder = tradeCmd;
        if (!scheduledTrade)
            scheduledTrade = this.getTradeFromTriggerOrder(tradeCmd);
        this.addOrder(scheduledTrade);
    }

    public serialize() {
        let state = super.serialize();
        state.pendingTriggerOrder = this.pendingTriggerOrder;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        if (state.pendingTriggerOrder)
            this.pendingTriggerOrder = state.pendingTriggerOrder;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        // we don't have our own indicators, they are part of strategy group
    }

    protected getTradeFromTriggerOrder(tradeCmd: TriggerOrderCommand) {
        // note that trade.fromClass will be wrong in this case (pointing to this class instead of the class that added the order)
        let trade = new ScheduledTrade(this.toTradeAction(tradeCmd.action), this.defaultWeight, tradeCmd.reason, this.className);
        return trade;
    }
}