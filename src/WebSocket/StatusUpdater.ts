import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as http from "http";
import * as path from "path";
import {ServerSocketPublisher, ServerSocket, ClientSocketOnServer, ServerSocketSendOptions} from "./ServerSocket";
import {AppPublisher} from "./AppPublisher";
import {WebSocketOpcode} from "./opcodes";
import TradeAdvisor from "../TradeAdvisor";
import {PortfolioTrader, BotEvaluation} from "../Trade/PortfolioTrader"
import {AbstractAdvisor} from "../AbstractAdvisor";
import * as helper from "../utils/helper";
import {LoginController} from "../LoginController";
import * as fs from "fs";

export interface StatusUpdate {
    error?: boolean;
    errorTxt?: string;
    errorCode?: string; // to be localized by client

    name?: string;
    config?: string;
    trader?: string;
    premium?: boolean;
    serverTime?: string;
    started?: Date;
    installed?: Date;
    botApiKey?: string;
    botToken?: string;
    nodeVersion?: string;
    username?: string;
    subscriptionValid?: boolean;
    demoVersion?: boolean;
    botID?: string;
    //currencies?: string[];
    currencies?: string;
    evaluation?: BotEvaluation;
    // we can't fetch global exchange balances because we might have multiple bots running (+ manual trading)
    // every trader instance has to count this by watching trades (minus fees) internally
    // then all instances can report back here

    restoredState?: boolean;
    log?: string;
}

export interface StatusUpdateReq {
    getLog?: boolean;
    restoreState?: string;
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
            let login = LoginController.getInstance();
            const subscription = login.getSubscription();
            let update: StatusUpdate = {
                name: this.getBotDirName(),
                config: this.advisor.getConfigName(),
                //trader: this.advisor.getTraderName(true),
                trader: this.getSelectedTraderForDisplay(),
                premium: nconf.get("serverConfig:premium"),
                serverTime: utils.getUnixTimeStr(true, new Date()),
                started: this.advisor.getStarted(),
                installed: installDate,
                botApiKey: helper.getFirstApiKey(),
                botToken: subscription ? subscription.token : "",
                nodeVersion: process.version,
                username: nconf.get("serverConfig:premium") === true ? nconf.get("serverConfig:username") : "",
                subscriptionValid: nconf.get("serverConfig:premium") === true && nconf.get("serverConfig:loggedIn") === true,
                demoVersion: subscription && subscription.demo === true ? true : false,
                botID: this.getBotDisplayID(),
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

    protected onData(data: StatusUpdateReq, clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
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
        else if (data.getLog === true)
            this.sendPreviousLog(clientSocket);
        else
            logger.warn("Received unknown message in %s", this.className, data)
    }

    protected getBotDisplayID() {
        if (nconf.get("serverConfig:premium") !== true)
            return "";
        return LoginController.getDisplayBotID();
    }

    protected getBotDirName() {
        return path.basename(utils.appDir);
    }

    protected send(ws: ClientSocketOnServer, data: StatusUpdate, options?: ServerSocketSendOptions) {
        return super.send(ws, data, options);
    }

    protected async sendPreviousLog(clientSocket: ClientSocketOnServer): Promise<void> {
        const logfilePath = nconf.get('logfile') + ".bak"; // in working dir. written in appUtils
        try {
            //let data = await fs.promises.readFile(logfilePath, {encoding: "utf8"});
            let data = await utils.tailPromise(logfilePath, 500);
            this.send(clientSocket, {log: data.join("")});
        }
        catch (err) {
            logger.error("Error getting previous logfile %s", logfilePath, err);
            if (err.code === "ENOENT" || err.err.code === "ENOENT") {
                this.send(clientSocket, {
                    error: true,
                    errorCode: "noPrevLogfile"
                });
            }
            else
                this.send(clientSocket, {error: true});
        }
    }
}
