import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, BuySellAction, StrategyAction, TradeAction} from "./AbstractStrategy";
import {Candle, Currency, Order, Trade} from "@ekliptor/bit-models";
import {AbstractTrailingStop, AbstractTrailingStopAction} from "./AbstractTrailingStop";
import {ClosePositionState} from "./AbstractStopStrategy";
import {TradeInfo} from "../Trade/AbstractTrader";
import {ExchangeFeed} from "../Exchanges/feeds/AbstractMarketData";
import * as helper from "../utils/helper";
import {MarginPosition} from "../structs/MarginPosition";

type FishingMode = "up" | "down" | "trend";
type FishingTrendIndicator = "MACD" | "EMA" | "SMA" | "DEMA";

interface FishingNetAction extends AbstractTrailingStopAction {
    fishingMode: FishingMode; // optional, default trend - In which direction shall this strategy open positions? 'trend' means the strategy will decide automatically based on the current MACD trend. Values: up|down|trend
    percentage: number; // optional, default 15% - How many percent of the total trading balance shall be used for the first trade and on each trade to increase the position size.
    maxPosIncreases: number; // optional, default 7 - How many times this strategy shall increase an existing position at most. Note that raising this value can cause your strategy to trade with more than your configured total trading balance.
    //scaleOutPerc: number; // optional, default 0.0 (use the same amount for all orders) - This value allows you to increase each buy/sell order of numOrdersPerSide by a certain percentage. This helps to move the average rate of all your orders
    // (and thus the break-even rate) in your favor.
    tradingAmountIncreaseFactor; // optional, default 1.1 - The factor with which your trading amount will be increased on each trade after opening a position. So the total capital of trade n to increase an existing position will be: tradeTotalBtc * percentage * tradingAmountIncreaseFactor * n
    profitPercent: number; // optional, default 2.1% - After the total position size reached this profit the position will no longer be increased. Instead a trailing stop with 'trailingStopPerc' will be placed.

    interval: number; // optional, default 24 - The number of candles to compute the volume profile and average volume from. Also the number of data points to keep in history.
    volumeRows: number; // default 24 - The number of equally-sized price zones the price range is divided into.
    valueAreaPercent: number; // default 60% - The percentage of the total volume that shall make up the value area, meaning the price range where x% of the trades happen.
    minVolumeSpike: number; // optional, default 1.7 - The min volume compared to the average volume of the last 'interval' candles to open a position.
    minVolumeSpikePosInc: number; // optional, default 1.1 - The min volume when increasing an existing position compared to the average volume of the last 'interval' candles to open a position.

    closePosition: ClosePositionState; // optional, default profit - Only close a position by placing the trailing stop if its profit/loss is in that defined state.
    trailingStopPerc: number; // optional, default 0.5% - The trailing stop percentage that will be placed once the computed profit target of the strategy has been reached.
    limitClose: boolean; // optional, default false - If enabled the trailing stop will be placed as a limit order at the last trade price (or above/below if makerMode is enabled). Otherwise the position will be closed with a market order.
    time: number; // optional, default 30 (0 = immediately) - The time in seconds until the stop gets executed after the trailing stop has been reached.

    // Trend Indicator
    trendIndicator: FishingTrendIndicator; // optional, default EMA. The indicator to determine the current market trend. Only used in fishingMode 'trend'. Values: MACD|EMA|SMA|DEMA
    // optional, default MACD indicator params
    short: number; // 10
    long: number; // 26
    signal: number; // 9

    feed: ExchangeFeed; // optional, default BitmexMarketData - The exchange feed to use to get liquidations from. This is not available during backtesting, so results might differ. Values: BitmexMarketData
    currencyPairs: string[]; // optional, default ["USD_BTC"] - The currency pairs to subscribe to for liquidation data.

    supportLines: number[]; // The price levels where we want to open long a position. Leave empty to open at any price level.
    resistanceLines: number[]; // The price levels where we want to open short a position. Leave empty to open at any price level.
    expirationPercent: number; // default 3%. Only execute orders at price levels that are within x% of the set support/resistance lines.
    makerMode: boolean; // optional, default false. Whether to adjust all order rates below/above bid ask rates to ensure we only pay the lower (maker) fee.
}

/**
 * A Strategy that starts buying amounts on/after a peak as the price declines.
 * It starts with small amounts and increases the size of the orders as the price goes down (thus dividing the total order
 * size into chunks). As the prices falls into this "fishing net", our losses increase, but since we repeatedly
 * bought the same amount, our average buy price is lower and it doesn't take long to get a profit at any point as soon as the market turns.
 * This strategy opens and closes positions but you may still add additional TakeProfit/StopLoss strategies.
 */
export default class FishingNet extends AbstractTrailingStop {
    public action: FishingNetAction;
    protected positionIncreasedCount: number = 0;
    protected lastIncreasedRate: number = -1.0;

        constructor(options) {
        super(options)
            if (typeof this.action.fishingMode !== "string")
                this.action.fishingMode = "trend";
            if (typeof this.action.percentage !== "number")
                this.action.percentage = 15.0;
            if (typeof this.action.maxPosIncreases !== "number")
                this.action.maxPosIncreases = 7;
            //if (typeof this.action.scaleOutPerc !== "number")
                //this.action.scaleOutPerc = 0.0;
            if (typeof this.action.tradingAmountIncreaseFactor !== "number")
                this.action.tradingAmountIncreaseFactor = 1.1;
            if (typeof this.action.profitPercent !== "number")
                this.action.profitPercent = 2.1;
            if (typeof this.action.interval !== "number")
                this.action.interval = 24;
            if (typeof this.action.volumeRows !== "number")
                this.action.volumeRows = 24;
            if (typeof this.action.valueAreaPercent !== "number")
                this.action.valueAreaPercent = 60.0;
            if (typeof this.action.minVolumeSpike !== "number")
                this.action.minVolumeSpike = 1.7;
            if (typeof this.action.minVolumeSpikePosInc !== "number")
                this.action.minVolumeSpikePosInc = 1.1;
            if (typeof this.action.closePosition !== "string")
                this.action.closePosition = "profit";
            if (typeof this.action.trailingStopPerc !== "number")
                this.action.trailingStopPerc = 0.5;
            if (typeof this.action.time !== "number")
                this.action.time = 30;
            if (typeof this.action.trendIndicator !== "string")
                this.action.trendIndicator = "EMA";
            if (!this.action.short)
                this.action.short = 10;
            if (!this.action.long)
                this.action.long = 26;
            if (!this.action.signal)
                this.action.signal = 9;
            //if (!this.action.feed) // allow empty string = disabled
                //this.action.feed = "BitmexMarketData";
            if (Array.isArray(this.action.currencyPairs) === false || this.action.currencyPairs.length === 0)
                this.action.currencyPairs = ["USD_BTC"];
            if (Array.isArray(this.action.supportLines) === false)
                this.action.supportLines = [];
            if (Array.isArray(this.action.resistanceLines) === false)
                this.action.resistanceLines = [];
            if (!this.action.expirationPercent)
                this.action.expirationPercent = 3.0;

            this.addIndicator("VolumeProfile", "VolumeProfile", this.action);
            this.addIndicator("AverageVolume", "AverageVolume", this.action);
            if (this.action.trendIndicator === "MACD")
                this.addIndicator("TrendIndicator", "MACD", this.action);
            else
                this.addIndicator("TrendIndicator", this.action.trendIndicator, this.action);

            if (nconf.get("trader") !== "Backtester" && this.action.feed) {
                this.addIndicator("Liquidator", "Liquidator", this.action);
            }

            const volumeProfile = this.getVolumeProfile("VolumeProfile");
            const averageVolume = this.getVolume("AverageVolume");
            const liquidator = nconf.get("trader") !== "Backtester" && this.action.feed ? this.getLiquidator("Liquidator") : null;
            this.addInfo("positionIncreasedCount", "positionIncreasedCount");
            this.addInfo("lastIncreasedRate", "lastIncreasedRate");
            this.addInfoFunction("valueAreaHigh", () => {
                const valueArea = volumeProfile.getValueArea();
                return valueArea !== null ? valueArea.valueAreaHigh : "";
            });
            this.addInfoFunction("valueAreaLow", () => {
                const valueArea = volumeProfile.getValueArea();
                return valueArea !== null ? valueArea.valueAreaLow : "";
            });
            /*
            this.addInfoFunction("valueAreaVolume", () => {
                const valueArea = volumeProfile.getValueArea();
                return valueArea !== null ? valueArea.valueAreaVolume : "";
            });
            */
            this.addInfoFunction("profileHigh", () => {
                const valueArea = volumeProfile.getValueArea();
                return valueArea !== null ? valueArea.profileHigh : "";
            });
            this.addInfoFunction("profileLow", () => {
                const valueArea = volumeProfile.getValueArea();
                return valueArea !== null ? valueArea.profileLow : "";
            });
            /*
            this.addInfoFunction("totalVolume", () => {
                return volumeProfile.getTotalVolume();
            });
            */
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
            this.addInfoFunction("MaxVolumeCandle", () => {
                let i = averageVolume.getHighestVolumeCandleIndex();
                return i === -1 || i >= this.candleHistory.length ? "" : ("index: " + i + ", " + this.candleHistory[i].toString());
            });
            this.addInfoFunction("trendUp", () => {
                return this.isUpwardsMarketTrend();
            });
            this.addInfoFunction("trendDown", () => {
                return this.isDownwardsMarketTrend();
            });
            if (this.action.trendIndicator === "MACD") {
                const macd = this.getMACD("MACD");
                this.addInfoFunction("MACD", () => {
                    return macd.getMACD();
                });
                this.addInfoFunction("Signal", () => {
                    return macd.getSignal();
                });
                this.addInfoFunction("Histogram", () => {
                    return macd.getHistogram();
                });
            }
            else {
                const ema = this.indicators.get("TrendIndicator");
                this.addInfoFunction("shortValue", () => {
                    return ema.getShortLineValue();
                });
                this.addInfoFunction("longValue", () => {
                    return ema.getLongLineValue();
                });
                this.addInfoFunction("line diff", () => {
                    return ema.getLineDiff();
                });
                this.addInfoFunction("line diff %", () => {
                    return ema.getLineDiffPercent();
                });
            }
            if (liquidator) {
                this.addInfoFunction("liquidationTotalVol", () => {
                    return liquidator.getTotalVolume("both");
                });
                this.addInfoFunction("liquidationTotalBuyVol", () => {
                    return liquidator.getTotalVolume("buy");
                });
                this.addInfoFunction("liquidationTotalSellVol", () => {
                    return liquidator.getTotalVolume("sell");
                });
                this.addInfoFunction("liquidationAvgVol", () => {
                    return liquidator.getAveragelVolume("both");
                });
                this.addInfoFunction("liquidationCandleVol", () => {
                    return liquidator.getCurrentLiquidationVolume("both");
                });
                this.addInfoFunction("liquidationLatest", () => {
                    let latest = liquidator.getLatest("both");
                    return latest ? latest.toString() : "";
                });
            }
            this.addInfoFunction("liquidationAreaLong100x", () => {
                let avg = this.getHighestVolumeBarAveragePrice();
                return avg - avg / 100.0 * 0.49;
            });
            this.addInfoFunction("liquidationAreaShort100x", () => {
                let avg = this.getHighestVolumeBarAveragePrice();
                return avg + avg / 100.0 * 0.51;
            });
            this.addInfoFunction("liquidationAreaLong50x", () => {
                let avg = this.getHighestVolumeBarAveragePrice();
                return avg - avg / 100.0 * 1.47;
            });
            this.addInfoFunction("liquidationAreaShort50x", () => {
                let avg = this.getHighestVolumeBarAveragePrice();
                return avg + avg / 100.0 * 1.55;
            });
            this.addInfoFunction("liquidationAreaLong25x", () => {
                let avg = this.getHighestVolumeBarAveragePrice();
                return avg - avg / 100.0 * 3.38;
            });
            this.addInfoFunction("liquidationAreaShort25x", () => {
                let avg = this.getHighestVolumeBarAveragePrice();
                return avg + avg / 100.0 * 3.7;
            });
            // TODO use actual bitmex formula
            // TODO add option to place additional buys/sells (that stay there permanently) around these prices if it matches our current position

            this.saveState = true;
            this.mainStrategy = true;
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            this.positionIncreasedCount = 0;
            this.lastIncreasedRate = -1.0;
        }
    }

    public onSyncPortfolio(coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange) {
        super.onSyncPortfolio(coins, position, exchangeLabel);
        if (this.strategyPosition === "none") {
            this.positionIncreasedCount = 0;
            this.lastIncreasedRate = -1.0;
        }
    }

    public getOrderAmount(tradeTotalBtc: number, leverage: number = 1): number {
        let amount = tradeTotalBtc * leverage;
        if (nconf.get("trader") !== "Backtester") { // backtester uses BTC as unit, live mode USD
            if (leverage >= 10 && this.isPossibleFuturesPair(this.action.pair) === true)
                amount = tradeTotalBtc * leverage * /*this.ticker.last*/this.avgMarketPrice;
        }

        // scaleOutPerc option to give outer buy/sell orders higher amounts
        // this.orderPairs gets increased in onTrade() - after the order has been placed
        /*
        if (this.action.scaleOutPerc > 0.0) {
            const increaseFactor = this.positionIncreasedCount * this.action.scaleOutPerc;
            if (increaseFactor > 0.0)
                amount *= increaseFactor;
        }
         */

        this.orderAmountPercent = this.action.percentage;
        if (!this.orderAmountPercent || this.orderAmountPercent === 100)
            return amount;
        let tradeAmount = amount / 100 * this.orderAmountPercent;
        if (this.strategyPosition !== "none" && this.positionIncreasedCount > 0)
            tradeAmount *= this.action.tradingAmountIncreaseFactor * this.positionIncreasedCount; // counter is increased before order is submitted
        return tradeAmount;
    }

    public serialize() {
        let state = super.serialize();
        state.positionIncreasedCount = this.positionIncreasedCount;
        state.lastIncreasedRate = this.lastIncreasedRate;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.positionIncreasedCount = state.positionIncreasedCount;
        this.lastIncreasedRate = state.lastIncreasedRate;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        if (this.trailingStopPrice !== -1)
            this.updateStop(false);
        return super.tick(trades);
    }

    protected checkIndicators() {
        if (this.strategyPosition === "none") // can get called twice on small candle size if order doesn't get filled quickly, but trade will be in same direction
            this.checkOpenPosition();
        else if (this.trailingStopPrice === -1) // don't increase our position further after we placed a trailing stop
            this.checkModifyPosition();
    }

    protected checkOpenPosition() {
        const volumeProfile = this.getVolumeProfile("VolumeProfile");
        //let profileBars = volumeProfile.getVolumeProfile();
        const valueArea = volumeProfile.getValueArea();

        if (this.action.fishingMode === "up" || (this.action.fishingMode === "trend" && this.isUpwardsMarketTrend() === true)) {
            if (this.isSufficientVolume(this.action.minVolumeSpike) === false)
                this.log("Insufficient volume (relative to avg) to go LONG " + this.getVolumeStr());
            else if (valueArea.isPriceWithinArea(this.avgMarketPrice) === false)
                this.log("Skipped going LONG because price is outside of value area of volume profile");
            else if (this.action.supportLines.length !== 0 && this.isLineBroken(this.candle, this.action.supportLines, "<") === false)
                this.log("Skipped going LONG because price is above support lines");
            else
                this.emitBuy(this.defaultWeight, utils.sprintf("Going LONG in uptrend market with candle volume: %s", this.getVolumeStr()));
        }
        else if (this.action.fishingMode === "down" || (this.action.fishingMode === "trend" && this.isDownwardsMarketTrend() === true)) {
            if (this.isSufficientVolume(this.action.minVolumeSpike) === false)
                this.log("Insufficient volume (relative to avg) to go SHORT " + this.getVolumeStr());
            else if (valueArea.isPriceWithinArea(this.avgMarketPrice) === false)
                this.log("Skipped going SHORT because price is outside of value area of volume profile");
            else if (this.action.resistanceLines.length !== 0 && this.isLineBroken(this.candle, this.action.resistanceLines, ">") === false)
                this.log("Skipped going SHORT because price is below resistance lines");
            else
                this.emitSell(this.defaultWeight, utils.sprintf("Going SHORT in downtrend market with candle volume: %s", this.getVolumeStr()));
        }
    }

    protected checkModifyPosition() {
        if (this.hasProfitReal(this.action.profitPercent) === true) { // we reached our profit target -> place a trailing stop
            if (this.trailingStopPrice === -1) {
                this.log(utils.sprintf("%s position reached profit target of %s%%. Placing a trailing stop with %s%%.", this.strategyPosition.toUpperCase(),
                    this.action.profitPercent, this.action.trailingStopPerc));
                this.updateStop(true);
            }
            return;
        }

        // otherwise increase our position gradually on every candle tick
        if (this.positionIncreasedCount >= this.action.maxPosIncreases) {
            this.log(utils.sprintf("Skipped increasing %s because it has already been increased %s times.", this.strategyPosition.toUpperCase(), this.positionIncreasedCount));
            if (this.position)
                this.log(utils.sprintf("Current profit/loss: %s", this.position.pl.toFixed(8)));
            return;
        }
        // TODO ignore volume if price < x% within a liquidation area
        if (this.isSufficientVolume(this.action.minVolumeSpikePosInc) === false) {
            this.log(utils.sprintf("Insufficient volume (relative to avg) to increase existing %s position. Volume: %s", this.strategyPosition.toUpperCase(), this.getVolumeStr()));
            return;
        }
        // TODO only increase if the latest candle moved against our position?
        switch (this.strategyPosition) {
            case "long":
                if (this.lastIncreasedRate !== -1.0 && this.lastIncreasedRate < this.avgMarketPrice) {
                    this.log(utils.sprintf("Skipped increasing %s position because the last buy rate was lower: %s < %s", this.strategyPosition.toUpperCase(),
                        this.lastIncreasedRate.toFixed(8), this.avgMarketPrice.toFixed(8)));
                    return;
                }
                this.positionIncreasedCount++;
                this.lastIncreasedRate = this.avgMarketPrice;
                this.emitBuy(this.defaultWeight, utils.sprintf("Increasing %s position %s/%s times.", this.strategyPosition.toUpperCase(), this.positionIncreasedCount, this.action.maxPosIncreases));
                break;
            case "short":
                if (this.lastIncreasedRate !== -1.0 && this.lastIncreasedRate > this.avgMarketPrice) {
                    this.log(utils.sprintf("Skipped increasing %s position because the last sell rate was higher: %s > %s", this.strategyPosition.toUpperCase(),
                        this.lastIncreasedRate.toFixed(8), this.avgMarketPrice.toFixed(8)));
                    return;
                }
                this.positionIncreasedCount++;
                this.lastIncreasedRate = this.avgMarketPrice;
                this.emitSell(this.defaultWeight, utils.sprintf("Increasing %s position %s/%s times.", this.strategyPosition.toUpperCase(), this.positionIncreasedCount, this.action.maxPosIncreases));
                break;
        }
    }

    protected isLineBroken(candle: Candle.Candle, lines: number[], comp: "<" | ">"): boolean {
        for (let i = 0; i < lines.length; i++)
        {
            if (comp === "<") {
                if (candle.close < lines[i] && this.isWithinRange(candle.close, lines[i])) {
                    return true;
                }
                continue;
            }
            // comp === ">"
            if (candle.close > lines[i] && this.isWithinRange(candle.close, lines[i])) {
                return true;
            }
        }
        return false;
    }

    protected isWithinRange(currentRate: number, orderRate: number) {
        let percentDiff = Math.abs(helper.getDiffPercent(currentRate, orderRate));
        if (percentDiff <= this.action.expirationPercent)
            return true;
        return false;
    }

    protected isUpwardsMarketTrend(): boolean {
        if (this.action.trendIndicator === "MACD") {
            let macd = this.getMACD("TrendIndicator");
            return macd.getHistogram() > 0.0;
        }
        const ema = this.indicators.get("TrendIndicator");
        return ema.getLineDiffPercent() > this.action.thresholds.up;
    }

    protected isDownwardsMarketTrend(): boolean {
        if (this.action.trendIndicator === "MACD") {
            let macd = this.getMACD("TrendIndicator");
            return macd.getHistogram() < 0.0;
        }
        const ema = this.indicators.get("TrendIndicator");
        return ema.getLineDiffPercent() < this.action.thresholds.down;
    }

    protected isSufficientVolume(minVolumeSpike: number) {
        if (minVolumeSpike == 0.0)
            return true; // disabled
        let averageVolume = this.getVolume("AverageVolume")
        return averageVolume.getVolumeFactor() >= minVolumeSpike;
    }

    protected getVolumeStr() {
        let averageVolume = this.getVolume("AverageVolume");
        return utils.sprintf("%s %s, spike %sx", averageVolume.getValue().toFixed(8), this.action.pair.getBase(), averageVolume.getVolumeFactor().toFixed(8));
    }

    protected getHighestVolumeBarAveragePrice() {
        let averageVolume = this.getVolume("AverageVolume");
        let i = averageVolume.getHighestVolumeCandleIndex();
        if (i === -1 || i >= this.candleHistory.length)
            return 0.0;
        return this.candleHistory[i].getAveragePrice();
    }
}
