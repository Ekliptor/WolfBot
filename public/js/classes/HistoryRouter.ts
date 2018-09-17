import {EventEmitter2} from "eventemitter2";
import {PageData} from "../types/PageData";
import {AppData} from "../types/AppData";
import {AppFunc, HelpersClass} from "@ekliptor/browserutils";

declare var pageData: PageData, appData: AppData;
declare var AppF: AppFunc, Hlp: HelpersClass;

export type StateChangeType = "pop" | "push" | "replace" | "current";

/**
 * A simple router that listens to changes of the window.history object.
 * @events: stateChange (state, location, stateChangeType)
 */
export class HistoryRouter extends EventEmitter2 {
    protected window: Window;
    protected history: History;

    constructor(window: Window) {
        super()
        this.window = window;
        this.history = window.history;
        // the old way is to implement: window.onhashchange (only detects # changes)
        this.window.onpopstate = (event) => {
            //console.log("location: " + document.location + ", state: " + JSON.stringify(event.state));
            this.emitStateChange(event.state, "pop");
        }
    }

    public getState() {
        return this.history.state;
    }

    public getLocation() {
        return this.window.document.location;
    }

    public back() {
        this.history.back();
    }

    public forward() {
        this.history.forward();
    }

    public go(delta: number) {
        this.history.go(delta);
    }

    public pushState(data: any, title?: string, url?: string | null) {
        if (!url)
            url = pageData.path[data.page];
        this.history.pushState(data, title, url);
        this.emitStateChange(data, "push");
    }

    public replaceState(data: any, title?: string, url?: string | null) {
        this.history.replaceState(data, title, url);
        this.emitStateChange(data, "replace");
    }

    public fireCurrentState() {
        //let urlParams = AppF.getUrlParameters(this.window.document.location.href, true);
        let path = this.window.document.location.pathname.split("/")[1]; // 0 = empty string, 1 = the first part is the name of the view
        if (path === "index.html")
            path = "";
        for (let name in pageData.path)
        {
            if (pageData.path[name] === "/" + path) {
                let data = {page: name};
                this.emitStateChange(data, "current");
                return;
            }
        }
        AppF.log("App in unknown state with path:", path);
        let data = {page: "home"};
        this.emitStateChange(data, "current");
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected emitStateChange(state: any, type: StateChangeType) {
        this.emit("stateChange", state, this.window.document.location, type);
    }
}