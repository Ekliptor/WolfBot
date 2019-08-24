import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import Notification from "./Notification";
import * as path from "path";
import * as os from "os";

export interface NotificationOpts {
    receiver: string; // email address, user token...
    adminReceiver: string; // admin address for crash reports (on premium bots)
    channel?: string; // telegram channel ID
}

export abstract class AbstractNotification {
    protected static instance: AbstractNotification = null;
    protected static adminInstance: AbstractNotification = null;

    protected options: NotificationOpts;
    protected className: string;
    protected isAdminInstance = false;

    constructor(options: NotificationOpts) {
        this.options = options;
        this.className = this.constructor.name;
    }

    public static getInstance(adminInstance = false) {
        const fallbackClass = "NoNotificationService";
        if (adminInstance === true) {
            if (AbstractNotification.adminInstance === null) {
                let notificationClass = nconf.get('serverConfig:adminNotificationMethod');
                let notificationOpts: any = {};
                if (notificationClass)
                    notificationOpts = nconf.get("serverConfig:apiKey:notify:" + notificationClass);
                else
                    notificationClass = "NoNotificationService";
                let modulePath = path.join(__dirname, notificationClass)
                AbstractNotification.adminInstance = AbstractNotification.loadModule(modulePath, notificationOpts);
                if (!AbstractNotification.adminInstance && notificationClass !== fallbackClass) {
                    logger.error("Loading admin notification class %s failed. Loading fallback %s", fallbackClass)
                    modulePath = path.join(__dirname, fallbackClass)
                    AbstractNotification.adminInstance = AbstractNotification.loadModule(modulePath, {});
                }
            }
            AbstractNotification.adminInstance.isAdminInstance = true;
            return AbstractNotification.adminInstance;
        }
        if (AbstractNotification.instance === null) {
            let notificationClass = nconf.get('serverConfig:notificationMethod');
            let notificationOpts: any = {};
            if (notificationClass)
                notificationOpts = nconf.get("serverConfig:apiKey:notify:" + notificationClass);
            else
                notificationClass = "NoNotificationService";
            let modulePath = path.join(__dirname, notificationClass)
            AbstractNotification.instance = AbstractNotification.loadModule(modulePath, notificationOpts);
            if (!AbstractNotification.instance && notificationClass !== fallbackClass) {
                logger.error("Loading notification class %s failed. Loading fallback %s", fallbackClass)
                modulePath = path.join(__dirname, fallbackClass)
                AbstractNotification.instance = AbstractNotification.loadModule(modulePath, {});
            }
        }
        return AbstractNotification.instance;
    }

    public send(notification: Notification/*, forceAdmin = false*/): Promise<void> {
        // TODO add a limit "max messages per time per notification-type" in here instead of classes outside
        const prefix = nconf.get("serverConfig:premium") === false || this.isAdminInstance === true ? this.getBotDirName() + " " : /*nconf.get("projectNameLong")*/"";
        notification.title = prefix + notification.title;
        let forceAdmin = false;
        if (this === AbstractNotification.adminInstance && AbstractNotification.adminInstance.isAdminInstance === true) {
            const userInfo = os.userInfo({encoding: "utf8"});
            notification.text += utils.sprintf("\nHost: %s, User: %s", os.hostname(), (userInfo ? userInfo.username : "unknown"));
            forceAdmin = true;
        }
        if (!notification.text)
            notification.text = "empty text"; // some services (Pushover) can't send empty messages
        return this.sendNotification(notification, forceAdmin);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected abstract sendNotification(notification: Notification, forceAdmin: boolean): Promise<void>;

    protected getBotDirName() {
        return path.basename(utils.appDir);
    }

    protected static loadModule(modulePath: string, options = undefined) {
        try {
            let ModuleClass = require(modulePath)
            if (ModuleClass.default)
                ModuleClass = ModuleClass.default; // fix for typescript default exports
            let instance = new ModuleClass(options)
            return instance
        }
        catch (e) { // e.code === 'MODULE_NOT_FOUND'
            logger.error('failed to load module: ' + modulePath, e)
            return null
        }
    }
}

// force loading dynamic imports for TypeScript
import "./Pushover";
import NoNotificationService from "./NoNotificationService";
