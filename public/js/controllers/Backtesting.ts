import {ClientSocketReceiver, ClientSocket} from "../classes/WebSocket/ClientSocket";
import {AbstractController} from "./base/AbstractController";
import {WebSocketOpcode} from "../../../src/WebSocket/opcodes";
import {PageData} from "../types/PageData";
import {AppData} from "../types/AppData";
import {AppFunc, HelpersClass, EJSON} from "@ekliptor/browserutils";
import {JsonEditor} from "./base/JsonEditor";
import {BacktestInitData, BacktestReq, BacktestRes, BacktestResult} from "../../../src/WebSocket/BacktestingUpdater";
import * as $ from "jquery";
import * as i18next from "i18next";
import {App} from "../index";

declare var pageData: PageData, appData: AppData;
declare var AppF: AppFunc, Hlp: HelpersClass;

export class Backtesting extends JsonEditor {
    public readonly opcode = WebSocketOpcode.BACKTESTING;
    protected backtestRunning = false;

    constructor(socket: ClientSocket) {
        super(socket)
    }

    public onData(data: BacktestRes) {
        if (data.error === true) {
            if (this.backtestRunning === true)
                this.enableBacktesting();
            return Hlp.showMsg(data.errorTxt ? data.errorTxt : AppF.tr(data.errorCode ? data.errorCode : 'unknownError'), 'danger');
        }
        else if (data.success === true)
            return Hlp.showMsg(data.errorTxt ? data.errorTxt : AppF.tr(data.errorCode ? data.errorCode : 'unknownError'), 'success');

        if (data.init)
            return this.initControls(data.init);
        else if (data.result)
            return this.showResult(data.result);
        else if (data.progress)
            return this.updateProgress(data.progress.percent);
        else if (data.importProgress)
            return this.updateImportProgress(data.importProgress.percent);
    }

    public render() {
        return new Promise<string>((resolve, reject) => {
            let html = AppF.translate(pageData.html.backtesting.main)
            resolve(html);
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected initControls(init: BacktestInitData) {
        init.configFiles.forEach((conf) => {
            let title = conf.substr(1).replace(/\.json$/, "")
            this.$("#configs").append(this.getSelectOption(conf, title, "/" + init.selectedConfig + ".json" === conf))
        })
        App.initMultiSelect((optionEl, checked) => {
        });

        this.loadDatePickerLib(() => {
            const now = Date.now();
            let options: any = {
                defaultDate: new Date(now - init.fromDays * 24 * 60 * 60 * 1000)
            }
            this.resetHours(options.defaultDate);
            if (appData.lang !== "en")
                options.locale = appData.lang;
            let from = this.$('#from');
            let to = this.$('#to');
            from.find(':input').attr("data-value", options.defaultDate.getTime());
            from.datetimepicker(options).data("DateTimePicker").date(options.defaultDate);
            options.defaultDate = new Date(now - init.toDays * 24 * 60 * 60 * 1000);
            this.resetHours(options.defaultDate);
            to.find(':input').attr("data-value", options.defaultDate.getTime());
            to.datetimepicker(options).data("DateTimePicker").date(options.defaultDate);
            this.setDateTimeValue(from);
            this.setDateTimeValue(to);
            this.addClickHandlers()
        })
    }

    protected showResult(result: BacktestResult) {
        this.enableBacktesting();
        let resultHtml = AppF.translate(pageData.html.backtesting.result, {
            startBalanceCoins: i18next.t("startBalanceCoins", {currency: result.quoteCurrency}),
            startCoinEquivalent: result.stats.startCoinEquivalent.toFixed(8),
            currentBalanceCoins: i18next.t("currentBalanceCoins", {currency: result.quoteCurrency}),
            currentCoinEquivalent: result.stats.currentCoinEquivalent.toFixed(8),
            startBalanceBase: i18next.t("startBalanceBase", {currency: result.baseCurrency}),
            startBaseEquivalent: result.stats.startBaseEquivalent.toFixed(8),
            currentBalanceBase: i18next.t("currentBalanceBase", {currency: result.baseCurrency}),
            currentBaseEquivalent: result.stats.currentBaseEquivalent.toFixed(8),
            totalBuy: result.stats.trades.totalBuy,
            winningBuy: result.stats.trades.winningBuy,
            losingBuy: result.stats.trades.losingBuy,
            totalSell: result.stats.trades.totalSell,
            winningSell: result.stats.trades.winningSell,
            losingSell: result.stats.trades.losingSell,
            hoursExp: result.stats.marketExposureTime.hours,
            daysExp: result.stats.marketExposureTime.days,
            percentExp: result.stats.marketExposureTime.percent,
            efficiencyPercent: result.stats.efficiencyPercent.toFixed(3),
            marketEfficiencyPercent: result.stats.marketEfficiencyPercent.toFixed(3),
            botEfficiencyPercent: result.stats.botEfficiencyPercent.toFixed(3),
            botVsMarketPercent: result.stats.botVsMarketPercent.toFixed(3)
        });
        this.$("#backtestResult").html(resultHtml);
        this.$("#showResult").attr("data-href",  + result.file);
        this.$("#showResult").click((event) => {
            window.open(this.getBacktestResultUrl(event,false), "", "");
        });
        this.$("#downloadResult").click((event) => {
            window.open(this.getBacktestResultUrl(event,true), "", "");
        });
    }

    protected getBacktestResultUrl(event: JQueryEventObject, download = false) {
        let key = AppF.getCookie("apiKey");
        let resultUrl = document.location.origin + "/dl/?bt=" + encodeURIComponent($(event.target).attr("data-href"));
        if (key)
            resultUrl += "&apiKey=" + key;
        if (download === true)
            resultUrl += "&dl=1";
        return resultUrl;
    }

    protected updateProgress(percent: number) {
        this.$("#startBacktesting").attr("disabled", "");
        let progressHtml = AppF.translate(pageData.html.backtesting.progressAnimated, {
            percent: percent
        });
        this.$("#backtestProgress").html(progressHtml);
    }

    protected updateImportProgress(percent: number) {
        if (percent === 100.0)
            this.$("#backtestImport").empty();
        else {
            /**
             * or to consider whitespaces as empty:
             * function isEmpty( el ){
                  return !$.trim(el.html())
              }
             */
            if (this.$("#backtestImport").is(':empty') === true) {
                let progressHtml = AppF.translate(pageData.html.backtesting.importProgress);
                this.$("#backtestImport").html(progressHtml);
            }
        }
    }

    protected enableBacktesting() {
        this.backtestRunning = false;
        this.$("#startBacktesting").removeAttr("disabled");
        this.$("#backtestProgress").empty();
    }

    protected addClickHandlers() {
        this.$("#backtestingForm").submit((event) => {
            event.preventDefault();
            //let values = $(event.target).serializeArray();
            let from = this.$("#from").data("DateTimePicker").date().toDate();
            let to = this.$("#to").data("DateTimePicker").date().toDate();
            if (from.getTime() > to.getTime())
                return Hlp.showMsg(i18next.t('backtestRangeErr'), 'danger');
            //values.push({name: "taskStart", value: from.getTime()});
            this.$("#startBacktesting").attr("disabled", "");
            this.$("#backtestResult").empty();
            this.updateProgress(0.0);
            this.backtestRunning = true;
            this.send({
                start: {
                    config: this.$("#configs").val(),
                    from: from.getTime(),
                    to: to.getTime(),
                    startBalance: this.$("#startBalance").val(),
                    slippage: this.$("#slippage").val(),
                    tradingFee: this.$("#tradingFee").val()
                }
            })
        });
    }

    protected resetHours(date: Date) {
        date.setUTCHours(0, 0, 0, 0);
    }

    protected send(data: BacktestReq) {
        super.send(data);
    }
}