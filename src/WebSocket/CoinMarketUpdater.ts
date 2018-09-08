import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Candle, Order, Funding, SocialPost, TrollShout, Ticker, TickerVolumeSpike, CoinMarketInfo} from "@ekliptor/bit-models";
import * as WebSocket from "ws";
import * as http from "http";
import * as db from "../database";
import {ServerSocketPublisher, ServerSocket} from "./ServerSocket";
import {AppPublisher} from "./AppPublisher";
import {WebSocketOpcode} from "./opcodes";
import {SocialController} from "../Social/SocialController";


export class CoinPriceMap extends Map<string, number[]> { // (currency, price)
    constructor() {
        super()
    }
}
export class LastPriceMap extends Map<string, number> { // (currency, price)
    constructor() {
        super()
    }
}
export class VolumeSpikeMap extends Map<string, TickerVolumeSpike.TickerVolumeSpike[]> { // (exchange name, spike)
    constructor() {
        super()
    }
}
export interface TickIndicatorCurrencies { // TICK indicator
    usd: number[];
    btc: number[];
}
export interface CoinMarketUpdate {
    //coinStats: CoinMarketInfo.CoinMarketInfo[]; // Map converted to object (Maps can't be serialized to JSON)
    coinStats: CoinPriceMap;
    volumeSpikes: VolumeSpikeMap; // TODO send less data?
    tick: TickIndicatorCurrencies;
}

export class CoinMarketUpdater extends AppPublisher {
    public readonly opcode = WebSocketOpcode.COINMARKET;
    protected socialController: SocialController;
    protected maxTickDate = new Date(0);

    constructor(serverSocket: ServerSocket, socialController: SocialController) {
        super(serverSocket, socialController)
        this.socialController = socialController;
        this.publishCoinInfos();
    }

    public onSubscription(clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        this.getCoinInfos().then((data) => {
            this.send(clientSocket, {
                maxAge: this.getMaxAge(),
                days: nconf.get("serverConfig:coinMarketInfoDisplayAgeDays"),
                tickHours: nconf.get("serverConfig:coinsTickIndicatorHours"),
                maxTickDate: this.maxTickDate,
                serverDate: new Date(),
                crawlTickerHours: nconf.get("serverConfig:crawlTickerHours")
            });
            this.send(clientSocket, {full: data});
        }).catch((err) => {
            logger.error("Error getting coin market data for client", err)
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected publishCoinInfos() {
        // no incremental updates yet. we just publish the full data
        let publish = () => {
            if (this.skipPublishing())
                return setTimeout(publish.bind(this), nconf.get("serverConfig:socialUpdateSecUI")*1000);
            this.getCoinInfos().then((data) => {
                this.publish({full: data}) // gets only called for connected clients
                setTimeout(publish.bind(this), nconf.get("serverConfig:socialUpdateSecUI")*1000)
            }).catch((err) => {
                logger.error("Error publishing coin market updates", err)
                setTimeout(publish.bind(this), nconf.get("serverConfig:socialUpdateSecUI")*1000) // don't repeat it immediately in case DB is overloaded
            })
        }
        publish();
    }

    protected getCoinInfos() {
        return new Promise<CoinMarketUpdate>((resolve, reject) => {
            let coinPriceMap = new CoinPriceMap();
            let coinDataMap: CoinMarketInfo.CoinMarketInfoMap;
            const priceComparisonCoins: Currency.Currency[] = nconf.get("serverConfig:priceComparisonCoins");
            CoinMarketInfo.getLatestData(db.get(), this.getMaxAge()).then((cM) => {
                coinDataMap = cM;
                //resolve({coinStats: coinDataMap.toObject()})
                const dataPointCount = nconf.get("serverConfig:coinMarketInfoDisplayAgeDays") * 24;
                for (let coin of coinDataMap) {
                    const currencyStr = coin[0];
                    let coinInfoArr = coin[1];
                    //if (currencyStr === "BTC")
                        //console.log(coinInfoArr)
                    if (priceComparisonCoins.indexOf(Currency.Currency[currencyStr]) === -1)
                        continue;
                    let prices = coinInfoArr.map(info => info.priceUSD);
                    if (coinInfoArr.length !== 0) {
                        let latest = coinInfoArr[coinInfoArr.length-1];
                        let latestDate = utils.date.dateFromUtc(latest.year, latest.month, latest.day, latest.hour);
                        if (this.maxTickDate.getTime() < latestDate.getTime())
                            this.maxTickDate = latestDate;
                    }
                    while (prices.length < dataPointCount)
                        prices.unshift(0.0);
                    coinPriceMap.set(currencyStr, prices);
                }
                return this.getTopVolumeSpikes()
            }).then((spikeMap) => {
                resolve({
                    coinStats: coinPriceMap.toObject(),
                    volumeSpikes: spikeMap.toObject(),
                    tick: {
                        usd: this.computeTickIndicator(coinDataMap, "priceUSD"),
                        btc: this.computeTickIndicator(coinDataMap, "priceBTC")
                    }
                })
            }).catch((err) => {
                reject({txt: "Error getting coin market data", err: err})
            })
        })
    }

    protected computeTickIndicator(coinDataMap: CoinMarketInfo.CoinMarketInfoMap, baseCurrency: string) {
        const maxHours = nconf.get("serverConfig:coinsTickIndicatorHours");
        let coinPriceMap = new CoinPriceMap();
        for (let coin of coinDataMap) {
            const currencyStr = coin[0];
            let coinInfoArr = coin[1].slice(-1 * (maxHours+1)); // we need n+1 elements to compute n ticks
            let prices: number[] = coinInfoArr.map(info => info[baseCurrency]);
            coinPriceMap.set(currencyStr, prices);
        }
        // ensure prices have the same length, fill with leading 0
        for (let pr of coinPriceMap) {
            let prices = pr[1];
            while (prices.length < maxHours+1)
                prices.unshift(0.0);
        }
        // now check at every hour if the price went up or down
        let upTicks: number[] = utils.objects.fillCreateArray<number>(0, maxHours), downTicks: number[] = utils.objects.fillCreateArray<number>(0, maxHours);
        let lastPrice = new LastPriceMap();
        let notifiedLenMissing = false;
        for (let i = 0; i < maxHours+1; i++) {
            for (let pr of coinPriceMap) {
                const currencyStr = pr[0];
                let prices = pr[1];
                if (prices.length <= i) {
                    // 2018-09-08 00:03:13 - warn: Not enough price history data for TICK indicator of coin HOT, length 27/48
                    // fill up with leading 0 values, because the few values we get are the latest ones and should be at the end of the array
                    // currently showing TICK indicator at 0 towards the end.
                    if (notifiedLenMissing === false)
                        logger.warn("Not enough price history data for TICK indicator of coin %s, length %s/%s", currencyStr, prices.length, i)
                    notifiedLenMissing = true; // they all are the same len. only print once
                    continue;
                }
                if (i === 0) { // no last price
                    lastPrice.set(currencyStr, prices[i])
                    continue;
                }
                let last = lastPrice.get(currencyStr);
                if (last === undefined) {
                    upTicks[i-1]++;
                    logger.warn("Unable to get last price for TICK indicator of %s. Assuming up", currencyStr)
                    continue;
                }
                if (last <= prices[i]) {
                    upTicks[i-1]++;
                    lastPrice.set(currencyStr, prices[i]);
                }
                else { // lastPrice > price
                    downTicks[i-1]++;
                    lastPrice.set(currencyStr, prices[i]);
                }
            }
        }
        //console.log("UP", upTicks, upTicks.length, "DOWN", downTicks, downTicks.length)
        // compute the difference for every hour (candle)
        let tick = utils.objects.fillCreateArray<number>(0, maxHours)
        for (let i = 0; i < maxHours; i++) {
            tick[i] = upTicks[i] - downTicks[i];
        }
        //console.log("TICK", tick)
        return tick;
    }

    protected async getTopVolumeSpikes(): Promise<VolumeSpikeMap> {
        let collection = db.get().collection(TickerVolumeSpike.COLLECTION_NAME);
        const exchangeLabels: number[] = nconf.get("serverConfig:crawlTickerExchangeLabels");
        let fetchOps = [];
        let spikeMap = new VolumeSpikeMap()
        exchangeLabels.forEach((label) => {
            fetchOps.push(new Promise((resolve, reject) => {
                collection.find({exchange: label}).sort({
                    spikeFactor: -1,
                    date: -1
                }).limit(nconf.get("serverConfig:listVolumeSpikes")).toArray().then((docs) => {
                    let spikes = TickerVolumeSpike.initMany(docs)
                    spikeMap.set(Currency.Exchange[label], spikes)
                    resolve()
                }).catch((err) => {
                    reject(err)
                })
            }))
        })
        await Promise.all((fetchOps))
        return spikeMap;
    }

    protected getMaxAge() {
        return new Date(Date.now() - nconf.get("serverConfig:coinMarketInfoDisplayAgeDays")*utils.constants.DAY_IN_SECONDS*1000);
    }
}