import * as $ from "jquery";
import * as i18next from "i18next";
//import Backend from "i18next-xhr-backend";
import * as Backend from "i18next-xhr-backend";
import {PageData} from "./types/PageData";
import {AppData} from "./types/AppData";
import {AppFunc, HelpersClass} from "@ekliptor/browserutils";
import {ClientSocket} from "./classes/WebSocket/ClientSocket";
import {HistoryRouter} from "./classes/HistoryRouter";
import {LogReceiver} from "./classes/WebSocket/LogReceiver";
import {LoginManager} from "./classes/WebSocket/LoginManager";
import {AbstractController} from "./controllers/base/AbstractController";
import {Home} from "./controllers/Home";
import {Status} from "./controllers/Status";
import {Strategies} from "./controllers/Strategies";
import {Lending} from "./controllers/Lending";
import {Social} from "./controllers/Social";
import {CoinMarket} from "./controllers/CoinMarket";
import {TradeHistory} from "./controllers/TradeHistory";
import {Oracle} from "./controllers/Oracle";
import {Config} from "./controllers/Config";
import {Scripts} from "./controllers/Scripts";
import {Backtesting} from "./controllers/Backtesting"
import {TradingViewDatafeed} from "./classes/WebSocket/TradingViewDatafeed";
import {WebSocketError} from "../../src/WebSocket/opcodes";


// declare our global variable types from other libraries
declare var i18nextXHRBackend: Backend;

declare var pageData: PageData, appData: AppData;
declare var AppF: AppFunc, Hlp: HelpersClass;
// static members are accessible via the import (only if they are declared in TS, not JS)
// we import and load our helpers as a separate TS bundle
//declare var AppF: AppFunc, AppFunc: AppFunc, Hlp: any, HelpersClass: any;
//export {pageData, appData, AppF, AppFunc, Hlp, HelpersClass}; // exports are undefined when importing

$(document).ready(function () {
    // load language
    i18next.use(i18nextXHRBackend);
    i18next.init({
        'debug': pageData.debug,
        'lng': appData.lang,
        'fallbackLng': pageData.defaultLang,
        //'returnObjects': true,
        backend: {
            //loadPath: pageData.domain + 'locales/{{lng}}.json'
            loadPath: document.location.origin + pageData.pathRoot + 'locales/{{lng}}.json?v=' + pageData.version
            //allowMultiLoading: true
        }
    }, () => {
        //jqueryI18next.init(i18next, $);
        //$('body').localize();
        //console.log("client lang ready: " + i18next.t("siteName"));
        App = new AppClass(); // load the app after translation is ready
        if (pageData.debug) // export it for easier debugging
            window["App"] = App;
        Hlp.initHelpers();
    });
});

export interface RenderViewResponse {
    html: string;
    controller: AbstractController;
}

export interface MultiSelectCallback {
    (optionEl: JQuery, checked: boolean): void;
}

export class AppClass {
    public static readonly cfg = {
        tpl: '', // for loading images/styles from a subdir instead of root
        appSel: '#app',
        contentWidget: '#content',
        successMsgRemoveSec: pageData.successMsgRemoveSec
    }

    protected webSocket: ClientSocket = null;
    protected router = new HistoryRouter(window);
    protected logReceiver: LogReceiver;
    protected loginManager: LoginManager;
    protected tradingViewDatafeed: TradingViewDatafeed;
    protected controllers = new Map<string, AbstractController>(); // (controller name, instance)
    protected activeController: AbstractController = null;

    constructor() {
        if (("WebSocket" in window) === false)
            return Hlp.showMsg(i18next.t('browserOutdated'), 'danger');
        let url = (document.location.protocol === "https:" ? "wss" : "ws") + "://" + document.location.host + pageData.pathRoot;
        let params = AppF.getUrlParameters(document.location.href, true);
        if (params.apiKey) {
            url += "?apiKey=" + params.apiKey;
            AppF.setCookie("apiKey", params.apiKey, pageData.cookieLifeDays); // store the last key to easier access the app again
        }
        else {
            let key = AppF.getCookie("apiKey");
            if (key)
                url += "?apiKey=" + key;
        }
        this.webSocket = new ClientSocket(url);
        this.webSocket.on("disconnect", (reason: WebSocketError) => {
            if ($("#modal-background").length !== 0)
                return; // another controller is showing a message (restart...)
            let vars: any =  {
                title: i18next.t('disconnected'),
                text: i18next.t('disconnectedTxt')
            }
            switch (reason) // see WebSocketError in opcodes.ts
            {
                case "Unauthorized":
                    vars = {
                        title: i18next.t('unauthorized'),
                        text: i18next.t('unauthorizedTxt')
                    }
                    if (AppF.getCookie("apiKey"))
                        AppF.setCookie("apiKey", "", -1); // delete it if existing
                    break;
                case "UnauthorizedPremium":
                    vars = null
                    this.loginManager.showLoginDialog();
                    break;
            }
            if (vars !== null) {
                let disconnected = AppF.translate(pageData.html.misc.disablePage, vars);
                $(AppClass.cfg.appSel).append(disconnected);
            }
        });
        this.logReceiver = new LogReceiver(this.webSocket);
        this.loginManager = new LoginManager(this.webSocket);
        this.tradingViewDatafeed = new TradingViewDatafeed(this.webSocket);
        this.webSocket.on("connect", () => {
            // setup websocket receivers, wait until we are connected
            this.webSocket.subscribe(this.logReceiver);
            this.webSocket.subscribe(this.loginManager);
            this.webSocket.subscribe(this.tradingViewDatafeed); // always subscribe. will only send data when chart is visible
            this.loadControllers();
            App.initSite();
        });
    }

    public initSite() {
        this.initLayout();
        // add screen-reader class
        $('li.active').append('<span class="sr-only"> ' + i18next.t("bracket_l") + i18next.t("selected") + i18next.t("bracket_r") + '</span>');

        // global inits for all pages
        //$('.dateTime').html(function() {
        //return new Date(parseInt($(this).attr('data-time')))
        //})
        Hlp.updateTimestampsRepeating();
        Hlp.updateAbsoluteDates();

        // add DOM event listeners
        /*
         $('#langSelect a').click(function(element) {
         var clicked = $(element.target);
         var lang = clicked.parent().attr('data-lang') || clicked.attr('data-lang'); // target = a if we click on span
         AppF.setCookie('lng', lang);
         document.location.reload();
         });
         */
        this.logReceiver.addListeners();

        // setup routing
        $(".navButtons a[data-target]").click((event) => {
            let target = $(event.target);
            this.router.pushState({page: target.attr("data-target")});
        })
        this.router.on("stateChange", (state, location, stateChangeType) => {
            //console.log(state, location, stateChangeType);
            if (this.activeController && !this.activeController.isPersistent()) {
                this.activeController.onClose();
                this.webSocket.unsubscribe(this.activeController);
            }
            let pageName = state.page ? state.page : "home"; // default view for empty url path
            $(".navButtons li").removeClass("active");
            $('.navButtons a[data-target="' + pageName + '"]').parent("li").addClass("active");
            this.setTitle(AppF.tr(pageName));
            this.renderView(pageName).then((view) => {
                $(AppClass.cfg.contentWidget).html(view.html);
                $('.asyncData').prepend(pageData.html.misc.asyncWait);
                if (view.controller)
                    view.controller.addListeners();
                Hlp.updateTimestampsRepeating(); // immediate update and restart the timer
            }).catch((err) => {
                AppF.log("Error loading view " + pageName, err);
                let errorHtml = AppF.translate(pageData.html.misc.error, {
                    error: i18next.t("errorRendering"),
                    msg: err && err.txt ? err.txt : "",
                    stack: pageData.debug === true && err.stack ? err.stack : ""
                });
                $(AppClass.cfg.contentWidget).html(errorHtml);
            })
        })
        this.router.fireCurrentState();
    }

    public setTitle(title: string) {
        document.title = title + " - " + AppF.tr("siteName");
    }

    public initMultiSelect(onChangeCallback?: MultiSelectCallback) {
        this.initSingleMultiSelect('.multiSel', onChangeCallback);
    }

    public initSingleMultiSelect(selector: string, onChangeCallback?: MultiSelectCallback) {
        // has be be called from controller AFTER multi sel is added to page
        $(selector).each((i, el) => {
            let selOpts: any = {
                nonSelectedText: i18next.t("nothingSelected"),
                nSelectedText: i18next.t("selected"),
                allSelectedText: i18next.t("allSelected"),
                //disabledText: '', // show nSelectedText
                //delimiterText: ', ',
                //selectAllText: '', // only with includeSelectAllOption: true
                numberDisplayed: pageData.multiselect.maxSelect
            }
            if ($(el).hasClass('htmlOptions')) {
                selOpts.enableHTML = true;
                selOpts.optionLabel = (element) => {
                    let image = $(element).attr('data-img');
                    if (!image)
                        return $(element).text();
                    return '<i class="' + image + '"></i> ' + $(element).text();
                }
            }
            if (typeof onChangeCallback === "function") {
                selOpts.onChange = function(option, checked, select) {
                    //if ($('#worksTable').length === 0)
                    //return; // we are in all overview table, change disabled there

                    // the old select element in the DOM of select doesn't reflect those updates? why wtf? search for a better plugin
                    let optionEl = $(option).parent();
                    let curOpt = $(option);
                    let domOpt = $('option[value="' + curOpt.val() + '"]', optionEl);
                    if (checked === true)
                        domOpt.attr('selected', 'selected');
                    else
                        domOpt.removeAttr('selected');
                    onChangeCallback(optionEl, checked);
                }
            }
            let jqEl: any = $(el); // disable warning cause of missing types
            jqEl.multiselect(selOpts);
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected initLayout() {
        let bar = AppF.translate(pageData.html.layout.navbarHead);
        $(AppClass.cfg.appSel).html(bar);
        $(AppClass.cfg.appSel).append(pageData.html.layout.contentWidget);
        let logs = AppF.translate(pageData.html.layout.logs);
        $(AppClass.cfg.appSel).append(logs);

        // TODO sometimes dropdown menu doesn't show. but showing is pure HTML, delaying this shouldn't have any effect. add navbar and delay content widget?
        let config = this.controllers.get("Config") as Config;
        $("#restartBot").click(() => {
            config.restartBot();
        })
        $("#pauseTrading").click(() => {
            config.pauseTrading();
        })
        $("#pauseOpeningPositions").click(() => {
            config.pauseOpeningPositions();
        })
    }

    /**
     * Renders a view. It looks if a controller class with the same name exists (view abc.html -> controller Abc.ts).
     * Otherwise it just renders the "main" section of the view.
     * @param {string} name
     * @returns {Promise<RenderViewResponse>}
     */
    protected renderView(name: string) {
        return new Promise<RenderViewResponse>((resolve, reject) => {
            $("body").removeClass().addClass(name);
            let controller = this.controllers.get(name[0].toUpperCase() + name.substr(1));
            if (controller) {
                this.activeController = controller;
                if (controller instanceof Config)
                    this.webSocket.setAllowReSubscribe(controller);
                this.webSocket.subscribe(controller);
                controller.render().then((html) => {
                    if (!html) // add loading icon instead of empty page. will get replaced when jQuery adds html in onData() of the controller
                        html = pageData.html.misc.asyncWait;
                    let wrappedHtml = AppF.translate(pageData.html.misc.controllerWrap, {
                        controllerName: controller.getClassName(),
                        html: html
                    }, true);
                    resolve({html: wrappedHtml, controller: controller})
                }).catch((err) => {
                    reject(err)
                })
                return;
            }
            resolve({html: AppF.translate(pageData.html[name].main), controller: null});
        })
    }

    protected loadControllers() {
        // TODO is there a way to dynamically detect and load them in webpack? similar to our loadModule() in NodeJS
        // https://github.com/webpack/webpack/issues/118
        // TODO load them after LogReceiver is ready and only instantiate classes we need
        this.controllers.set("Home", new Home(this.webSocket));
        this.controllers.set("Status", new Status(this.webSocket));
        this.controllers.set("Strategies", new Strategies(this.webSocket, this.tradingViewDatafeed));
        this.controllers.set("Lending", new Lending(this.webSocket));
        this.controllers.set("Social", new Social(this.webSocket));
        this.controllers.set("CoinMarket", new CoinMarket(this.webSocket));
        this.controllers.set("TradeHistory", new TradeHistory(this.webSocket));
        this.controllers.set("Oracle", new Oracle(this.webSocket));
        this.controllers.set("Config", new Config(this.webSocket));
        this.controllers.set("Scripts", new Scripts(this.webSocket));
        this.controllers.set("Backtesting", new Backtesting(this.webSocket));
        // always listen to config changes because we use it to send restart/pause commands
        this.webSocket.subscribe(this.controllers.get("Config"), true);
    }
}

// TODO settings ?
var App: AppClass = null; // delay until page load to inherit before (not needed anymore with TS)
export {App}
