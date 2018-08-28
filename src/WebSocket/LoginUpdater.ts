import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as WebSocket from "ws";
import * as http from "http";
import {ServerSocketPublisher, ServerSocket, ServerSocketSendOptions, ClientSocketOnServer} from "./ServerSocket";
import {AppPublisher} from "./AppPublisher";
import {WebSocketOpcode} from "./opcodes";
import TradeAdvisor from "../TradeAdvisor";
import {AbstractAdvisor} from "../AbstractAdvisor";
import {BotSubscription, LoginController} from "../LoginController";


export interface LoginData {
    username: string;
    password: string;
}
export interface LoginUpdateReq {
    login?: LoginData;
}
export type ExpirationMsgLevel = "warning" | "danger";
export interface LoginUpdateRes {
    error?: boolean;
    //errorTxt?: string;
    errorCode?: string;
    enterLogin?: LoginData
    loginRes?: {
        loginValid: boolean;
        subscriptionValid: boolean;
        apiKey: string;
    }
    expirationMsg?: {
        label: string;
        level: ExpirationMsgLevel;
        subscription: BotSubscription;
    }
}

export class LoginUpdater extends AppPublisher {
    public readonly opcode = WebSocketOpcode.LOGIN;
    protected expirationNotificationTimer: NodeJS.Timer = null; // only store 1 timer and overwrite it. if we have new connections they will have a new ID (even from the same client)

    constructor(serverSocket: ServerSocket, advisor: AbstractAdvisor) {
        super(serverSocket, advisor)
        //this.checkRequestLoginData(); // currently done in ServerSocket when receiving messages
    }

    public onSubscription(clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
        //if (nconf.get("serverConfig:loggedIn") === false) // done via http
            //this.requestLoginData();
        this.notifySubscriptionExpiration(clientSocket);
    }

    protected onData(data: LoginUpdateReq, clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
        //if (data.login) // never called
            //this.verifyLogin(data.login, clientSocket)
    }

    public async verifyLogin(loginData: LoginData, clientSocket: ClientSocketOnServer): Promise<LoginUpdateRes> {
        let login = LoginController.getInstance();
        nconf.set("serverConfig:username", loginData.username);
        nconf.set("serverConfig:password", loginData.password);
        try {
            await login.checkLogin();
            let res: LoginUpdateRes = {
                loginRes: {
                    loginValid: login.isLoginValid(),
                    subscriptionValid: login.isSubscriptionValid(),
                    apiKey: Object.keys(nconf.get("apiKeys"))[0]
                }
            }
            if (!res) {
                res.error = true;
                res.errorCode = "unknownError";
            }
            else if (res.loginRes.loginValid === false || res.loginRes.subscriptionValid === false) {
                res.error = true;
                res.errorCode = res.loginRes.loginValid === false ? "userNotFound" : "subscriptionNotFound";
            }
            this.send(clientSocket, res) // usually called via http from main controller instead
            return res;
        }
        catch (err) {
            logger.error("Error checking new login data", err)
            return null;
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected notifySubscriptionExpiration(clientSocket: ClientSocketOnServer) {
        if (this.expirationNotificationTimer !== null) {
            clearTimeout(this.expirationNotificationTimer);
            this.expirationNotificationTimer = null;
        }
        const loginController = LoginController.getInstance();
        const subscription = loginController.getSubscription();
        if (subscription === null)
            return;
        if (subscription.expiration.getTime() < Date.now())
            return this.sendExpirationMsg(clientSocket, subscription, "expiredMsg", "danger");
        const expirationSoonMs = nconf.get("serverConfig:notifyBeforeSubscriptionExpirationDays")*utils.constants.DAY_IN_SECONDS*1000;
        const untilExpirationMs = subscription.expiration.getTime() - Date.now();
        if (untilExpirationMs < expirationSoonMs)
            return this.sendExpirationMsg(clientSocket, subscription, "expiringSoonMsg", "warning");
        const timeoutMs = /*nconf.get("serverConfig:notifyBeforeSubscriptionExpirationDays")*utils.constants.DAY_IN_SECONDS*1000*/10000;
        this.expirationNotificationTimer = setTimeout(() => {
            this.sendExpirationMsg(clientSocket, subscription, "expiringSoonMsg", "warning");
        }, untilExpirationMs - expirationSoonMs);
    }

    protected sendExpirationMsg(clientSocket: ClientSocketOnServer, subscription: BotSubscription, message: string, level: ExpirationMsgLevel) {
        this.send(clientSocket, {
            expirationMsg: {
                label: message,
                level: level,
                subscription: subscription
            }
        })
    }

    protected checkRequestLoginData() {
        setInterval(() => {
            if (nconf.get("serverConfig:loggedIn"))
                return;
            this.requestLoginData();
        }, nconf.get("serverConfig:checkLoginIntervalMin")*utils.constants.MINUTE_IN_SECONDS*1000)
    }

    protected requestLoginData() {
        this.publish({
            enterLogin: {
                username: nconf.get("serverConfig:username"),
                password: nconf.get("serverConfig:password")
            }
        })
    }

    protected send(ws: ClientSocketOnServer, data: LoginUpdateRes, options?: ServerSocketSendOptions) {
        if (ws === null)
            return Promise.resolve(false);
        return super.send(ws, data, options);
    }
}