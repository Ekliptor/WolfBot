import {ClientSocketReceiver, ClientSocket} from "../classes/WebSocket/ClientSocket";
import {WebSocketOpcode} from "../../../src/WebSocket/opcodes";
import {PageData} from "../types/PageData";
import {AppData} from "../types/AppData";
import {AppFunc, HelpersClass} from "@ekliptor/browserutils";
import {AppClass, App} from "../index";
import {
    ConfigReq,
    ConfigRes,
    ConfigTab, DisplayCurrencyMap,
    ExchangeApiConfig,
    ExchangeApiKeyMap, NotificationMethodMap
} from "../../../src/WebSocket/ConfigEditor";
import {Strategies} from "./Strategies";
import * as $ from "jquery";
import * as i18next from "i18next";
import {TableController} from "./base/TableController";
//import {AceAjax} from "ace"; // namespace, not a module

declare var pageData: PageData, appData: AppData;
declare var AppF: AppFunc, Hlp: HelpersClass;
declare var JSONEditor: any; // TODO wait for typings

export class Config extends TableController {
    public readonly opcode = WebSocketOpcode.CONFIG;

    protected selectedTab: ConfigTab = null;
    protected fullData: ConfigRes = null;
    protected currentConfigFile: string = null;

    protected jsonEditor: any = null;
    protected createJsonViewTimerID: number = 0;
    protected editor: AceAjax.Editor;
    protected canEdit = false;
    protected currencyTable: DataTables.Api = null;

    constructor(socket: ClientSocket) {
        super(socket)
        this.persistent = true;
    }

    public onData(data: ConfigRes) {
        if (data.error)
            return Hlp.showMsg(data.errorTxt ? data.errorTxt : AppF.tr(data.errorCode ? data.errorCode : 'unknownError'), 'danger');
        else if (data.saved) {
            this.$("#saveConfig, #saveKey, #saveNotification, #copyConfigPanel").fadeOut("slow");
            Hlp.showMsg(AppF.tr('savedConfig'), 'success', AppClass.cfg.successMsgRemoveSec);
            if (data.restart)
                this.showRestartMsg();
            if (data.configFiles)
                this.rebuildConfigDropdown(data.configFiles);
            return;
        }

        if (data.configWasReset === true)
            Hlp.showMsg(data.errorTxt ? data.errorTxt : AppF.tr(data.errorCode ? data.errorCode : 'configWasReset'), 'danger');
        if (!this.isVisible())
            return;
        if (data.configFiles) {
            this.setPersistent(true);
            this.setupInitialPage(data);
        }
        else if (data.configFileData) {
            if (this.editor) // undefined if this is not the current view
                this.editor.setValue(data.configFileData, -1);
            this.canEdit = true;
        }
        else if (data.currencies)
            this.showCurrencyTable(data.currencies);
    }

    public render() {
        return new Promise<string>((resolve, reject) => {
            this.canEdit = false; // when we re-open the page
            resolve(pageData.html.config.main);
        })
    }

    public restartBot() {
        Hlp.confirm(AppF.tr('restartConfirm'), (answer) => {
            if (answer !== true)
                return;
            let vars =  {
                title: AppF.tr('restarting'),
                text: AppF.tr('restartingTxt')
            }
            let disconnected = AppF.translate(pageData.html.misc.restartDialog, vars);
            $(AppClass.cfg.appSel).append(disconnected);
            this.send({restart: true});
            $("#reloadPage").click((event) => {
                window.location.reload(true);
            });
            let checkRestartDone = (responseCount) => {
                setTimeout(() => {
                    let data = new FormData(); // multipart POST data
                    data.append("data", JSON.stringify({ // postDataAsJson() function
                        apiKey: AppF.getCookie("apiKey") // if the key changed we won't be able to open the app either way
                    }))
                    $.ajax({
                        url: pageData.pathRoot + "state/",
                        method: "POST",
                        timeout: 5000,
                        cache: false,
                        contentType: false,
                        processData: false,
                        data: data
                    }).done((data)  =>{
                        if (data.data && data.data.ready === true) {
                            responseCount++;
                            if (responseCount > 2) { // wait for 3 responses to ensure it's not the update process
                                // check for content to see if the app is really ready (and not just the http server running + updater restarting again)
                                setTimeout(() => {
                                    document.location.reload(true);
                                }, 1500);
                            }
                            else
                                checkRestartDone(responseCount);
                        }
                        else {
                            if (responseCount > 0)
                                responseCount--;
                            checkRestartDone(responseCount);
                        }
                    }).fail((err) => {
                        if (responseCount > 0)
                            responseCount--;
                        checkRestartDone(responseCount);
                    })
                }, 1200);
            }
            checkRestartDone(0);
        })
    }

    public pauseTrading() {
        this.send({setPaused: $("#pauseTrading").hasClass("paused") ? false : true});
        if ($("#pauseTrading").hasClass("paused"))
            $("#pauseTradingTxt").text(AppF.tr("pauseTrading"));
        else
            $("#pauseTradingTxt").text(AppF.tr("resumeTrading"));
        $("#pauseTrading").toggleClass("paused");
    }

    public pauseOpeningPositions() {
        this.send({setPausedOpening: $("#pauseOpeningPositions").hasClass("paused") ? false : true});
        if ($("#pauseOpeningPositions").hasClass("paused"))
            $("#pauseOpeningPositionsTxt").text(AppF.tr("pauseOpeningPositions"));
        else
            $("#pauseOpeningPositionsTxt").text(AppF.tr("resumeOpeningPositions"));
        $("#pauseOpeningPositions").toggleClass("paused");
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected setupInitialPage(data: ConfigRes) {
        this.selectedTab = data.selectedTab;
        this.fullData = data;
        this.currentConfigFile = data.selectedConfig;
        let tabsHtml = AppF.translate(pageData.html.config.tabs, {
            active: ""
        });
        this.$().html(tabsHtml);
        data.tabs.forEach((tabID) => {
            if (tabID === data.selectedTab)
                this.$("#" + tabID).addClass("active");
            this.$("#" + tabID).click((event) => {
                const tab = $(event.target).parent();
                this.$(".configTab").removeClass("active");
                tab.addClass("active");
                const curTabID = tab.attr("id") as ConfigTab;
                this.displayTab(curTabID);
                this.send({selectedTab: curTabID});
            });
        });

        this.displayTab(this.selectedTab);
        if (data.devMode !== true) {
            setTimeout(() => {
                $(".tabScripts, #tabTradingDev").addClass("hidden");
            }, 100);
        }
    }

    protected displayTab(tab: ConfigTab) {
        this.$("#tabContent").empty();
        clearTimeout(this.createJsonViewTimerID);
        switch (tab)
        {
            case "tabGeneral":
                this.setupGeneralTab(this.fullData);
                break;
            case "tabTrading":
                // gets show twice otherwise because we load config twice on page open
                // because JSONView creates the element async?
                this.createJsonViewTimerID = setTimeout(() => {
                    this.$("#tabContent").empty();
                    this.setupTradingTab(this.fullData);
                }, 100) as any;
                break;
            case "tabTradingDev":
                this.setupTradingDevTab(this.fullData);
                break;
        }
    }

    protected setupGeneralTab(data: ConfigRes) {
        let html = AppF.translate(pageData.html.config.general)
        this.$("#tabContent").append(html);
        data.tradingModes.forEach((mode) => {
            this.$("#tradingMode").append(this.getSelectOption(mode, AppF.tr(mode), mode === data.selectedTradingMode));
        })
        data.configFiles.forEach((conf) => {
            let title = this.getPlainConfigName(conf);
            this.$("#configs").append(this.getSelectOption(conf, title, "/" + data.selectedConfig + ".json" === conf))
        });
        this.$("#copyConfig").click((event) => {
            this.$("#copyConfigPanel").fadeIn("slow");
        });
        this.$("#copyConfigName").keydown((event) => {
            this.onCopyConfigNameChange();
        });
        this.$("#copyConfigName").change((event) => {
            this.onCopyConfigNameChange();
        });
        this.$("#copyConfigForm").submit((event) => {
            event.preventDefault();
            this.send({copyConfig: this.$("#copyConfigName").val()});
        });
        this.$("#cancelNewConfigFile").click((event) => {
            this.$("#copyConfigPanel").fadeOut("slow");
        });
        this.$("#deleteConfig").click((event) => {
            const valueToRemove = this.$("#configs").val();
            const valueToRemovePlain = this.getPlainConfigName(valueToRemove);
            if (data.activeConfig === valueToRemovePlain) {
                Hlp.alert(AppF.tr('deleteConfigDenied'));
                return;
            }
            Hlp.confirm(i18next.t("deleteConfigConfirm", {name: valueToRemovePlain}), (answer) => {
                if (answer !== true)
                    return;
                this.send({deleteConfig: valueToRemove});
                this.$("#configs option[value='" + valueToRemove + "']").remove();
                (this.$("#configs").val("/" + data.activeConfig + ".json") as any).multiselect("rebuild"); // refresh works for changing the value only
            });
        });
        data.traders.forEach((trader) => {
            this.$("#traders").append(this.getSelectOption(trader, AppF.tr(trader), data.selectedTrader === trader))
        });
        let firstEx = true;
        data.exchanges.forEach((exchangeName) => {
            this.$("#exchanges").append(this.getSelectOption(exchangeName, exchangeName, firstEx))
            firstEx = false;
        });
        let notificationMethods = Object.keys(data.notifications);
        let firstNotification = true;
        notificationMethods.forEach((method) => {
            this.$("#notificationMethod").append(this.getSelectOption(method, method, firstNotification))
            firstNotification = false;
        });
        App.initMultiSelect((optionEl, checked) => { // this must be called after adding all options to select elements
            const id = optionEl.attr("id");
            if (id !== "exchanges")
                this.showRestartMsg();
            if (id === "configs") {
                this.canEdit = false;
                this.currentConfigFile = this.getPlainConfigName(optionEl.val());
                this.$("#saveConfig").fadeOut("slow");
                this.send({configChange: optionEl.val()});
            }
            else if (id === "traders")
                this.send({traderChange: optionEl.val()});
            else if (id === "tradingMode")
                this.send({tradingModeChange: optionEl.val()});
            else if (id === "exchanges")
                this.showEditExchangeApiKeys(optionEl.val());
            else if (id === "notificationMethod")
                this.showNotificationKeyInput(optionEl.val());
        });
        if (data.lending === true)
            (this.$("#traders") as any).multiselect('disable'); // TODO wait for typings
        else if (data.social === true)
            this.$(".traderCtrl").addClass("hidden");

        this.$("#debug").prop("checked", data.debugMode);
        this.$("#debug").change((event) => {
            this.send({debugMode: $(event.target).is(":checked")})
        });
        if (data.premium === true)
            this.$("#debugCtrls").addClass("hidden");
        this.$("#devMode").prop("checked", data.devMode);
        this.$("#devMode").change((event) => {
            const checked = $(event.target).is(":checked");
            //> scrips tab removed, use local IDE: .tabScripts
            if (checked === true)
                $("#tabTradingDev").removeClass("hidden");
            else
                $("#tabTradingDev").addClass("hidden");
            this.send({devMode: checked})
        });
        this.$("#restoreCfg").prop("checked", data.restoreCfg);
        this.$("#restoreCfg").change((event) => {
            const checked = $(event.target).is(":checked");
            if (checked === true) {
                Hlp.confirm(AppF.tr('restoreCfgMsg'), (answer) => {
                    if (answer !== true) {
                        this.$("#restoreCfg").prop("checked", false);
                        return;
                    }
                    this.send({restoreCfg: checked})
                });
            }
            else
                this.send({restoreCfg: checked})
        });

        // Exchange API Keys
        this.$("#configExchangeForm input[type=text]").change((event) => {
            this.$("#saveKey").fadeIn("slow");
            if (this.canDeleteApiKey() === true)
                this.$("#deleteApiKey").fadeIn("slow");
        });
        setTimeout(() => {
            if (this.canDeleteApiKey() === true)
                this.$("#deleteApiKey").fadeIn("slow");
        }, 0);
        this.showEditExchangeApiKeys(this.$("#exchanges").val());
        this.showNotificationKeyInput(this.$("#notificationMethod").val());
        //this.$("#saveKey").click((event) => { // we want to use the browser to validate the form
        this.$("#configExchangeForm").submit((event) => {
            event.preventDefault();
            let saveReq: ExchangeApiKeyMap = {}
            const exchangeName = this.$("#exchanges").val();
            saveReq[exchangeName] = {
                key: this.$("#apiKey").val(),
                secret: this.$("#apiSecret").val(),
                key2: "",
                secret2: ""
            };
            if (this.$("#key2Panel").is(":visible") === true) {
                saveReq[exchangeName].key2 = this.$("#apiKey2").val();
                saveReq[exchangeName].secret2 = this.$("#apiSecret2").val();
            }
            this.send({
                saveKey: saveReq
            })
        });
        this.$("#deleteApiKey").click((event) => {
            Hlp.confirm(AppF.tr('deleteApiKeyConfirm'), (answer) => {
                if (answer !== true)
                    return;
                const exchangeName = this.$("#exchanges").val();
                this.send({removeApiKey: exchangeName});
            });
        });

        // Notification method
        this.$("#notificationsForm input[type=text]").change((event) => {
            this.$("#saveNotification").fadeIn("slow");
        });
        this.$("#notificationsForm").submit((event) => {
            event.preventDefault();
            let saveReq: NotificationMethodMap = {}
            const method = this.$("#notificationMethod").val();
            saveReq[method] = {
                receiver: this.$("#notificationKey").val()
            };
            this.send({
                saveNotification: saveReq,
                notificationMeta: {
                    title: i18next.t("notifySetupTitle"),
                    text: i18next.t("notifySetupTxt")
                }
            })
        });
    }

    protected setupTradingTab(data: ConfigRes) {
        let html = AppF.translate(pageData.html.config.jsonView)
        this.$("#tabContent").append(html);
        this.showAsyncLoadingIcon();
        this.loadJsonView(() => {
            //$('.asyncWait').remove();
            JSONEditor.defaults.languages[i18next.language] = AppF.getTranslation("editor");
            JSONEditor.defaults.language = i18next.language;
            let element = document.getElementById('tradeSettingsEditor');
            let options = {
                theme: "bootstrap3",
                iconlib: "fontawesome4", // overwrites some localized properties, also some buttons as "Edit JSON" not localized
                schema: this.translateSchema(data.jsonEditorData.schema),
                disable_collapse: true,
                disable_edit_json: true,
                disable_properties: true,
                //no_additional_properties: true,
                disable_array_delete_all_rows: true,
                disable_array_delete_last_row: true,
                disable_array_reorder: true
            }
            this.jsonEditor = new JSONEditor(element, options);
            // Set the value
            this.jsonEditor.setValue(data.jsonEditorData.data);
            //this.jsonEditor.getEditor('root.username').disable();
            this.jsonEditor.on("change", () => {
                if (!this.canEdit)
                    return;
                this.$("#saveConfig").fadeIn("slow");
            });
            this.setCanEdit();
            this.$("#saveConfig").click((event) => {
                let errors = this.jsonEditor.validate();
                if (errors.length !== 0) {
                    for (let i = 0; i < errors.length; i++)
                    {
                        let locals = {
                            path: errors[i].path,
                            property: errors[i].property,
                            message: errors[i].message
                        }
                        Hlp.showMsg(i18next.t('editor:errorValidate', locals), 'danger');
                    }
                    return;
                }
                this.send({
                    saveConfig: this.jsonEditor.getValue(),
                    configName: /*this.$("#configs").val()*/this.currentConfigFile
                })
            });
            setTimeout(() => {
                // hide the button to delete the first (only config)
                this.$(".json-editor-btn-delete").eq(0).addClass("hidden");
                // hide the first delete button in all strategy-property arrays (such as PlanRunner.order)
                let lastParentStrategy = null;
                this.$(".json-editor-btn-delete").each((index: number, elem: Element)=> {
                    const el = $(elem);
                    if (el.hasClass("hidden") === true || el.is(":visible") === false)
                        return;
                    const obj = el.parent().parent().parent();
                    if (obj.attr("data-schematype") !== "object")
                        return; // only hide it on object arrays
                    const schemaPath = obj.attr("data-schemapath");
                    if (schemaPath.indexOf(".strategies.") === -1)
                        return; // only hide it within strategies (don't hide the delete button for 2nd main config)
                    const parentStrategy = obj.parent().parent().parent().attr("data-schemapath");
                    if (parentStrategy === lastParentStrategy)
                        return; // hide only the 1st delete array element button, show from 2nd onwards...
                    lastParentStrategy = parentStrategy;
                    el.addClass("hidden");
                });
                this.$("#tradeSettingsEditor option[value=undefined]").remove();

                // remove exchange delete + add buttons (in arbitrage mode)
                for (let i = 0; i < data.jsonEditorData.data.length; i++)
                {
                    let selector = "#tradeSettingsEditor div[data-schemapath='root." + i + ".exchanges']";
                    this.$(selector + " .json-editor-btn-add").remove();
                    this.$(selector + " .json-editor-btn-delete").remove();
                }
                this.removeAsyncLoadingIcon();
            }, 0);
        });
        this.$("#showCurrencies").click((event) => {
            let vars = {}
            let currencyDialog = AppF.translate(pageData.html.supportedCurrencies.currencyDialog, vars);
            $(AppClass.cfg.appSel).append(currencyDialog);
            $("#closeCurrencyDialog").click((event) => {
                $("#modal-currency-dialog").remove();
            });
            this.send({getCurrencies: true});
            this.showAsyncLoadingIcon();
        });
    }

    protected setupTradingDevTab(data: ConfigRes) {
        let html = AppF.translate(pageData.html.config.editor)
        this.$("#tabContent").append(html);
        this.editor = ace.edit("editor");
        this.editor.$blockScrolling = Number.POSITIVE_INFINITY;
        this.editor.setTheme("ace/theme/xcode");
        this.editor.getSession().setMode("ace/mode/json");
        this.editor.on("change", (e) => {
            if (!this.canEdit)
                return;
            this.$("#saveConfig").fadeIn("slow");
        })
        this.editor.setValue(data.configFileData, -1);
        this.setCanEdit();
        this.$("#saveConfig").click((event) => {
            this.send({
                saveConfig: this.editor.getValue(),
                configName: /*this.$("#configs").val()*/this.currentConfigFile
            })
        });
    }

    protected showEditExchangeApiKeys(exchangeName: string) {
        let exchangeKey = this.fullData.exchangeKeys[exchangeName];
        if (!exchangeKey)
            return AppF.log("Error getting exchange key " + exchangeName);
        this.$("#apiKey").val(exchangeKey.key);
        this.$("#apiSecret").val(exchangeKey.secret);
        this.$("#apiKey2").val(exchangeKey.key2 || "");
        this.$("#apiSecret2").val(exchangeKey.secret2 || "");
        if (exchangeKey.key2 === undefined) {
            this.$("#key2Panel").fadeOut("slow");
            this.$("#apiKey2, #apiSecret2").removeAttr("required");
        }
        else {
            this.$("#key2Panel").fadeIn("slow");
            this.$("#apiKey2, #apiSecret2").attr("required", "required");
        }
    }

    protected showNotificationKeyInput(notifytMethod: string) {
        let notifyKeys = this.fullData.notifications[notifytMethod];
        if (!notifyKeys)
            return AppF.log("Error getting notification method data " + notifytMethod);
        let firstValue = /*notifyKeys.key || */notifyKeys.receiver;
        this.$("#notificationKey").val(firstValue);
    }

    protected setCanEdit() {
        setTimeout(() => { // delay it or else the save button shows (change event fired on init)
            this.canEdit = true;
        }, 1200);
    }

    protected translateSchema(schema: any) {
        // TODO add jquery code to collapse all descriptions. only show the first few words (via Regex) and then "..." and let the user click to expand
        for (let prop in schema)
        {
            //console.log(prop, schema[prop])
            if (prop === "title") {
                if (i18next.exists(schema[prop]))
                    schema[prop] = i18next.t(schema[prop]);
                //continue;
            }
            else if (prop === "strategies") {
                schema[prop].properties = this.translateStrategyProperties(schema[prop].properties)
            }
            //else if (prop !== "type")
                //continue;
            else if (schema[prop].title === undefined) {
                const key = "confTitle." + prop;
                if (i18next.exists(key))
                    schema[prop].title = i18next.t(key);
            }
            if (schema[prop].description === undefined) {
                const key = "confDesc." + prop;
                if (i18next.exists(key))
                    schema[prop].description = i18next.t(key);
            }

            const type = schema["type"];
            if (type === "array") {
                //for (let subProp in  schema.items)
                    //schema.items[subProp] = this.translateSchema(schema.items[subProp]);
                schema.items = this.translateSchema(schema.items);
            }
            else if (type === "object") {
                //for (let subProp in schema.properties)
                    //schema.properties[subProp] = this.translateSchema(schema.properties[subProp]);
                schema.properties = this.translateSchema(schema.properties);
            }
            const subType = schema[prop]["type"];
            if (subType === "array") {
                schema[prop].items = this.translateSchema(schema[prop].items);
            }
            else if (subType === "object") {
                schema[prop].properties = this.translateSchema(schema[prop].properties);
            }
        }
        return schema;
    }

    protected translateStrategyProperties(strategySchema: any) {
        const strategyNames = Object.keys(strategySchema);
        strategyNames.forEach((strategyName) => {
            const lookupName = strategyName.replace(/Leverage$/, ""); // leverage strategies have the same config as their parent class
            const key = this.getStrategyLocaleKey() + lookupName + ".desc";
            if (i18next.exists(key))
                strategySchema[strategyName].description = i18next.t(key);
            if (typeof strategySchema[strategyName].properties !== "object") {
                AppF.log("ERROR: strategy doesn't have properties object - ", strategyName);
                return;
            }
            for (let prop in strategySchema[strategyName].properties)
            {
                if (strategySchema[strategyName].properties[prop].type === "array")
                    strategySchema[strategyName].properties[prop] = this.translateStrategyChildArrayProperties(strategySchema[strategyName].properties[prop], strategyName, prop);
                else if (strategySchema[strategyName].properties[prop].type === "object")
                    strategySchema[strategyName].properties[prop] = this.translateStrategyChildObjectProperties(strategySchema[strategyName].properties[prop], strategyName, prop);
                else {
                    let stratKey = this.getStrategyLocaleKey() + lookupName + "." + prop; // try the strategy first
                    if (i18next.exists(stratKey)) {
                        strategySchema[strategyName].properties[prop].description = i18next.t(stratKey);
                        continue;
                    }
                    stratKey = this.getStrategyLocaleKey() + "all." + prop; // check if this property is part of all strategies second
                    if (i18next.exists(stratKey))
                        strategySchema[strategyName].properties[prop].description = i18next.t(stratKey);
                }
            }
        });
        return strategySchema;
    }

    protected translateStrategyChildArrayProperties(strategySchema: any, strategyName: string, prop: string) {
        const key = this.getStrategyLocaleKey() + strategyName + "." + prop + ".desc";
        if (i18next.exists(key))
            strategySchema.description = i18next.t(key);
        for (let childProp in strategySchema.items.properties)
        {
            const childKey = this.getStrategyLocaleKey() + strategyName + "." + prop + "." + childProp;
            if (i18next.exists(childKey))
                strategySchema.items.properties[childProp].description = i18next.t(childKey);
        }
        return strategySchema;
    }

    protected translateStrategyChildObjectProperties(strategySchema: any, strategyName: string, prop: string) {
        for (let childProp in strategySchema.properties)
        {
            const childKey = this.getStrategyLocaleKey() + strategyName + "." + prop + "." + childProp;
            if (i18next.exists(childKey))
                strategySchema.properties[childProp].description = i18next.t(childKey);
        }
        return strategySchema;
    }

    protected getStrategyLocaleKey() {
        if (this.fullData == null)
            return "stratDesc.";
        if (this.fullData.arbitrage === true)
            return "arbitrageStratDesc.";
        if (this.fullData.lending === true)
            return "lendingStratDesc.";
        return "stratDesc.";
    }

    protected showRestartMsg() {
        let msg = i18next.t('restartRequiredConf');
        let vars =  {
            title: AppF.tr('restartNow'),
            href: "javascript:;",
            id: "restartLnk"
        }
        msg += " " + AppF.translate(pageData.html.misc.link, vars)  + "<br>" + i18next.t('backtestNoRestart');
        Hlp.showMsg(msg, 'warning');
        setTimeout(() => {
            $("#restartLnk").click((event) => {
                this.restartBot();
            });
        }, 100);
    }

    protected onCopyConfigNameChange() {
        if (this.$("#saveConfigFile").is(":visible") === false)
            this.$("#saveConfigFile").fadeIn("slow");
    }

    protected rebuildConfigDropdown(configFiles: string[]) {
        this.$("#configs option").remove();
        configFiles.forEach((conf) => {
            let title = this.getPlainConfigName(conf);
            this.$("#configs").append(this.getSelectOption(conf, title, "/" + this.currentConfigFile + ".json" === conf))
        });
        (this.$("#configs") as any).multiselect("rebuild");
    }

    protected showCurrencyTable(currencies: DisplayCurrencyMap) {
        this.removeAsyncLoadingIcon();
        let tableOptions = this.getTableOpts();
        tableOptions["pageLength"] = Number.MAX_VALUE; // show all
        tableOptions["paging"] = false;
        tableOptions = this.prepareTable(tableOptions,"#currencyTable", false);
        this.currencyTable = $("#currencyTable").DataTable(tableOptions);
        for (let tickerSymbol in currencies)
        {
            this.currencyTable.row.add([
                tickerSymbol,
                AppF.escapeOutput(currencies[tickerSymbol])
            ]);
        }
        this.currencyTable.draw(false);
    }

    protected getPlainConfigName(filename: string) {
        return filename.substr(1).replace(/\.json$/, "");
    }

    protected canDeleteApiKey() {
        return this.$("#apiKey").val() !== "" || this.$("#apiKey2").val() !== "";
    }

    protected send(data: ConfigReq) {
        super.send(data);
    }
}