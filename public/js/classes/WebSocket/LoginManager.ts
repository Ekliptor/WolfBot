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
        else if (data.loginRes)
            $(AppClass.cfg.appSel).remove("#modal-login-dialog"); // errors are caught above
    }

    public render() {
        return new Promise<string>((resolve, reject) => {
            resolve(""); // never called in here
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected showLoginDialog(loginData: LoginData) {
        let vars = {
            username: loginData.username,
            password: loginData.password,
            siteUrl: appData.siteUrl,
            siteName: i18next.t("siteName")
        }
        let loginDialog = AppF.translate(pageData.html.login.loginDialog, vars);
        $(AppClass.cfg.appSel).append(loginDialog);
        this.$("#loginForm").submit((event) => {
            event.preventDefault();
            this.send({
                login: {
                    username: this.$("#username").val(),
                    password: this.$("#password").val()
                }
            })
        });
    }

    protected showLoginError(data: LoginUpdateRes) {
        this.$("#loginError").text(i18next.t(data.errorCode ? data.errorCode : "unknownError"));
    }

    protected send(data: LoginUpdateReq) {
        return super.send(data);
    }
}