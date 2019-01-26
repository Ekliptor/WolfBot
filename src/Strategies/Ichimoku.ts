import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import * as _ from "lodash";

interface IchimokuAction extends TechnicalStrategyAction {
    conversionPeriod: number; // optional, default 9. The number of of periods to use for the short average of the price highs and lows (Tenkan-sen).
    basePeriod: number; // optional, default 26. The number of periods to use for the long average of the price highs and lows (Kijun-sen).
    spanPeriod: number; // optional, default 52. The number of periods to use for the price highs and lows of the slower Span (Senkou Span B).
    displacement: number; // optional, default 26. The number of periods close prices shall be shifted into the past (Chikou Span, Lagging Span).
}

/**
 * Strategy that buys and sells depending on signals from the Ichimoku Clouds indicator. This indicator is mostly used
 * to show support and resistance as well as the trend direction.
 * A bullish signal occurs when:
 * - Price moves above Cloud (trend)
 * - Cloud turns from red to green (ebb-flow within trend)
 * - Price Moves above the Base Line (momentum)
 * - Conversion Line moves above Base Line (momentum)
 * A bearish signal occurs when:
 * - Price moves below Cloud (trend)
 * - Cloud turns from green to red (ebb-flow within trend)
 * - Price Moves below Base Line (momentum)
 * - Conversion Line moves below Base Line (momentum)
 * This strategy only opens positions. You need a stop-loss and/or take profit strategy.
 */
export default class Ichimoku extends TechnicalStrategy {
    public action: IchimokuAction;
    protected lastConversion: number = -1; // identical to current because it's updated on every candle tick
    protected lastBase: number = -1;
    protected lastSpanA: number = -1;
    protected lastSpanB: number = -1;
    protected secondLastConversion: number = -1;
    protected secondLastBase: number = -1;
    protected secondLastSpanA: number = -1;
    protected secondLastSpanB: number = -1;

    constructor(options) {
        super(options)
        if (typeof this.action.conversionPeriod !== "number")
            this.action.conversionPeriod = 9;
        if (typeof this.action.basePeriod !== "number")
            this.action.basePeriod = 26;
        if (typeof this.action.spanPeriod !== "number")
            this.action.spanPeriod = 52;
        if (typeof this.action.displacement !== "number")
            this.action.displacement = 26;
        this.addIndicator("IchimokuClouds", "IchimokuClouds", this.action);

        const ichimoku = this.getIchimokuClouds("IchimokuClouds");
        this.addInfo("conversion", "lastConversion");
        this.addInfo("base", "lastBase");
        this.addInfo("spanA", "lastSpanA");
        this.addInfo("spanB", "lastSpanB");
        this.addInfo("secondLastConversion", "secondLastConversion");
        this.addInfo("secondLastBase", "secondLastBase");
        this.addInfo("secondLastSpanA", "secondLastSpanA");
        this.addInfo("secondLastSpanB", "secondLastSpanB");
        this.addInfoFunction("priceAboveCloud", () => {
            return ichimoku.priceAboveCloud(this.avgMarketPrice);
        });
        this.addInfoFunction("priceAboveBaseLine", () => {
            return ichimoku.priceAboveBaseLine(this.avgMarketPrice);
        });
        this.addInfoFunction("conversionAboveBaseLine", () => {
            return ichimoku.conversionAboveBaseLine();
        });
        this.addInfoFunction("cloudIsGreen", () => {
            return ichimoku.cloudIsGreen();
        });
        this.addInfoFunction("cloudIsRed", () => {
            return ichimoku.cloudIsRed();
        });
        this.saveState = true;
        this.mainStrategy = true;
    }

    public serialize() {
        let state = super.serialize();
        state.lastConversion = this.lastConversion;
        state.lastBase = this.lastBase;
        state.lastSpanA = this.lastSpanA;
        state.lastSpanB = this.lastSpanB;
        state.secondLastConversion = this.secondLastConversion;
        state.secondLastBase = this.secondLastBase;
        state.secondLastSpanA = this.secondLastSpanA;
        state.secondLastSpanB = this.secondLastSpanB;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.lastConversion = state.lastConversion;
        this.lastBase = state.lastBase;
        this.lastSpanA = state.lastSpanA;
        this.lastSpanB = state.lastSpanB;
        this.secondLastConversion = state.secondLastConversion;
        this.secondLastBase = state.secondLastBase;
        this.secondLastSpanA = state.secondLastSpanA;
        this.secondLastSpanB = state.secondLastSpanB;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        const ichimoku = this.getIchimokuClouds("IchimokuClouds");
        this.secondLastConversion = this.lastConversion;
        this.secondLastBase = this.lastBase;
        this.secondLastSpanA = this.lastSpanA;
        this.secondLastSpanB = this.lastSpanB;
        let updateLastValues = () => {
            this.lastConversion = ichimoku.getConversion();
            this.lastBase = ichimoku.getBase();
            this.lastSpanA = ichimoku.getSpanA();
            this.lastSpanB = ichimoku.getSpanB();
        }
        if (this.strategyPosition !== "none") {
            updateLastValues();
            return;
        }

        const trendMsg = utils.sprintf("priceAboveCloud %s, cloudGreen %s, priceAboveBase %s, conversionAboveBase %s",
            ichimoku.priceAboveCloud(this.candle.close), ichimoku.cloudIsGreen(), ichimoku.priceAboveBaseLine(this.candle.close), ichimoku.conversionAboveBaseLine());
        if (ichimoku.priceAboveCloud(this.candle.close) && ichimoku.cloudIsGreen() && ichimoku.priceAboveBaseLine(this.candle.close) && ichimoku.conversionAboveBaseLine()) {
            this.emitBuy(this.defaultWeight, "Bullish cloud: " + trendMsg);
        }
        else if (!ichimoku.priceAboveCloud(this.candle.close) && ichimoku.cloudIsRed() && !ichimoku.priceAboveBaseLine(this.candle.close) && !ichimoku.conversionAboveBaseLine()) {
            this.emitSell(this.defaultWeight, "Bearish cloud: " + trendMsg);
        }
        else
            this.log("No Ichimoku Clouds trend detected: " + trendMsg);

        updateLastValues();
    }
}