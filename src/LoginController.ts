import * as utils from "@ekliptor/apputils";
import {AbstractSubController} from "./AbstractSubController";
const logger = utils.logger
    , nconf = utils.nconf;


/**
 * Class to check if the login & subscription on wolfbot.org is valid.
 */
export class LoginController extends AbstractSubController {
    private static instance: LoginController = null;

    protected lastCheckedLogin = new Date(0);
    protected loginValid: boolean = false;
    protected subscriptionValid: boolean = false;

    constructor() {
        super()
        this.setLoggedIn();
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
                this.lastCheckedLogin.getTime() + nconf.get("serverConfig:checkLoginIntervalMin")*utils.constants.MINUTE_IN_SECONDS*1000 > Date.now())
                return resolve()

            this.lastCheckedLogin = new Date();
            this.checkLogin().then(() => {
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
            let options = {
                cloudscraper: true
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
                else if (Array.isArray(json.data) === true && json.data.length === 1 && json.data[0].user &&
                    Array.isArray(json.data[0].user.subscriptions) === true) {
                    this.loginValid = true;
                    this.subscriptionValid = this.hasThisBotSubscription(json.data[0].user.subscriptions);
                    if (this.subscriptionValid === false)
                        logger.info("Cloud bot subscription has expired")
                    else
                        logger.info("Cloud bot subscription is active")
                }
                else {
                    this.loginValid = false;
                    this.subscriptionValid = false;
                    logger.error("Received invalid response JSON from cloud login API", json)
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
            // TODO check some meta info (such as post_content) to identify this bot instance
            return true;
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

    protected generateApiKey() {
        // TODO
    }
}