import {ClientSocketReceiver, ClientSocket} from "./ClientSocket";
import {WebSocketOpcode} from "../../../../src/WebSocket/opcodes";
import {AppFunc, HelpersClass} from "@ekliptor/browserutils";
import {LogType} from "../../../../src/WebSocket/LogPublisher";
import {LoginData, LoginUpdateReq, LoginUpdateRes} from "../../../../src/WebSocket/LoginUpdater";
import {AppClass} from "../../index";
import * as $ from "jquery";
import * as i18next from "i18next";
import {AppData} from "../../types/AppData";
import {PageData} from "../../types/PageData";
import {AbstractController} from "../../controllers/base/AbstractController";

declare var pageData: PageData, appData: AppData;
declare var AppF: AppFunc, Hlp: HelpersClass;

export class LoginManager extends AbstractController {
    public readonly opcode = WebSocketOpcode.LOGIN;

    constructor(socket: ClientSocket) {
        super(socket)
    }

    public onData(data: LoginUpdateRes) {
        if (data.error)
            return this.showLoginError(data);

        if (data.enterLogin)
            this.showLoginDialog(data.enterLogin);
        else if (data.loginRes) {
            $(AppClass.cfg.appSel).remove("#modal-login-dialog"); // errors are caught above
            AppF.setCookie("apiKey", data.loginRes.apiKey, pageData.cookieLifeDays);
            this.reloadPage();
        }
        else if (data.expirationMsg)
            this.showExpirationMsg(data);
    }

    public render() {
        return new Promise<string>((resolve, reject) => {
            resolve(""); // never called in here
        })
    }

    public showLoginDialog(loginData: LoginData = null) {
        let vars = {
            username: loginData ? loginData.username : "",
            password: loginData ? loginData.password : "",
            siteUrl: appData.siteUrl,
            siteName: i18next.t("siteName")
        }
        let loginDialog = AppF.translate(pageData.html.login.loginDialog, vars);
        $(AppClass.cfg.appSel).append(loginDialog);
        $("#loginForm").submit((event) => { // part of parent widget now
            event.preventDefault();
            this.send({
                login: {
                    username: $("#username").val(),
                    password: $("#password").val()
                }
            })
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected showLoginError(data: LoginUpdateRes) {
        $("#loginError").text(i18next.t(data.errorCode ? data.errorCode : "unknownError"));
    }

    protected showExpirationMsg(data: LoginUpdateRes) {
        const subs = data.expirationMsg.subscription;
        let msgVars = { // simply always add all variables
            date: subs.expiration.toLocaleDateString() + " " + subs.expiration.toLocaleTimeString(),
            percent: subs.discount,
            code: subs.coupon
        }
        Hlp.showMsg(i18next.t(data.expirationMsg.label, msgVars), data.expirationMsg.level);
        if (!subs.discount || !subs.coupon)
            return;
        Hlp.showMsg(i18next.t("beforeDiscount", msgVars), "success");
    }

    protected send(data: LoginUpdateReq) {
        //return super.send(data); // we use HTTP for now to keep the WS area secured
        return this.sendHTTP("login", data);
    }
}