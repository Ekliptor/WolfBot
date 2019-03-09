import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractSubController} from "./AbstractSubController";
import {AbstractNotification} from "./Notifications/AbstractNotification";
import * as path from "path";

export default class NotificationController extends AbstractSubController {
    protected notifiers: AbstractNotification[] = [];

    constructor() {
        super()
    }

    public process() {
        return new Promise<void>((resolve, reject) => {
            this.loadNotifiers()
            resolve()
        })
    }

    public getNotifiers() {
        return this.notifiers
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected loadNotifiers() {
        let apiKeys = nconf.get("serverConfig:apiKey:notify")
        const notifiers: string[] = [nconf.get("serverConfig:notificationMethod"), nconf.get("serverConfig:adminNotificationMethod")];
        for (let notify in apiKeys)
        {
            if (notifiers.indexOf(notify) === -1)
                continue;
            const modulePath = path.join(__dirname, "Notifications", notify);
            let notifierInstance = this.loadModule(modulePath, apiKeys[notify])
        }
    }
}