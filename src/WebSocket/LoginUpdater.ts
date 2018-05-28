import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as WebSocket from "ws";
import * as http from "http";
import {ServerSocketPublisher, ServerSocket, ServerSocketSendOptions} from "./ServerSocket";
import {AppPublisher} from "./AppPublisher";
import {WebSocketOpcode} from "./opcodes";
import TradeAdvisor from "../TradeAdvisor";
import {AbstractAdvisor} from "../AbstractAdvisor";
import {LoginController} from "../LoginController";


export interface LoginData {
    username: string;
    password: string;
}
export interface LoginUpdateReq {
    login?: LoginData;
}
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
}

export class LoginUpdater extends AppPublisher {
    public readonly opcode = WebSocketOpcode.LOGIN;

    constructor(serverSocket: ServerSocket, advisor: AbstractAdvisor) {
        super(serverSocket, advisor)
        //this.checkRequestLoginData(); // currently done in ServerSocket when receiving messages
    }

    public onSubscription(clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        //if (nconf.get("serverConfig:loggedIn") === false) // done via http
            //this.requestLoginData();
    }

    protected onData(data: LoginUpdateReq, clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        //if (data.login) // never called
            //this.verifyLogin(data.login, clientSocket)
    }

    public async verifyLogin(loginData: LoginData, clientSocket: WebSocket): Promise<LoginUpdateRes> {
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
            this.send(clientSocket, res)
            return res;
        }
        catch (err) {
            logger.error("Error checking new login data", err)
            return null;
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

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

    protected send(ws: WebSocket, data: LoginUpdateRes, options?: ServerSocketSendOptions) {
        if (ws === null)
            return Promise.resolve(false);
        return super.send(ws, data, options);
    }
}