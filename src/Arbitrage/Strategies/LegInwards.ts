import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Candle, Currency, Trade, Order, Ticker, MarketOrder} from "@ekliptor/bit-models";
import {AbstractArbitrageStrategy, ArbitrageStrategyAction, ArbitrageTrade} from "./AbstractArbitrageStrategy";
import {TradeInfo} from "../../Trade/AbstractTrader";
import {BuySellAction, ScheduledTrade, TradeAction} from "../../Strategies/AbstractStrategy";
import {PendingOrder} from "../../Trade/AbstractOrderTracker";
import {OrderBookEntry} from "../../Trade/OrderBook";
import {OrderPair, SimpleOrder} from "../../structs/MarketMakerOrders";
import Leg, {LegAction} from "./Leg";
import * as helper from "../../utils/helper";

type LegCopyBookSide = /*"both" | */"bids" | "asks";

interface LegInwardsAction extends LegAction {
    copySide: LegCopyBookSide; // default "bids" - Which side of the orderbook shall be mirrored. Values: bids|asks
    //priceAddPercent: number; // not used here
    //bookDepthPerSide: number // always 1 here
    // so depending on the minimum trade tick size of each exchange the actual number of orders might be different on both exchanges.
    // Yet they both with go the same price-depth into the bids and asks.
    // Keep in mind that increasing this value will increase the number of trade API requests to the smaller exchange, so be sure your request limit is sufficiently high.
    maxAmountPerOrder: number; // optional, default tradeTotalBtc - The max amount in base currency of a single order. The actual amount will be min(maxAmountPerOrder, amount on leg exchange). This value can't be higher than tradeTotalBtc.
    maxTotalExposure: number; // optional, default 500.000 - Max amount in base currency of all open orders combined.

    // for copyMode == weakInwards
    //pricePointsAddStrong: number; use market orders
    pricePointsAddWeak: number; // optional, default 0 - How many units of price (base currency) shall we go inwards to reduce the spread in the orderbook when placing orders on the small exchange.
    minSpreadPercent: number; // optional, default 0.1% - The minimum spread that must exist to place new orders.
    skipMarketOrders: boolean; // optional, default false - Don't place market orders on the smaller exchange. Wait until the spread increases to place limit orders.

    minDelayAdjustOrdersMs: number; // default 300 ms - The minimum delay in milliseconds before updating orders.
}

/**
 * Arbitrage strategy using limit orders with 1 leg "standing" on the current price rate of the higher-volume exchange.
 * Thereby offering liquidity to the lower-volume exchange by copying the orderbook.
 * Unlike the Leg strategy this strategy places orders inwards on the smaller exchange (to reduce the spread). The leg strategy just copies orders
 * with a configurable price offset in percent.
 * It uses limit orders at market rate on the stronger exchange with more liquidity after an order has been filled.
 */
export default class LegInwards extends Leg {
    protected action: LegInwardsAction;
    protected myRate: number = -1.0;

    constructor(options) {
        super(options)
        this.action.bookDepthPerSide = 1;
        if (typeof this.action.pricePointsAddWeak !== "number")
            this.action.pricePointsAddWeak = 0;
        if (typeof this.action.minSpreadPercent !== "number")
            this.action.minSpreadPercent = 0.1;
        if (typeof this.action.skipMarketOrders !== "boolean")
            this.action.skipMarketOrders = false;

        //this.addInfo("spreadTargetReached", "spreadTargetReached");
        //this.addInfo("trailingStopSpread", "trailingStopSpread");
        this.addInfoFunction("rate1stAsk", () => {
            if (this.orderBook === null)
                return 0.0;
            return this.getFirstExchangeRate(this.orderBook.getAsk());
        });
        this.addInfoFunction("rate1stBid", () => {
            if (this.orderBook === null)
                return 0.0;
            return this.getFirstExchangeRate(this.orderBook.getBid());
        });
        this.addInfoFunction("rate2ndAsk", () => {
            if (this.orderBook2 === null)
                return 0.0;
            return this.getSecondExchangeRate(this.orderBook2.getAsk());
        });
        this.addInfoFunction("rate2ndBid", () => {
            if (this.orderBook2 === null)
                return 0.0;
            return this.getSecondExchangeRate(this.orderBook2.getBid());
        });

        if (nconf.get("trader") === "Backtester")
            throw new Error(utils.sprintf("%s is not available during backtesting because the order book is only available during live trading.", this.className))

        // cancel all open orders on startup
        this.scheduleCancelAllOrders();
    }

    public getArbitrageRate(arbitrageTrade: ArbitrageTrade): number {
        // overwrite this to use custom buy/sell rates
        return super.getArbitrageRate(arbitrageTrade);
    }

    public getMoveOpenOrderSec(pendingOrder: PendingOrder): number {
        return -1; // don't move open limit orders
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (!info.pendingOrder) {
            this.warn("Trader did not return pendingOrder info. Unable to track order.");
            return;
        }

        if (action === "buy" || action === "sell") { // this strategy doesn't send any other orders and shouldn't be used with other strategies
            let nextOrder = this.createSimpleOrder(order, info);
            let currentOrderPair = new OrderPair(this.getMarketTime(), null, null);
            if (action === "buy")
                currentOrderPair.buyOrder = nextOrder;
            else
                currentOrderPair.sellOrder = nextOrder;
            this.orderPairs.push(currentOrderPair);
            this.totalExposure += Math.abs(order.amount);
            /* // we only place 1 side and market buy the other side after the order has been filled
            const nextOrderMs = orderPairComplete ? 0 : 1000; // delay it a bit as the exchange API response might be outstanding
            setTimeout(() => {
                this.placeNextOrder(this.remainingOrders);
            }, nextOrderMs);*/
        }

        // the 1st order is always the buy order, sell is 2nd
        //if (action !== "close") {
        //}
    }

    public onOrderFilled(pendingOrder: PendingOrder): void {
        super.onOrderFilled(pendingOrder);
        this.marketOrderLeg(pendingOrder);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected updateLegOrders() {
        let legExchange = Currency.ExchangeName.get(this.config.exchanges[0]);
        let copyExchange = Currency.ExchangeName.get(this.config.exchanges[1]);
        this.remainingOrders = [];
        //this.legOrderPlaced = false;
        this.arbitrageExchangePair = [legExchange, copyExchange];

        // we always place orders at the same levels as existing on the leg exchange
        // then we add priceAddPercent and place the same order on the smaller exchange
        switch (this.action.copySide) {
            /*
            case "both": {
                // copy buy / sell orders from leg exchange
                break;
            }*/
            case "bids": {
                // copy buy orders from leg exchange
                let orders = this.getExistingOrders("bids");
                if (orders.length > 0) {
                    //this.performArbitrage(legExchange, copyExchange, 12, 4);
                    let nextOrder = orders[0];
                    const nextRate = this.getInwardOrderRate("sell", nextOrder);
                    if (this.myRate === nextRate)
                        break;
                    else if (this.isSpreadTooLow("sell", nextRate) === true || this.resultsInMarketOrder(nextRate) === true)
                        break;
                    this.myRate = nextRate;
                    logger.verbose("Updated SELL rate on %s to %s", this.config.exchanges[1], this.myRate.toFixed(8));
                    this.cancelOpenOrders(this.orderPairs);
                    this.remainingOrders = orders;
                    this.placeNextOrder(this.remainingOrders);
                }
                break;
            }
            case "asks": {
                // copy sell orders from leg exchange
                let orders = this.getExistingOrders("asks");
                if (orders.length > 0) {
                    //this.performArbitrage(legExchange, copyExchange, 12, 4);
                    let nextOrder = orders[0];
                    const nextRate = this.getInwardOrderRate("buy", nextOrder);
                    if (this.myRate === nextRate)
                        break;
                    else if (this.isSpreadTooLow("buy", nextRate) === true || this.resultsInMarketOrder(nextRate) === true)
                        break;
                    this.myRate = nextRate;
                    logger.verbose("Updated BUY rate on %s to %s", this.config.exchanges[1], this.myRate.toFixed(8));
                    this.cancelOpenOrders(this.orderPairs);
                    this.remainingOrders = orders;
                    this.placeNextOrder(this.remainingOrders);
                }
                break;
            }
            default:
                utils.test.assertUnreachableCode(this.action.copySide);
        }
    }

    /**
     * Return an array of orders away from the last trade price on the weaker exchange (we want to do market making on).
     * @param side
     */
    protected getExistingOrders(side: "bids" | "asks"): OrderBookEntry[] {
        let orders = [];
        let last = this.orderBook2.getLast();
        //console.log(side.toUpperCase())
        for (let i = 0; i < this.action.bookDepthPerSide; i++)
        {
            let order = side === "bids" ? this.orderBook2.getNextBid(last) : this.orderBook2.getNextAsk(last);
            if (order === null)
                break;
            last =  order.rate;
            orders.push(order);
            //console.log("rate: %s, amount %s", order.rate, order.amount);
        }
        return orders;
    }

    protected placeNextOrder(remainingOrders: OrderBookEntry[]) {
        let nextOrder = remainingOrders.shift(); // modify object
        if (nextOrder === undefined)
            return;
        if (this.totalExposure >= this.action.maxTotalExposure) {
            while (remainingOrders.shift()) ; // remove all orders
            const quoteCurrencyStr = Currency.getCurrencyLabel(this.action.pair.to);
            this.log(utils.sprintf("Total exposure reached limit: %s %s > %s %s - stopped placing more orders",
                this.totalExposure.toFixed(8), quoteCurrencyStr, this.action.maxTotalExposure.toFixed(8), quoteCurrencyStr));
            return;
        }

        //let legExchange = Currency.ExchangeName.get(this.config.exchanges[0]); // the bigger exchange (with more liquidity)
        let copyExchange = Currency.ExchangeName.get(this.config.exchanges[1]); // the smaller exchange
        //const orderCount = utils.sprintf(", remaining %s", remainingOrders.length);
        switch (this.action.copySide) {
            case "bids":
                this.nextRate = this.getInwardOrderRate("sell", nextOrder);
                this.arbitrageRate = [this.nextRate, this.nextRate]; // [buy, sell]
                this.nextAmount = nextOrder.amount;
                //this.emitBuy(this.defaultWeight, "leg buy" + orderCount, this.className, legExchange);
                this.emitSell(this.defaultWeight, "copying leg buy with offset", this.className, copyExchange);
                break;
            case "asks":
                this.nextRate = this.getInwardOrderRate("buy", nextOrder);
                this.arbitrageRate = [this.nextRate, this.nextRate]; // [buy, sell]
                this.nextAmount = nextOrder.amount;
                this.emitBuy(this.defaultWeight, "copying leg sell with offset", this.className, copyExchange);
                //this.emitSell(this.defaultWeight, "leg sell" + orderCount, this.className, legExchange);
                break;
            default:
                utils.test.assertUnreachableCode(this.action.copySide);
        }
    }

    protected marketOrderLeg(filledOrder: PendingOrder) {
        let legExchange = Currency.ExchangeName.get(this.config.exchanges[0]); // the bigger exchange (with more liquidity)
        switch (this.action.copySide) {
            case "bids":
                // this.nextAmount is already set
                this.emitBuy(this.defaultWeight, "leg buy after fill", this.className, legExchange);
                break;
            case "asks":
                this.emitSell(this.defaultWeight, "leg sell after fill", this.className, legExchange);
                break;
            default:
                utils.test.assertUnreachableCode(this.action.copySide);
        }
    }

    protected getInwardOrderRate(smallExchangeAction: BuySellAction, firstOrder: OrderBookEntry): number {
        if (smallExchangeAction === "sell")
            return firstOrder.rate - this.action.pricePointsAddWeak;
        return firstOrder.rate + this.action.pricePointsAddWeak; // buy
    }

    protected isSpreadTooLow(smallExchangeAction: BuySellAction, nextRate: number): boolean {
        nextRate = this.getSecondExchangeRate(nextRate); // convert from weaker exchange (THB) to main rate (USD)
        const bestRateLeg = this.getFirstExchangeRate(smallExchangeAction === "buy" ? this.orderBook.getAsk() : this.orderBook.getBid());
        const baseCurrencyStr = Currency.getCurrencyLabel(this.action.pair.from);
        if (smallExchangeAction === "buy" && nextRate >= bestRateLeg) {
            this.log(utils.sprintf("Skipped placing BUY because rate on small exchange is higher: %s %s > %s %s",
                nextRate.toFixed(8), baseCurrencyStr, bestRateLeg.toFixed(8), baseCurrencyStr));
            return true;
        }
        else if (smallExchangeAction === "sell" && nextRate <= bestRateLeg) {
            this.log(utils.sprintf("Skipped placing SELL because rate on small exchange is lower: %s %s < %s %s",
                nextRate.toFixed(8), baseCurrencyStr, bestRateLeg.toFixed(8), baseCurrencyStr));
            return true;
        }
        const spreadPercent = helper.getDiffPercent(nextRate, bestRateLeg);
        if (Math.abs(spreadPercent) < this.action.minSpreadPercent) {
            this.log(utils.sprintf("Skipped placing %s because spread is too low: %s%%", smallExchangeAction.toUpperCase(), spreadPercent.toFixed(8)));
            return true;
        }
        return false;
    }

    protected resultsInMarketOrder(nextRate: number): boolean {
        if (this.action.skipMarketOrders !== true)
            return false;
        if (this.orderBook2.getBid() >= nextRate && this.orderBook2.getAsk() <= nextRate) {
            this.log(utils.sprintf("Skipped placing market order at %s, bid %s, ask %s",
                nextRate.toFixed(8), this.orderBook2.getBid(), this.orderBook2.getAsk()));
            return true;
        }
        return false;
    }
}
