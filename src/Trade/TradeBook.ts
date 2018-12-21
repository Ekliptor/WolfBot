import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Order, Funding, BotTrade} from "@ekliptor/bit-models";
import {TradeInfo} from "./AbstractTrader";
import {LendingTradeInfo} from "../Lending/AbstractLendingTrader";
import TradeAdvisor from "../TradeAdvisor";
import {LendingAdvisor} from "../Lending/LendingAdvisor";
import {ConfigCurrencyPair} from "./TradeConfig";
import * as db from "../database";
import {UIBotLendingTrade, UIBotTrade} from "../structs/UITrade";
import {JsonResponse} from "../Web/JsonResponse";
import {WebErrorCode} from "../Web/errorCodes";


export interface MyTradeHistoryReq {
    mode: string; //BotTrade.TradingMode;
    currencyStr: string; // or single currency for lending
    configName: string;
    endDate: number; // unix timestamp, i.e. number of seconds
}
export interface MyTradeHistoryRes {
    trades?: UIBotTrade[];
    tradesMeta?: TradeMetaInfo;
    lendingTrades?: UIBotLendingTrade[];
}
export class TradeMetaInfo {
    avgBuyPrice: number = 0.0;
    avgSellPrice: number = 0.0;
    totalBuys: number = 0.0; // volume
    totalSells: number = 0.0;
    totalBuyAmountBase: number = 0.0;
    totalSellAmountBase: number = 0.0;
    remainingCoins: number = 0.0;
    breakEvenPrice: number = 0.0;
    profitLoss: number = 0.0;
    // TODO add profit/loss percent (we need to get the starting amount?)
    // TODO add some background tasks to evalute bots on server
    baseCurrency: string = "";
    quoteCurrency: string = "";

    constructor() {
    }
}


/**
 * A class keeping book of all our live trades and their profitability (excluding backtests).
 */
export class TradeBook {
    protected tradeAdvisor: TradeAdvisor = null; // only 1 of them will be set
    protected lendingAdvisor: LendingAdvisor = null;

    constructor(tradeAdvisor: TradeAdvisor, lendingAdvisor: LendingAdvisor) {
        this.tradeAdvisor = tradeAdvisor;
        this.lendingAdvisor = lendingAdvisor;
    }

    public logTrade(order: Order.Order, trades: Trade.Trade[], info: TradeInfo, configCurrencyPair: ConfigCurrencyPair) {
        if (nconf.get("trader") === "Backtester")
            return;
        let market = order.leverage > 1.0 || order.marginOrder ? BotTrade.LogTradeMarket.MARGIN : BotTrade.LogTradeMarket.EXCHANGE;
        let type: BotTrade.LogTradeType;
        if (market === BotTrade.LogTradeMarket.MARGIN) {
            if (order.type !== Trade.TradeType.CLOSE)
                type = order.type === Trade.TradeType.BUY ? BotTrade.LogTradeType.BUY : BotTrade.LogTradeType.SELL;
            else
                type = order.closePosition === "long" ? BotTrade.LogTradeType.CLOSE_LONG/*sell*/ : BotTrade.LogTradeType.CLOSE_SHORT;
        }
        else
            type = order.type === Trade.TradeType.BUY ? BotTrade.LogTradeType.BUY : BotTrade.LogTradeType.SELL;
        let botTrade = new BotTrade.BotTrade(order.date, market, type, order.exchange, order.currencyPair);
        botTrade.paper = nconf.get("tradeMode") === 1;
        let strategies = this.tradeAdvisor.getStrategies();
        let pairStrategies = strategies.get(configCurrencyPair);
        botTrade.setTradingData(this.tradeAdvisor.getConfigName(), pairStrategies.map(s => s.getClassName()), trades, info.reason);
        botTrade.setTradingAmount(order.rate, order.amount);
        // TODO get the trades worth in a user-defined tax currency (such as JPY...)
        if (info.exchange)
            botTrade.fees = info.exchange.getFee();
        if (nconf.get("arbitrage"))
            botTrade.arbitrage = true;
        this.store(botTrade);
    }

    public logLendingTrade(order: Funding.FundingOrder, trades: Funding.FundingTrade[], info: LendingTradeInfo, configCurrencyPair: ConfigCurrencyPair) {
        if (nconf.get("trader") === "Backtester")
            return;
        let botTrade = new BotTrade.BotLendingTrade(order.date, BotTrade.LogTradeMarket.LENDING, BotTrade.LogTradeType.LEND, order.exchange, order.currency)
        let strategies = this.lendingAdvisor.getLendingStrategies();
        let pairStrategies = strategies.get(configCurrencyPair);
        botTrade.setTradingData(this.tradeAdvisor.getConfigName(), pairStrategies.map(s => s.getClassName()), trades, info.reason);
        botTrade.setTradingAmount(order.rate, order.amount);
        if (info.exchange) {
            botTrade.lendingFees = info.exchange.getLendingFee();
            //botTrade.interestRate = order.rate; // daily rate
            botTrade.interestAmount = order.rate * order.amount * order.days;
            botTrade.days = order.days;
        }
        this.store(botTrade);
    }

    public async getHistory(tradeReq: MyTradeHistoryReq, output: JsonResponse) {
        let update: MyTradeHistoryRes = {}
        //console.log(utils.dispatcher.getSingleKeyPostReq(tradeReq))
        if (!tradeReq.mode)
            tradeReq.mode = "trading";
        else if (BotTrade.TRADING_MODES.indexOf(tradeReq.mode as BotTrade.TradingMode) === -1) {
            output.setError(WebErrorCode.TRADEBOOK_ERROR_PARAMS, "Invalid 'mode' parameter");
            return update;
        }
        if (typeof tradeReq.currencyStr !== "string") {
            output.setError(WebErrorCode.TRADEBOOK_ERROR_PARAMS, "Parameter 'currencyStr' is required");
            return update;
        }
        // TODO add validation if currencyStr is invalid
        try {
            let trades = await this.getMyTrades(tradeReq);
            this.addUiTrades(update, trades, tradeReq.mode === "lending");
        }
        catch (err) {
            logger.error("Error getting tradebook trade history", err)
            output.setError(WebErrorCode.TRADEBOOK_ERROR_QUERY, "Error getting history for your request. Please ensure your parameters are correct and try again.");
        }
        return update;
    }

    public async getMyTrades(req: MyTradeHistoryReq): Promise<BotTrade.AbstractBotTrade[]> {
        const token = nconf.get("serverConfig:userToken")
        if (!token) {
            logger.error("User token must be set for trade book to return history");
            return [];
        }
        let collection = db.get().collection(BotTrade.COLLECTION_NAME)
        let filter: any = {
            userToken: token
        }
        if (typeof req.endDate === "number" && req.endDate !== 0)
            filter.time = {$lt: new Date(req.endDate * 1000)}
        const lending = req.mode === "lending";
        if (lending)
            filter.market = BotTrade.LogTradeMarket.LENDING;
        else {
            filter.market = {$in: [BotTrade.LogTradeMarket.EXCHANGE, BotTrade.LogTradeMarket.MARGIN]};
            filter.arbitrage = req.mode === "arbitrage";
        }
        if (req.configName)
            filter.configName = req.configName;
        try {
            if (req.currencyStr) {
                if (lending)
                    filter.currencyPair = Currency.CurrencyPair.fromString(req.currencyStr + "_" + req.currencyStr).toNr();
                else
                    filter.currencyPair = Currency.CurrencyPair.fromString(req.currencyStr).toNr();
            }
            let docs = await collection.find(filter).sort({time: -1}).limit(nconf.get("data:maxShowHistoryTrades")).toArray();
            return BotTrade.initMany(docs);
        }
        catch (err) {
            logger.error("Error getting bot trades", err)
            return [];
        }
    }

    /**
     * Adds the total statistics about our trades (shown in the header as the summary of the trade book).
     * @param res
     * @param trades
     * @param lending
     */
    public addUiTrades(res: MyTradeHistoryRes, trades: BotTrade.AbstractBotTrade[], lending: boolean) {
        res.tradesMeta = new TradeMetaInfo();
        if (lending) {
            res.lendingTrades = [];
            trades.forEach((trade) => {
                res.lendingTrades.push(UIBotLendingTrade.fromTrade(trade as BotTrade.BotLendingTrade));
                if (trade instanceof BotTrade.BotLendingTrade) {
                    const amount = Math.abs(trade.amount)/* * trade.lendingFees*/;
                    res.tradesMeta.avgSellPrice += amount * trade.rate; // display lending as sells
                    res.tradesMeta.totalSells += amount;
                    res.tradesMeta.profitLoss += trade.interestAmount * trade.lendingFees; // on lending fees are being deducted from our returned interest
                }
            })
        }
        else {
            res.trades = [];
            trades.forEach((trade) => {
                res.trades.push(UIBotTrade.fromTrade(trade as BotTrade.BotTrade));
                if (trade instanceof BotTrade.BotTrade) {
                    const amount = Math.abs(trade.amount) * trade.fees;
                    if (trade.type === BotTrade.LogTradeType.BUY || trade.type === BotTrade.LogTradeType.CLOSE_SHORT) {
                        res.tradesMeta.avgBuyPrice += amount * trade.rate;
                        res.tradesMeta.totalBuys += amount;
                    }
                    else {
                        res.tradesMeta.avgSellPrice += amount * trade.rate;
                        res.tradesMeta.totalSells += amount;
                    }
                }
            })
        }
        // TODO all calculations correct for shorting too?
        res.tradesMeta.totalBuyAmountBase = res.tradesMeta.avgBuyPrice;
        res.tradesMeta.totalSellAmountBase = res.tradesMeta.avgSellPrice;
        // compute the Volume Weighted Price
        if (res.tradesMeta.avgBuyPrice !== 0 && res.tradesMeta.totalBuys !== 0)
            res.tradesMeta.avgBuyPrice /= res.tradesMeta.totalBuys;
        if (res.tradesMeta.avgSellPrice !== 0 && res.tradesMeta.totalSells !== 0)
            res.tradesMeta.avgSellPrice /= res.tradesMeta.totalSells;
        if (!lending)
            res.tradesMeta.profitLoss = res.tradesMeta.totalBuyAmountBase - res.tradesMeta.totalSellAmountBase;
        res.tradesMeta.remainingCoins = res.tradesMeta.totalBuys - res.tradesMeta.totalSells;
        if (res.tradesMeta.remainingCoins > 0.0)
            res.tradesMeta.breakEvenPrice = (res.tradesMeta.totalBuyAmountBase - res.tradesMeta.totalSellAmountBase) / res.tradesMeta.remainingCoins;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected store(botTrade: BotTrade.AbstractBotTrade) {
        if (nconf.get("serverConfig:userToken"))
            botTrade.userToken = nconf.get("serverConfig:userToken");
        (botTrade as any).currencyPair = botTrade.currencyPair.toNr(); // for smaller storage size. converted back when reading from DB
        BotTrade.storeTrade(db.get(), botTrade).then((success) => {
            if (success === false)
                logger.error("Failed to store bot trade", botTrade)
        }).catch((err) => {
            logger.error("Error storing bot trade", err)
        })
    }
}