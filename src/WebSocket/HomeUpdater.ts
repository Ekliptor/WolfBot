import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as WebSocket from "ws";
import * as http from "http";
import * as path from "path";
import {ServerSocketPublisher, ServerSocket} from "./ServerSocket";
import {AppPublisher} from "./AppPublisher";
import {WebSocketOpcode} from "./opcodes";
import {AbstractAdvisor} from "../AbstractAdvisor";


export class HomeUpdater extends AppPublisher {
    public readonly opcode = WebSocketOpcode.HOME;

    constructor(serverSocket: ServerSocket, advisor: AbstractAdvisor) {
        super(serverSocket, advisor)
    }

    public onSubscription(clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        // static page. nothing to send via websockets here yet
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected onData(data: any, clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {

    }
}