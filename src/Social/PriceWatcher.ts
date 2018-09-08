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
    protected coinMarketCap = new CoinMarketCap({apiKey: nconf.get("serverConfig:apiKey:coinMarketCap:apiKey")});

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

        /*
        const url = nconf.get("serverConfig:crawlPricesUrl")
        let httpOptions = CoinMarketCap.getHttpOptions();
        utils.getPageCode(url, (body, response) => {
            if (body === false)
                return logger.error("Error crawling price data from %s", url, response)
            let json = utils.parseJson(body);
            if (!json || !json.data)
                return logger.error("Received invalid price data JSON from %s", url)
        */
        this.coinMarketCap.listCurrencies().then((list) => {
            let infos = []
            let btcUsdRate = 0.0;
            //json.data.forEach((coinPriceData) => {
            //for (let prop in json.data)
            for (let coinPriceData of list.data)
            {
                //const coinPriceData = json.data[prop]; // indexed by the number (id?) as key. very strange
                let currency = this.coinMarketCap.currencyFromCoinMarketCapSymbol(coinPriceData.symbol);
                if (!currency)
                    continue;
                let info = new CoinMarketInfo.CoinMarketInfo(currency);
                /*
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
                */
                info.priceUSD = coinPriceData.quote.USD.price;
                //info.priceBTC = coinPriceData.quote.BTC.price; // TODO upgrade plan to allow multiple conversions
                info.priceBTC = 0.0;
                if (btcUsdRate !== 0.0)
                    info.priceBTC = info.priceUSD / btcUsdRate;
                else if (info.currency !== Currency.Currency.BTC)
                    logger.error("BTC rate not available for conversion for currency %s", Currency[info.currency]);
                info.volume24hUSD = coinPriceData.quote.USD.volume_24h;
                info.marketCapUSD = coinPriceData.quote.USD.market_cap;
                info.availableSupply = coinPriceData.circulating_supply;
                info.totalSupply = coinPriceData.total_supply;
                info.percentChange1h = coinPriceData.quote.USD.percent_change_1h;
                info.percentChange24h = coinPriceData.quote.USD.percent_change_24h;
                info.percentChange7d = coinPriceData.quote.USD.percent_change_7d;
                info.lastUpdated = new Date(coinPriceData.last_updated) // from ISO string
                infos.push(info)
                if (btcUsdRate === 0.0 && info.currency === Currency.Currency.BTC)
                    btcUsdRate = info.priceUSD; // the list is sorted by market cap, so BTC should be first (for now)
            }
            CoinMarketInfo.insert(db.get(), infos).then(() => {
                logger.verbose("Added %s price infos to database", infos.length)
            }).catch((err) => {
                logger.error("Error adding price infos to database", err)
            })
        }/*, httpOptions*/).catch((err) => {
            logger.error("Error crawling coin market cap currency price list", err)
        })
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
}