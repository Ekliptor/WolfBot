import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import * as helper from "../utils/helper";
import * as Heap from "qheap";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {TradeDirection} from "../Trade/AbstractTrader";

interface OrderPartitionerAction extends TechnicalStrategyAction {
    tradeCount: number; // The number of trades sorted by amount we want to display.
    percentChange: number; // How many percent shall the price be changed by orders on the order book?

    // optional values
    whalePercentage: number; // 5% // % volume level for the high volume orders that shall be considered 'whales'
    fishPercentage: number; // 3% // % volume level for the low volume orders that shall be considered 'small fish'
    maxTradesDisplay: number; // 30 // How many single trades to display at most per bucket.

    tradeDirection: TradeDirection | "notify" | "watch"; // optional. default "watch"

    // TODO count buy/sell trades over specified intervals

    // EMA cross params (optional)
    CrossMAType: "EMA" | "DEMA" | "SMA"; // optional, default EMA
    short: number; // default 2
    long: number; // default 7

    // trading config. optional, default disabled
    requireMAMatch: boolean; // optional, default false. Require the moving average to match the trades buy/sell ratio to open a position.
    volumeBuySellLongThreshold: number; // 65 // The min ratio for buy-sell orders to open a long position.
    volumeBuySellShortThreshold: number; // 35 // The max ratio for buy-sell orders to open a short position.
}

class PartitionTrade implements Trade.SimpleTrade {
    rate: number;
    amount: number;
    date: Date;
    type: Trade.TradeType;
    constructor(rate: number, amount: number, date: Date, type: Trade.TradeType) {
        this.rate = rate;
        this.amount = amount;
        this.date = date;
        this.type = type;
    }

    toString() {
        return utils.sprintf("%s %s@%s", Trade.TradeType[this.type], this.amount, this.rate);
    }
}

/**
 * Strategy that partitions orders of the last candle tick into buckets of different sizes by volume.
 * It then displays you the buy/sell ratios for these volume buckets. You can open trades once this ratio
 * crosses a certain threshold. Signal is to weak to be used alone, should be used together with other strategies
 * (such as MACD or RSI).
 */
export default class OrderPartitioner extends TechnicalStrategy {
    protected static WATCH_ORDERBOOK = false;

    public action: OrderPartitionerAction;
    protected currentTickTrades: Trade.Trade[] = [];
    protected tradesCount: number = -1;
    protected minTradeVolume: number = -1;
    protected maxTradeVolume: number = -1;
    protected lastTotalTradeVolume: number = -1;
    protected totalTradeVolume: number = -1;
    protected averageTradeVolume: number = -1;
    protected minPrice: number = -1;
    protected maxPrice: number = -1;
    protected buyCount: number = -1;
    protected sellCount: number = -1;
    protected volumeBuyCount: number = -1;
    protected volumeSellCount: number = -1;
    protected whaleBuyCount: number = -1;
    protected whaleSellCount: number = -1;
    protected fishBuyCount: number = -1;
    protected fishSellCount: number = -1;
    protected volumeTradeList: PartitionTrade[] = [];
    protected whaleTrades: PartitionTrade[] = [];
    protected fishTrades: PartitionTrade[] = [];

    protected tradeHeap: Heap = this.getNewHeap();
    protected raiseLowerDiffPercents: number[] = [];

    constructor(options) {
        super(options)
        //if (nconf.get("trader") === "Backtester")
            //throw new Error(utils.sprintf("%s is not available during backtesting because the order book is only available during live trading.", this.className))

        if (typeof this.action.whalePercentage !== "number")
            this.action.whalePercentage = 5.0;
        if (typeof this.action.fishPercentage !== "number")
            this.action.fishPercentage = 3.0;
        if (!this.action.maxTradesDisplay)
            this.action.maxTradesDisplay = 30;
        if (!this.action.tradeDirection)
            this.action.tradeDirection = "watch";
        if (!this.action.CrossMAType)
            this.action.CrossMAType = "EMA";
        if (!this.action.short)
            this.action.short = 2;
        if (!this.action.long)
            this.action.long = 7;
        if (typeof this.action.requireMAMatch !== "boolean")
            this.action.requireMAMatch = false;

        this.addIndicator("EMA", this.action.CrossMAType, this.action); // can be type EMA, DEMA or SMA

        this.addInfoFunction("currentTradesCount", () => {
            return this.currentTickTrades.length;
        });
        this.addInfo("tradesCount", "tradesCount");
        this.addInfo("minTradeVolume", "minTradeVolume");
        this.addInfo("maxTradeVolume", "maxTradeVolume");
        this.addInfo("lastTotalTradeVolume", "lastTotalTradeVolume");
        this.addInfo("totalTradeVolume", "totalTradeVolume");
        this.addInfo("averageTradeVolume", "averageTradeVolume");
        this.addInfo("minPrice", "minPrice");
        this.addInfo("maxPrice", "maxPrice");
        this.addInfo("buyCount", "buyCount");
        this.addInfo("sellCount", "sellCount");
        this.addInfo("volumeBuyCount", "volumeBuyCount");
        this.addInfo("volumeSellCount", "volumeSellCount");
        this.addInfo("whaleBuyCount", "whaleBuyCount");
        this.addInfo("whaleSellCount", "whaleSellCount");
        this.addInfo("fishBuyCount", "fishBuyCount");
        this.addInfo("fishSellCount", "fishSellCount");
        this.addInfoFunction("tradeVolumeDiff", () => {
            if (this.totalTradeVolume === -1 || this.lastTotalTradeVolume === -1)
                return -1;
            return helper.getDiffPercent(this.totalTradeVolume, this.lastTotalTradeVolume);
        });
        this.addInfoFunction("volumeTradeList", () => {
            return this.formatTrades(this.volumeTradeList);
        });
        this.addInfoFunction("whaleTrades", () => {
            return this.formatTrades(this.whaleTrades);
        });
        this.addInfoFunction("fishTrades", () => {
            return this.formatTrades(this.fishTrades);
        });
        this.addInfoFunction("buySell", () => {
            return this.getBuySellPercentage(this.buyCount, this.sellCount);
        });
        this.addInfoFunction("volumeBuySell", () => {
            return this.getBuySellPercentage(this.volumeBuyCount, this.volumeSellCount);
        });
        this.addInfoFunction("whaleBuySell", () => {
            return this.getBuySellPercentage(this.whaleBuyCount, this.whaleSellCount);
        });
        this.addInfoFunction("fishBuySell", () => {
            return this.getBuySellPercentage(this.fishBuyCount, this.fishSellCount);
        });
        this.addInfoFunction("volumeTrend", () => {
            return this.volumeBuyCount > this.volumeSellCount ? "up" : "down"; // TODO volume weighed trades?
        });

        // order book features
        if (nconf.get("trader") !== "Backtester" && OrderPartitioner.WATCH_ORDERBOOK) {
            this.addInfoFunction("raiseTargetPrice", () => {
                let currentPrice = this.orderBook.getLast();
                return currentPrice + currentPrice / 100 * this.action.percentChange;
            });
            this.addInfoFunction("lowerTargetPrice", () => {
                let currentPrice = this.orderBook.getLast();
                return currentPrice - currentPrice / 100 * this.action.percentChange;
            });
            this.addInfoFunction("raiseAmountBase", () => {
                return this.orderBook.getRaiseAmount(this.action.percentChange);
            });
            this.addInfoFunction("lowerAmountBase", () => {
                return this.orderBook.getLowerAmount(this.action.percentChange);
            });
            this.addInfoFunction("raiseLowerDiffPercent", () => {
                return Math.floor(this.getRaiseLowerDiffPercent() * 100) / 100;
            });
            this.addInfoFunction("raiseLowerDiffPercentAvg", () => {
                return Math.floor(this.getAvgRaiseLowerDiffPercent() * 100) / 100;
            });
            this.addInfoFunction("orderBookTrend", () => {
                return this.getRaiseLowerDiffPercent() > 0 ? "up" : "down";
            });
        }
        this.addInfoFunction("EMA line diff %", () => {
            return this.indicators.get("EMA").getLineDiffPercent();
        });

        this.saveState = true;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            this.currentTickTrades = this.currentTickTrades.concat(trades);
            this.addRaiseLowerDiffPercent(); // use avg of ratio on each tick instead of current value at candle tick
            super.tick(trades).then(() => {
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected checkIndicators() {
        this.computeVolumeStats();
        this.partitionTrades();
        this.tradesCount = this.currentTickTrades.length;
        this.currentTickTrades = [];
        this.raiseLowerDiffPercents = []; // restart will empty array and fill it up until next candle tick
        this.plotChart();
        if (this.action.tradeDirection !== "watch")
            this.tradeByVolume();
    }

    protected computeVolumeStats() {
        let min = Number.MAX_VALUE, minPrice = Number.MAX_VALUE;
        let max = 0, maxPrice = 0;
        let buy = 0, sell = 0;
        let total = 0;
        for (let i = 0; i < this.currentTickTrades.length; i++)
        {
            let trade = this.currentTickTrades[i];
            if (trade.amount < min)
                min = trade.amount;
            if (trade.amount > max)
                max = trade.amount;
            if (trade.rate < minPrice)
                minPrice = trade.rate;
            if (trade.rate > maxPrice)
                maxPrice = trade.rate;
            if (trade.type === Trade.TradeType.BUY)
                buy++;
            else if (trade.type === Trade.TradeType.SELL)
                sell++;
            total += this.currentTickTrades[i].amount;
        }
        this.minTradeVolume = min;
        this.maxTradeVolume = max;
        this.lastTotalTradeVolume = this.totalTradeVolume;
        this.totalTradeVolume = total;
        this.minPrice = minPrice;
        this.maxPrice = maxPrice;
        this.buyCount = buy;
        this.sellCount = sell;
        if (this.currentTickTrades.length > 0)
            this.averageTradeVolume = total / this.currentTickTrades.length;
        else
            this.averageTradeVolume = 0;
    }

    protected partitionTrades() {
        //let priceDiffPercent = helper.getDiffPercent(this.maxPrice, this.minPrice);
        //const priceDiff = this.maxPrice - this.minPrice;
        //let priceStep = 0;
        let allTrades = [];
        for (let i = 0; i < this.currentTickTrades.length; i++)
        {
            let trade = this.currentTickTrades[i];
            //if (trade.type === Trade.TradeType.BUY)
            let partitionTrade = new PartitionTrade(trade.rate, trade.amount, trade.date, trade.type);
            this.tradeHeap.insert(partitionTrade);
            allTrades.push(partitionTrade);
        }
        let next;
        let tradeList = [];
        let volumeBuy = 0, volumeSell = 0;
        while (next = this.tradeHeap.remove())
        {
            tradeList.push(next);
            if (next.type === Trade.TradeType.BUY)
                volumeBuy++;
            else if (next.type === Trade.TradeType.SELL)
                volumeSell++;
            if (tradeList.length >= this.action.tradeCount)
                break;
        }
        this.volumeTradeList = tradeList;
        this.volumeBuyCount = volumeBuy;
        this.volumeSellCount = volumeSell;
        this.tradeHeap = this.getNewHeap();
        this.collectWhalesAndSmallFishes(allTrades);
    }

    protected collectWhalesAndSmallFishes(trades: PartitionTrade[]) {
        let minWhaleAmount = this.maxTradeVolume - this.maxTradeVolume / 100 * this.action.whalePercentage;
        let maxFishAmount = this.minTradeVolume + this.minTradeVolume / 100 * this.action.fishPercentage;
        let whales = [], fish = [];
        let whaleBuy = 0, whaleSell = 0, fishBuy = 0, fishSell = 0;
        for (let i = 0; i < trades.length; i++)
        {
            if (trades[i].amount > minWhaleAmount) {
                whales.push(trades[i]);
                if (trades[i].type === Trade.TradeType.BUY)
                    whaleBuy++;
                else if (trades[i].type === Trade.TradeType.SELL)
                    whaleSell++;
            }
            else if (trades[i].amount < maxFishAmount) {
                fish.push(trades[i]);
                if (trades[i].type === Trade.TradeType.BUY)
                    fishBuy++;
                else if (trades[i].type === Trade.TradeType.SELL)
                    fishSell++;
            }
        }
        this.whaleTrades = whales;
        this.fishTrades = fish;
        this.whaleBuyCount = whaleBuy;
        this.whaleSellCount = whaleSell;
        this.fishBuyCount = fishBuy;
        this.fishSellCount = fishSell;
    }

    protected getBuySellPercentage(buy: number, sell: number) {
        if (sell === 0)
            return buy === 0 ? 0 : 100;
        let quotient = buy / (buy + sell) * 100;
        return Math.floor(quotient * 100) / 100.0;
    }

    protected formatTrades(list: PartitionTrade[]) {
        let result = "";
        for (let i = 0; i < list.length; i++)
        {
            result += ", " + list[i].toString();
            if (i >= this.action.maxTradesDisplay) {
                result += ",...";
                break;
            }
        }
        return result.substr(2);
    }

    protected getNewHeap(): Heap {
        return new Heap({
            comparBefore(a: PartitionTrade, b: PartitionTrade) {
                return a.amount > b.amount; // higher numbers come first
            },
            compar(a: PartitionTrade, b: PartitionTrade) {
                return a.amount > b.amount ? -1 : 1;
            },
            freeSpace: false,
            size: 1000
        });
    }

    /**
     * Equivalent to getRaiseLowerRatio(), but return value is in percent.
     * @returns {number} a value < 0 if there is more money on sell orders
     * a value > 0 if there is more money on buy orders
     */
    protected getRaiseLowerDiffPercent() {
        // positive % if raise amount bigger -> more sell orders
        // -1 to reverse it, positive = up trend, negative = down trend
        if (!OrderPartitioner.WATCH_ORDERBOOK)
            return 0
        return -1 * helper.getDiffPercent(this.orderBook.getRaiseAmount(this.action.percentChange), this.orderBook.getLowerAmount(this.action.percentChange));
    }

    protected addRaiseLowerDiffPercent() {
        // TODO only keep values from last x ticks? should be dynamic such as "half of the number of ticks per candle size"
        this.raiseLowerDiffPercents.push(this.getRaiseLowerDiffPercent())
    }

    protected getAvgRaiseLowerDiffPercent() {
        let avg = 0;
        if (this.raiseLowerDiffPercents.length === 0)
            return avg;
        for (let i = 0; i < this.raiseLowerDiffPercents.length; i++)
            avg += this.raiseLowerDiffPercents[i];
        avg /= this.raiseLowerDiffPercents.length;
        return avg;
    }

    protected tradeByVolume() {
        if (!this.action.volumeBuySellLongThreshold || !this.action.volumeBuySellShortThreshold)
            return;
        if (this.strategyPosition !== "none")
            return; // only trade once
        const volumeBuySell = this.getBuySellPercentage(this.volumeBuyCount, this.volumeSellCount); // or use "buySell" to include all trades
        if (volumeBuySell > this.action.volumeBuySellLongThreshold && this.isEmaTrendUp()) {
            this.openLong("volumeBuySell value: " + volumeBuySell);
        }
        else if (volumeBuySell < this.action.volumeBuySellShortThreshold && this.isEmaTrendDown()) {
            this.openShort("volumeBuySell value: " + volumeBuySell);
        }
        else
            this.log("No volume trend detected")
    }

    protected openLong(reason: string) {
        if (this.action.tradeDirection === "down")
            return this.log("Skipped opening LONG position because trade direction is set to DOWN only. reason: " + reason);
        this.log(reason);
        if (this.action.tradeDirection === "notify")
            this.sendNotification("BUY signal", reason)
        else
            this.emitBuy(this.defaultWeight, reason);
    }

    protected openShort(reason: string) {
        if (this.action.tradeDirection === "up")
            return this.log("Skipped opening SHORT position because trade direction is set to UP only. reason: " + reason);
        this.log(reason);
        if (this.action.tradeDirection === "notify")
            this.sendNotification("SELL signal", reason)
        else
            this.emitSell(this.defaultWeight, reason);
    }

    protected isEmaTrendUp() {
        if (this.action.requireMAMatch === false)
            return true;
        return this.indicators.get("EMA").getLineDiffPercent() > 0.0;
    }

    protected isEmaTrendDown() {
        if (this.action.requireMAMatch === false)
            return true;
        return this.indicators.get("EMA").getLineDiffPercent() < 0.0;
    }

    protected plotChart() {
        this.plotData.plotMark({
            buySell: this.getBuySellPercentage(this.buyCount, this.sellCount),
            volumeBuySell: this.getBuySellPercentage(this.volumeBuyCount, this.volumeSellCount),
            //whaleBuySell: this.getBuySellPercentage(this.whaleBuyCount, this.whaleSellCount), // always top or bottom, even with 25% whale setting
            fishBuySell: this.getBuySellPercentage(this.fishBuyCount, this.fishSellCount)
        }, true)
        const whaleBuySell = this.getBuySellPercentage(this.whaleBuyCount, this.whaleSellCount);
        if (whaleBuySell < 10)
            this.plotData.plotMark({whaleSell: whaleBuySell}, true, true);
        else if (whaleBuySell > 90)
            this.plotData.plotMark({whaleBuy: whaleBuySell}, true, true);
    }
}