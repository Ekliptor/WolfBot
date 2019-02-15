import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractMarketData} from "./AbstractMarketData";
import * as helper from "../../utils/helper";
import * as BitMEXClient from "@ekliptor/bitmex-realtime-api-fix";
import * as WebSocket from "ws";
import {Currency, Ticker, Liquidation} from "@ekliptor/bit-models";

import * as argvFunction from "minimist";
import {PushApiConnectionType} from "../AbstractExchange";
import {BitMEXCurrencies} from "../BitMEX";
const argv = argvFunction(process.argv.slice(2));
const bitmexFix = nconf.get("serverConfig:premium") === true || argv.bitmex === true ? require("../BitmexFix").bitmexFix : null;


/**
 * A small helper class to listen to BitMEX market data (highest volume exchange) that effects the whole
 * cryptocurrency market (such as liquidations).
 */
export default class BitmexMarketData extends AbstractMarketData {
    protected static readonly CLEANUP_LIQUIDATION_SEC = 60;

    protected apiClient: any = null; // TODO wait for typings
    protected currencies: BitMEXCurrencies;

    protected finishedLiquidations = new Map<string, Date>(); // (orderID, liquidation finished time)

    constructor() {
        super()
        this.currencies = new BitMEXCurrencies(this as any); // we only need it to convert currency pairs
        this.exchangeLabel = Currency.Exchange.BITMEX;
        this.pushApiConnectionType = PushApiConnectionType.WEBSOCKET;
        this.webSocketTimeoutMs = 0; // disabled it. few data, but stable library handling reconnects automatically
        this.apiClient = new BitMEXClient({
            //testnet: this.apiKey.testnet === true,
            //apiKeyID: this.apiKey.key,
            //apiKeySecret: this.apiKey.secret,
            maxTableLen: 10000,  // the maximum number of table elements to keep in memory (FIFO queue)
            wsExtras: bitmexFix ? bitmexFix.getWebsocketExtras() : null
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected createWebsocketConnection(): WebSocket {
        try {
            const bws = this.apiClient.socket/*(2)*/; // TODO proxy/options

            this.apiClient.on("error", (err) => {
                // TODO bitmex api doesn't expose close() ?
                logger.error("WebSocket error in %s", this.className, err);
                this.closeConnection("WebSocket error")
            })

            this.apiClient.on('open', () => {
                logger.info("%s WS Connection opened", this.className)
            });

            this.apiClient.on('initialize', () => {
                logger.verbose('%s Client initialized, data is flowing.', this.className);

                this.currencyPairs.forEach((currencyPair) => {
                    let marketPair = this.currencies.getExchangePair(currencyPair);
                    this.apiClient.addStream(marketPair, "liquidation", (data, symbol, tableName)=> {
                        // we get maxTableLen newest results, if the table is full it behaves like a FIFO, so we need to detect whats new
                        this.resetWebsocketTimeout();

                        // in official library data is empty: https://github.com/BitMEX/api-connectors/issues/225
                        // https://www.bitmex.com/app/wsAPI#Liquidation
                        //console.log(data, symbol, tableName)
                        if (!data || !data.data.length || data.data.length <= 0)
                            return;
                        if (data.table === "liquidation")
                            this.processLiquidations(data);
                    });
                });

                this.apiClient.addStream("1", "chat", (data, symbol, tableName)=> { // to keep the WS connected
                    //console.log(data)
                });
            });

            this.apiClient.on('close', () => {
                logger.info('%s Connection closed.', this.className)
                this.closeConnection("Connection closed");
            });

            this.apiClient.on('end', () => {
                logger.info('%s Connection ended.', this.className)
                this.closeConnection("Connection ended");
            });

            return bws; // EventEmitter and not WebSocket, but ok
        }
        catch (e) {
            logger.error("Exception on creating %s WebSocket connection", this.className, e)
            return null; // this function will get called again after a short timeout
        }
    }

    protected processLiquidations(data: any) {
        let liquidations = [];
        switch (data.action)
        {
            case "partial":
            case "delete":
                // "delete" means the liquidation is done (has been bought by another party)
                data.data.forEach((liq) => {
                    const orderID = liq.orderID;
                    this.finishedLiquidations.set(orderID, new Date());
                });
                break;

            case "update":
                // moved order to new price or deleverage
                break;

            case "insert":
                // called first once liquidation occurs
                data.data.forEach((liq) => {
                    const orderID = liq.orderID;
                    // insert/delete can happen multiple times when BitMex is able to liquidate at a better price. we only count the first liquidation
                    if (this.finishedLiquidations.has(orderID) === true)
                        return; // liquidation just has been bought, we already counted it on insert
                    let liquidation = this.fromRawLiquidation(liq);
                    if (liquidation) {
                        liquidations.push(liquidation);
                        //this.finishedLiquidations.delete(orderID);
                    }
                });
                break;
        }
        //console.log("FINISHED", liquidations);
        if (liquidations.length === 0)
            return;
        this.emit("liquidation", liquidations);

        // cleanup liquidations
        const now = Date.now();
        for (let liq of this.finishedLiquidations)
        {
            const finishTime = liq[1];
            if (finishTime.getTime() + BitmexMarketData.CLEANUP_LIQUIDATION_SEC*1000 < now)
                this.finishedLiquidations.delete(liq[0]);
        }
    }

    protected fromRawLiquidation(liquidation: any) {
        let pair = this.currencies.getLocalPair(liquidation.symbol);
        let amount = liquidation.leavesQty; // TODO convert for non-perpetual contracts?
        let liquidationObj = Liquidation.Liquidation.createLiquidation(pair, liquidation.side == "Buy" ? "buy": "sell", amount, liquidation.price, this.exchangeLabel, liquidation.orderID);
        return liquidationObj;
    }
}