import {ClientSocketReceiver, ClientSocket} from "../classes/WebSocket/ClientSocket";
import {AbstractController} from "./base/AbstractController";
import {WebSocketOpcode} from "../../../src/WebSocket/opcodes";
import {StatusUpdate} from "../../../src/WebSocket/StatusUpdater";
import {PageData} from "../types/PageData";
import {AppData} from "../types/AppData";
import {AppFunc, HelpersClass, EJSON} from "@ekliptor/browserutils";
//import * as butils from "@ekliptor/browserutils"; butils.EJSON also works

declare var pageData: PageData, appData: AppData;
declare var AppF: AppFunc, Hlp: HelpersClass;

export class Home extends AbstractController {
    public readonly opcode = WebSocketOpcode.HOME;

    constructor(socket: ClientSocket) {
        super(socket)
    }

    public onData(data: any) {
        if (data.error)
            return Hlp.showMsg(data.errorTxt ? data.errorTxt : AppF.tr(data.errorCode ? data.errorCode : 'unknownError'), 'danger');
    }

    public render() {
        return new Promise<string>((resolve, reject) => {
            let status = AppF.translate(pageData.html.home.main);
            setTimeout(() => {
                this.addClickListeners();
            }, 0)
            resolve(status);
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected addClickListeners() {
        this.$("#startWizard .panel-heading").click((event) => {
            const panelBody = $(event.target).parent().find(".panel-body");
            panelBody.fadeToggle("slow");
        });
    }
}