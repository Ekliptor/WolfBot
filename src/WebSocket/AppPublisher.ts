import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as WebSocket from "ws";
import * as http from "http";
import {ServerSocketPublisher, ServerSocket} from "./ServerSocket";
import {WebSocketOpcode} from "./opcodes";
import {TradeConfig} from "../Trade/TradeConfig";
import {AbstractAdvisor} from "../AbstractAdvisor";
import {ReadPreference} from "mongodb";

export abstract class AppPublisher extends ServerSocketPublisher {
    protected advisor: AbstractAdvisor;

    constructor(serverSocket: ServerSocket, advisor: AbstractAdvisor) {
        super(serverSocket)
        this.advisor = advisor;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected getAggregateOpts() {
        return {
            maxTimeMS: nconf.get("mongoTimeoutSec") * 1000,
            allowDiskUse: true,
            readPreference: ReadPreference.SECONDARY_PREFERRED
        }
    }
}