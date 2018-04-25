//import {AbstractWidget} from "../classes/AbstractWidget";
import {ClientSocketReceiver, ClientSocket} from "../../classes/WebSocket/ClientSocket";
import * as $ from "jquery";
import {PageData} from "../../types/PageData";
import {AppData} from "../../types/AppData";
import {AppFunc, HelpersClass} from "@ekliptor/browserutils";

declare var pageData: PageData, appData: AppData;
declare var AppF: AppFunc, Hlp: HelpersClass;

export interface PlainUpdate {
    [domID: string]: string;
}

export abstract class AbstractController extends ClientSocketReceiver {
    //protected static readonly DATE_REGEX = "^2.+T.+Z$"; // bad idea because timezone is lost in this format. use EJSON for Dates

    constructor(socket: ClientSocket) {
        super(socket)
    }

    public static restoreJson(obj, dateFields = []) {
        // json doesn't have a Date type. so we have to specify fields and restore it here
        for (let prop of dateFields)
        {
            if (obj[prop])
                obj[prop] = new Date(obj[prop])
        }
        return obj
    }

    public abstract render(): Promise<string>;

    public onClose(): void {
        // overwrite it to perform cleanup if required
    }

    public isVisible() {
        return this.$().length !== 0;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected updateDataByClass(data: PlainUpdate, safeHtml = false) {
        for (let prop in data)
        {
            let el = $("#" + this.className + " ." + prop);
            if (el.length === 0)
                continue;
            if (safeHtml === true)
                el.html(data[prop]);
            else
                el.text(data[prop]);
        }
    }

    /**
     * Get $ with the the DOM id of the current view prefixed.
     * @param selector
     * @param context
     * @returns {JQuery}
     */
    protected $(selector?: string, context?: Element|JQuery) {
        if (selector)
            return $("#" + this.className + " " + selector, context);
        return $("#" + this.className, context);
    }

    // TODO 2 way databinding functions (event listeners) that send data back from the client to the server

    protected getSelectOption(value: string, title: string, selected = false) {
        let attributes = {
            value: value,
            title: title,
            selected: selected ? " selected" : ""
        }
        return AppF.translate(pageData.html.misc.selectOpt, attributes);
    }

    protected getFormValue(values: JQuerySerializeArrayElement[], name: string): string {
        for (let i = 0; i < values.length; i++)
        {
            if (values[i].name === name)
                return values[i].value;
        }
        return null;
    }

    protected getDatepickerLibs() {
        let resources = [
            document.location.origin + "/js/libs/moment/moment.min.js",
            document.location.origin + "/js/libs/bootstrap-datetimepicker.min.js"
        ];
        if (appData.lang !== "en") { // en-US is already included
            resources.push(document.location.origin + "/js/libs/moment/locales/" + appData.lang + ".min.js");
        }
        return resources;
    }

    protected loadDatePickerLib(callback) {
        if (typeof $("body").datetimepicker === "function")
            return setTimeout(callback.bind(this), 0); // already loaded
        AppF.loadResource(document.location.origin + "/css/libs/bootstrap-datetimepicker.min.css");
        // see https://github.com/moment/moment/tree/master/locale for more locales
        let resources = this.getDatepickerLibs();
        //if (AppF.isOldIE())
        //resources.push(document.location.origin + "/js/libs/es5-shim.min.js"); // for parsley & IE8
        //resources.push(document.location.origin + "/js/libs/parsley/parsley.min.js");
        if (appData.lang !== "en") { // en-US is already included
            //resources.push(document.location.origin + "/js/libs/parsley/i18n/" + appData.lang + ".min.js");
        }
        AppF.loadResource(resources, callback.bind(this), null, true);
    }

    public setDateTimeValue(element: JQuery) {
        let val = element ? element.find(':input').attr('data-value') : null; // data-value of the first input child element
        if (!val)
            return false;
        let valNr = Math.floor(parseInt(val));
        if (!valNr)
            return false;
        element.data("DateTimePicker").date(new Date(valNr));
        return true;
    }
}