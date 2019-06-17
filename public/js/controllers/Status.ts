import {ClientSocketReceiver, ClientSocket} from "../classes/WebSocket/ClientSocket";
import {AbstractController} from "./base/AbstractController";
import {WebSocketOpcode} from "../../../src/WebSocket/opcodes";
import {StatusUpdate} from "../../../src/WebSocket/StatusUpdater";
import {PageData} from "../types/PageData";
import {AppData} from "../types/AppData";
import {AppFunc, HelpersClass, EJSON} from "@ekliptor/browserutils";
import * as $ from "jquery";
//import * as butils from "@ekliptor/browserutils"; butils.EJSON also works

declare var pageData: PageData, appData: AppData;
declare var AppF: AppFunc, Hlp: HelpersClass;

export class Status extends AbstractController {
    public readonly opcode = WebSocketOpcode.STATUS;

    constructor(socket: ClientSocket) {
        super(socket)
    }

    public onData(data: any) {
        if (data.error)
            return Hlp.showMsg(data.errorTxt ? data.errorTxt : AppF.tr(data.errorCode ? data.errorCode : 'unknownError'), 'danger');

        //console.log("RECEIVER", data)
        //this.send({x: "client res"})
        if (data.config) { // initial data
            this.updateDataByClass(data);
            this.$(".started").attr("data-time", Math.floor(new Date(data.started).getTime() / 1000)); // copy of Date wouldn't be necessary with EJSON
            this.$(".installed").attr("data-time", Math.floor(new Date(data.installed).getTime() / 1000));
            if (data.premium === true)
                this.$("#botEvaluation, #stateForm").addClass("hidden");
            else {
                this.$("#botEvaluation").html(JSON.stringify(data.evaluation, null, 4));
                this.$("#usernameRow, #tokenRow, #statusRow, #botIDRow").addClass("hidden");
            }
            this.removeAsyncLoadingIcon();
            Hlp.updateTimestampsRepeating();

            this.$("#restoreState").click(() => {
                let jsonTxt = this.$("#strategyState").val().trim();
                if (jsonTxt)
                    this.send({restoreState: jsonTxt})
            });
        }
        else if (data.restoredState) {
            Hlp.showMsg(AppF.tr('restoredStrategyState'), 'success');
            this.$("#strategyState").val("");
        }
    }

    public render() {
        return new Promise<string>((resolve, reject) => {
            let status = AppF.translate(pageData.html.status.main)
            resolve(status);
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}