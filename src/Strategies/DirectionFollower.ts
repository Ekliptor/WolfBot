import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {TradeDirection} from "../Trade/AbstractTrader";
import * as helper from "../utils/helper";

interface DirectionFollowerAction extends TechnicalStrategyAction {
    interval: number; // interval for ADX
    adxTrend: number; // ADX will be considered trending when above this value
    adxMaxTrend: number; // optional, default 0 = disabled. ADX must be below this value. prevents opening a position too late
    initialStop: boolean; // optional, default false // use the candle high/low of the current candle as initial stop on sell/buy actions

    // SAR params (optional)
    accelerationFactor: number; // default 0.02 // Acceleration Factor used up to the Maximum value
    accelerationMax: number; // default 0.2 // Acceleration Factor Maximum value

    tradeDirection: TradeDirection | "notify" | "watch"; // optional, default "both". "watch" only computes indicators
}

/**
 * Strategy that tries to identify a trend/direction using ADX. Then it follows that trend using
 * SAR as a trailing stop-loss.
 * candle sizes 60 - 1440
 * http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:average_directional_index_adx
 * http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:parabolic_sar
 * TODO add 1h MACD to buy at the right momentum
 * TODO add 1h RSI to prevent buying/selling at oversold/overbought
 * TODO iceberg order strategy -> split order into smaller pieces (to avoid trading at a bad moment)
 */
export default class DirectionFollower extends TechnicalStrategy {
    public action: DirectionFollowerAction;
    protected initialStop: number = -1;
    protected lastADX: number = -1; // last values are identical to current because updated on candle tick
    protected lastADXR: number = -1;
    protected secondLastADX: number = -1;
    protected secondLastADXR: number = -1;

    constructor(options) {
        super(options)
        if (!this.action.adxMaxTrend)
            this.action.adxMaxTrend = 0.0;
        if (typeof this.action.initialStop !== "boolean")
            this.action.initialStop = false;
        if (!this.action.tradeDirection)
            this.action.tradeDirection = "both";
        this.addIndicator("ADX", "ADX", this.action);
        this.addIndicator("SAR", "SAR", this.action);

        /*
        this.addInfoFunction("adxTrend", () => {
            return this.action.adxTrend;
        });
        */
        let adx = this.getADX("ADX")
        adx.disableADXR(true);
        this.addInfo("secondLastADX", "secondLastADX");
        this.addInfo("secondLastADXR", "secondLastADXR");
        this.addInfoFunction("ADX", () => {
            return adx.getADX();
        });
        this.addInfoFunction("+DM", () => {
            return adx.getPlusDM();
        });
        this.addInfoFunction("-DM", () => {
            return adx.getMinusDM();
        });
        this.addInfoFunction("+DI", () => {
            return adx.getPlusDI();
        });
        this.addInfoFunction("-DI", () => {
            return adx.getMinusDI();
        });
        this.addInfoFunction("ADXR", () => {
            return adx.getADXR();
        });
        this.addInfoFunction("Parabolic SAR", () => {
            return this.indicators.get("SAR").getValue();
        });
        this.addInfoFunction("Initial Stop", () => {
            return this.initialStop;
        });
        this.mainStrategy = true;
        this.saveState = true;
    }

    public serialize() {
        let state = super.serialize();
        state.initialStop = this.initialStop;
        state.lastADX = this.lastADX;
        state.lastADXR = this.lastADXR;
        state.secondLastADX = this.secondLastADX;
        state.secondLastADXR = this.secondLastADXR;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.initialStop = state.initialStop;
        this.lastADX = state.lastADX;
        this.lastADXR = state.lastADXR;
        this.secondLastADX = state.secondLastADX;
        this.secondLastADXR = state.secondLastADXR;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        let adx = this.getADX("ADX")
        //let sar = this.indicators.get("SAR")
        //console.log(adx.getAllValues())
        //console.log("SAR: " + sar.getValue())
        this.secondLastADX = this.lastADX;
        this.secondLastADXR = this.lastADXR;
        let updateLastValues = () => {
            this.lastADX = adx.getADX();
            this.lastADXR = adx.getADXR();
        }

        if (this.strategyPosition !== "none") {
            this.checkStop(); // TODO option to check stop on every trade tick?
            updateLastValues();
            return;
        }
        else if (adx.getADX() < this.action.adxTrend || (this.action.adxMaxTrend !== 0 && adx.getADX() > this.action.adxMaxTrend)) {
            updateLastValues();
            return; // we are not in a trend, don't open a position
        }

        const adxMsg = utils.sprintf("ADX %s (last %s), +DI %s, -DI %s", adx.getADX().toFixed(2), this.secondLastADX.toFixed(2),
            adx.getPlusDI().toFixed(2), adx.getMinusDI().toFixed(2))
        // TODO allow to configure a range/offset (instead of "greater") if we compare with the last ADX
        if (adx.getPlusDI() > adx.getMinusDI()/* && adx.getADX() > this.secondLastADX*/) {
            this.log("UP trend detected,", adxMsg)
            this.emitBuy(this.defaultWeight, adxMsg);
            this.lastTrend = "up";
            //this.strategyPosition = "long";
            this.initialStop = this.candle.low;
        }
        else if (adx.getMinusDI() > adx.getPlusDI()/* && adx.getADX() > this.secondLastADX*/) {
            this.log("DOWN trend detected,", adxMsg)
            this.emitSell(this.defaultWeight, adxMsg);
            this.lastTrend = "down";
            //this.strategyPosition = "short";
            this.initialStop = this.candle.high;
        }
        else
            this.log("no trend detected,", adxMsg)
        updateLastValues();
    }

    protected checkStop() {
        if (this.action.initialStop === true && this.initialStop !== -1) {
            if (this.strategyPosition === "long" && this.candle.close < this.initialStop) {
                this.emitClose(Number.MAX_VALUE, "initial long stop reached, value " + this.initialStop.toFixed(8));
                //this.strategyPosition = "none"; // to prevent the strategy being stuck // Backtester can sync state now too
            }
            else if (this.strategyPosition === "short" && this.candle.close > this.initialStop) {
                this.emitClose(Number.MAX_VALUE, "initial short stop reached, value"  + this.initialStop.toFixed(8));
                //this.strategyPosition = "none";
            }
        }

        // use SAR as trailing stop
        let sar = this.indicators.get("SAR")
        if (this.strategyPosition === "long" && this.candle.close < sar.getValue()) {
            this.emitClose(Number.MAX_VALUE, "SAR long stop reached, value " + sar.getValue().toFixed(8));
            //this.strategyPosition = "none";
        }
        else if (this.strategyPosition === "short" && this.candle.close > sar.getValue()) {
            this.emitClose(Number.MAX_VALUE, "SAR short stop reached, value " + sar.getValue().toFixed(8));
            //this.strategyPosition = "none";
        }
    }

    protected emitBuy(weight: number, reason = "", fromClass = "") {
        if (this.canExecuteTrade("buy", reason))
            super.emitBuy(weight, reason, fromClass);
    }

    protected emitSell(weight: number, reason = "", fromClass = "") {
        if (this.canExecuteTrade("sell", reason))
            super.emitSell(weight, reason, fromClass);
    }

    protected emitClose(weight: number, reason = "", fromClass = "") {
        if (this.canExecuteTrade("close", reason))
            super.emitClose(weight, reason, fromClass);
    }

    protected canExecuteTrade(action: TradeAction, reason: string) {
        if (this.action.tradeDirection === "watch") {
            this.log(utils.sprintf("Skipping %s trade because strategy is in watch mode, reason: %s", action.toUpperCase(), reason))
            return false;
        }
        if (this.action.tradeDirection === "notify") {
            this.log(reason);
            const msgTitle = utils.sprintf("ADX %s signal", action.toUpperCase())
            this.sendNotification(msgTitle, reason, false, true)
            return false;
        }
        if (this.action.tradeDirection === "up" && action === "sell") {
            this.log("Skipped opening SHORT position because trade direction is set to UP only. reason: " + reason);
            return false;
        }
        if (this.action.tradeDirection === "down" && action === "buy") {
            this.log("Skipped opening LONG position because trade direction is set to DOWN only. reason: " + reason);
            return false;
        }
        return true;
    }
}