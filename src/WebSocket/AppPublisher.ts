import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as WebSocket from "ws";
import * as http from "http";
import {ServerSocketPublisher, ServerSocket, ClientSocketOnServer} from "./ServerSocket";
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

    protected waitForConfigLoaded() {
        return new Promise<void>((resolve, reject) => {
            let load = () => {
                const maxConfigNr = this.advisor.getConfigs().length;
                if (maxConfigNr === 0)
                    setTimeout(load.bind(this), 1000); // config files are read async from disk
                else
                    resolve();
            }
            setTimeout(load.bind(this), 1000);
        })
    }

    protected getSelectedTrader() {
        let trader = this.advisor.getTraderName();
        if (trader === "RealTimeLendingTrader" || nconf.get("lending")) // lending only supports real time for now // TODO
            return "realTime";
        else if (trader === "RealTimeTrader")
            return nconf.get("tradeMode") === 1 ? "realTimePaper": "realTime"
        else if (trader === "TradeNotifier")
            return "notifier"
        else if (trader === "Backtester")
            return trader;
        logger.error("Unknown trader %s selected", trader)
        return trader;
    }
    
    protected getSelectedTraderForDisplay() {
        let trader = this.getSelectedTrader();
        if (!trader)
            return "-";
        return trader[0].toLocaleUpperCase() + trader.substr(1);
    }

    protected sendErrorMessage(clientSocket: ClientSocketOnServer, errorCode: string) {
        this.send(clientSocket, {
            error: true,
            errorCode: errorCode
            //errorTxt: msg
        });
    }

    protected getAggregateOpts() {
        return {
            maxTimeMS: nconf.get("mongoTimeoutSec") * 1000,
            allowDiskUse: true,
            readPreference: ReadPreference.SECONDARY_PREFERRED
        }
    }
}