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
import {PortfolioTrader, BotEvaluation} from "../Trade/PortfolioTrader"
import {AbstractAdvisor} from "../AbstractAdvisor";
import * as helper from "../utils/helper";

export interface StatusUpdate {
    name: string;
    config: string;
    trader: string;
    premium: boolean;
    serverTime: string;
    started: Date;
    installed: Date;
    botApiKey: string;
    nodeVersion: string;
    username: string;
    //currencies: string[];
    currencies: string;
    evaluation: BotEvaluation;
    // we can't fetch global exchange balances because we might have multiple bots running (+ manual trading)
    // every trader instance has to count this by watching trades (minus fees) internally
    // then all instances can report back here
}

export class StatusUpdater extends AppPublisher {
    public readonly opcode = WebSocketOpcode.STATUS;

    constructor(serverSocket: ServerSocket, advisor: AbstractAdvisor) {
        super(serverSocket, advisor)
        /*
        setInterval(() => {
            let x = {
                msg: "Foo send server",
                rand: utils.getRandomInt(0, 100)
            }
            this.publish(x)
        }, 2000)
        */
    }

    public onSubscription(clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
        let portfolioTrader: PortfolioTrader = null;
        let traders = this.advisor.getTraders();
        for (let i = 0; i < traders.length; i++)
        {
            //if (PortfolioTrader.isPortfolioTrader(traders[i])) {
            if (traders[i] instanceof PortfolioTrader) {
                portfolioTrader = <PortfolioTrader>traders[i];
                break; // there should only be one
            }
        }

        utils.file.getInstallDate().then((installDate) => {
            //const firstCurrency = this.tradeAdvisor.getConfigs()[0].markets[0]; // needed for market exposure time
            let update: StatusUpdate = {
                name: this.getBotDirName(),
                config: this.advisor.getConfigName(),
                trader: this.advisor.getTraderName(true),
                premium: nconf.get("serverConfig:premium"),
                serverTime: utils.getUnixTimeStr(true, new Date()),
                started: this.advisor.getStarted(),
                installed: installDate,
                botApiKey: helper.getFirstApiKey(),
                nodeVersion: process.version,
                username: nconf.get("serverConfig:premium") === true ? nconf.get("serverConfig:username") : "",
                currencies: this.advisor.getCandleCurrencies().toString().replaceAll(",", ", "),
                // TODO better evaluation display for premium bot
                evaluation: !nconf.get("serverConfig:premium") && portfolioTrader && portfolioTrader.warmUpDone(false) ? portfolioTrader.evaluateTrades() : null
            }
            this.send(clientSocket, update)
        }).catch((err) => {
            logger.error("Error getting install date", err)
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected onData(data: any, clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
        if (data.restoreState) {
            let unpackState = utils.text.isPossibleJson(data.restoreState) ? Promise.resolve(data.restoreState) : utils.text.unpackGzip(data.restoreState)
            unpackState.then((unpackedStr) => {
                data.restoreState = utils.parseEJson(unpackedStr);
                if (!data.restoreState) {
                    this.send(clientSocket, {error: true, errorCode: "syntaxErrorJson"});
                    return;
                }
                let restored = this.advisor.unserializeStrategyData(data.restoreState, "/WebUI");
                this.send(clientSocket, {restoredState: restored});
            }).catch((err) => {
                logger.error("Error unpacking state string", err)
            })
        }
        else
            logger.warn("Received unknown message in %s", this.className, data)
    }

    protected getBotDirName() {
        return path.basename(utils.appDir);
    }
}