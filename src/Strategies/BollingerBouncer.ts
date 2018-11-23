import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, ScheduledTrade, StrategyAction, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {BollingerBands as BollingerIndicator} from "../Indicators/BollingerBands";
import * as Order from "@ekliptor/bit-models/build/models/Order";
import {TradeInfo} from "../Trade/AbstractTrader";
import {MarginPosition} from "../structs/MarginPosition";

type BollingerStopBand = "middle" | "opposite";

interface BollingerBouncerAction extends TechnicalStrategyAction {
    // optional, Volume profile params
    interval: number; // default 48. The number of candles to compute the volume profile and average volume from.
    volumeRows: number; // default 24. The number of equally-sized price zones the price range is divided into.
    valueAreaPercent: number; // default 70%. The percentage of the total volume that shall make up the value area, meaning the price range where x% of the trades happen.
    waitEntrySec: number; // default 300. How many seconds price has to stay at or outside the Bollinger Bands before opening a trade.
    clearTradeTicks: number; // default 8. After how many candles a previous buy/sell trade shall be removed, allowing to trade at a possibly worse price again.
    stopBand: BollingerStopBand; // default middle. At which Bollinger Band this strategy starts placing a trailing stop.

    minVolumeSpike: number; // default 1.1. The min volume compared to the average volume of the last 'interval' candles to open a position.
    percentBThreshold: number; // 0.01, optional, A number indicating how close to %b the price has to be to consider it "reached".
    trailingStopPerc: number; // optional, default 0.05% ( 0 = disabled) // The trailing stop percentage that will be placed after the opposite Bollinger Band has been reached.

    // optional, for defaults see BolloingerBandsParams
    N: number; // The time period for MA of BollingerBands.
    K: number; // The factor for upper/lower band of BollingerBands.
    MAType: number; // The moving average type of BollingerBands. 0 = SMA
}

class LastTradePoint {
    public rate: number = -1;
    public pastCandles: number = 0; // how many candles ago this trade was, starting with 0 = current candle
    constructor(rate: number) {
        this.rate = rate;
    }
    public toString() {
        return utils.sprintf("rate %s, past candle count %s", this.rate.toFixed(8), this.pastCandles);
    }
}

/**
 * Strategy that sells on the upper Bollinger Band and buys on the lower band.
 * Our assumption is that the price will always jump between the upper and lower band (as in a sideways market).
 * This strategy only trades within the value area of the volume profile, which is when price is within the range where 70% of
 * trades take place using default settings. Additionally the current candle volume must be 'minVolumeSpike' above average (SMA) of
 * the latest 'interval' candles.
 * This strategy waits with the market entry until 'waitEntrySec' has passed and keeps track of the last buy/sell prices
 * to ensure it doesn't trade a a loss in prolonged sideways markets.
 * See PingPing strategy for a simpler version which doesn't keep track of the last buy/sell prices.
 * ideas from https://medium.com/bitfinex/ping-pong-a-new-hf-algorithmic-order-dcc844950a25
 */
export default class BollingerBouncer extends TechnicalStrategy {
    public action: BollingerBouncerAction;
    protected trailingStopPrice: number = -1;
    protected lastBuy: LastTradePoint = null;
    protected lastSell: LastTradePoint = null;
    //protected pendingOpenPositionTrade: ScheduledTrade = null; // use pendingOrder

    constructor(options) {
        super(options)
        if (typeof this.action.interval !== "number")
            this.action.interval = 48;
        if (typeof this.action.volumeRows !== "number")
            this.action.volumeRows = 24;
        if (typeof this.action.valueAreaPercent !== "number")
            this.action.valueAreaPercent = 70.0;
        if (typeof this.action.waitEntrySec !== "number")
            this.action.waitEntrySec = 300;
        if (typeof this.action.clearTradeTicks !== "number")
            this.action.clearTradeTicks = 8;
        if (!this.action.stopBand)
            this.action.stopBand = "middle";
        if (typeof this.action.minVolumeSpike !== "number")
            this.action.minVolumeSpike = 1.1;
        if (!this.action.percentBThreshold)
            this.action.percentBThreshold = 0.01;
        if (typeof this.action.trailingStopPerc !== "number")
            this.action.trailingStopPerc = 0.05;
        this.addIndicator("VolumeProfile", "VolumeProfile", this.action);
        this.addIndicator("AverageVolume", "AverageVolume", this.action);
        this.addIndicator("BollingerBands", "BollingerBands", this.action);

        const volumeProfile = this.getVolumeProfile("VolumeProfile");
        const averageVolume = this.getVolume("AverageVolume");
        this.addInfoFunction("valueAreaHigh", () => {
            const valueArea = volumeProfile.getValueArea();
            return valueArea !== null ? valueArea.valueAreaHigh : "";
        });
        this.addInfoFunction("valueAreaLow", () => {
            const valueArea = volumeProfile.getValueArea();
            return valueArea !== null ? valueArea.valueAreaLow : "";
        });
        this.addInfoFunction("valueAreaVolume", () => {
            const valueArea = volumeProfile.getValueArea();
            return valueArea !== null ? valueArea.valueAreaVolume : "";
        });
        this.addInfoFunction("profileHigh", () => {
            const valueArea = volumeProfile.getValueArea();
            return valueArea !== null ? valueArea.profileHigh : "";
        });
        this.addInfoFunction("profileLow", () => {
            const valueArea = volumeProfile.getValueArea();
            return valueArea !== null ? valueArea.profileLow : "";
        });
        this.addInfoFunction("totalVolume", () => {
            return volumeProfile.getTotalVolume();
        });
        this.addInfoFunction("maxVolumeProfileBar", () => {
            const profile = volumeProfile.getVolumeProfile();
            return profile.length !== 0 ? profile[0].toString() : ""; // display the bar with the highest volume
        });
        this.addInfoFunction("AverageVolume", () => {
            return averageVolume.getValue();
        });
        this.addInfoFunction("VolumeFactor", () => {
            return averageVolume.getVolumeFactor();
        });

        const bollinger = this.getBollinger("BollingerBands");
        this.addInfoFunction("%b", () => {
            if (!this.candle)
                return -1;
            return bollinger.getPercentB(this.candle.close);
        });
        this.addInfoFunction("Bandwidth", () => {
            return bollinger.getBandwidth();
        });
        this.addInfoFunction("BandwidthAvgFactor", () => {
            return bollinger.getBandwidthAvgFactor();
        });
        this.addInfoFunction("upperValue", () => {
            return bollinger.getUpperValue();
        });
        this.addInfoFunction("middleValue", () => {
            return bollinger.getMiddleValue();
        });
        this.addInfoFunction("lowerValue", () => {
            return bollinger.getLowerValue();
        });
        this.addInfoFunction("stop", () => {
            return this.getStopPrice();
        });
        this.addInfoFunction("lastBuy", () => {
            return this.lastBuy === null ? "" : this.lastBuy.toString();
        });
        this.addInfoFunction("lastSell", () => {
            return this.lastSell === null ? "" : this.lastSell.toString();
        });

        this.saveState = true;
        this.mainStrategy = true;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            this.trailingStopPrice = -1;
        }
    }

    public onSyncPortfolio(coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange) {
        super.onSyncPortfolio(coins, position, exchangeLabel)
        if (this.strategyPosition === "none") {
            this.trailingStopPrice = -1;
        }
    }

    public serialize() {
        let state = super.serialize();
        state.trailingStopPrice = this.trailingStopPrice;
        state.lastBuy = this.lastBuy;
        state.lastSell = this.lastSell;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.trailingStopPrice = state.trailingStopPrice;
        if (state.lastBuy)
            this.lastBuy = Object.assign(new LastTradePoint(state.lastBuy.rate), state.lastBuy);
        if (state.lastSell)
            this.lastSell = Object.assign(new LastTradePoint(state.lastSell.rate), state.lastSell);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            //if (this.done)
                //return resolve();

            if (this.pendingOrder !== null)
                this.checkDelayedMarketEntry();
            else if (this.strategyPosition !== "none") {
                if (this.trailingStopPrice !== -1)
                    this.updateStop();
                if (this.action.order === "sell" || this.action.order === "closeLong")
                    this.checkStopSell();
                else if (this.action.order === "buy" || this.action.order === "closeShort")
                    this.checkStopBuy();
            }
            super.tick(trades).then(() => {
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected checkIndicators() {
        const bollinger = this.getBollinger("BollingerBands");
        const value = bollinger.getPercentB(this.candle.close);
        const volumeProfile = this.getVolumeProfile("VolumeProfile");
        //const averageVolume = this.getVolume("AverageVolume");
        this.incrementLastTradeHistory();

        if (value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) {
            this.log("fast moving market (consider increasing candleSize), no trend detected, percent b value", value)
        }
        else if (this.strategyPosition !== "none") { // update the trailing stop to close
            if (this.trailingStopPrice !== -1) // opposite band has already been reached on previous candle tick
                this.updateStop();
            else if (this.strategyPosition === "long" && ((this.action.stopBand === "opposite" && value >= 1 - this.action.percentBThreshold) || (this.action.stopBand === "middle" && value >= 0.5 - this.action.percentBThreshold)))
                this.updateStop(); // upper band reached 1st time
            else if (this.strategyPosition === "short" && ((this.action.stopBand === "opposite" && value <= this.action.percentBThreshold) || (this.action.stopBand === "middle" && value <= 0.5 + this.action.percentBThreshold)))
                this.updateStop(); // lower band reached 1st time
        }
        else if (volumeProfile.getValueArea().isPriceWithinArea(this.candle.close) === false) {
            // TODO option to trade outside of the value area when the direction is back into it?
            this.log(utils.sprintf("Skipped opening position because price %s is not within value area, low %s, high %s, percentB %s", this.candle.close.toFixed(8),
                volumeProfile.getValueArea().valueAreaLow.toFixed(8), volumeProfile.getValueArea().valueAreaHigh.toFixed(8), value.toFixed(8)))
        }
        else if (this.isSufficientVolume() === false)
            this.log("Insufficient volume (relative to avg) to trade " + this.getVolumeStr() + ", percentB " + value.toFixed(8));
        else if (value >= 1 - this.action.percentBThreshold) {
            this.log("reached upper band, DOWN trend imminent, value", value)
            //this.emitSell(this.defaultWeight, "percent b value: " + value);
            this.pendingOrder = new ScheduledTrade("sell", this.defaultWeight, "percent b value: " + value, this.className);
            this.pendingOrder.created = this.marketTime;
        }
        else if (value <= this.action.percentBThreshold) {
            this.log("reached lower band, UP trend imminent, value", value)
            this.pendingOrder = new ScheduledTrade("buy", this.defaultWeight, "percent b value: " + value, this.className);
            this.pendingOrder.created = this.marketTime;
        }
        else {
            this.log("no trend detected, percent b value", value.toFixed(8))
        }
    }

    protected checkDelayedMarketEntry() {
        if (this.pendingOrder.created.getTime() + this.action.waitEntrySec*1000 > this.marketTime.getTime())
            return;
        const bollinger = this.getBollinger("BollingerBands");
        const value = bollinger.getPercentB(this.avgMarketPrice);
        // here we don't trade if the price is too far outside of Bollinger Bands
        if (this.pendingOrder.action === "buy" && value <= this.action.percentBThreshold && value >= 0 - this.action.percentBThreshold) {
            if (this.lastBuy && this.lastBuy.rate < this.avgMarketPrice)
                this.log(utils.sprintf("Skipping BUY because last last buy price was lower: %s < %s", this.lastBuy.rate.toFixed(8), this.avgMarketPrice.toFixed(8)));
            else {
                this.log(utils.sprintf("percentB value at buy time %s", value.toFixed(8)));
                this.executeTrade(this.pendingOrder);
            }
        }
        else if (this.pendingOrder.action === "sell" && value >= 1 - this.action.percentBThreshold && value <= 1 + this.action.percentBThreshold) {
            if (this.lastSell && this.lastSell.rate > this.avgMarketPrice)
                this.log(utils.sprintf("Skipping SELL because last last sell price was higher: %s > %s", this.lastSell.rate.toFixed(8), this.avgMarketPrice.toFixed(8)));
            else {
                this.log(utils.sprintf("percentB value at sell time %s", value.toFixed(8)));
                this.executeTrade(this.pendingOrder);
            }
        }
        else {
            this.log(utils.sprintf("Price %s is not close enough to Bollinger Bands anymore, percentB %s - cancelling scheduled order",
                this.avgMarketPrice.toFixed(8), value.toFixed(8)));
        }
        this.pendingOrder = null;
    }

    protected incrementLastTradeHistory() {
        if (this.lastBuy !== null) {
            this.lastBuy.pastCandles++;
            if (this.lastBuy.pastCandles >= this.action.clearTradeTicks) {
                this.log(utils.sprintf("Last buy at %s expired after %s candle ticks", this.lastBuy.rate.toFixed(8), this.lastBuy.pastCandles));
                this.lastBuy = null;
            }
        }
        if (this.lastSell !== null) {
            this.lastSell.pastCandles++;
            if (this.lastSell.pastCandles >= this.action.clearTradeTicks) {
                this.log(utils.sprintf("Last sell at %s expired after %s candle ticks", this.lastSell.rate.toFixed(8), this.lastSell.pastCandles));
                this.lastSell = null;
            }
        }
    }

    protected isSufficientVolume() {
        if (this.action.minVolumeSpike == 0.0)
            return true; // disabled
        let averageVolume = this.getVolume("AverageVolume")
        return averageVolume.getVolumeFactor() >= this.action.minVolumeSpike;
    }

    protected getVolumeStr() {
        let averageVolume = this.getVolume("AverageVolume");
        return utils.sprintf("%s %s, spike %sx", averageVolume.getValue().toFixed(8), this.action.pair.getBase(), averageVolume.getVolumeFactor().toFixed(8));
    }

    protected updateStop() {
        if (this.action.trailingStopPerc == 0.0)
            return; // disabled
        if (this.strategyPosition === "long") {
            const nextStop = this.avgMarketPrice - this.avgMarketPrice/100.0*this.action.trailingStopPerc;
            if (nextStop > this.trailingStopPrice)
                this.trailingStopPrice = nextStop;
            //this.strategyPosition = "none"; // to prevent the strategy being stuck // Backtester can sync state now too
        }
        else if (this.strategyPosition === "short") {
            const nextStop = this.avgMarketPrice + this.avgMarketPrice/100.0*this.action.trailingStopPerc;
            if (this.trailingStopPrice === -1 || nextStop < this.trailingStopPrice)
                this.trailingStopPrice = nextStop;
            //this.strategyPosition = "none";
        }
    }

    protected checkStopSell() {
        if (this.avgMarketPrice > this.getStopSell())
            return;
        this.emitSellClose(Number.MAX_VALUE, utils.sprintf("Price <= trailing stop at %s", this.trailingStopPrice));
        this.trailingStopPrice = -1; // reset it so that this doesn't get fired again immediately
    }

    protected checkStopBuy() {
        if (this.avgMarketPrice < this.getStopBuy())
            return;
        this.emitBuyClose(Number.MAX_VALUE, utils.sprintf("Price >= trailing stop at %s", this.trailingStopPrice));
        this.trailingStopPrice = -1; // reset it so that this doesn't get fired again immediately
    }


    protected getStopSell() {
        if (this.trailingStopPrice !== -1)
            return this.trailingStopPrice;
        return 0.0;
    }

    protected getStopBuy() {
        if (this.trailingStopPrice !== -1)
            return this.trailingStopPrice;
        return Number.MAX_VALUE;
    }

    protected getStopPrice() {
        if (this.action.order === "sell" || this.action.order === "closeLong")
            return this.getStopSell()
        return this.getStopBuy()
    }

    protected resetValues(): void {
        super.resetValues();
    }
}