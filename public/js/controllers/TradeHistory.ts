import {ClientSocketReceiver, ClientSocket} from "../classes/WebSocket/ClientSocket";
import {WebSocketOpcode} from "../../../src/WebSocket/opcodes";
import {PageData} from "../types/PageData";
import {AppData} from "../types/AppData";
import {AppFunc, HelpersClass} from "@ekliptor/browserutils";
import {SocialConfig} from "../../../src/Social/SocialConfig";
import {SocialUpdate} from "../../../src/Social/SocialController";
import {BotTradeReq, BotTradeRes} from "../../../src/WebSocket/TradeHistoryUpdater";
import {UIBotLendingTrade, UIBotTrade} from "../../../src/structs/UITrade";
import {TableController} from "./base/TableController";
import * as $ from "jquery";
import * as i18next from "i18next";
import {App} from "../index";
import {TradeMetaInfo} from "../../../src/Trade/TradeBook";

declare var pageData: PageData, appData: AppData;
declare var AppF: AppFunc, Hlp: HelpersClass;

export class TradeHistory extends TableController {
    public readonly opcode = WebSocketOpcode.TRADE_HISTORY;

    protected configName: string = "";
    protected tradingModes: string[] = [];

    constructor(socket: ClientSocket) {
        super(socket)
    }

    public onData(data: BotTradeRes) {
        if (data.init) {
            this.$().empty();
            this.configName = data.init.configName;
            this.tradingModes = data.init.tradingModes;
            this.addControls(data.init.lending);
            return;
        }
        if (data.trades) {
            this.$("#historyTableRow").empty();
            this.creteTradesTable(data.trades, data.tradesMeta, false);
            return;
        }
        else if (data.lendingTrades) {
            this.$("#historyTableRow").empty();
            this.creteTradesTable(data.lendingTrades, data.tradesMeta, true);
            return;
        }
    }

    public render() {
        return new Promise<string>((resolve, reject) => {
            let status = AppF.translate(pageData.html.tradeHistory.main)
            resolve(status);
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected creteTradesTable(trades: (UIBotTrade | UIBotLendingTrade)[], meta: TradeMetaInfo, lending: boolean) {
        this.addTradeStats(meta, lending)
        let tableHtml = AppF.translate(pageData.html.tradeHistory[lending ? "lendingTable" : "tradeTable"]);
        this.$("#historyTableRow").append(tableHtml);
        let tableOptions = this.getTableOpts(); // TODO doesn't really help much since it was written to create options from already created html?
        /*
        tableOptions["aoColumns"] = [];
        for (let i = 0; i < 12; i++)
        {
            if (tableOptions["aoColumns"][i] === undefined)
                tableOptions["aoColumns"][i] = [];
            if (i === 7)
                tableOptions["aoColumns"][i].push({"sType": "dynamic-number", "sClass": "dateTime"});
           else
                tableOptions["aoColumns"][i].push(null);
        }
        */
        const timestampCols: number[] = lending === true ? [8] : [7];
        tableOptions["columnDefs"] = [
            {className: "dateTime", "targets": timestampCols}
            //{className: "number", "targets": [3, 4]} // header
        ];
        let numberCols: number[];
        if (lending === true)
            numberCols = [2, 3, 4, 5, 6, 7];
        else
            numberCols = [3, 4, 5, 6];
        tableOptions["columnDefs"].push({className: "num decimalNumber", "targets": numberCols});
        tableOptions = this.prepareTable(tableOptions, /*".jsTable"*/"#currencyTable", false);
        let table = this.$("#historyTable").DataTable(tableOptions);
        for (let i = 0; i < trades.length; i++)
        {
            if (lending === true) {
                const trade = trades[i] as UIBotLendingTrade;
                const totalBase = trade.rate * trade.amount;
                const timeHtml = AppF.translate(pageData.html.misc.sortSpan, {
                    time: trade.time,
                    timestamp: Math.floor( trade.time.getTime() / 1000)
                });
                table.row.add([
                    trade.currencyStr,
                    trade.typeStr,
                    trade.rate.toFixed(8),
                    trade.amount.toFixed(8),
                    i18next.t("tradingFee", {
                        fee: (trade.amount*trade.rate*trade.lendingFees).toFixed(8),
                        percent: (trade.lendingFees*100).toFixed(2)}),
                    totalBase.toFixed(8),
                    trade.interestAmount.toFixed(8),
                    trade.days,
                    timeHtml,
                    trade.exchangeStr,
                    trade.configName,
                    this.formatStrategies(trade.strategies),
                    trade.reason
                ]);
            }
            else {
                const trade = trades[i] as UIBotTrade;
                const totalBase = trade.rate * trade.amount;
                const typeHtml = AppF.translate(pageData.html.misc.classSpan, {
                    className: trade.typeStr === "BUY" || trade.typeStr === "CLOSE_SHORT" ? "green" : "red",
                    text: trade.typeStr
                });
                const timeHtml = AppF.translate(pageData.html.misc.sortSpan, {
                    time: trade.time,
                    timestamp: Math.floor( trade.time.getTime() / 1000)
                });
                table.row.add([
                    trade.currencyPairStr,
                    typeHtml,
                    trade.marketStr,
                    trade.rate.toFixed(8),
                    trade.amount.toFixed(8),
                    i18next.t("tradingFee", {
                        fee: (trade.amount*trade.rate*trade.fees).toFixed(8),
                        percent: (trade.fees*100).toFixed(2)}),
                    totalBase.toFixed(8),
                    timeHtml,
                    trade.exchangeStr,
                    //trade.arbitrage ? "yes" : "no", // better show icon. removed from table and shown in selection above
                    trade.configName,
                    this.formatStrategies(trade.strategies),
                    trade.reason
                ]);
            }
        }
        table.draw(false);
        this.replaceClasses("#historyTable", numberCols, "num decimalNumber", "number");
        this.moveTimestampsToParent("#historyTable", timestampCols);
        Hlp.updateTimestampsRepeating(); // or use updateAbsoluteDates()?
    }

    protected addControls(/*trades: (UIBotTrade | UIBotLendingTrade)[], */lending: boolean) {
        // TODO add datepicker library and allow selecting data range
        // TODO store recent configs and currency pairs on server and show them in a dropdown
        let html = AppF.translate(pageData.html.tradeHistory.tableCtrls, {
            currencySel: i18next.t(lending === true ? "currency" : "currencyPair"),
            currencyPlace: i18next.t(lending === true ? "currencyPlaceLend" : "currencyPlace"),
            configNamePlace: i18next.t("configNamePlace", {name: this.configName})
        });
        this.$().append(html);

        let first = true;
        this.tradingModes.forEach((mode) => {
            this.$("#tradingMode").append(this.getSelectOption(mode, AppF.tr(mode), first === true));
            first = false;
        })
        App.initMultiSelect((optionEl, checked) => {
            //if (optionEl.attr("id") === "traders")
                //this.send({traderChange: optionEl.val()})
            if (optionEl.attr("id") === "tradingMode")
                this.updateControls(optionEl.val());
        });

        this.addControlHandlers();
    }

    protected updateControls(selectedTradingMode: string) {
        const lending = selectedTradingMode === "lending";
        this.$("#currencyLbl").text(i18next.t(lending === true ? "currency" : "currencyPair") + i18next.t("colon"));
        this.$("#currency").attr("placeholder", i18next.t(lending === true ? "currencyPlaceLend" : "currencyPlace"));
    }

    protected addControlHandlers() {
        this.$(".historyInfo").unbind("click").click((event) => {
            const el = $(event.target);
            this.$("#" + el.attr("data-idtoggle")).fadeToggle("slow");
        });
        this.$("#historyForm").unbind("submit").submit((event) => {
            event.preventDefault();
            let values = $(event.target).serializeArray();
            let mode = this.getFormValue(values, "tradingMode");
            let currency = this.getFormValue(values, "currency");
            if (!currency || currency.length < 3 || (mode !== "lending" && (currency.length < 7 || currency.indexOf("_") === -1)))
                return Hlp.showMsg(AppF.tr('invalidCurrency'), 'danger');
            this.send({
                getTrades: {
                    mode: mode,
                    currencyStr: currency,
                    configName: this.getFormValue(values, "configName"),
                    endDate: 0 // get all
                }
            })
        });
    }

    protected addTradeStats(meta: TradeMetaInfo, lending: boolean) {
        if (lending === true) {
            this.$("#avgBuyPrice, #totalBuys, #totalSells, #breakEvenPrice").text("-");
            this.$("#avgSellPrice").text(meta.avgSellPrice.toFixed(8));
            this.$("#profitLoss").text(meta.profitLoss.toFixed(8));
            // TODO totalSells after we extended our exchange API with "loan taken" calls
            return;
        }
        this.$("#avgBuyPrice").text(meta.avgBuyPrice.toFixed(8));
        this.$("#avgSellPrice").text(meta.avgSellPrice.toFixed(8));
        this.$("#totalBuys").text(meta.totalBuys.toFixed(8));
        this.$("#totalSells").text(meta.totalSells.toFixed(8));
        if (meta.breakEvenPrice !== 0.0)
            this.$("#breakEvenPrice").text(meta.breakEvenPrice.toFixed(8));
        else
            this.$("#breakEvenPrice").text("-");
        this.$("#profitLoss").text(meta.profitLoss.toFixed(8));
    }

    protected formatStrategies(strategies: string[]) {
        return strategies.toString().replace(/,/g, ", ");
    }

    protected send(data: BotTradeReq) {
        super.send(data)
    }
}