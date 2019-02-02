import * as utils from "@ekliptor/apputils";
import {AbstractSubController} from "./AbstractSubController";
const logger = utils.logger
    , nconf = utils.nconf;
import * as path from "path";
import {Currency, Trade, Candle, Order, Funding, serverConfig} from "@ekliptor/bit-models";
import * as crypto from "crypto";
import * as helper from "./utils/helper";
import {AbstractNotification} from "./Notifications/AbstractNotification";
import Notification from "./Notifications/Notification";
import {LoginData, LoginUpdateRes} from "./WebSocket/LoginUpdater";


export interface NodeConfigFile {
    id: number;
    url: string;
}
export class BotSubscription {
    id: number;
    url: string;
    expiration: Date;
    token: string = ""; // server-generated unique token per bot
    coupon: string = ""; // cooupon code
    discount: number = 0; // percentage of the discount with the coupon
    constructor(id: number, url: string, expiration: Date) {
        this.id = id;
        this.url = url;
        this.expiration = typeof expiration === "number" ? new Date(expiration*1000) : expiration;
    }
}

/**
 * Class to check if the login & subscription on wolfbot.org is valid.
 */
export class LoginController extends AbstractSubController {
    private static instance: LoginController = null;

    protected lastCheckedLogin = new Date(0);
    protected loginValid: boolean = false;
    protected subscriptionValid: boolean = false;
    protected nodeConfig: NodeConfigFile = null;
    protected subscription: BotSubscription = null;
    protected tokenGenerated = false;
    protected accountWasValid = false;
    protected notifier: AbstractNotification;
    protected sentExpirationMessage = false;
    protected static firstStart = false;

    constructor() {
        super()
        this.notifier = AbstractNotification.getInstance(true);
        this.loadConfig().then(() => {
            this.generateApiKeyOnFirstStart();
        }).catch((err) => {
            logger.error("Error loading node config on startup", err) // TODO send notification? premium login will most likely not work
        })
    }

    public static getInstance() {
        if (LoginController.instance === null)
            LoginController.instance = new LoginController();
        return LoginController.instance;
    }

    public isLoginValid() {
        if (nconf.get("serverConfig:premium") === false)
            return true;
        return this.loginValid;
    }

    public isSubscriptionValid() {
        if (nconf.get("serverConfig:premium") === false)
            return true;
        return this.subscriptionValid;
    }

    public getSubscription() {
        return this.subscription;
    }

    public process() {
        return new Promise<void>((resolve, reject) => {
            if (nconf.get("serverConfig:premium") === false ||
                !nconf.get("serverConfig:username") || !nconf.get("serverConfig:password") ||
                this.lastCheckedLogin.getTime() + nconf.get("serverConfig:checkLoginIntervalMin")*utils.constants.MINUTE_IN_SECONDS*1000 > Date.now()) {
                if (this.tokenGenerated === false) {
                    nconf.set("serverConfig:userToken", this.getUserToken());
                    this.tokenGenerated = true;
                }
                return resolve();
            }

            this.lastCheckedLogin = new Date();
            this.loadConfig().then(() => {
                return this.checkLogin();
            }).then(() => {
                resolve();
            }).catch((err) => {
                logger.error("Error checking cloud login", err);
                resolve()
            })
        })
    }

    public async login(loginData: LoginData) {
        nconf.set("serverConfig:username", loginData.username);
        nconf.set("serverConfig:password", loginData.password);
        try {
            await this.checkLogin();
            let res: LoginUpdateRes = {
                loginRes: {
                    loginValid: this.isLoginValid(),
                    subscriptionValid: this.isSubscriptionValid(),
                    apiKey: Object.keys(nconf.get("apiKeys"))[0]
                }
            }
            if (!res) {
                res.error = true;
                res.errorCode = "unknownError";
            }
            else if (res.loginRes.loginValid === false || res.loginRes.subscriptionValid === false) {
                res.error = true;
                res.errorCode = res.loginRes.loginValid === false ? "userNotFound" : "subscriptionNotFound";
            }
            serverConfig.saveConfigLocal();
            return res;
        }
        catch (err) {
            logger.error("Error checking new login data", err)
            //return null;
            let res: LoginUpdateRes = {
                loginRes: {
                    loginValid: false,
                    subscriptionValid: false,
                    apiKey: Object.keys(nconf.get("apiKeys"))[0]
                }
            }
            res.error = true;
            res.errorCode = "internalError";
            return res;
        }
    }

    /**
     * Verifies if the login is valid with the API server.
     * Call isLoginValid() after this function is done to see if the login is valid.
     * @returns {Promise<void>}
     */
    public checkLogin() {
        return new Promise<void>((resolve, reject) => {
            let data = {
                botID: this.nodeConfig.id,
                botApiKey: helper.getFirstApiKey(), // easier to just send the key every time
                apiKey: nconf.get("serverConfig:checkLoginApiKey"),
                username: nconf.get("serverConfig:username"),
                password: nconf.get("serverConfig:password"),
                // notification methods
                pushover: nconf.get("serverConfig:apiKey:notify:Pushover:receiver")
            }
            serverConfig.saveConfigLocal();
            logger.verbose("Checking cloud login validity of account");
            utils.postData(nconf.get("serverConfig:checkLoginUrl"), data, (body, response) => {
                if (body === false) {
                    //this.loginValid = false; // keep the previous setting. this is a server error and we will retry
                    return reject({txt: "Error contacting login API", err: response})
                }
                let json = utils.parseJson(body);
                if (json === null)
                    return reject({txt: "Invalid response from login API", res: body})
                if (json.error === true) {
                    if (this.usernameChanged() === true) {
                        logger.verbose("Keeping previous login after username change");
                        nconf.set("serverConfig:username", nconf.get("serverConfig:lastUsername"));
                        return reject({txt: "username changed"});
                    }
                    else {
                        this.loginValid = false;
                        this.subscriptionValid = false;
                        logger.info("Login to cloud API is not valid")
                    }
                }
                else if (Array.isArray(json.data) === true && json.data.length === 1 && json.data[0].data) {
                    this.loginValid = true;
                    nconf.set("serverConfig:lastUsername", nconf.get("serverConfig:username"));
                    //const registeredUsername = json.data[0].data.user_login;
                    if (Array.isArray(json.data[0].data.subscriptions) === true)
                        this.subscriptionValid = this.hasThisBotSubscription(json.data[0].data.subscriptions);
                    else
                        this.subscriptionValid = false;
                    if (this.subscriptionValid === false)
                        logger.info("Cloud bot subscription has expired")
                    else
                        logger.info("Cloud bot subscription is active")
                }
                else if (this.usernameChanged() === true) {
                    logger.verbose("Keeping previous login after username change with wrong credentials");
                    nconf.set("serverConfig:username", nconf.get("serverConfig:lastUsername"));
                    return reject({txt: "username changed"});
                }
                else {
                    this.loginValid = false;
                    this.subscriptionValid = false;
                    //logger.error("Received invalid response JSON from cloud login API", json) // wrong credentials
                }
                this.setLoggedIn();
                resolve()
            }, this.getPostOptions())
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected setLoggedIn() {
        logger.info("Logged in as %s, login valid %s, subscription valid %s", nconf.get("serverConfig:username"), this.isLoginValid(), this.isSubscriptionValid());
        const loggedIn = this.isLoginValid() && this.isSubscriptionValid();
        // send admin notification if subscription changed the state
        if (this.accountWasValid === true && loggedIn === false)
            this.sendAccountExpiredNotification();
        else if (this.accountWasValid === false && loggedIn === true)
            this.accountWasValid = true;
        nconf.set("serverConfig:loggedIn", loggedIn);
        nconf.set("serverConfig:userToken", this.getUserToken());
        // generate a new apiKey if login failed to ensure user can't access it anymore
        // (another user won't get this bot because we re-install the VM)
        if (nconf.get("serverConfig:premium") === true && loggedIn === false)
            this.generateApiKey();
        else if (Object.keys(nconf.get("apiKeys")).length === 0) // first start
            this.generateApiKey();
        serverConfig.saveConfigLocal();
    }

    protected hasThisBotSubscription(subscriptions: any[]) {
        for (let i = 0; i < subscriptions.length; i++)
        {
            const sub = subscriptions[i];
            if (/*sub.post_name !== "subscription" || */sub.post_type === "shop_subscription" && this.isActiveSubscriptionStatus(sub.post_status) === false)
                continue; // TODO ensure object is kept when switching from active
            else if (sub.post_type === "shop_order" && this.isCompletedOrder(sub.post_status) === false)
                continue;
            // check if we have a subscription for this bot instance
            if (sub.bot_url != null && typeof sub.bot_url === "object") {
                if (sub.bot_url.id === this.nodeConfig.id) {
                    this.subscription = new BotSubscription(sub.bot_url.id, sub.bot_url.url, sub.bot_url.expiration);
                    if (sub.bot_url.coupon) {
                        this.subscription.coupon = sub.bot_url.coupon;
                        this.subscription.discount = sub.bot_url.discount;
                    }
                    this.subscription.token = sub.bot_url.token;
                    return true;
                }
            }
        }
        return false;
    }

    protected isActiveSubscriptionStatus(status: string) {
        switch (status)
        {
            case "wc-active":
            case "wc-pending-cancel":
            case "wc-switched":
                return true;
        }
        return false;
    }

    protected isCompletedOrder(status: string) {
        switch (status)
        {
            case "wc-completed":
                return true;
        }
        return false;
    }

    protected async loadConfig(): Promise<void> {
        if (this.nodeConfig !== null || nconf.get("serverConfig:premium") === false)
            return; // only load it once
        let configFile = path.join(utils.appDir, "..", nconf.get("serverConfig:premiumConfigFileName"));
        try {
            let data = await utils.file.readFile(configFile)
            let json = utils.parseJson(data);
            if (json === null || typeof json.id !== "number")
                throw new Error("Invalid node config json")
            this.nodeConfig = json;
        }
        catch (err) {
            logger.error("Error reading node config file %s", configFile, err)
            throw err; // don't login
        }
    }

    protected generateApiKey() {
        const random = utils.getRandomString(20, false);
        let keys: any = {}
        keys[random] = true;
        nconf.remove("apiKeys"); // can't delete config from .ts file. config from .json is overwritten. always remove because we don't allow multiple keys
        nconf.set("apiKeys", keys);
        serverConfig.saveConfigLocal();
        if (nconf.get("serverConfig:premium") === true)
            this.updateApiKey();
    }

    protected updateApiKey() {
        let data = {
            apiKey: nconf.get("serverConfig:checkLoginApiKey"),
            username: nconf.get("serverConfig:username"),
            password: nconf.get("serverConfig:password"),
            botID: this.nodeConfig.id,
            botApiKey: helper.getFirstApiKey()
        }
        logger.verbose("Submitting new bot API key");
        utils.postData(nconf.get("serverConfig:updateApiKeyUrl"), data, (body, response) => {
            if (body === false)
                return logger.error("Error contacting cloud bot API to update key", response);
            let json = utils.parseJson(body);
            if (json === null)
                return logger.error("Invalid response from cloud bot API", body);
            if (json.error === true)
                return logger.info("Error updating API key via cloud API", json);
            logger.verbose("Updated cloud API key")
        }, this.getPostOptions())
    }

    /**
     * Generate a token that is unique for this bot instance and user.
     */
    protected getUserToken() {
        let secret = nconf.get("serverConfig:userTokenSeed") + utils.appDir + nconf.get("serverConfig:username");
        let hash = crypto.createHash('sha512').update(secret, 'utf8').digest('hex');
        return utils.toBase64(hash, 'hex'); // use the URL safe version of base64
    }

    protected generateApiKeyOnFirstStart() {
        LoginController.firstStart = this.isFirstStart();
        if (LoginController.firstStart === true) {
            nconf.set("serverConfig:firstStart", new Date());
            if (nconf.get("serverConfig:premium") === true)
                this.generateApiKey(); // make sure every bot has a different default API key
        }
    }

    protected isFirstStart() {
        const firstStart = nconf.get("serverConfig:firstStart");
        if (firstStart)
            return false;
        return true;
    }

    protected getPostOptions() {
        return {
            cloudscraper: true,
            urlencoded: true // must be true with cloudscraper
        }
    }

    protected sendAccountExpiredNotification() {
        if (this.sentExpirationMessage === true)
            return;
        let message = "";
        if (this.subscription)
            message = utils.sprintf("User: %s\r\nExpiration date: %s\r\nBot ID: %s", nconf.get("serverConfig:username"),
                utils.date.toDateTimeStr(this.subscription.expiration, true), this.subscription.id);
        else
            message = utils.sprintf("User: %s\r\nNo subscription data loaded", nconf.get("serverConfig:username"));
        let notification = new Notification("Subscription expired", message, false);
        this.notifier.send(notification).then(() => {
        }).catch((err) => {
            logger.error("Error sending %s notification", this.className, err)
        });
        this.sentExpirationMessage = true;
    }

    protected usernameChanged() {
        if (!nconf.get("serverConfig:lastUsername"))
            return false;
        return nconf.get("serverConfig:lastUsername") !== nconf.get("serverConfig:username")
    }
}