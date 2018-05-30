import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Candle, Order, Funding, SocialPost, TrollShout, CoinMarketInfo, SocialAction} from "@ekliptor/bit-models";
import {AbstractSubController} from "../AbstractSubController";
import {SocialConfig} from "./SocialConfig";
import {CoinMarketCap} from "./CoinMarketCap";
import * as helper from "../utils/helper";
import * as db from "../database";
import * as argvFunction from "minimist";
const argv = argvFunction(process.argv.slice(2));


export class PriceWatcher extends AbstractSubController {
    protected lastCleanupMarketInfoCollections = new Date();
    protected lastCrawledPrices = new Date(0);

    constructor() {
        super()
    }

    public process() {
        return new Promise<void>((resolve, reject) => {
            if (argv.c && argv.c !== "Price")
                return resolve();
            this.crawlPriceData();
            this.cleanupOldPriceData();
            resolve();
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected crawlPriceData() {
        // TODO function to delete old data?
        if (this.lastCrawledPrices.getTime() + nconf.get("serverConfig:crawlPricesMin")*utils.constants.MINUTE_IN_SECONDS*1000 > Date.now())
            return;
        this.lastCrawledPrices = new Date();

        const url = nconf.get("serverConfig:crawlPricesUrl")
        let httpOptions = CoinMarketCap.getHttpOptions();
        utils.getPageCode(url, (body, response) => {
            if (body === false)
                return logger.error("Error crawling price data from %s", url, response)
            let json = utils.parseJson(body);
            if (!json || !json.data)
                return logger.error("Received invalid price data JSON from %s", url)
            let infos = []
            //json.data.forEach((coinPriceData) => {
            for (let prop in json.data)
            {
                const coinPriceData = json.data[prop]; // indexed by the number (id?) as key. very strange
                let currency = this.currencyFromCoinMarketCapSymbol(coinPriceData.symbol);
                if (!currency)
                    return;
                let info = new CoinMarketInfo.CoinMarketInfo(currency);
                info.priceUSD = helper.parseFloatVal(coinPriceData.price_usd);
                info.priceBTC = helper.parseFloatVal(coinPriceData.price_btc);
                info.volume24hUSD = helper.parseFloatVal(coinPriceData["24h_volume_usd"]);
                info.marketCapUSD = helper.parseFloatVal(coinPriceData.market_cap_usd);
                info.availableSupply = helper.parseFloatVal(coinPriceData.available_supply);
                info.totalSupply = helper.parseFloatVal(coinPriceData.total_supply);
                info.percentChange1h = helper.parseFloatVal(coinPriceData.percent_change_1h);
                info.percentChange24h = helper.parseFloatVal(coinPriceData.percent_change_24h);
                info.percentChange7d = helper.parseFloatVal(coinPriceData.percent_change_7d);
                info.lastUpdated = new Date(helper.parseFloatVal(coinPriceData.last_updated) * 1000); // from unix timestamp string
                infos.push(info)
            }
            CoinMarketInfo.insert(db.get(), infos).then(() => {
                logger.verbose("Added %s price infos to database", infos.length)
            }).catch((err) => {
                logger.error("Error adding price infos to database", err)
            })
        }, httpOptions)
    }

    protected cleanupOldPriceData() {
        if (this.lastCleanupMarketInfoCollections.getTime() + nconf.get("serverConfig:cleanupPriceDataIntervalDays")*utils.constants.DAY_IN_SECONDS*1000 > Date.now())
            return;
        this.lastCleanupMarketInfoCollections = new Date();
        let collection = db.get().collection(CoinMarketInfo.COLLECTION_NAME);
        const maxAge = new Date(Date.now() - nconf.get("serverConfig:priceDataDeleteOldDays")*utils.constants.DAY_IN_SECONDS*1000)
        collection.deleteMany({
            added: {$lt: maxAge}
        }, (err, result) => {
            if (err)
                return logger.error("Error deleting old price data", err);
            logger.verbose("Deleted old price data")
        })
    }

    protected currencyFromCoinMarketCapSymbol(currencyStr: string): Currency.Currency {
        switch (currencyStr)
        {
            case "NEO":     return Currency.Currency.NEO;
            case "VEN":     return Currency.Currency.VET;
            default:
                let currency = Currency.Currency[currencyStr];
                if (currency)
                    return currency;
                let currencyAlternative = Currency.getAlternativSymbol(currencyStr)
                if (currencyAlternative) {
                    currency = Currency.Currency[currencyAlternative];
                    if (currency)
                        return currency;
                }
                logger.warn("Unable to convert CoinMarketCap currency (not supported?) %s", currencyStr)
                return 0;
        }
    }
}