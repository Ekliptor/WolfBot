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

export class Home extends AbstractController {
    public readonly opcode = WebSocketOpcode.HOME;
    protected static readonly STRATEGY_TOPLIST_URL = "https://wolfbot.org/wp-json/tradebot/v1/popular-strategies";

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
                this.loadTopStrategies();
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

    protected loadTopStrategies() {
        $.get(Home.STRATEGY_TOPLIST_URL, undefined, (data) => {
            let topStrategies = AppF.translate(pageData.html.home.topStrategies, {
                strat1: data.data[0].name,
                strat2: data.data[1].name,
                strat3: data.data[2].name
            });
            $("#strategyToplistBody").html(topStrategies);
        });
    }
}