import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as WebSocket from "ws";
import * as http from "http";
import * as path from "path";
import {ServerSocketPublisher, ServerSocket, ClientSocketOnServer} from "./ServerSocket";
import {AppPublisher} from "./AppPublisher";
import {WebSocketOpcode} from "./opcodes";
import TradeAdvisor from "../TradeAdvisor";
import {AbstractAdvisor} from "../AbstractAdvisor";
import {Currency, Trade, BotTrade} from "@ekliptor/bit-models";
import * as db from "../database";
import {UIBotLendingTrade, UIBotTrade} from "../structs/UITrade";
import {MyTradeHistoryReq, MyTradeHistoryRes, TradeMetaInfo} from "../Trade/TradeBook";

export interface GetTradeHistoryReq extends MyTradeHistoryReq {
}
export interface BotTradeRes extends MyTradeHistoryRes {
    init?: {
        configName: string;
        tradingModes: string[];
        lending: boolean; // mode the bot is currently in. we can still show all stats
    }
}
export interface BotTradeReq {
    getTrades?: GetTradeHistoryReq;
}

export class TradeHistoryUpdater extends AppPublisher {
    public readonly opcode = WebSocketOpcode.TRADE_HISTORY;

    constructor(serverSocket: ServerSocket, advisor: AbstractAdvisor) {
        super(serverSocket, advisor)
    }

    public onSubscription(clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
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

    protected onData(data: BotTradeReq, clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
        if (data.getTrades)
            return this.respondWithTrades(data.getTrades, clientSocket);
    }

    protected respondWithTrades(req: GetTradeHistoryReq, clientSocket: ClientSocketOnServer) {
        this.advisor.getTradeBook().getMyTrades(req).then((trades) => {
            let update: BotTradeRes = {
            }
            this.advisor.getTradeBook().addUiTrades(update, trades, req.mode === "lending");
            this.send(clientSocket, update)
        }).catch((err) => {
            logger.error("Error getting trade history", err)
        })
    }
}