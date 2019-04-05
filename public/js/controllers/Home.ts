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
            let listHtml = "";
            for (let i = 0; i < data.data.length; i++)
            {
                let curStrategyHtml = AppF.escapeOutput(data.data[i].name);
                if (data.data[i].docLink) {
                    curStrategyHtml = AppF.translate(pageData.html.misc.newWindowLink, {
                        id: "topStrat-" + i,
                        href: data.data[i].docLink,
                        title: data.data[i].name
                    });
                }
                listHtml += AppF.translate(pageData.html.home.stratEntry, {strat: curStrategyHtml}, true);
            }
            let topStrategies = AppF.translate(pageData.html.home.topStrategies, {
                strategies: listHtml
            }, true);
            $("#strategyToplistBody").html(topStrategies);
        });
    }
}