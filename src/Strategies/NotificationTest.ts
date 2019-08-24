import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";

interface NotificationTestAction extends TechnicalStrategyAction {
    message: string;
}

/**
 * This strategy sends a notification every minute. Use this to test your (smartphone) notification setup.
 * It does not perform any trades.
 */
export default class NotificationTest extends TechnicalStrategy {
    public action: NotificationTestAction;

    constructor(options) {
        super(options)
        if (nconf.get("trader") === "Backtester")
            throw new Error(utils.sprintf("%s is not available during backtesting because notifications can only be sent during live trading.", this.className));

        this.addInfoFunction("sample", () => {
            return this.action.message;
        });
        setInterval(() => {
            const now = new Date();
            let text = utils.sprintf("%s, %s UTC", this.action.message, utils.getUnixTimeStr(true, now, true));
            this.sendNotification("Test notification", text, false, true, false);
        }, 1*utils.constants.MINUTE_IN_SECONDS*1000);
    }

    public getMinWarumCandles() {
        return 0; // ensure we don't start any trade imports with this strategy
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        // this strategy does nothing
    }
}
