import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractNotification, NotificationOpts} from "./AbstractNotification";
import Notification from "./Notification";

export default class Pushover extends AbstractNotification {
    protected static readonly API_URL = "https://api.pushover.net/1/messages.json"

    constructor(options: NotificationOpts) {
        super(options)
        if (!nconf.get("serverConfig:apiKey:notify:Pushover:appToken"))
            throw new Error("Pushover appToken must be set to send Pushover notifications");
        if (!this.options.receiver)
            throw new Error("Receiver has to be defined to send Pushover notifications");
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected sendNotification(notification: Notification) {
        return new Promise<void>((resolve, reject) => {
            // https://pushover.net/api
            let data: any = {
                token: nconf.get("serverConfig:apiKey:notify:Pushover:appToken"),
                user: this.options.receiver,
                message: notification.text,
                title: notification.title
            }
            if (notification.requireConfirmation) {
                // high priority and retry every 60 sec for 1 h
                data.priority = 2;
                data.expire = 60*60;
                data.retry = 60
            }
            utils.postData(Pushover.API_URL, data, (body, response) => {
                if (!body)
                    return reject({txt: "Received invalid response from Pushover API", response: response})
                let json = utils.parseJson(body)
                if (!json)
                    return reject({txt: "Received invalid JSON from notification api", notification: this.className, body: body})
                else if (json.status !== 1)
                    return reject({txt: "Failed to send pushover message", json: json})
                resolve()
            })
        })
    }
}