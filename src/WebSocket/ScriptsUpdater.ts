import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as WebSocket from "ws";
import * as http from "http";
import * as path from "path";
import {ServerSocketPublisher, ServerSocket, ServerSocketSendOptions, ClientSocketOnServer} from "./ServerSocket";
import {AppPublisher} from "./AppPublisher";
import {WebSocketOpcode} from "./opcodes";
import TradeAdvisor from "../TradeAdvisor";
import {PortfolioTrader, BotEvaluation} from "../Trade/PortfolioTrader"
import {AbstractAdvisor} from "../AbstractAdvisor";

export interface ScriptsRes {

}
export interface ScriptsReq {

}

export class ScriptsUpdater extends AppPublisher {
    public readonly opcode = WebSocketOpcode.SCRIPTS;

    constructor(serverSocket: ServerSocket, advisor: AbstractAdvisor) {
        super(serverSocket, advisor)
    }

    public onSubscription(clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {

    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected onData(data: ScriptsReq, clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {

    }

    protected send(ws: ClientSocketOnServer, data: ScriptsRes, options?: ServerSocketSendOptions) {
        return super.send(ws, data, options);
    }
}