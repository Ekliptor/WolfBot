import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, StrategyPosition, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import {MarginPosition} from "../structs/MarginPosition";
import * as helper from "../utils/helper";

interface PositionReopenerAction extends TechnicalStrategyAction {
    reOpenRateFactorLong: number; // optional, default 1.0 - The rate that must be reached (higher than previous closing rate) to re-open a previously closed long position. The current market rate will be multiplied by this. Values above 1.0 mean a higher rate, below 1.0 mean a lower rate.
    reOpenRateFactorShort: number; // optional, default 1.0 - The rate that must be reached (lower than previous closing rate) to re-open a previously closed short position. The current market rate will be multiplied by this. Values above 1.0 mean a higher rate, below 1.0 mean a lower rate.
    reOpenAmountPerc: number; // optional, default 100%. The amount in percentage of the previously closed position that shall be re-opened. You may use values above 100% to increase your position site.
    expiryMin: number; // optional, default 360 min - How many minutes a previously closed position shall be queued for re-opening. Use 0 to never let scheduled orders expire.
    waitOpenMin: number; // optional, default 0 = immediately - How many minutes to wait at least before re-opening a position.
    expirationPercent: number; // optional default 1.0% - Only re-open a previous position if price has changed less than this amount in percent since the position was closed.
    reopenOncePerMinutes: number; // optional, default 0 min = unlimited - How many times to re-open a position at most within this specified interval. Use this to prevent a position constantly flipping and costing fees.

    makerMode: boolean; // optional, default false. Whether to adjust all order rates below/above bid ask rates to ensure we only pay the lower (maker) fee.
}

/**
 * A strategy that re-open a previously closed position (closed by WolfBot or manually) after
 * price moves again a certain percentage in the direction of your previous position (from the close price).
 * This is helpful if you have a strong bias in one direction but also want to trade cautious at a
 * support/resistance line and always place a stop.
 * This strategy should run on a low candle size (1min) to react quickly.
 * You can use this strategy with manual stops too. It will re-open positions that have not been closed by WolfBot.
 */
export default class PositionReopener extends TechnicalStrategy {
    public action: PositionReopenerAction;
    protected lastPositionAmount: number = -1.0;
    protected lastCloseRate: number = -1.0;
    protected lastPositionDirection: StrategyPosition = "none";
    protected lastClosedPositionTime: Date = null;
    protected lastNearestStop: number = -1.0;
    protected lastPositionOpenTime = new Date(0);

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
        if (!this.action.expirationPercent)
            this.action.expirationPercent = 1.0;
        if (!this.action.reopenOncePerMinutes)
            this.action.reopenOncePerMinutes = 0;
        if (typeof this.action.makerMode !== "boolean")
            this.action.makerMode = false;

        this.addInfo("lastPositionAmount", "lastPositionAmount");
        this.addInfo("lastCloseRate", "lastCloseRate");
        this.addInfo("lastPositionDirection", "lastPositionDirection");
        this.addInfo("lastClosedPositionTime", "lastClosedPositionTime");
        this.addInfo("lastPositionOpenTime", "lastPositionOpenTime");
        this.addInfo("nearestStop", "lastNearestStop");
        this.saveState = true;
        this.logOnceTimeoutMin = Math.max(5, this.action.candleSize);

        // testing code
        /*
        setTimeout(() => {
            this.emitBuy(this.defaultWeight, "test buy");
            setTimeout(() => {
                this.emitClose(this.defaultWeight, "test close");
            }, 9000);
        }, 5000);
         */
        setTimeout(() => {
            this.getNearestStop();
        }, 5000);
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
        state.lastNearestStop = this.lastNearestStop;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.lastPositionAmount = state.lastPositionAmount;
        this.lastCloseRate = state.lastCloseRate;
        this.lastPositionDirection = state.lastPositionDirection;
        this.lastClosedPositionTime = state.lastClosedPositionTime;
        this.lastNearestStop = state.lastNearestStop || -1.0;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        const now = this.getMarketTime().getTime();
        // check expiry of re-opening first
        if (this.lastClosedPositionTime === null)
            return;
        else if (this.action.expiryMin > 0 && this.lastClosedPositionTime.getTime() + this.action.expiryMin*utils.constants.MINUTE_IN_SECONDS*1000 < now) {
            this.log(utils.sprintf("Scheduled action to re-open position has expired after %s min", this.action.expiryMin));
            this.lastClosedPositionTime = null; // delete the scheduled action to re-open
            return;
        }

        const nearestStop = this.getNearestStop(); // do this first so we always update lastNearestStop
        if (nearestStop > 0.0 && nearestStop !== Number.MAX_VALUE) {
            this.lastNearestStop = nearestStop; // TODO expire? overwrite from new position stop should be enough. if we don't trade manually we don't want this to change (and won't update our stop settings)
            // TODO add % setting rate must be above/below stop to prevent closing again too quickly and avoid fees
            if (this.lastPositionDirection === "long" && nearestStop > this.avgMarketPrice) {
                this.logOnce(utils.sprintf("Skipped re-opening LONG position because there is a stop above current market price: %s > %s", nearestStop.toFixed(8), this.avgMarketPrice.toFixed(8)));
                return;
            }
            else if (this.lastPositionDirection === "short" && nearestStop < this.avgMarketPrice) {
                this.logOnce(utils.sprintf("Skipped re-opening SHORT position because there is a stop below current market price: %s < %s", nearestStop.toFixed(8), this.avgMarketPrice.toFixed(8)));
                return;
            }
            // TODO also iterate over abstract take profit strategies and ensure we have not reached the stop? (avoid trading fees by closing immediately with 0.xx% profit only)
        }

        // check other conditions to re-open
        if (this.action.reOpenAmountPerc <= 0.0) {
            this.log("Skipped re-opening position because 'reOpenAmountPerc' config value is not positive.");
            this.lastClosedPositionTime = null;
            return;
        }
        else if (this.lastClosedPositionTime.getTime() + 3*nconf.get("serverConfig:updatePortfolioSec")*1000 > now)
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
        else if (this.isWithinRange(this.avgMarketPrice, this.lastCloseRate) === false) {
            const percentDif = helper.getDiffPercent(this.avgMarketPrice, this.lastCloseRate)
            this.logOnce(utils.sprintf("Skipped re-opening position because rate %s is over %s%% away from previous close rate. Away %s%%", this.avgMarketPrice.toFixed(8),
                this.action.expirationPercent, percentDif.toFixed(2)));
            //this.lastClosedPositionTime = null; // let it open later
            return;
        }
        else if (this.lastPositionOpenTime.getTime() + this.action.reopenOncePerMinutes*utils.constants.MINUTE_IN_SECONDS*1000 > this.marketTime.getTime()) {
            this.logOnce(utils.sprintf("Skipped re-opening position because it was recently reopened: %s ago", utils.test.getPassedTime(this.lastPositionOpenTime.getTime(), this.marketTime.getTime())));
            return;
        }

        // re-open the position
        if (this.lastPositionDirection === "long") {
            const openTargetRate = this.lastCloseRate * this.action.reOpenRateFactorLong;
            if (this.avgMarketPrice > openTargetRate) {
                this.emitBuy(this.defaultWeight, utils.sprintf("Re-opening %s %s LONG position closed at rate %s after %s", this.lastPositionAmount.toFixed(8), Currency.getCurrencyLabel(this.action.pair.to),
                    this.lastCloseRate.toFixed(8), utils.test.getPassedTime(this.lastClosedPositionTime.getTime(), now)));
                this.lastClosedPositionTime = null; // to ensure we don't re-open multiple times
                this.lastPositionOpenTime = this.marketTime;
            }
        }
        else if (this.lastPositionDirection === "short") {
            const openTargetRate = this.lastCloseRate * this.action.reOpenRateFactorShort;
            if (this.avgMarketPrice < openTargetRate) {
                this.emitSell(this.defaultWeight, utils.sprintf("Re-opening %s %s SHORT position closed at rate %s after %s", this.lastPositionAmount.toFixed(8), Currency.getCurrencyLabel(this.action.pair.to),
                    this.lastCloseRate.toFixed(8), utils.test.getPassedTime(this.lastClosedPositionTime.getTime(), now)));
                this.lastClosedPositionTime = null; // to ensure we don't re-open multiple times
                this.lastPositionOpenTime = this.marketTime;
            }
        }
    }

    protected checkPositionClosed(prevAmount: number, prevDirection: StrategyPosition) {
        if (prevAmount > 0.0 && prevDirection !== "none") { // just to be sure
            this.lastPositionAmount = prevAmount;
            this.lastCloseRate = this.avgMarketPrice;
            this.lastPositionDirection = prevDirection;
            this.lastClosedPositionTime = this.getMarketTime();
            //const nearestStop = this.getNearestStop(); // too late to call this after pos sync
        }
    }

    protected getNearestStop() {
        let stop = this.strategyGroup.getNearestStop(this.lastPositionDirection); // TODO this should have a parameter forPosition = long|short
        if (stop > 0.0 && stop !== Number.MAX_VALUE)
            return stop;
        // if position is closed we might have to fall back to the last stop. stop strategies return different values depending on position state
        // TODO ideally every stop strategy would have a method getStopPriceForState(this.lastPositionDirection)
        return this.lastNearestStop;
    }

    protected isWithinRange(currentRate: number, orderRate: number) {
        let percentDiff = Math.abs(helper.getDiffPercent(currentRate, orderRate));
        if (percentDiff <= this.action.expirationPercent)
            return true;
        return false;
    }
}
