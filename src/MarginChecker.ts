import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractSubController} from "./AbstractSubController";
import {AbstractExchange, ExchangeMap} from "./Exchanges/AbstractExchange";
import {AbstractStrategy} from "./Strategies/AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";
import {AbstractNotification} from "./Notifications/AbstractNotification";
import Notification from "./Notifications/Notification";
import * as path from "path";


export default class MarginChecker extends AbstractSubController {
    //public static readonly MARGIN_NOTIFY = 0.26; // set per exchange in serverConfig
    public static readonly MARGIN_CHECK_INTERVAL_SEC = 120;

    protected exchanges: ExchangeMap; // (exchange name, instance)
    protected lastCheck: Date = null;
    protected notifier: AbstractNotification;
    protected lastNotification: Date = null;

    constructor(exchanges: ExchangeMap) {
        super()
        this.exchanges = exchanges;
        this.lastCheck = new Date(); // set checked on start to avoid checking immediately (causes nonce error on bitfinex during auth)
        this.notifier = AbstractNotification.getInstance();
    }

    public process() {
        return new Promise<void>((resolve, reject) => {
            if (!nconf.get('serverConfig:checkMargins') || /*nconf.get('trader') === "Backtester"*/nconf.get('trader') !== "RealTimeTrader")
                return resolve();

            this.checkMargins().then(() => {
                resolve()
            }).catch((err) => {
                logger.error("Error checking margins", err)
                resolve() // continue
            })
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkMargins() {
        return new Promise<void>((resolve, reject) => {
            if (this.lastCheck && this.lastCheck.getTime() + MarginChecker.MARGIN_CHECK_INTERVAL_SEC * 1000 > Date.now())
                return resolve()

            let checkOps = []
            for (let ex of this.exchanges)
            {
                if (ex[1].marginTradingSupport() && ex[1].getMarginNotification())
                    checkOps.push(this.checkExchangeMargin(ex[1]))
            }
            Promise.all(checkOps).then(() => {
                this.lastCheck = new Date();
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected checkExchangeMargin(exchange: AbstractExchange) {
        return new Promise<void>((resolve, reject) => {
            exchange.getMarginAccountSummary().then((account) => {
                //console.log(Currency.toExchange(2, null)) // prints LTC
                //console.log(Currency.fromExchange("LTC", null)) // prints 2

                let margin = account.currentMargin
                if (margin !== Number.NaN && margin < exchange.getMarginNotification())
                    this.notifyLowMargin(exchange.getClassName(), margin)
                return Promise.resolve(margin)
            }).then((margin) => {
                logger.verbose("Checked %s margin: %s", exchange.getClassName(), margin)
                resolve()
            }).catch((err) => {
                logger.error("Error checking margin", err)
                resolve()
            })
        })
    }

    protected notifyLowMargin(exchangeName: string, margin: number) {
        const pauseMs = nconf.get('serverConfig:notificationPauseMin') * utils.constants.MINUTE_IN_SECONDS * 1000;
        if (this.lastNotification && this.lastNotification.getTime() + pauseMs > Date.now()) // TODO lastNotification per exchange?
            return;
        let headline = exchangeName + " Margin is low";
        let text = "Current margin is: " + (margin !== Number.NaN ? (margin * 100).toFixed(2) + "%" : "100%");
        let notification = new Notification(headline, text, true);
        this.notifier.send(notification).then(() => {
        }).catch((err) => {
            logger.error("Error sending %s notification", this.className, err)
        });
        this.lastNotification = new Date();
    }

}