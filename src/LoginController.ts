import * as utils from "@ekliptor/apputils";
import {AbstractSubController} from "./AbstractSubController";
const logger = utils.logger
    , nconf = utils.nconf;
import * as path from "path";
import {Currency, Trade, Candle, Order, Funding, serverConfig} from "@ekliptor/bit-models";
import * as crypto from "crypto";


export interface NodeConfigFile {
    id: number;
    url: string;
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
    protected tokenGenerated = false;

    constructor() {
        super()
        this.loadConfig().catch((err) => {
            logger.error("Error loading node config on startup", err)
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

    /**
     * Verifies if the login is valid with the API server.
     * Call isLoginValid() after this function is done to see if the login is valid.
     * @returns {Promise<void>}
     */
    public checkLogin() {
        return new Promise<void>((resolve, reject) => {
            let data = {
                apiKey: nconf.get("serverConfig:checkLoginApiKey"),
                username: nconf.get("serverConfig:username"),
                password: nconf.get("serverConfig:password")
            }
            serverConfig.saveConfigLocal();
            let options = {
                cloudscraper: true,
                urlencoded: true // must be true with cloudscraper
            }
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
                    this.loginValid = false;
                    this.subscriptionValid = false;
                    logger.info("Login to cloud API is not valid")
                }
                else if (Array.isArray(json.data) === true && json.data.length === 1 && json.data[0].data) {
                    this.loginValid = true;
                    if (Array.isArray(json.data[0].data.subscriptions) === true)
                        this.subscriptionValid = this.hasThisBotSubscription(json.data[0].data.subscriptions);
                    else
                        this.subscriptionValid = false;
                    if (this.subscriptionValid === false)
                        logger.info("Cloud bot subscription has expired")
                    else
                        logger.info("Cloud bot subscription is active")
                }
                else {
                    this.loginValid = false;
                    this.subscriptionValid = false;
                    //logger.error("Received invalid response JSON from cloud login API", json) // wrong credentials
                }
                this.setLoggedIn();
                resolve()
            }, options)
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected setLoggedIn() {
        const loggedIn = this.isLoginValid() && this.isSubscriptionValid();
        nconf.set("serverConfig:loggedIn", loggedIn);
        nconf.set("serverConfig:userToken", this.getUserToken());
        // generate a new apiKey if login failed to ensure user can't access it anymore
        // (another user won't get this bot because we re-install the VM)
        if (nconf.get("serverConfig:premium") === true && loggedIn === false)
            this.generateApiKey();
        else if (Object.keys(nconf.get("apiKeys")).length === 0) // first start
            this.generateApiKey();
    }

    protected hasThisBotSubscription(subscriptions: any[]) {
        for (let i = 0; i < subscriptions.length; i++)
        {
            const sub = subscriptions[i];
            if (/*sub.post_name !== "subscription" || */sub.post_type !== "shop_subscription" || this.isActiveSubscriptionStatus(sub.post_status) === false)
                continue;
            // check if we have a subscription for this bot instance
            if (sub.bot_url && typeof sub.bot_url === "object") {
                if (sub.bot_url.id === this.nodeConfig.id)
                    return true;
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
    }

    protected getUserToken() {
        let secret = nconf.get("serverConfig:userTokenSeed") + utils.appDir + nconf.get("serverConfig:username");
        let hash = crypto.createHash('sha512').update(secret, 'utf8').digest('hex');
        return utils.toBase64(hash, 'hex'); // use the URL safe version of base64
    }
}