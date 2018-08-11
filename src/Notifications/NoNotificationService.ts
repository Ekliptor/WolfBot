import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractNotification, NotificationOpts} from "./AbstractNotification";
import Notification from "./Notification";

/**
 * This is class serves as a placeholder instead of a real notification service.
 * The purpose of it is that we always have a notifier object and don't have to check for !== null
 */
export default class NoNotificationService extends AbstractNotification {

    constructor(options: NotificationOpts) {
        super(options)
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected sendNotification(notification: Notification, forceAdmin: boolean) {
        return new Promise<void>((resolve, reject) => {
            logger.info("%s: %s - %s", this.className, notification.title, notification.text)
            resolve()
        })
    }
}