import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, TrendDirection} from "../../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order, Funding} from "@ekliptor/bit-models";
import {AbstractLendingStrategy, LendingTradeAction} from "./AbstractLendingStrategy";
import {TechnicalLendingStrategy, TechnicalLendingStrategyAction} from "./TechnicalLendingStrategy";
import {LendingTradeInfo} from "../AbstractLendingTrader";

interface DemaAction extends TechnicalLendingStrategyAction {
    // optional parameters
    CrossMAType: "EMA" | "DEMA" | "SMA"; // default DEMA
    autoSensitivity: boolean; // default false. automatically adjust how many % above the EMA the interest rate should be on highly volatile markets
    deltaPercent: number; // default 0% - increase the min lending rate by %x above EMA. use negative values to decrease it

    // optional, for defaults see BolloingerBandsParams
    N: number; // time period for MA
    K: number; // factor for upper/lower band
    MAType: number; // moving average type, 0 = SMA
}

/**
 * Strategy that emits buy/sell based on the DEMA indicator of the short and long line.
 * Strategy has an open market position over 70% of the time.
 */
export default class DEMA extends TechnicalLendingStrategy {
    // TODO find the biggest wall in orderBook and ensure we place below that
    public action: DemaAction;
    //protected lastLineDiff: number = 0;
    //protected lastCloseLineDiff: number = 0;
    //protected closeTickCount: number = 0;
    //protected closeLineCandleTicks: number = 0;

    constructor(options) {
        super(options)
        if (!this.action.CrossMAType)
            this.action.CrossMAType = "DEMA";
        if (typeof this.action.autoSensitivity !== "boolean")
            this.action.autoSensitivity = false;
        if (!this.action.deltaPercent)
            this.action.deltaPercent = 0.0;

        this.addIndicator("DEMA", this.action.CrossMAType, this.action);
        this.addIndicator("BollingerBands", "BollingerBands", this.action);

        this.addInfoFunction("long", () => {
            return this.action.long;
        });
        let dema = this.indicators.get("DEMA")
        this.addInfoFunction("longValue", () => {
            return dema.getLongLineValue();
        });
        /*
        this.addInfoFunction("line diff", () => {
            return dema.getLineDiff();
        });
        this.addInfoFunction("line diff %", () => {
            return dema.getLineDiffPercent();
        });
        */
        let bollinger = this.getBollinger("BollingerBands")
        this.addInfoFunction("Bandwidth", () => {
            return bollinger.getBandwidth();
        });
        this.addInfoFunction("BandwidthAvgFactor", () => {
            return bollinger.getBandwidthAvgFactor();
        });

        this.saveState = true;
    }

    public onTrade(action: LendingTradeAction, order: Funding.FundingOrder, trades: Funding.FundingTrade[], info: LendingTradeInfo) {
        super.onTrade(action, order, trades, info);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        let dema = this.indicators.get("DEMA")
        let bollinger = this.getBollinger("BollingerBands")
        //const diff = dema.getLineDiffPercent();
        let demaVal = dema.getLongLineValue();

        if (this.action.autoSensitivity === true) {
            const bandwidthAvgFactor = bollinger.getBandwidthAvgFactor();
            if (bandwidthAvgFactor > 1) { // only increase sensitivity (no decrease)
                demaVal *= bandwidthAvgFactor;
            }
        }

        // we could detect orderbook walls and don't increase with getOrderBookWallPrice()
        // but since lending walls might also move quickly it's safer to remember the time of our last trade and decrease our interest rate
        let minInterest = demaVal;
        if (this.action.deltaPercent > 0)
            minInterest += minInterest / 100 * this.action.deltaPercent;
        else if (this.action.deltaPercent < 0)
            minInterest -= minInterest / 100 * this.action.deltaPercent;
        this.minInterestRate = minInterest;
        const msg = utils.sprintf("DEMA line value at %s", demaVal);
        this.log(msg);
        this.emitPlaceOffer(msg);
    }

    protected resetValues() {
        // done for close only
        super.resetValues();
    }
}