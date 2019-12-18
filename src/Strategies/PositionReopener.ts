import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, StrategyPosition, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import * as _ from "lodash";
import {TradeInfo} from "../Trade/AbstractTrader";
import {MarginPosition} from "../structs/MarginPosition";

interface PositionReopenerAction extends TechnicalStrategyAction {
    reOpenRateFactorLong: number; // optional, default 1.0 - The rate that must be reached (higher than previous closing rate) to re-open a previously closed long position. The current market rate will be multiplied by this. Values above 1.0 mean a higher rate, below 1.0 mean a lower rate.
    reOpenRateFactorShort: number; // optional, default 1.0 - The rate that must be reached (lower than previous closing rate) to re-open a previously closed short position. The current market rate will be multiplied by this. Values above 1.0 mean a higher rate, below 1.0 mean a lower rate.
    reOpenAmountPerc: number; // optional, default 100%. The amount in percentage of the previously closed position that shall be re-opened. You may use values above 100% to increase your position site.
    expiryMin: number; // optional, default 360 min - How many minutes a previously closed position shall be queued for re-opening. Use 0 to never let scheduled orders expire.
    waitOpenMin: number; // optional, default 0 = immediately - How many minutes to wait at least before re-opening a position.

    makerMode: boolean; // optional, default false. Whether to adjust all order rates below/above bid ask rates to ensure we only pay the lower (maker) fee.
}

/**
 * A strategy that re-open a previously closed position (closed by WolfBot or manually) after
 * price moves again a certain percentage in the direction of your previous position (from the close price).
 * This is helpful if you have a strong bias in one direction but also want to trade cautious at a
 * support/resistance line and always place a stop.
 * This strategy should run on a low candle size (1min) to react quickly.
 */
export default class PositionReopener extends TechnicalStrategy {
    public action: PositionReopenerAction;
    protected lastPositionAmount: number = -1.0;
    protected lastCloseRate: number = -1.0;
    protected lastPositionDirection: StrategyPosition = "none";
    protected lastClosedPositionTime: Date = null;

    constructor(options) {
        super(options)
        if (typeof this.action.reOpenRateFactorLong !== "number")
            this.action.reOpenRateFactorLong = 1.0;
        if (typeof this.action.reOpenRateFactorShort !== "number")
            this.action.reOpenRateFactorShort = 1.0;
        if (typeof this.action.reOpenAmountPerc !== "number")
            this.action.reOpenAmountPerc = 100.0;
        if (typeof this.action.expiryMin !== "number")
            this.action.expiryMin = 360;
        if (typeof this.action.waitOpenMin !== "number")
            this.action.waitOpenMin = 0;
        if (typeof this.action.makerMode !== "boolean")
            this.action.makerMode = false;

        this.addInfo("lastPositionAmount", "lastPositionAmount");
        this.addInfo("lastCloseRate", "lastCloseRate");
        this.addInfo("lastPositionDirection", "lastPositionDirection");
        this.addInfo("lastClosedPositionTime", "lastClosedPositionTime");
        this.saveState = true;

        // testing code
        /*
        setTimeout(() => {
            this.emitBuy(this.defaultWeight, "test buy");
            setTimeout(() => {
                this.emitClose(this.defaultWeight, "test close");
            }, 9000);
        }, 5000);
         */
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        const amount = Math.abs(this.getPositionAmount());
        const direction = this.strategyPosition;
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            this.checkPositionClosed(amount, direction);
        }
    }

    public onSyncPortfolio(coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange) {
        const amount = Math.abs(this.getPositionAmount());
        const direction = this.strategyPosition;
        super.onSyncPortfolio(coins, position, exchangeLabel);
        if (this.strategyPosition === "none" && direction !== "none") {
            this.checkPositionClosed(amount, direction);
        }
    }

    public getOrderAmount(tradeTotalBtc: number, leverage: number = 1): number {
        //let amount = super.getOrderAmount(tradeTotalBtc, leverage);
        //if (leverage > 1.0)
            //amount /= leverage; // don't increase it on every re-opening
        let amount = this.lastPositionAmount * this.avgMarketPrice; // rate is stored in coin amount, order is submitted in base currency
        return amount / 100.0 * this.action.reOpenAmountPerc;
    }

    public serialize() {
        let state = super.serialize();
        state.lastPositionAmount = this.lastPositionAmount;
        state.lastCloseRate = this.lastCloseRate;
        state.lastPositionDirection = this.lastPositionDirection;
        state.lastClosedPositionTime = this.lastClosedPositionTime;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.lastPositionAmount = state.lastPositionAmount;
        this.lastCloseRate = state.lastCloseRate;
        this.lastPositionDirection = state.lastPositionDirection;
        this.lastClosedPositionTime = state.lastClosedPositionTime;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        const now = this.getMarketTime().getTime();
        if (this.lastClosedPositionTime === null)
            return;
        else if (this.action.expiryMin > 0 && this.lastClosedPositionTime.getTime() + this.action.expiryMin*utils.constants.MINUTE_IN_SECONDS*1000 < now) {
            this.log(utils.sprintf("Scheduled action to re-open position has expired after %s min", this.action.expiryMin));
            this.lastClosedPositionTime = null; // delete the scheduled action to re-open
            return;
        }
        else if (this.action.reOpenAmountPerc <= 0.0) {
            this.log("Skipped re-opening position because 'reOpenAmountPerc' config value is not positive.");
            this.lastClosedPositionTime = null;
            return;
        }
        else if (this.lastClosedPositionTime.getTime() + 2*nconf.get("serverConfig:updatePortfolioSec")*1000 > now)
            return; // don't try to re-open it yet or else stop strategy might close it again immediately (as a remaining open position)
        else if (this.action.waitOpenMin > 0 && this.lastClosedPositionTime.getTime() + this.action.waitOpenMin*utils.constants.MINUTE_IN_SECONDS*1000 > now) {
            this.logOnce(utils.sprintf("Skipped re-opening position because %s min have not passed yet since close.", this.action.waitOpenMin));
            return;
        }
        else if (this.strategyPosition !== "none") {
            this.log(utils.sprintf("Skipped re-opening position because there is already a %s position open again.", this.strategyPosition.toUpperCase()));
            this.lastClosedPositionTime = null;
            return;
        }

        // re-open the position
        if (this.lastPositionDirection === "long") {
            const openTargetRate = this.lastCloseRate * this.action.reOpenRateFactorLong;
            if (this.avgMarketPrice > openTargetRate) {
                this.emitBuy(this.defaultWeight, utils.sprintf("Re-opening %s %s LONG position closed at rate %s after %s", this.lastPositionAmount.toFixed(8), Currency.getCurrencyLabel(this.action.pair.to),
                    this.lastCloseRate.toFixed(8), utils.test.getPassedTime(this.lastClosedPositionTime.getTime(), now)));
                this.lastClosedPositionTime = null; // to ensure we don't re-open multiple times
            }
        }
        else if (this.lastPositionDirection === "short") {
            const openTargetRate = this.lastCloseRate * this.action.reOpenRateFactorShort;
            if (this.avgMarketPrice < openTargetRate) {
                this.emitBuy(this.defaultWeight, utils.sprintf("Re-opening %s %s SHORT position closed at rate %s after %s", this.lastPositionAmount.toFixed(8), Currency.getCurrencyLabel(this.action.pair.to),
                    this.lastCloseRate.toFixed(8), utils.test.getPassedTime(this.lastClosedPositionTime.getTime(), now)));
                this.lastClosedPositionTime = null; // to ensure we don't re-open multiple times
            }
        }
    }

    protected checkPositionClosed(prevAmount: number, prevDirection: StrategyPosition) {
        if (prevAmount > 0.0 && prevDirection !== "none") { // just to be sure
            this.lastPositionAmount = prevAmount;
            this.lastCloseRate = this.avgMarketPrice;
            this.lastPositionDirection = prevDirection;
            this.lastClosedPositionTime = this.getMarketTime();
        }
    }
}
