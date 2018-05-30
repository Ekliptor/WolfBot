import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Candle, Order, Ticker, TickerVolumeSpike, Funding, SocialPost, TrollShout, CoinMarketInfo, SocialAction} from "@ekliptor/bit-models";
import {AbstractSubController} from "../AbstractSubController";
import {SocialConfig} from "./SocialConfig";
import * as argvFunction from "minimist";
import ExchangeController from "../ExchangeController";
import {ExternalTickerExchange, isExternalTickerExchange} from "../Exchanges/ExternalTickerExchange";
import * as db from "../database";
import * as path from "path";
import {SpikeNotification} from "./SocialController";
import Notification from "../Notifications/Notification";
import {AbstractNotification} from "../Notifications/AbstractNotification";
import {AbstractExchange} from "../Exchanges/AbstractExchange";
const argv = argvFunction(process.argv.slice(2));


//
/**
 * Load exchange tickers every x hours and look for volume spikes.
 */
export class TickerWatcher extends AbstractSubController {
    protected exchangeController: ExchangeController;
    protected lastCleanupTickers = new Date();
    protected lastCrawledTickers = new Date(0);
    protected notifier: AbstractNotification;

    constructor(exchangeController: ExchangeController) {
        super()
        this.exchangeController = exchangeController;
        this.loadNotifier();
    }

    public process() {
        return new Promise<void>((resolve, reject) => {
            if (argv.c && argv.c !== "Ticker")
                return resolve();
            this.crawlTickerData().then(() => {
                this.cleanupOldTickers();
                resolve();
            }).catch((err) => {
                logger.error("Error watching exchange tickers", err)
                resolve();
            });
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected async crawlTickerData() {
        if (this.lastCrawledTickers.getTime() + nconf.get("serverConfig:crawlTickerHours") * utils.constants.HOUR_IN_SECONDS * 1000 > Date.now())
            return;
        let ticker = await this.getMostRecentTicker();
        const addMsLastCrawled = (nconf.get("serverConfig:crawlTickerHours")-1) * utils.constants.HOUR_IN_SECONDS * 1000; // give 1 hour offset
        if (ticker && ticker.created.getTime() + addMsLastCrawled > Date.now()) {
            logger.verbose("Skipped crawling exchange ticker data because it has been crawled recently");
            this.lastCrawledTickers = ticker.created;
            return;
        }

        this.lastCrawledTickers = new Date();
        const exchangeNames: string[] = nconf.get("serverConfig:crawlTickerExchanges");
        let tickerOps = [];
        exchangeNames.forEach( (exchangeName) => {
            tickerOps.push(this.crawlExchangeTicker(exchangeName))
        })
        Promise.all(tickerOps).then(() => {
            logger.verbose("Updated exchange tickers")
        }).catch((err) => {
            logger.error("Error updating exchange tickers", err)
        })
    }

    protected crawlExchangeTicker(exchangeName) {
        return new Promise<void>((resolve, reject) => {
            let exchangeInstance: AbstractExchange;
            let ticker: Ticker.ExternalTickerMap;
            this.exchangeController.loadSingleExchange(exchangeName).then((ex) => {
                exchangeInstance = ex;
                if (!isExternalTickerExchange(exchangeInstance)) {
                    logger.error("Exchange %s doesn't support external exchange ticker", exchangeName);
                    return Promise.reject({txt: "Invalid exchange type"});
                }
                return exchangeInstance.getExternalTicker(nconf.get("serverConfig:requiredTickerCurrencies"))
            }).then((t) => {
                ticker = t;
                return this.checkTickerVolumeSpikes(ticker, exchangeInstance.getExchangeLabel())
            }).then(() => {
                return this.updateExchangeTicker(ticker);
            }).then(() => {
                resolve()
            }).catch((err) => {
                reject(err);
            })
        })
    }

    protected async checkTickerVolumeSpikes(ticker: Ticker.ExternalTickerMap, exchange: Currency.Exchange) {
        let collection = db.get().collection(Ticker.COLLECTION_NAME_EXTERNAL);
        // fetch as many tickers as we currently have. this way we get the most recent ticker of every currency pair
        // in case a currency is removed we get duplicates, in case a currency is added we can't compare it to history either way
        let docs = await collection.find({exchange: exchange}).sort({created: -1}).limit(ticker.size);
        let tickerHistory = Ticker.initManyExternal(docs);
        tickerHistory.forEach((last) => {
            let current = ticker.get(last.currencyPair);
            if (!current)
                return; // currency removed from exchange
            else if (!last.quoteVolume)
                return logger.error("No volume present on last %s ticker of %s", last.currencyPair, Currency.Exchange[exchange])
            // TODO require min volume in BTC/USD. but that might exclude the small and most profitable currencies
            // TODO compare to average volume of last tickers?
            const volumeSpike = current.quoteVolume / last.quoteVolume; // compare coin volumes
            const isRising = current.last >= last.last; // we can't short sell on small coins (not supported by exchanges)
            if (volumeSpike >= nconf.get("serverConfig:tickerVolumeSpikeFactor") && isRising) {
                let spike = new TickerVolumeSpike.TickerVolumeSpike(last, current);
                this.storeVolumeSpike(spike);
                this.sendTickerSpikeNotification(spike);
            }
        })
    }

    protected async updateExchangeTicker(ticker: Ticker.ExternalTickerMap) {
        let collection = db.get().collection(Ticker.COLLECTION_NAME_EXTERNAL);
        let tickerArr = Array.from(ticker.values());
        if (tickerArr.length === 0)
            return;
        await collection.insertMany(tickerArr);
    }

    protected async getMostRecentTicker(): Promise<Ticker.ExternalTicker> {
        let collection = db.get().collection(Ticker.COLLECTION_NAME_EXTERNAL); // use ticker because we might not store spikes for days
        let docs = await collection.find({}).sort({created: -1}).limit(1).toArray();
        if (!docs || docs.length === 0)
            return null;
        let ticker = Ticker.initExternal(docs[0]);
        return ticker;
    }

    protected storeVolumeSpike(spike: TickerVolumeSpike.TickerVolumeSpike) {
        let collection = db.get().collection(TickerVolumeSpike.COLLECTION_NAME);
        // overwrite to keep only the most recent one. also means we only keep 1 spike per currency pair
        collection.updateOne({
            exchange: spike.exchange,
            currencyPair: spike.currencyPair
        }, spike, {
            upsert: true
        }, (err, result) => {
            if (err)
                logger.error("Error storing volume spike", err);
        })
    }

    protected cleanupOldTickers() {
        if (this.lastCleanupTickers.getTime() + nconf.get("serverConfig:removeTickersIntervalDays")*utils.constants.DAY_IN_SECONDS*1000 > Date.now())
            return;
        this.lastCleanupTickers = new Date();
        let collection = db.get().collection(Ticker.COLLECTION_NAME_EXTERNAL);
        const maxAge = new Date(Date.now() - nconf.get("serverConfig:removeTickersDays")*utils.constants.DAY_IN_SECONDS*1000)
        collection.deleteMany({
            created: {$lt: maxAge}
        }, (err, result) => {
            if (err)
                return logger.error("Error deleting old exchange ticker data", err);
            logger.verbose("Deleted old exchange ticker data")
        })

        let collectionSpikes = db.get().collection(TickerVolumeSpike.COLLECTION_NAME);
        const maxAgeSpikes = new Date(Date.now() - nconf.get("serverConfig:removeVolumeSpikeDays")*utils.constants.DAY_IN_SECONDS*1000)
        collectionSpikes.deleteMany({
            date: {$lt: maxAgeSpikes}
        }, (err, result) => {
            if (err)
                return logger.error("Error deleting old volume spikes", err);
            logger.verbose("Deleted old volume spikes")
        })
    }

    protected sendTickerSpikeNotification(spike: TickerVolumeSpike.TickerVolumeSpike) {
        if (!nconf.get("serverConfig:notifyVolumeSpikes"))
            return;
        const spikeFormatted = Math.floor(spike.spikeFactor * 100) / 100.0;
        let message = utils.sprintf("TICKER volume %sx: previous %s, current %s, price change %s%% interval %sh", spikeFormatted, spike.lastTicker.quoteVolume,
            spike.currentTicker.quoteVolume, spike.priceChange.toFixed(2), nconf.get("serverConfig:crawlTickerHours"));
        this.sendNotification(utils.sprintf("%s %s volume spike", Currency.Exchange[spike.exchange], spike.currencyPair), message);
    }

    protected loadNotifier() {
        this.notifier = AbstractNotification.getInstance();
    }

    protected sendNotification(headline: string, text: string = "-", requireConfirmation = false) {
        let notification = new Notification(headline, text, requireConfirmation);
        if (nconf.get("debug")) // don't spam our phone when testing
            return logger.verbose("Skipped sending ticker notification in debug mode: %s", headline)
        this.notifier.send(notification).then(() => {
        }).catch((err) => {
            logger.error("Error sending %s notification", this.className, err)
        });
        //this.lastNotification = new Date();
    }
}