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
export class VolumeSpikeMap extends Map<string, TickerVolumeSpike.TickerVolumeSpike[]> { // (exchange name, spike)
    constructor() {
        super()
    }
}
export interface CoinMarketUpdate {
    //coinStats: CoinMarketInfo.CoinMarketInfo[]; // Map converted to object (Maps can't be serialized to JSON)
    coinStats: CoinPriceMap;
    volumeSpikes: VolumeSpikeMap; // TODO send less data?
}

export class CoinMarketUpdater extends AppPublisher {
    public readonly opcode = WebSocketOpcode.COINMARKET;
    protected socialController: SocialController;

    constructor(serverSocket: ServerSocket, socialController: SocialController) {
        super(serverSocket, socialController)
        this.socialController = socialController;
        this.publishCoinInfos();
    }

    public onSubscription(clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        this.send(clientSocket, {
            maxAge: this.getMaxAge(),
            days: nconf.get("serverConfig:coinMarketInfoDisplayAgeDays"),
            serverDate: new Date(),
            crawlTickerHours: nconf.get("serverConfig:crawlTickerHours")
        });
        this.getCoinInfos().then((data) => {
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
            CoinMarketInfo.getLatestData(db.get(), this.getMaxAge()).then((coinDataMap) => {
                //resolve({coinStats: coinDataMap.toObject()})
                const dataPointCount = nconf.get("serverConfig:coinMarketInfoDisplayAgeDays") * 24;
                for (let coin of coinDataMap) {
                    const currencyStr = coin[0];
                    let coinInfoArr = coin[1];
                    let prices = coinInfoArr.map(info => info.priceUSD);
                    while (prices.length < dataPointCount)
                        prices.unshift(0.0);
                    coinPriceMap.set(currencyStr, prices);
                }
                return this.getTopVolumeSpikes()
            }).then((spikeMap) => {
                resolve({
                    coinStats: coinPriceMap.toObject(),
                    volumeSpikes: spikeMap.toObject()
                })
            }).catch((err) => {
                reject({txt: "Error getting coin market data", err: err})
            })
        })
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