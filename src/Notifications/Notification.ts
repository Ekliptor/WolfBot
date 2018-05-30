import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;

export default class Notification {
    public title: string;
    public text: string;
    public requireConfirmation = false;

    constructor(title: string, text: string, requireConfirmation = false) {
        this.title = title;
        this.text = this.filterInvalidChars(text);
        this.requireConfirmation = requireConfirmation;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected filterInvalidChars(text: string) {
        if (!text)
            return "";
        //return text.replaceAll("@", "-");
        return text;
    }
}