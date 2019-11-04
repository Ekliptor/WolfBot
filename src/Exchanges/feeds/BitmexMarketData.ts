import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractMarketData} from "./AbstractMarketData";
import * as helper from "../../utils/helper";
import * as BitMEXClient from "@ekliptor/bitmex-realtime-api-fix";
import * as WebSocket from "ws";
import {Currency, Ticker, Liquidation, Trade, FundingRate} from "@ekliptor/bit-models";

import * as argvFunction from "minimist";
import {PushApiConnectionType} from "../AbstractExchange";
import {BitMEXCurrencies} from "../BitMEX";
const argv = argvFunction(process.argv.slice(2));
const bitmexFix = nconf.get("serverConfig:premium") === true || argv.bitmex === true ? require("../BitmexFix").bitmexFix : null;


export interface BitmexMarketDataOptions {
    streams: string[];
}

/**
 * A small helper class to listen to BitMEX market data (highest volume exchange) that effects the whole
 * cryptocurrency market (such as liquidations).
 */
export default class BitmexMarketData extends AbstractMarketData {
    protected static readonly CLEANUP_LIQUIDATION_SEC = 60;
    protected static readonly CLOSE_SOCKET_DELAY_MS = 4000;

    protected apiClient: any = null; // TODO wait for typings
    protected currencies: BitMEXCurrencies;
    protected options: BitmexMarketDataOptions;

    protected finishedLiquidations = new Map<string, Date>(); // (orderID, liquidation finished time)

    constructor(options: BitmexMarketDataOptions) {
        super(options)
        this.exchangeLabel = Currency.Exchange.BITMEX;
        this.currencies = new BitMEXCurrencies(this as any); // we only need it to convert currency pairs
        this.pushApiConnectionType = PushApiConnectionType.API_WEBSOCKET;
        this.webSocketTimeoutMs = 0; // disabled it. few data, but stable library handling reconnects automatically
        this.reconnectWebsocketDelayMs = 16000; // BitMEX is currently (August 2019) very unstable

        this.createApiClient();
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected createApiWebsocketConnection(): any {
        try {
            this.createApiClient();
            const bws = this.apiClient.socket/*(2)*/; // TODO proxy/options

            let closeSocketTimerID = null;
            this.apiClient.on("error", (err) => {
                logger.error("WebSocket error in %s", this.className, err);
                clearTimeout(closeSocketTimerID);
                closeSocketTimerID = setTimeout(() => {
                    this.closeConnection("WebSocket error")
                }, BitmexMarketData.CLOSE_SOCKET_DELAY_MS);
            })

            this.apiClient.on('open', () => {
                logger.info("%s WS Connection opened", this.className)
            });

            this.apiClient.on('initialize', () => {
                logger.verbose('%s Client initialized, data is flowing.', this.className);
                let lastTradeID = "";

                this.currencyPairs.forEach((currencyPair) => {
                    let marketPair = this.currencies.getExchangePair(currencyPair);
                    if (this.options.streams.indexOf("liquidation") !== -1) {
                        this.apiClient.addStream(marketPair, "liquidation", (data, symbol, tableName)=> {
                            // we get maxTableLen newest results, if the table is full it behaves like a FIFO, so we need to detect whats new
                            this.resetWebsocketTimeout();

                            // in official library data is empty: https://github.com/BitMEX/api-connectors/issues/225
                            // https://www.bitmex.com/app/wsAPI#Liquidation
                            //console.log(data, symbol, tableName)
                            if (!data || !data.data.length || data.data.length <= 0)
                                return;
                            if (data.table === "liquidation") // just to be sure
                                this.processLiquidations(data);
                        });
                    }

                    if (this.options.streams.indexOf("trade") !== -1) {
                        this.apiClient.addStream(marketPair, "trade", (data, symbol, tableName) => {
                            // we get maxTableLen newest results, if the table is full it behaves like a FIFO, so we need to detect whats new
                            //console.log("got trades: " + data.length);
                            if (!data.length || data.length <= 0) {
                                return
                            }
                            this.resetWebsocketTimeout();

                            let newIndex = 0;
                            for (let i=data.length-1; i >= 0; i--) {
                                let trade = data[i];
                                if (trade.trdMatchID == lastTradeID) {
                                    newIndex = i+1;
                                    break;
                                }
                            }
                            lastTradeID = data[data.length-1].trdMatchID;

                            let trades = [];
                            //let timestamp = Math.floor(Date.now() / 1000);
                            for (let i=newIndex; i < data.length; i++) {
                                let trade = data[i];
                                //let date = this.setDateByStr(new Date(this.lastServerTimestampMs), trade.timestamp);
                                //let timestamp = Math.floor(date.getTime() / 1000);
                                // todo: order.size to coin
                                //trades.push(["t", trade.trdMatchID, trade.side == "Buy" ? 1 : 0, trade.price, trade.size, timestamp])
                                trades.push(this.fromRawTrade(trade, currencyPair));
                            }
                            if (trades.length !== 0)
                                this.emit("trade", trades);
                        });

                        if (this.options.streams.indexOf("funding") !== -1) {
                            this.apiClient.addStream(marketPair, "funding", (data, symbol, tableName) => {
                                // https://www.bitmex.com/api/explorer/#!/Funding/Funding_get
                                // updates once per funding interval (8h) and on opening connection
                                this.resetWebsocketTimeout();
                                if (!data || Array.isArray(data) === false) {
                                    logger.error("Received invalid funding data in %s: %s", this.className, data);
                                    return;
                                }
                                let fundingRates = [];
                                for (let i = 0; i < data.length; i++)
                                {
                                    let fundingRate = this.fromRawFundingRate(data[i]);
                                    if (fundingRate)
                                        fundingRates.push(fundingRate);
                                }
                                if (fundingRates.length !== 0)
                                    this.emit("funding", fundingRates);
                            });
                        }

                        if (this.options.streams.indexOf("instrument") !== -1) {
                            this.apiClient.addStream(marketPair, "instrument", (data, symbol, tableName) => {
                                // https://www.bitmex.com/api/explorer/#!/Instrument/Instrument_get
                                // updates every few seconds
                                this.resetWebsocketTimeout();
                                if (!data || Array.isArray(data) === false) {
                                    logger.error("Received invalid instrument data in %s: %s", this.className, data);
                                    return;
                                }
                                let tickers = [];
                                for (let i = 0; i < data.length; i++)
                                {
                                    let ticker = this.currencies.toLocalTicker(data[i]);
                                    if (ticker)
                                        tickers.push(ticker);
                                }
                                if (tickers.length !== 0)
                                    this.emit("ticker", tickers);
                            });
                        }
                    }
                });

                if (this.options.streams.indexOf("trade") === -1 && this.options.streams.indexOf("instrument") === -1) {
                    this.apiClient.addStream("1", "chat", (data, symbol, tableName)=> { // to keep the WS connected
                        //console.log(data)
                        this.resetWebsocketTimeout();
                    });
                }
            });

            this.apiClient.on('close', () => {
                logger.info('%s Connection closed.', this.className)
                clearTimeout(closeSocketTimerID);
                closeSocketTimerID = setTimeout(() => { // close event is sometimes sent multiple times. prevent closing & opening multiple times
                    this.closeConnection("Connection closed");
                }, BitmexMarketData.CLOSE_SOCKET_DELAY_MS);
            });

            this.apiClient.on('end', () => {
                logger.info('%s Connection ended.', this.className)
                clearTimeout(closeSocketTimerID);
                closeSocketTimerID = setTimeout(() => {
                    this.closeConnection("Connection ended");
                }, BitmexMarketData.CLOSE_SOCKET_DELAY_MS);
            });

            return bws; // EventEmitter and not WebSocket, but ok
        }
        catch (e) {
            logger.error("Exception on creating %s WebSocket connection", this.className, e)
            return null; // this function will get called again after a short timeout
        }
    }

    protected closeApiWebsocketConnection() {
        const bws = this.apiClient.socket/*(2)*/;
        bws.instance.close();
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

    protected fromRawTrade(trade: any, currencyPair: Currency.CurrencyPair, timestampMs = 0): Trade.Trade {
        if (!timestampMs)
            timestampMs = Date.now();
        //trades.push(["t", trade.trdMatchID, trade.side == "Buy" ? 1 : 0, trade.price, trade.size, timestamp])
        let tradeObj = new Trade.Trade();
        tradeObj.date = new Date(timestampMs);
        tradeObj.type = trade.side == "Buy" ? Trade.TradeType.BUY : Trade.TradeType.SELL;
        tradeObj.amount = trade.size;
        tradeObj.rate = trade.price;
        tradeObj.tradeID = trade.trdMatchID;
        tradeObj = Trade.Trade.verifyNewTrade(tradeObj, currencyPair, Currency.Exchange.BITMEX, 0.0);
        return tradeObj;
    }

    protected fromRawFundingRate(fundingRate: any): FundingRate.FundingRate {
        const pair = this.currencies.getLocalPair(fundingRate.symbol);
        let fundingObj = new FundingRate.FundingRate(fundingRate.fundingRate, pair);
        const fundingIntervalBaseDate = new Date('2000-01-01T00:00:00.000Z');
        const fundingIntervalDate = new Date(fundingRate.fundingInterval); // from ISO string
        fundingObj.fundingIntervalH = fundingIntervalDate.getUTCHours() - fundingIntervalBaseDate.getUTCHours();
        if (fundingRate.timestamp)
            fundingObj.date = new Date(fundingRate.timestamp); // from ISO string
        return fundingObj;
    }

    protected createApiClient() {
        try {
            this.apiClient = new BitMEXClient({
                //testnet: this.apiKey.testnet === true,
                //apiKeyID: this.apiKey.key,
                //apiKeySecret: this.apiKey.secret,
                maxTableLen: 1000,  // the maximum number of table elements to keep in memory (FIFO queue)
                wsExtras: bitmexFix ? bitmexFix.getWebsocketExtras() : null
            });
        }
        catch (err) {
            /**
             * 2019-08-21 17:40:09 - warn: Uncaught Exception
             2019-08-21 17:40:09 - warn: Error: Forbidden
             at Request.callback (/home/bitbrain2/nodejs/BitBrain2/Sensor1/node_modules/superagent/lib/node/index.js:706:15)
             at IncomingMessage.<anonymous>
             */
            logger.error("Error initializing %s. Please check your config and API key permissions.", this.className, err);
        }
    }
}
