import {ClientSocketReceiver, ClientSocket} from "./ClientSocket";
import {WebSocketOpcode} from "../../../../src/WebSocket/opcodes";
import {AbstractWidget, TranslationFunction} from "../AbstractWidget";
import {AppFunc, HelpersClass} from "@ekliptor/browserutils";
import {LogType} from "../../../../src/WebSocket/LogPublisher";
import {AppClass} from "../../index";

declare var AppF: AppFunc, Hlp: HelpersClass;

export class LogReceiver extends ClientSocketReceiver {
    public readonly opcode = WebSocketOpcode.LOG;

    protected firstOpen = new Map<LogType, boolean>(); // (type, first open)

    constructor(socket: ClientSocket) {
        super(socket)
        this.firstOpen.set("a", true);
        this.firstOpen.set("t", true);
    }

    public onData(data: any) {
        if (data.a)
            this.printLog("a", data.a);
        else if (data.t)
            this.printLog("t", data.t);
        else if (data.state) {
            if (data.state.trader.paused) {
                $("#pauseTradingTxt").text(AppF.tr("resumeTrading"));
                $("#pauseTrading").addClass("paused");
            }
            if (data.state.trader.pausedOpeningPositions) {
                $("#pauseOpeningPositionsTxt").text(AppF.tr("resumeOpeningPositions"));
                $("#pauseOpeningPositions").addClass("paused");
            }
            if (data.state.mode === "ai") {
                $(".tabTrading, .tabLending, .tabSocial, .tabCoinMarket, .tabBacktesting, .tabHistory").addClass("hidden");
                $("#pauseOpeningPositions").addClass("hidden");
            }
            else if (data.state.mode === "trading" || data.state.mode === "arbitrage") {
                $(".tabAI, .tabLending, .tabSocial, .tabCoinMarket").addClass("hidden");
            }
            else if (data.state.mode === "lending") {
                $(".tabAI").addClass("hidden"); // trading tab shows our lending strategies
                $("#pauseOpeningPositions, .tabSocial, .tabCoinMarket, .tabBacktesting, .tabHistory").addClass("hidden");
            }
            else if (data.state.mode === "social") {
                $(".tabTrading, .tabLending, .tabAI, .tabBacktesting, .tabHistory").addClass("hidden");
                $("#pauseTrading, #pauseOpeningPositions").addClass("hidden");
            }

            if (data.state.devMode === false)
                $(".tabScripts").addClass("hidden");

            if (data.state.error === true)
                Hlp.showMsg(AppF.tr('errorState'), 'danger');
        }
        //this.send({x: "client res"})
    }

    public addListeners() {
        /*
        $("#logs").animate({
            height: "100px",
            duration: 600
        });
        */
        $("#toggleLogs").click(() => {
            $("#logs").toggle("slow", () => {
                if ($("#toggleLogs").hasClass("showLogs")) {
                    $("#toggleLogs").attr("title", AppF.tr("hideLogs"));
                    $("#toggleLogs i").removeClass("fa-arrow-up").addClass("fa-arrow-down");
                }
                else {
                    $("#toggleLogs").attr("title", AppF.tr("showLogs"));
                    $("#toggleLogs i").removeClass("fa-arrow-down").addClass("fa-arrow-up");
                }
                $("#toggleLogs").toggleClass("showLogs");
                setTimeout(() => {
                    this.firstOpen.set("a", false); // app log is always the first on opening
                    $("#logs pre").each(function (i, element) { // scroll all logs down
                        let el = $(element);
                        el.scrollTop((el).prop("scrollHeight"));
                    });
                }, 500); // be safe and make sure we scroll
            });
        });
        $(".logTabs a").click((event) => {
            let target = $(event.target);
            $(".logTabs li").removeClass("active");
            target.parent().addClass("active");
            $(".logtext").css("display", "none");
            $("#" + target.attr("data-log")).css("display", "inherit");
            let type = target.attr("data-type");
            if (type === "a" || type === "t")
                this.firstOpen.set(type, false);
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected printLog(type: LogType, lines: string[]) {
        // TODO remove old lines from browser
        const logID = type === "a" ? "#appLog" : "#tradeLog";
        let autoScroll = this.firstOpen.get(type); // scroll down on first load
        if ($(logID).text().length !== 0) {
            if (!autoScroll)
                autoScroll = $(logID).prop("scrollTop") + $(logID).height()*2 >= $(logID).prop("scrollHeight")
            $(logID).append("\r\n");
        }
        else
            autoScroll = true;
        $(logID).append(AppF.escapeOutput(lines.join("\r\n"), false));
        if (autoScroll)
            $(logID).scrollTop($(logID).prop("scrollHeight"))
    }
}