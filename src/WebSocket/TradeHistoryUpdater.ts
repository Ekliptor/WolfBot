import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as WebSocket from "ws";
import * as http from "http";
import * as path from "path";
import {ServerSocketPublisher, ServerSocket} from "./ServerSocket";
import {AppPublisher} from "./AppPublisher";
import {WebSocketOpcode} from "./opcodes";
import TradeAdvisor from "../TradeAdvisor";
import {AbstractAdvisor} from "../AbstractAdvisor";
import {Currency, Trade, BotTrade} from "@ekliptor/bit-models";
import * as db from "../database";
import {UIBotLendingTrade, UIBotTrade} from "../structs/UITrade";

export interface GetTradeHistoryReq {
    mode: string; //BotTrade.TradingMode;
    currencyStr: string; // or single currency for lending
    configName: string;
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

export interface BotTradeRes {
    init?: {
        configName: string;
        tradingModes: string[];
        lending: boolean; // mode the bot is currently in. we can still show all stats
    }
    trades?: UIBotTrade[];
    tradesMeta?: TradeMetaInfo;
    lendingTrades?: UIBotLendingTrade[];
}
export interface BotTradeReq {
    getTrades?: GetTradeHistoryReq;
}

export class TradeHistoryUpdater extends AppPublisher {
    public readonly opcode = WebSocketOpcode.TRADE_HISTORY;

    constructor(serverSocket: ServerSocket, advisor: AbstractAdvisor) {
        super(serverSocket, advisor)
    }

    public onSubscription(clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        let update: BotTradeRes = {
            init: {
                configName: this.advisor.getConfigName(),
                tradingModes: BotTrade.TRADING_MODES,
                lending: nconf.get("lending") === true // initial state only
            }
        }
        this.send(clientSocket, update)
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected onData(data: BotTradeReq, clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        if (data.getTrades)
            return this.respondWithTrades(data.getTrades, clientSocket);
    }

    protected respondWithTrades(req: GetTradeHistoryReq, clientSocket: WebSocket) {
        this.getMyTrades(req).then((trades) => {
            let update: BotTradeRes = {
            }
            this.addUiTrades(update, trades, req.mode === "lending");
            this.send(clientSocket, update)
        }).catch((err) => {
            logger.error("Error getting trade history", err)
        })
    }

    protected addUiTrades(res: BotTradeRes, trades: BotTrade.AbstractBotTrade[], lending: boolean) {
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

    protected async getMyTrades(req: GetTradeHistoryReq): Promise<BotTrade.AbstractBotTrade[]> {
        const token = nconf.get("serverConfig:userToken")
        let collection = db.get().collection(BotTrade.COLLECTION_NAME)
        let filter: any = {
            userToken: token
        }
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
            return BotTrade.initMany(docs)
        }
        catch (err) {
            logger.error("Error getting bot trades", err)
            return [];
        }
    }
}