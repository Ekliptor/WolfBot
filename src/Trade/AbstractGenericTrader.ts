import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as EventEmitter from 'events';
import {Trade, Order, Currency, Candle, serverConfig} from "@ekliptor/bit-models";
import {AbstractExchange, ExchangeMap, OrderParameters} from "../Exchanges/AbstractExchange";
import * as fs from "fs";
import {CoinMap} from "./PortfolioTrader";
import {AbstractNotification} from "../Notifications/AbstractNotification";
import {default as Notification} from "../Notifications/Notification";


export class ActiveTradesMap extends Map<string, boolean> { // (currency (pair) name, true)
    constructor() {
        super()
    }
}

export abstract class AbstractGenericTrader extends EventEmitter {
    protected className: string;
    protected exchanges: ExchangeMap; // (exchange name, instance)
    protected isTrading: ActiveTradesMap = new ActiveTradesMap();
    protected pausedTrading = nconf.get("serverConfig:pausedTrading"); // trader instance (thus this value) not loaded if no valid config present
    protected restartPausedTimerID: NodeJS.Timer = null;
    protected tradeNotifier: AbstractGenericTrader = null; // TradeNotifier
    protected notifiedPaused: boolean = false;
    protected static notifiedApiErrorExchanges = new Set<string>();

    protected logQueue = Promise.resolve();
    protected logPath: string = ""; // set this to a file to log trades
    protected tradesLog: string[] = [];
    protected marketTime: Date = null; // for backtesting we log the market time in trades log
    protected recordMyTrades = false; // store all trades in "myTrades" (in PortfolioTrader)

    constructor() {
        super()
        this.className = this.constructor.name;

        this.setMaxListeners(nconf.get('maxEventListeners'));
        setTimeout(this.prepareLogFile.bind(this), 0); // wait until child constructor has finished
    }

    public getClassName() {
        return this.className;
    }

    public getMarketTime() {
        return this.marketTime;
    }

    public sendCandleTick(candle: Candle.Candle) {
        // overwrite this in the subclass if you need candles (mostly for stats)
        // the order of candles is in ascending time (just as the market data)
    }

    public setPausedTrading(paused: boolean) {
        this.pausedTrading = paused;
        if (this.tradeNotifier) // notifier will always send notifications, but needs to know when positions can be out of sync
            this.tradeNotifier.setPausedTrading(paused);
        /*
        if (!this.pasuedTrading || !nconf.get("serverConfig:restartPausedBotsMin")) {
            clearTimeout(this.restartPausedTimerID);
            return;
        }
        this.restartPausedTimerID = setTimeout(() => {
            Controller.restart(); // TODO we have to implement a flag to restart the bot paused
        }, nconf.get("serverConfig:restartPausedBotsMin")*utils.constants.MINUTE_IN_SECONDS*1000)
        */
        nconf.set("serverConfig:pausedTrading", paused)
        serverConfig.saveConfigLocal();
    }

    public getPausedTrading() {
        return this.pausedTrading;
    }

    public getExchanges() {
        return this.exchanges;
    }

    // usually from a static variable, but abstract static is not possible
    public abstract getBalances(): CoinMap;
    //public abstract getBalancesTaken(): CoinMap; // in subclass

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected writeLogLine(logLine: string) {
        const date = this.marketTime ? this.marketTime : new Date();
        logLine = utils.getUnixTimeStr(true, date) + ": " + logLine;
        if (this.recordMyTrades === true)
            this.tradesLog.push(logLine)
        if (!this.logPath)
            return;
        this.logQueue = this.logQueue.then(() => { // chain it to the queue. promise will always end in resolved state and then we can write again
            return new Promise<void>((resolve, reject) => {
                fs.appendFile(this.logPath, logLine + "\r\n", (err) => {
                    if (err)
                        logger.error("Error writing to logfile", err);
                    this.emit("log", logLine);
                    resolve() // we can now write more
                })
            })
        })
    }

    protected prepareLogFile() {
        const msg = utils.sprintf("START TRADING IN %s", this.className);
        if (!this.logPath || !nconf.get('serverConfig:removeOldLog')) {
            this.writeLogLine(msg)
            return;
        }
        fs.unlink(this.logPath, (err) => {
            // err when no logfile exists
            this.writeLogLine(msg) // TODO add exchange name and currency pair
        })
    }

    protected getExchangeName(exchange: Currency.Exchange) {
        for (let ex of Currency.ExchangeName)
        {
            if (ex[1] == exchange)
                return ex[0];
        }
        logger.warn("Exchange %s not found in exchange map", exchange.toString());
        return "";
    }

    protected checkSendPausedNotification(message: string, currencyStr: string) {
        if (this.notifiedPaused === true/* || this.tradeNotifier === null*/ || nconf.get("debug") === true)
            return;
        this.notifiedPaused = true;
        let notifier = AbstractNotification.getInstance();
        let notification = new Notification(utils.sprintf("%s trading is paused", currencyStr), message, true);
        notifier.send(notification).catch((err) => {
            logger.error("Error sending trading paused notification", err);
        });
    }

    protected sendApiErrorNotification(message: string, exchange: AbstractExchange) {
        if (AbstractGenericTrader.notifiedApiErrorExchanges.has(exchange.getClassName()) === true || nconf.get("debug") === true)
            return;
        AbstractGenericTrader.notifiedApiErrorExchanges.add(exchange.getClassName());
        let notifier = AbstractNotification.getInstance();
        message += "\r\nTrading might be impacted currently!";
        let notification = new Notification("Exchange API Error", message, false);
        notifier.send(notification).catch((err) => {
            logger.error("Error sending trading paused notification", err);
        });
    }

    protected loadModule(modulePath: string, options = undefined) {
        try {
            let ModuleClass = require(modulePath)
            if (ModuleClass.default)
                ModuleClass = ModuleClass.default; // fix for typescript default exports
            let instance = new ModuleClass(options)
            return instance
        }
        catch (e) { // e.code === 'MODULE_NOT_FOUND'
            logger.error('failed to load module in %s: %s', this.className, modulePath, e)
            return null
        }
    }
}
