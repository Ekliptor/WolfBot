import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as http from "http";
import {ServerSocketPublisher, ServerSocket, ClientSocketOnServer} from "./ServerSocket";
import {AppPublisher} from "./AppPublisher";
import {WebSocketOpcode} from "./opcodes";
import {AbstractAdvisor} from "../AbstractAdvisor";


export class TradesUpdater extends AppPublisher {
    public readonly opcode = WebSocketOpcode.TRADES;

    constructor(serverSocket: ServerSocket, advisor: AbstractAdvisor) {
        super(serverSocket, advisor)
        this.waitForConfigLoaded().then(() => {
            return utils.promiseDelay(3000)
        }).then(() => {
            this.publishLiveTrades();
        })
    }

    public onSubscription(clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
        // nothing to do here. History can be fetched via REST from TradeBook
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected onData(data: any, clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
        // nothing yet
    }

    protected publishLiveTrades() {
        // there is 1 trader instance per config-currency pair. Sub-instances (such as TradeNotifier)
        // are not returned here
        let traders = this.advisor.getTraders(); // TODO only for real time traders?
        // [ 'buy', 'sell', 'close', 'syncPortfolio' ]
        // lending [ 'place', 'takenAll' ]
        traders.forEach((trader) => {
            let eventNames = trader.eventNames();
            eventNames.forEach((event) => {
                trader.on(event, (...args) => {
                    let payload = args.unshift(event);
                    this.publish(payload);
                });
            });
        })
    }
}