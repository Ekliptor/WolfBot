import {ClientSocketReceiver, ClientSocket} from "../classes/WebSocket/ClientSocket";
import {AbstractController} from "./base/AbstractController";
import {WebSocketOpcode} from "../../../src/WebSocket/opcodes";
import {PageData} from "../types/PageData";
import {AppData} from "../types/AppData";
import {AppFunc, HelpersClass} from "@ekliptor/browserutils";
import {AppClass, App} from "../index";
import {ConfigReq, ConfigRes, ConfigTab} from "../../../src/WebSocket/ConfigEditor";
import {Strategies} from "./Strategies";
import * as $ from "jquery";
import * as i18next from "i18next";
//import {AceAjax} from "ace"; // namespace, not a module

declare var pageData: PageData, appData: AppData;
declare var AppF: AppFunc, Hlp: HelpersClass;
declare var JSONEditor: any; // TODO wait for typings

export class Config extends AbstractController {
    public readonly opcode = WebSocketOpcode.CONFIG;

    protected selectedTab: ConfigTab = null;
    protected fullData: ConfigRes = null;
    protected currentConfigFile: string = null;

    protected jsonEditor: any = null;
    protected editor: AceAjax.Editor;
    protected canEdit = false;

    constructor(socket: ClientSocket) {
        super(socket)
        this.persistent = true;
    }

    public onData(data: ConfigRes) {
        if (data.error)
            return Hlp.showMsg(data.errorTxt ? data.errorTxt : AppF.tr(data.errorCode ? data.errorCode : 'unknownError'), 'danger');
        else if (data.saved) {
            this.$("#saveConfig").fadeOut("slow");
            return Hlp.showMsg(AppF.tr('savedConfig'), 'success', AppClass.cfg.successMsgRemoveSec);
        }

        if (!this.isVisible())
            return;
        if (data.configFiles) {
            this.setPersistent(true);
            this.setupInitialPage(data);
        }
        else if (data.configFileData) {
            this.editor.setValue(data.configFileData, -1);
            this.canEdit = true;
        }
    }

    public render() {
        return new Promise<string>((resolve, reject) => {
            this.canEdit = false; // when we re-open the page
            resolve("");
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
            let disconnected = AppF.translate(pageData.html.misc.disablePage, vars);
            $(AppClass.cfg.appSel).append(disconnected);
            this.send({restart: true})
            let checkRestartDone = () => {
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
                            // check for content to see if the app is really ready (and not just the http server running + updater restarting again)
                            setTimeout(() => {
                                document.location.reload(true);
                            }, 1500);
                        }
                        else
                            checkRestartDone();
                    }).fail((err) => {
                        checkRestartDone();
                    })
                }, 1000);
            }
            checkRestartDone();
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
            $("#pauseOpeningPositions").text(AppF.tr("pauseOpeningPositions"));
        else
            $("#pauseOpeningPositions").text(AppF.tr("resumeOpeningPositions"));
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
    }

    protected displayTab(tab: ConfigTab) {
        this.$("#tabContent").empty();
        switch (tab)
        {
            case "tabGeneral":
                this.setupGeneralTab(this.fullData);
                break;
            case "tabTrading":
                this.setupTradingTab(this.fullData);
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
            let title = conf.substr(1).replace(/\.json$/, "")
            this.$("#configs").append(this.getSelectOption(conf, title, "/" + data.selectedConfig + ".json" === conf))
        });
        data.traders.forEach((trader) => {
            this.$("#traders").append(this.getSelectOption(trader, AppF.tr(trader), data.selectedTrader === trader))
        })
        App.initMultiSelect((optionEl, checked) => {
            const id = optionEl.attr("id");
            Hlp.showMsg(AppF.tr('restartRequiredConf'), 'warning');
            if (id === "configs") {
                this.canEdit = false;
                this.currentConfigFile = optionEl.val().substr(1).replace(/\.json$/, "");
                this.$("#saveConfig").fadeOut("slow");
                this.send({configChange: optionEl.val()});
            }
            else if (id === "traders")
                this.send({traderChange: optionEl.val()});
            else if (id === "tradingMode")
                this.send({tradingModeChange: optionEl.val()});
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
            this.$("#debug").addClass("hidden");
        this.$("#devMode").prop("checked", data.devMode);
        this.$("#devMode").change((event) => {
            const checked = $(event.target).is(":checked");
            if (checked === true)
                $(".tabScripts, #tabTradingDev").removeClass("hidden");
            else
                $(".tabScripts, #tabTradingDev").addClass("hidden");
            this.send({devMode: checked})
        });

        // Exchange API Keys
        this.$("#configExchangeForm input[type=text]").change((event) => {
            this.$("#saveKey").fadeIn("slow");
            // TODO implement storing keys + user management
            // TODO populate exchange menu
        });
    }

    protected setupTradingTab(data: ConfigRes) {
        let html = AppF.translate(pageData.html.config.jsonView)
        this.$("#tabContent").append(html);
        this.loadJsonView(() => {
            //$('.asyncWait').remove();
            JSONEditor.defaults.languages[i18next.language] = AppF.getTranslation("editor");
            JSONEditor.defaults.language = i18next.language;
            let element = document.getElementById('tradeSettingsEditor');
            let options = {
                theme: "bootstrap3",
                iconlib: "fontawesome4", // overwrites some localized properties, also some buttons as "Edit JSON" not localized
                schema: data.jsonEditorData.schema
            }
            this.jsonEditor = new JSONEditor(element, options);
            // Set the value
            this.jsonEditor.setValue(data.jsonEditorData.data);
            //this.jsonEditor.getEditor('root.username').disable();
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
        setTimeout(() => {
            this.canEdit = true;
        }, 600);
        this.$("#saveConfig").click((event) => {
            this.send({
                saveConfig: this.editor.getValue(),
                configName: /*this.$("#configs").val()*/this.currentConfigFile
            })
        });
    }

    protected send(data: ConfigReq) {
        super.send(data);
    }
}