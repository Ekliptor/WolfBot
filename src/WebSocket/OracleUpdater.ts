import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as WebSocket from "ws";
import * as http from "http";
import {ServerSocketPublisher, ServerSocket} from "./ServerSocket";
import {AppPublisher} from "./AppPublisher";
import {WebSocketOpcode} from "./opcodes";
import TradeAdvisor from "../TradeAdvisor";
import {TradeConfig} from "../Trade/TradeConfig";
import {Brain} from "../AI/Brain";


export class OracleUpdater extends /*AppPublisher*/ServerSocketPublisher {
    public readonly opcode = WebSocketOpcode.ORACLE;

    protected brain: Brain;

    constructor(serverSocket: ServerSocket, brain: Brain) {
        super(serverSocket)
        this.brain = brain;
        this.publishPredictions();
    }

    public onSubscription(clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        this.send(clientSocket, this.getOracleData());
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected publishPredictions() {
        let oracle = this.brain.getLiveOracle();
        if (!oracle)
            return; // most liekly training
        oracle.on("predictions", (data) => {
            this.publish(this.getOracleData())
        })
    }

    protected getOracleData() {
        let oracle = this.brain.getLiveOracle();
        if (!oracle)
            return null;
        return {
            predictions: {
                predictions: oracle.getPredictions(),
                realData: oracle.getRealData(),
                current: oracle.getCurrent()
            }
        }
    }
}