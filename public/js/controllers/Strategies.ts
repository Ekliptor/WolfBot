import {ClientSocketReceiver, ClientSocket} from "../classes/WebSocket/ClientSocket";
import {AbstractController} from "./base/AbstractController";
import {WebSocketOpcode} from "../../../src/WebSocket/opcodes";
import {PageData} from "../types/PageData";
import {AppData} from "../types/AppData";
import {AppFunc, HelpersClass, store} from "@ekliptor/browserutils";
import {LendingStrategyUpdate, StrategyMeta, StrategyUpdate} from "../../../src/WebSocket/StrategyUpdater";
import * as $ from "jquery";
import * as TradingView from "../libs/tv/charting_library.min";
import {TradingViewDatafeed} from "../classes/WebSocket/TradingViewDatafeed";
import {ConfigCurrencyPair} from "../../../src/Trade/TradeConfig";
import {StrategyPosition} from "../../../src/Strategies/AbstractStrategy";
import * as i18next from "i18next";
import {AppClass} from "../index";
//import {AceAjax} from "ace"; // namespace, not a module


declare var pageData: PageData, appData: AppData;
declare var AppF: AppFunc, Hlp: HelpersClass;

export class Strategies extends AbstractController {
    public readonly opcode = WebSocketOpcode.STRATEGIES;
    protected feed: TradingViewDatafeed;
    protected showingChart: ConfigCurrencyPair = null;
    protected configCache: any[] = []; // TradeConfig[]
    protected showingImportState: string = "";
    protected editor: AceAjax.Editor;

    constructor(socket: ClientSocket, feed: TradingViewDatafeed) {
        super(socket)
        this.feed = feed;
    }

    public onData(data: any) {
        // TODO ensure data is parsed with plain JSON or EJSON. add a flag or query
        if (data.error)
            return Hlp.showMsg(data.errorTxt ? data.errorTxt : AppF.tr(data.errorCode ? data.errorCode : 'unknownError'), 'danger');
        if (data.meta && data.meta.importLabel)
            setTimeout(this.showImportState.bind(this, data.meta), 100);
        if (data.full) {
            // full data only contains strategy data for the active tab
            this.$().empty().append(AppF.translate(pageData.html.strategies.main));
            this.configCache = [];
            let currentConfNr = 1;
            data.full.forEach((config/*: StrategyUpdate | LendingStrategyUpdate*/) => {
                this.configCache.push(config);
                let html = "";
                let tabsHtml = "";
                if (/*config instanceof StrategyUpdate*/config.hasOwnProperty("marginTrading")) {
                    html = AppF.translate(pageData.html.strategies.strategyData, {
                        nr: config.nr,
                        exchanges: Strategies.getExchangeNames(config.exchanges),
                        marginTrading: config.marginTrading ? AppF.tr("yes") : AppF.tr("no"),
                        tradeTotalBtc: config.tradeTotalBtc,
                        //baseCurrency: this.getBaseCurrency(config.strategies),
                        baseCurrency: config.baseCurrency,
                        quoteCurrency: config.quoteCurrency,
                        position: config.position,
                        amount: config.positionAmount.toFixed(8),
                        pl: config.pl.toFixed(8),
                        plPercent: config.plPercent.toFixed(2),
                        style: config.activeNr === currentConfNr ? "" : "display: none"
                    });
                }
                else {
                    html = AppF.translate(pageData.html.strategies.lendingStrategyData, {
                        nr: config.nr,
                        exchange: config.exchange,
                        baseCurrency: config.baseCurrency,
                        style: config.activeNr === currentConfNr ? "" : "display: none"
                    });
                }
                tabsHtml = AppF.translate(pageData.html.strategies.tab, {
                    nr: config.nr,
                    tabTitle: Strategies.getExchangeNames(config.exchanges) + AppF.tr("colon") + config.currencyPairStr,
                    active: config.activeNr === currentConfNr ? "active " :""
                });
                this.$("#strategyTabs").append(tabsHtml);
                if (config.activeNr === currentConfNr) {
                    this.$().append(html);
                    let count = 0; // i = key = name of the strategy
                    $.each(config.strategies, (i, value) => {
                        let strategyHtml = this.getStrategyHtml(config.nr, value)
                        this.placeStrategyHtml(count, config, strategyHtml);
                        this.addStrategyProperties(config.nr, value);
                        count++;
                    });
                    this.addButtonEvents(config);
                    this.updateButtonStates(config.nr, config.position);
                    setTimeout(() => { // show chart after the page is loaded
                        this.showActiveChart(config.activeNr, config.mainStrategyName);
                    }, 100)
                }

                currentConfNr++;
            })
            this.addTabClickHandlers(data.full);
            Hlp.updateTimestampsRepeating();
            return;
        }
        else if (data.strategyConfig)
            return this.onStrategyConfig(data.strategyConfig);
        else if (data.stratConfError) {
            $("#stratConfError").text(i18next.t(data.stratConfError));
            return;
        }
        else if (data.savedStratConf) {
            $("#modal-config-dialog").remove();
            return;
        }
        else if (!data.config)
            return;

        // TODO PriceUpDown class that just watches DOM elements with certain IDs and flashes red/green on movements and shows text in green/red if + or -
        // how to store values? we replace html? x-path as unique keys?
        let configNr = parseInt(data.config.split("-")[0]);
        $.each(data.strategies, (i, value) => {
            let strategyHtml = this.getStrategyHtml(configNr, value)
            this.$("#strategy-" + configNr + " ." + value.name).replaceWith(strategyHtml);
            this.addStrategyProperties(configNr, value);
        })
        if (data.position) { // TODO sometimes not updating until we reopen the tab. move this up?
            this.$("#position-" + configNr).text(data.position); // replace only the inner data
            this.$("#amount-" + configNr).text(data.positionAmount.toFixed(8));
            this.$("#pl-" + configNr).text(data.pl.toFixed(8));
            this.$("#plPercent-" + configNr).text(data.plPercent.toFixed(2));
        }
        this.updateButtonStates(configNr, data.position);
        Hlp.updateTimestampsRepeating();
    }

    public render() {
        return new Promise<string>((resolve, reject) => {
            let status = AppF.translate(pageData.html.strategies.main)
            resolve(status);
        })
    }

    public onClose(): void {
        this.showingChart = null;
        this.feed.resetCurrencyPair();
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected getStrategyHtml(configNr: number, strategyData: any) {
        let attributes = {
            nr: configNr,
            name: strategyData.name,
            headline: strategyData.name + " " + strategyData.pair
        }
        return AppF.translate(pageData.html.strategies.singleStrategy, attributes);
    }

    protected placeStrategyHtml(strategyIndex: number, config: StrategyUpdate, strategyHtml: string) {
        if (strategyIndex % 2 === 0)
            this.$("#strategy-" + config.nr).append(pageData.html.strategies.strategyRow);
        this.$("#strategy-" + config.nr + " .strategyRow").last().append(strategyHtml);
    }

    protected addStrategyProperties(configNr: number, strategyData: any): void {
        $.each(strategyData, (i, value) => {
            if (i === "name" || i === "pair")
                return;
            let html = "";
            const type = typeof value;
            if (type === "boolean")
                value = AppF.tr(value === true ? "yes" : "no");
            else if (type === "number") {
                if (Math.floor(value*8) !== value*8)
                    value = value.toFixed(8); // show at most 8 decimals
                //else
                    //value = value;
            }
            else if (!value)
                value = ""; // null Dates

            //if (type === "string" && value.match(AbstractController.DATE_REGEX) !== null) {
                //value = new Date(value);
            if (value instanceof Date) {
                html = AppF.translate(pageData.html.strategies.stratTimeProp, {
                    name: i,
                    timestamp: Math.floor(new Date(value).getTime() / 1000), // ensure getTime() really exists, shouldn't be needed
                    value: value
                });
            }
            else {
                // TODO check if translation exists and translate names?
                html = AppF.translate(pageData.html.strategies.stratProp, {
                    name: i,
                    value: value instanceof Object ? value.toString() : value
                });
            }
            this.$("#strat-" + configNr + "-" + strategyData.name).append(html);
        });
        const i = configNr-1;
        if (i >= this.configCache.length)
            return AppF.log("Error: Config cache has missing data. Can not create chart.");
        let config = this.configCache[i];
        this.addStrategyButtonEvents(config, strategyData.name);
    }

    protected addButtonEvents(config: StrategyUpdate) {
        if (/*config instanceof StrategyUpdate*/config.hasOwnProperty("marginTrading")) {
            this.$("#closePos-" + config.nr).click((event) => {
                this.send({closePos: config.nr, pair: config.currencyPairStr});
            });
        }
        else {
            // Lending
            this.$("#closePos-" + config.nr).addClass("hidden");
        }
    }

    protected updateButtonStates(configNr: number, position: StrategyPosition) {
        if (position === "none")
            this.$("#closePos-" + configNr).attr("disabled", "disabled");
        else
            this.$("#closePos-" + configNr).removeAttr("disabled");
    }

    protected addStrategyButtonEvents(config: StrategyUpdate, strategyName: string) {
        this.$("#showChartBtn-" + config.nr + "-" + strategyName).unbind("click").click((event) => {
            store.setItem("chartClosed", false);
            const durationMs = 360;
            $('html, body').animate({scrollTop: 0}, durationMs);
            const button = $(event.target);
            const strategyName = button.attr("data-strategy");
            this.renderChart(config, strategyName);
        });
        const idAddon =  + config.nr + "-" + strategyName;
        this.$("#editConfigBtn-" + idAddon).unbind("click").click((event) => {
            $("#modal-config-dialog").remove(); // only open 1 at a time
            let editorHtml = AppF.translate(pageData.html.strategiesConfigPopup.editOverlay, {strategyName: strategyName});
            $(AppClass.cfg.appSel).append(editorHtml);
            this.editor = ace.edit("editor");
            this.editor.$blockScrolling = Number.POSITIVE_INFINITY;
            this.editor.setTheme("ace/theme/xcode");
            this.editor.getSession().setMode("ace/mode/json");
            this.editor.on("change", (e) => {
                //if (!this.canEdit)
                    //return;
                $("#saveStratConfig").fadeIn("slow");
            });
            this.send({
                getStrategyConfig: strategyName,
                configNr: config.nr
            });
            setTimeout(() => {
                $("#saveStratConfig").click((event) => {
                    this.send({
                        updateStrategyConfig: strategyName,
                        configNr: config.nr,
                        strategyConfig: this.editor.getValue()
                    });
                });
                $("#cancelStratConfig").click((event) => {
                    $("#modal-config-dialog").remove();
                });
            }, 100);
        });
    }

    protected onStrategyConfig(strategyConfig: string) {
        if (this.editor) {
            if (typeof strategyConfig !== "string")
                strategyConfig = JSON.stringify(strategyConfig); // shouldn't happen
            this.editor.setValue(strategyConfig, -1);
        }
    }

    protected showActiveChart(configNr: number, strategyName: string) {
        const i = configNr-1;
        if (i >= this.configCache.length)
            return AppF.log("Error: Config cache has missing data. Can not show chart.");
        let config = this.configCache[i];
        this.renderChart(config, strategyName);
    }

    protected renderChart(config: StrategyUpdate, strategyName: string) {
        if (store.getItem("chartClosed") === true)
            return;
        const nextChart = config.nr + "-" + strategyName;
        if (this.showingChart === nextChart)
            return;
        this.showingChart = nextChart;
        if (appData.tvReady === true)
            this.addTradingViewChart(config, strategyName);
        else {
            //Tradingview.onReady()
            //window.addEventListener("DOMContentLoaded", () => { // DOM content should already be loaded if we reach this script
            setTimeout(() => {
                appData.tvReady = true;
                setTimeout(() => { // TradingView undefined error even after tvReady before. new tv lib loads resources async and calls this too soon?
                    this.addTradingViewChart(config, strategyName);
                }, 300);
            }, 500);
        }
    }

    protected addTabClickHandlers(configs: StrategyUpdate[]) {
        configs.forEach((config) => {
            this.$("#tab-" + config.nr).click((event) => {
                const configNr = parseInt($(event.target).parent().attr("data-nr"));
                this.send({tabNr: configNr});
                this.$(".strategyTab").removeClass("active");
                this.$(".strategiesRow").fadeOut("slow");
                setTimeout(() => {
                    $(event.target).addClass("active");
                    this.$("#strategies-" + configNr).fadeIn("slow");
                }, 200);
            });
        })

        this.$("#closeChart").unbind("click").click((event) => {
            this.$("#tvChart").empty();
            this.$(".chartButtons").fadeOut("slow");
            store.setItem("chartClosed", true);
        });
    }

    protected addTradingViewChart(config: StrategyUpdate, activeStrategy: string): void {
        if (!config.strategies[activeStrategy] || !config.strategies[activeStrategy].candleSize)
            return AppF.log("Error: Can not show chart for strategy without candle size: " + activeStrategy);

        // workarounds: https://github.com/tradingview/charting_library/issues/2442
        // no workaround found. solution: move the container outside of the bootstrap tabs (which have "display: none" property)
        //this.$("#tvChart").empty().css("display", "block").css("visibility", "visible");
        this.$("#tvChart").empty()/*.replaceWith('<div id="tvChart" class="bottom20"></div>')*/;
        /*
        let parents = $("#tvChart").parents();
        $.each(parents, (i, element) => { // all strategies should have the same currency pairs
            $(element).attr("display", "block");
        })*/

        this.$(".chartButtons").fadeIn("slow");
        this.feed.setCurrencyPair(config.nr, config.currencyPairStr, activeStrategy);
        let widget = new TradingView.widget({
            debug: false, // uncomment this line to see Library errors and warnings in the console
            fullscreen: true, // use all space (better than width 100%)
            symbol: config.currencyPairStr,
            interval: config.strategies[activeStrategy].candleSize.toString(),
            container_id: "tvChart",
            datafeed: this.feed,
            library_path: "/js/libs/tv/",
            locale: (appData.lang as TradingView.LanguageCode), // TODO check if lang is actually supported
            //timezone: this.getTimezoneName() as any,
            //timezone: 'Asia/Bangkok',
            //timezone: new Date().getTimezoneOffset() as any,
            //	Regression Trend-related functionality is not implemented yet, so it's hidden for a while
            drawings_access: { type: 'black', tools: [ { name: "Regression Trend" } ] },
            disabled_features: ["header_symbol_search", "compare_symbol", "header_compare"/*, "use_localstorage_for_settings"*/],
            enabled_features: ["study_templates", "left_toolbar", "keep_left_toolbar_visible_on_small_screens"],
            // TODO implement backend to store JSON https://github.com/tradingview/charting_library/wiki/Saving-and-Loading-Charts#developing-your-own-backend
            charts_storage_url: 'https://saveload.tradingview.com',
            charts_storage_api_version: "1.1",
            client_id: 'wolfbot.org',
            user_id: config.userToken // this ID is used by the server to store + load the user charts
            //charts_storage_url: "http://null.com"
        });
    }

    protected showImportState(meta: StrategyMeta) {
        if (this.showingImportState === meta.importLabel)
            return;
        this.showingImportState = meta.importLabel;
        const stateType = meta.importLabel.toLowerCase().indexOf("failed") !== -1 ? "warning" : "success";
        Hlp.showMsg(i18next.t(meta.importLabel), stateType);
    }

    /*
    protected getTimezoneName(): string {
        // https://stackoverflow.com/questions/18246547/get-name-of-time-zone
        return (new Date).toString().split('(')[1].slice(0, -1);
    }
    */

    /*
    protected getBaseCurrency(strategies: any) {
        let strategyData;
        $.each(strategies, (i, value) => { // all strategies should have the same currency pairs
            strategyData = value;
            return false; // stop
        })
        return strategyData.pair.split("_")[0];
    }
    */

    public static getExchangeNames(exchanges: string[]) { // in Strategies on client and AbstractConfig on server
        return exchanges.toString().replace(/,/g, ", ");
    }
}
