import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractMarketStream} from "./AbstractMarketStream";
import {OrderModification} from "../structs/OrderResult";
import {Currency, Trade, Order, MarketOrder, Funding} from "@ekliptor/bit-models";
import {AbstractExchange, OrderBookUpdate} from "../Exchanges/AbstractExchange";
import {AbstractLendingExchange} from "../Exchanges/AbstractLendingExchange";

export interface MarketAction {
    type: "newTrade" | "orderBookModify" | "orderBookRemove";
    data: any;
    // newTrade: see OrderTrade class
    // see OrderModification class: orderBookModify: { type: 'bid', rate: '0.00009810', amount: '58242.27220445' }
    // orderBookRemove: data: { type: 'bid', rate: '0.00009811' }
}

class FundingQueue extends Map<string, Funding.FundingTrade[]> { // (currency, trades/orders)
    constructor() {
        super()
    }
}

export class MarketStream extends AbstractMarketStream {
    protected fundingTrades = new FundingQueue();
    protected fundingOrders = new FundingQueue();
    protected fundingTradeTimerID: NodeJS.Timer = null;
    protected fundingOrderTimerID: NodeJS.Timer = null;

    constructor(exchange: AbstractExchange) {
        super(exchange)
    }

    public write(currencyPair: Currency.CurrencyPair, actions: /*MarketAction[]*/any[], seqNr: number) {
        let trades = []
        let orders = []
        const orderBook = this.exchange.getOrderBook().get(currencyPair.toString());
        const exLabel = this.exchange.getExchangeLabel();
        let removeMarkedOrders = false;
        for (let i = 0; i < actions.length; i++)
        {
            // TODO move poloniex specific code into poloniex currencies interface
            let action = actions[i];
            if (action instanceof Trade.Trade) { // Kraken and other imports
                trades.push(action)
                continue;
            }

            if (Array.isArray(action) === true) { // new poloniex api
                //console.log(action)
                if (action[0] === "t") { // trade
                    trades.push(Trade.Trade.fromJson(action.slice(1), currencyPair, exLabel, this.exchange.getFee(), this.exchange.getDateTimezoneSuffix()))
                }
                else if (action[0] === "o") { // order book
                    //console.log(seqNr, action)
                    // use Order.Order class
                    // [ 'o', 1, '0.09520000', '8.74681417' ] // add
                    // [ 'o', 0, '0.10285241', '0.18471782' ] // remove, modify = remove + add?
                    let order = MarketOrder.MarketOrder.getOrder(currencyPair, exLabel, action[3], action[2]);
                    if (orderBook.isSnapshotReady()) { // causes orderbook to hang in removeOrder() otherwise // TODO why?
                        if (action[1] != 0)
                            orderBook.addOrder(order, seqNr);
                        else
                            orderBook.removeOrder(order, seqNr);
                    }
                    //else // too many lines on startup
                        //logger.warn("Ignoring orderbook update for %s because snapshot is not ready", currencyPair.toString())
                }
                else if (action[0] == "of") { // order book full updates (no incremental updates)
                    //orderBook.clear(true); // causes flickering
                    orderBook.markOrders();
                    removeMarkedOrders = true;
                    let order = MarketOrder.MarketOrder.getOrder(currencyPair, exLabel, action[3], action[2]);
                    if (action[1] != 0)
                        orderBook.addOrder(order, seqNr);
                    else
                        orderBook.removeOrder(order, seqNr);
                }
                else if (action[0] === "i") { // order book init (complete current state)
                    // action[1] == {"currencyPair":"BTC_ETH","orderBook":[[{"0.09551761":"0.00080897",...}, [BUY ORDERS]]
                    //console.log(seqNr, action[1].orderBook)
                    let orders = []
                    //console.log(action[1].orderBook[1])
                    let maxSellRate = Number.MAX_VALUE; // ask
                    let marketRate = 0;
                    [action[1].orderBook[0], action[1].orderBook[1]].forEach((o) => {
                        for (let prop in o)
                        {
                            //console.log(prop, o[prop])
                            let order = MarketOrder.MarketOrder.getOrder(currencyPair, exLabel, o[prop], prop);
                            orders.push(order)
                            //console.log(order.rate)
                            if (order.rate < maxSellRate)
                                maxSellRate = order.rate;
                        }
                        if (marketRate === 0)
                            marketRate = maxSellRate - OrderBookUpdate.ASK_BID_DIFF; // assume right below sell rate to start
                    })
                    orderBook.setSnapshot(orders, seqNr);
                    //orderBook.setLast(marketRate); // the last order != the last trade
                }
                else
                    logger.warn("Received unknown market action:", action)
                continue;
            }

            // poloniex v1 legacy APPI
            if (action.type === "newTrade")
                trades.push(Trade.Trade.fromJson(action.data, currencyPair, this.exchange.getExchangeLabel(), this.exchange.getFee(), this.exchange.getDateTimezoneSuffix()))
            else if (action.type === "orderBookModify" || action.type === "orderBookRemove")
                orders.push(action) // TODO parse order
            else
                logger.warn("Received unknown market action '%s':", action.type, action.data)
        }
        if (removeMarkedOrders === true)
            orderBook.removeMarked();
        this.emitTrades(currencyPair, trades)
        this.emitOrders(currencyPair, orders)
    }

    public writeTrades(currencyPair: Currency.CurrencyPair, trades: Trade.Trade[]) {
        this.emitTrades(currencyPair, trades)
        // better done in replay() while reading from DB
        /*
        if (nconf.get('trader') !== "Backtester") {
            this.emitTrades(currencyPair, trades)
            return;
        }

        // emit at most 1 min of trades so that strategies can trade to a price closer to current market value (otherwise the simulation results are unrealistic)
        this.emitTradesQueue = this.emitTradesQueue.then(() => {
            let emitTrades = []
            const pairStr = currencyPair.toString()
        }).catch((err) => {
            logger.error("Error emitting trades", err)
        })
        */
    }

    public writeFundingOrderbook(currency: Currency.Currency, fundingOrder: Funding.FundingOrder, seqNr: number) {
        clearTimeout(this.fundingOrderTimerID)
        this.fundingOrderTimerID = setTimeout(() => { // only 1 timer for all currencies to save resources. emit all currencies
            this.emitFundingOrders()
        }, 0)
        const currencyStr = Currency.Currency[currency];
        let queue = this.fundingOrders.get(currencyStr)
        if (!queue)
            queue = [];
        queue.push(fundingOrder);
        this.fundingOrders.set(currencyStr, queue); // emit all new info together
        // TODO snapshots of funding book not needed? at least for bitfinex first websocket packet is big enough
        const orderBook = (this.exchange as AbstractLendingExchange).getLendingOrderBook().get(currencyStr);
        orderBook.addOrder(fundingOrder, seqNr);
    }

    public writeFundingTrade(currency: Currency.Currency, fundingTrade: Funding.FundingTrade, seqNr: number) {
        clearTimeout(this.fundingTradeTimerID)
        this.fundingTradeTimerID = setTimeout(() => {
            this.emitFundingTrades()
        }, 0)
        const currencyStr = Currency.Currency[currency];
        let queue = this.fundingTrades.get(currencyStr)
        if (!queue)
            queue = [];
        queue.push(fundingTrade);
        this.fundingTrades.set(currencyStr, queue)
    }

    //public writeOrders(currencyPair: Currency.CurrencyPair, orders: Order.Order[]) {
        //this.emitOrders(currencyPair, orders)
    //}

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected emitTrades(currencyPair: Currency.CurrencyPair, trades: Trade.Trade[]) {
        if (trades.length !== 0)
            this.emit("trades", currencyPair, trades);
    }

    protected emitOrders(currencyPair: Currency.CurrencyPair, orders: OrderModification[]) {
        if (orders.length !== 0)
            this.emit("orders", currencyPair, orders);
    }

    protected emitFundingTrades() {
        for (let funding of this.fundingTrades)
        {
            let currency: Currency.Currency = Currency.Currency[funding[0]];
            let trades = funding[1];
            if (trades.length !== 0)
                this.emit("tradesFunding", currency, trades);
        }
        this.fundingTrades.clear();
    }

    protected emitFundingOrders() {
        for (let funding of this.fundingTrades)
        {
            let currency: Currency.Currency = Currency.Currency[funding[0]];
            let orders = funding[1];
            if (orders.length !== 0)
                this.emit("ordersFunding", currency, orders);
        }
        this.fundingOrders.clear();
    }
}