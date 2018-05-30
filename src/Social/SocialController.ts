import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Candle, Order, Funding, SocialPost, TrollShout, CoinMarketInfo, SocialAction} from "@ekliptor/bit-models";
import {AbstractSubController} from "../AbstractSubController";
import {SocialConfig} from "./SocialConfig";
import * as fs from "fs";
import * as path from "path";
import * as db from "../database";
import * as argvFunction from "minimist";
const argv = argvFunction(process.argv.slice(2));
//import {AbstractCrawler} from "./Crawler/AbstractCrawler";
const AbstractCrawler = argv.noBrowser === true ? null : require("./Crawler/AbstractCrawler").AbstractCrawler;
//import {RawTelegramMessage, default as Telegram} from "./Crawler/Telegram";
const RawTelegramMessage = argv.noBrowser === true ? null : require("./Crawler/Telegram").RawTelegramMessage;
const Telegram = argv.noBrowser === true ? null : require("./Crawler/Telegram").default;
import {AbstractWebPlugin} from "./AbstractWebPlugin";
import {AbstractAdvisor} from "../AbstractAdvisor";
import {ExchangeMap} from "../Exchanges/AbstractExchange";
import {AbstractNotification} from "../Notifications/AbstractNotification";
import Notification from "../Notifications/Notification";
import * as helper from "../utils/helper";
import {PriceWatcher} from "./PriceWatcher";
import {TickerWatcher} from "./TickerWatcher";
import ExchangeController from "../ExchangeController";


export class CrawlerMap extends Map<string, /*AbstractCrawler*/AbstractWebPlugin> { // (class name, instance)
    constructor() {
        super()
    }
}
export interface SocialUpdate { // for SocialUpdater and here
    [network: string]: { // social network name from enum in uppercase
        postStats: { // Map converted to object (Maps can't be serialized to JSON)
            [currency: string]: SocialPost.SocialPostAggregate[]
        }
    }
}
export class SpikeNotification {
    created = new Date();
    constructor() {
    }
}
export class NotificationSpikeMap extends Map<string, SpikeNotification> { // (network-currency, data)
    constructor() {
        super()
    }
}

/**
 * Main controller class that starts crawling tasks.
 */
export class SocialController extends AbstractAdvisor {
    protected configs: SocialConfig[] = [];
    protected configFilename: string;
    protected errorState = false;
    protected exchangeController: ExchangeController;
    protected crawlers = new CrawlerMap();
    protected lastCleanupCollections = new Date(); // set to now to skip cleanup at startup
    protected lastCheckedSocialSpikes = new Date(/*0*/); // set to now or we get notifications on every restart and app starts slowly
    protected notifier: AbstractNotification;
    protected notifiedSpikes = new NotificationSpikeMap();
    protected priceWatcher = new PriceWatcher();
    protected tickerWatcher: TickerWatcher;

    constructor(configFilename: string, exchangeController: ExchangeController) {
        super()
        this.configFilename = configFilename;
        this.exchangeController = exchangeController;
        if (!this.configFilename) {
            logger.error("Please specify a config file with the command line option --config=")
            logger.error("example: --config=Reddit")
            this.waitForRestart();
            return
        }
        if (this.configFilename.substr(-5) !== ".json")
            this.configFilename += ".json";

        this.loadConfig();
        this.loadNotifier();
        if (this.errorState)
            return;
        this.tickerWatcher = new TickerWatcher(this.exchangeController);
    }

    public process() {
        return new Promise<void>((resolve, reject) => {
            if (this.errorState)
                return; // wait until restart
            if (!process.env.IS_CHILD) {
                this.cleanupOldData();
                this.checkSocialSpikes();
                this.priceWatcher.process();
                this.tickerWatcher.process();
            }
            resolve()
        })
    }

    public getCrawlers() {
        return this.crawlers;
    }

    public getConfigName() {
        return this.configFilename.replace(/\.json$/, "");
    }

    public getConfigs() {
        return this.configs;
    }

    public getTraders() {
        return []; // not available here
    }

    public getExchanges() {
        return new ExchangeMap(); // not available here
    }

    public unserializeStrategyData(json: any, filePath: string): boolean {
        // TODO
        return false;
    }

    public getAllCrawlerData() {
        return new Promise<SocialUpdate>((resolve, reject) => {
            const maxAge = new Date(Date.now() - nconf.get("serverConfig:postDisplayAgeDays")*utils.constants.DAY_IN_SECONDS*1000);
            let fetchOps = [];
            const networksEnabled: SocialPost.SocialNetwork[] = nconf.get("serverConfig:networksEnabled");
            networksEnabled.forEach((network) => {
                fetchOps.push(SocialPost.getRecentPostStats(db.get(), network, maxAge, nconf.get("serverConfig:postDisplayAgeDays")));
                if (network === SocialPost.SocialNetwork.TELEGRAM)
                    fetchOps.push(SocialPost.getRecentPostStats(db.get(), network, maxAge, nconf.get("serverConfig:postDisplayAgeDays"), false, "currenciesRaw"));
            })
            fetchOps.push(SocialPost.getRecentPostStats(db.get(), SocialAction.SocialActionType.News, maxAge, nconf.get("serverConfig:postDisplayAgeDays"), true));
            Promise.all(fetchOps).then((results) => {
                let update: SocialUpdate = {};
                results.forEach((result: SocialPost.SocialPostAggregateMap) => {
                    let networkStr = SocialPost.SocialNetwork[result.network];
                    if (result.network === SocialPost.SocialNetwork.TELEGRAM && update[networkStr]) {
                        // the 2nd telegram update (Promise.all() keeps the order for the result array)
                        networkStr = SocialPost.SocialNetwork[SocialPost.SocialNetwork.TELEGRAM_RAW];
                        result.network = SocialPost.SocialNetwork.TELEGRAM_RAW;
                    }
                    update[networkStr] = {postStats: result.toObject()};
                })
                resolve(update)
            }).catch((err) => {
                reject({txt: "Error getting crawler data", err: err})
            })
        })
    }

    public addTelegramMessage(message: RawTelegramMessage) {
        if (argv.noBrowser === true)
            return;
        let telegram = this.crawlers.get("Telegram");
        if (!telegram) {
            logger.error("Telegram class not loaded in controller. Can not forward message");
            return false;
        }
        return (telegram as Telegram).addMessage(message);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected loadConfig() {
        const filePath = path.join(utils.appDir, "config", "social", this.configFilename)
        let data = fs.readFileSync(filePath, {encoding: "utf8"});
        if (!data) {
            logger.error("Can not load config file under: %s", filePath)
            return this.waitForRestart()
        }
        let json = utils.parseJson(data);
        if (!json || !json.data) {
            logger.error("Invalid JSON in config file: %s", filePath)
            return this.waitForRestart()
        }

        json.data.forEach((conf) => {
            let config = new SocialConfig(conf, this.configFilename);
            this.configs.push(config)

            // we don't have exchanges to connect with strategies here
            // just load our crawlers. they handle all the data, sore it and emit events (for UI)
            this.loadPlugin(config, conf, "websites", "Crawler");
            this.loadPlugin(config, conf, "watchers", "Watcher");
        })

        this.logCrawlerSubscriptions();
    }

    protected loadPlugin(config: SocialConfig, conf: any, pluginType: string, moduleSubFolder: string) {
        if (argv.noBrowser === true) {
            logger.warn("Skipped loading %s plugin because browser is disabled", pluginType);
            return;
        }
        for (let className in conf[pluginType])
        {
            // in the parent process we load all classes once to get their config once.
            // then in the children every class has it's own child process
            if (process.env.IS_CHILD && process.env.CRAWLER_CLASS !== className)
                continue;
            else if (argv.c && argv.c !== className)
                continue;
            const modulePath = path.join(__dirname, moduleSubFolder, className)
            let crawlerInstance = this.loadModule<AbstractCrawler>(modulePath, conf[pluginType][className])
            if (!crawlerInstance)
                continue;
            this.crawlers.set(crawlerInstance.getClassName(), crawlerInstance);
            crawlerInstance.setSocialConfig(config);
            crawlerInstance.start().then((started) => {
                if (!started)
                    return logger.error("Error starting %s crawler", crawlerInstance.getClassName())
                logger.verbose("Started %s crawler", crawlerInstance.getClassName())
            }).catch((err) => {
                logger.error("Error during %s crawler startup", crawlerInstance.getClassName(), err)
            })
        }
    }

    protected logCrawlerSubscriptions() {
        let crawlerNames = []
        for (let crawler of this.crawlers)
            crawlerNames.push(crawler[0]);
        logger.info("Active social crawlers:", crawlerNames);
    }

    protected cleanupOldData() {
        if (this.lastCleanupCollections.getTime() + nconf.get("serverConfig:cleanupPostsIntervalDays")*utils.constants.DAY_IN_SECONDS*1000 > Date.now())
            return;
        this.lastCleanupCollections = new Date();
        //const networksEnabled: SocialPost.SocialNetwork[] = nconf.get("serverConfig:networksEnabled"); // just delete from all networks in 1 query
        let collection = db.get().collection(SocialPost.COLLECTION_NAME);
        const maxAge = new Date(Date.now() - nconf.get("serverConfig:postDeleteOldDays")*utils.constants.DAY_IN_SECONDS*1000)
        collection.deleteMany({
            date: {$lt: maxAge}
        }, (err, result) => {
            if (err)
                return logger.error("Error deleting old data from social posts", err);
            logger.verbose("Deleted old social post data")
        })
    }

    protected checkSocialSpikes() {
        if (this.lastCheckedSocialSpikes.getTime() + nconf.get("serverConfig:checkSocialSpikeMin")*utils.constants.MINUTE_IN_SECONDS*1000 > Date.now())
            return;
        this.lastCheckedSocialSpikes = new Date();
        this.getAllCrawlerData().then((data) => {
            const nowH = new Date().getUTCHours() + 1; // 1-24
            for (let networkStr in data)
            {
                const networkNr = SocialPost.SocialNetwork[networkStr];
                if (networkNr >= 100) // news sites and other aggregates
                    continue;
                let networkData = data[networkStr];
                for (let currencyStr in networkData.postStats)
                {
                    let currencyData: SocialPost.SocialPostAggregate[] = networkData.postStats[currencyStr];
                    if (currencyData.length < 2)
                        continue; // less than 2 days available
                    let today = currencyData[currencyData.length-1];
                    let yesterday = currencyData[currencyData.length-2];
                    let todayPosts = today.postCount + today.commentCount;
                    let yesterdayPosts = yesterday.postCount + yesterday.commentCount;
                    //console.log("checking %s %s %s", currencyStr, todayPosts, yesterdayPosts)
                    if (!this.hasEnoughPosts(networkNr, yesterdayPosts))
                        continue;
                    // extrapolate today's posts to 24h to notice a trend sooner
                    let todayPostsExtrapolated = Math.floor(todayPosts / nowH * 24);
                    if (todayPostsExtrapolated >= yesterdayPosts * nconf.get('serverConfig:postTodayIncreaseFactor'))
                        this.sendSocialSpikeNotification(networkStr, currencyStr, yesterdayPosts, todayPosts, todayPostsExtrapolated);
                }
            }
        }).catch((err) => {
            logger.error("Error getting crawler data to check for social spikes", err)
        })
    }

    protected hasEnoughPosts(network: SocialPost.SocialNetwork, yesterdayPosts: number) {
        const minPosts = nconf.get("serverConfig:minPostsDayBefore")
        switch (network)
        {
            case SocialPost.SocialNetwork.TWITTER:          return yesterdayPosts >= minPosts.twitter;
            case SocialPost.SocialNetwork.TELEGRAM:         return yesterdayPosts >= minPosts.telegram;
            default:                                        return yesterdayPosts >= minPosts.other;
        }
    }

    protected sendSocialSpikeNotification(networkStr: string, currencyStr: string, yesterdayPosts: number, todayPosts: number, todayPostsExtrapolated: number) {
        const key = networkStr + "-" + currencyStr;
        let lastNotification = this.notifiedSpikes.get(key);
        if (lastNotification && lastNotification.created.getTime() + nconf.get("serverConfig:spikeNotificationRepeatHours")*utils.constants.HOUR_IN_SECONDS*1000 > Date.now())
            return;
        this.notifiedSpikes.set(key, new SpikeNotification());
        const extrapolatedPercentIncrease = utils.calc.round(helper.getDiffPercent(todayPostsExtrapolated, yesterdayPosts), 2);
        let message = utils.sprintf("POSTS: yesterday %s, today %s, today extrapolated %s (+%s%%)", yesterdayPosts, todayPosts, todayPostsExtrapolated, extrapolatedPercentIncrease);
        this.sendNotification(utils.sprintf("%s %s activity spike", networkStr, currencyStr), message);
    }

    protected loadNotifier() {
        this.notifier = AbstractNotification.getInstance();
    }

    protected sendNotification(headline: string, text: string = "-", requireConfirmation = false) {
        // note that pushover won't accept empty message text
        //const pauseMs = nconf.get('serverConfig:notificationPauseMin') * utils.constants.MINUTE_IN_SECONDS * 1000;
        //if (this.lastNotification && this.lastNotification.getTime() + pauseMs > Date.now())
            //return;
        //headline = this.className + ": " + headline;
        let notification = new Notification(headline, text, requireConfirmation);
        this.notifier.send(notification).then(() => {
        }).catch((err) => {
            logger.error("Error sending %s notification", this.className, err)
        });
        //this.lastNotification = new Date();
    }

    protected waitForRestart() {
        this.errorState = true;
        //process.exit(1) // don't exit or else we can't restart it via http API
        logger.error("App entered error state. Please restart the app")
    }
}