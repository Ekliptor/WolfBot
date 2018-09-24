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