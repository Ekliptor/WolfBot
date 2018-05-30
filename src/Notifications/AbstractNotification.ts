import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import Notification from "./Notification";
import * as path from "path";

export interface NotificationOpts {
    receiver: string; // email address, user token...
}

export abstract class AbstractNotification {
    protected static instance: AbstractNotification = null;

    protected options: NotificationOpts;
    protected className: string;

    constructor(options: NotificationOpts) {
        this.options = options;
        this.className = this.constructor.name;
    }

    public static getInstance() {
        if (AbstractNotification.instance === null) {
            let notificationClass = nconf.get('serverConfig:notificationMethod');
            let notificationOpts: any = {};
            if (notificationClass)
                notificationOpts = nconf.get("serverConfig:apiKey:notify:" + notificationClass);
            else
                notificationClass = "NoNotificationService";
            const modulePath = path.join(__dirname, notificationClass)
            AbstractNotification.instance = AbstractNotification.loadModule(modulePath, notificationOpts);
            if (!AbstractNotification.instance && notificationClass !== "NoNotificationService") {
                logger.error("Loading notification class %s failed. Loading fallback", notificationClass)
                AbstractNotification.instance = AbstractNotification.loadModule(modulePath, notificationOpts);
            }
        }
        return AbstractNotification.instance;
    }

    public send(notification: Notification): Promise<void> {
        // TODO add a limit "max messages per time per notification-type" in here instead of classes outside
        notification.title = this.getBotDirName() + " " + notification.title;
        return this.sendNotification(notification);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected abstract sendNotification(notification: Notification): Promise<void>;

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