import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as WebSocket from "ws";
import * as http from "http";
import * as path from "path";
import {ServerSocketPublisher, ServerSocket, ServerSocketSendOptions, ClientSocketOnServer} from "./ServerSocket";
import {AppPublisher} from "./AppPublisher";
import {WebSocketOpcode} from "./opcodes";
import {AbstractTrader} from "../Trade/AbstractTrader";
import TradeAdvisor, {StrategyMap} from "../TradeAdvisor";
import {LendingAdvisor, StrategyMap as LendingStrategyMap} from "../Lending/LendingAdvisor";
import {AbstractAdvisor} from "../AbstractAdvisor";
import {AbstractGenericStrategy} from "../Strategies/AbstractGenericStrategy";
import {TradeConfig} from "../Trade/TradeConfig";
import {Currency, Candle, Trade} from "@ekliptor/bit-models";
import {LendingConfig} from "../Lending/LendingConfig";
import {AbstractStrategy} from "../Strategies/AbstractStrategy";
import {AbstractConfig} from "../Trade/AbstractConfig";
import {AbstractLendingStrategy} from "../Lending/Strategies/AbstractLendingStrategy";
import * as TradingView from "../../public/js/libs/tv/charting_library.min"
import {CandleMaker} from "../Trade/Candles/CandleMaker";

export type CandleBarArray = number[][];
export interface ChartSymbolUpdate {
    name: string;
    description: string; // currently identical to name
    exchange: string; // one or more exchanges
    timezone: TradingView.Timezone;
    resolution: number;
    baseCurrency: string;
}
export interface BarRequest {
    configNr: number;
    currencyPair: string;
    from: number;
    to: number;
    first: boolean;
}
export interface RealtimeSubscribe {
    configNr: number;
    currencyPair: string;
    id: string;
}
export interface RealtimeUpdate {
    candles: CandleBarArray;
    id: string;
}

export interface TradingViewDataReq {
    initPair?: string;
    configNr?: number;
    strategy?: string;
    resolve?: string;
    bars?: BarRequest;
    realtime?: RealtimeSubscribe;
    unsubscribeID?: string;
    time?: boolean;

    reqMs?: number;
}
export interface TradingViewDataRes {
    resolution?: number;
    symbol?: ChartSymbolUpdate;
    barArr?: CandleBarArray;
    realtime?: RealtimeUpdate;
    timeSec?: number;

    reqMs?: number;
}

interface RaltimeUpdate {
    listener: (...args: any[]) => void;
    candleMaker: CandleMaker<any>;
}
class RealtimeUpdateMap extends Map<string, RaltimeUpdate> { // (websocket client ID, listener)
}

export class TradingViewData extends AppPublisher {
    public readonly opcode = WebSocketOpcode.TRADINGVIEW;
    protected realtimeUpdates = new RealtimeUpdateMap();

    constructor(serverSocket: ServerSocket, advisor: AbstractAdvisor) {
        super(serverSocket, advisor)
    }

    public onSubscription(clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
        // anything to do?
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected onData(data: TradingViewDataReq, clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
        //console.log("TV DATA", data);
        if (typeof data.initPair === "string")
            this.initChart(data, clientSocket);
        else if (typeof data.resolve === "string")
            this.resolveSymbol(data, clientSocket);
        else if (typeof data.bars === "object")
            this.sendBars(data, clientSocket)
        else if (typeof data.realtime === "object")
            this.startRealtimeUpdates(data, clientSocket);
        else if (typeof data.unsubscribeID === "string")
            this.stopRealtimeUpdates(data, clientSocket);
        else if (data.time === true)
            this.send(clientSocket, {timeSec: Math.floor(Date.now()/1000)});
    }

    protected initChart(data: TradingViewDataReq, clientSocket: ClientSocketOnServer) {
        let strategies = this.getStrategies(data.configNr, data.initPair);
        let strategy = AbstractGenericStrategy.getStrategyByName(strategies, data.strategy);
        if (strategy)
            this.send(clientSocket, {resolution: strategy.getAction().candleSize});
    }

    protected resolveSymbol(data: TradingViewDataReq, clientSocket: ClientSocketOnServer) {
        let strategies = this.getStrategies(data.configNr, data.resolve);
        let strategy = AbstractGenericStrategy.getStrategyByName(strategies, data.strategy);
        if (!strategy)
            return;
        let symbol: ChartSymbolUpdate = null;
        if (strategy instanceof AbstractStrategy && this.advisor instanceof TradeAdvisor) {
            let config = AbstractAdvisor.getConfigByNr<TradeConfig>(this.advisor.getConfigs(), data.configNr);
            const currencyPair = strategy.getAction().pair.toString();
            const name = currencyPair + " " + strategy.getClassName();
            symbol = {
                name: name,
                description: name,
                // TODO support for 2 charts in arbitrage mode (side by side?)
                exchange: AbstractConfig.getExchangeNames(nconf.get("arbitrage") ? config.exchanges.slice(0, 1) : config.exchanges),
                timezone: "UTC",
                resolution: strategy.getAction().candleSize,
                baseCurrency: currencyPair.split("_")[0]
            }
        }
        else if (strategy instanceof AbstractLendingStrategy && this.advisor instanceof LendingAdvisor) {
            let config = AbstractAdvisor.getConfigByNr<LendingConfig>(this.advisor.getConfigs(), data.configNr);
            const currency = Currency.getCurrencyLabel(strategy.getAction().currency);
            symbol = {
                name: currency,
                description: currency,
                exchange: AbstractConfig.getExchangeNames(config.exchanges),
                //timezone: "Europe/London", // GMT0, constant for now (always?)
                timezone: "UTC",
                resolution: strategy.getAction().candleSize,
                baseCurrency: currency
            }
        }
        this.send(clientSocket, {symbol: symbol});
    }

    protected sendBars(data: TradingViewDataReq, clientSocket: ClientSocketOnServer) {
        const barReq = data.bars;
        if (this.advisor instanceof TradeAdvisor || this.advisor instanceof LendingAdvisor) {
            /*
            let batchers = this.advisor.getCandleBatchers(data.bars.currencyPair);
            for (let bat of batchers)
            {
                bat[1].setExchange()
            }
            */
            let strategies = this.getStrategies(barReq.configNr, barReq.currencyPair);
            let strategy = AbstractGenericStrategy.getStrategyByName(strategies, data.strategy);
            if (!strategy)
                return;
            const endMs = barReq.first === true ? Number.MAX_VALUE : barReq.to*1000;
            let candles = strategy.getCandleHistory(barReq.from*1000, endMs);
            if (nconf.get("arbitrage") && this.advisor instanceof TradeAdvisor) {
                let config = AbstractAdvisor.getConfigByNr<TradeConfig>(this.advisor.getConfigs(), barReq.configNr);
                let firstExchange = this.advisor.getExchanges().get(config.exchanges[0]); // TODO support for 2 charts in arbitrage mode (side by side?)
                if (!firstExchange) {
                    logger.error("Exchange instance %s is not loaded. Can't send chart bars.", config.exchanges[0])
                    return;
                }
                const firstExchangeLabel = firstExchange.getExchangeLabel();
                candles = candles.filter(c => c.exchange === firstExchangeLabel);
            }
            this.send(clientSocket, {barArr: Candle.Candle.toBarArray(candles), reqMs: data.reqMs});
        }
    }

    protected startRealtimeUpdates(data: TradingViewDataReq, clientSocket: ClientSocketOnServer) {
        const realtimeReq = data.realtime;
        if (this.advisor instanceof TradeAdvisor || this.advisor instanceof LendingAdvisor) {
            let exchangeLabel: Currency.Exchange = undefined;
            if (nconf.get("arbitrage") && this.advisor instanceof TradeAdvisor) {
                let config = AbstractAdvisor.getConfigByNr<TradeConfig>(this.advisor.getConfigs(), realtimeReq.configNr);
                let firstExchange = this.advisor.getExchanges().get(config.exchanges[0]);
                if (!firstExchange) {
                    logger.error("Exchange instance %s is not loaded. Can't send chart realtime updates.", config.exchanges[0])
                    return;
                }
                exchangeLabel = firstExchange.getExchangeLabel();
            }
            let maker = this.advisor.getCandleMaker(realtimeReq.currencyPair, exchangeLabel);
            let listener = (candle: Candle.Candle) => {
                this.send(clientSocket, {
                    realtime: {
                        candles: Candle.Candle.toBarArray([candle]),
                        id: realtimeReq.id
                    }}).then((success) => {
                    if (success === false)
                        this.stopRealtimeUpdates({unsubscribeID: realtimeReq.id}, clientSocket); // TODO unsubscribe only after x errors?
                });
            }
            maker.on("currentCandle", listener);
            const key = realtimeReq.id + (clientSocket as any).id;
            logger.verbose("Starting realtime chart updates for subscriber ID %s", key);
            this.realtimeUpdates.set(key, {listener: listener, candleMaker: maker});
        }
    }

    protected stopRealtimeUpdates(data: TradingViewDataReq, clientSocket: ClientSocketOnServer) {
        const key = data.unsubscribeID + (clientSocket as any).id;
        let update = this.realtimeUpdates.get(key);
        if (update) {
            logger.verbose("Stopping realtime chart updates for subscriber ID %s", key);
            update.candleMaker.removeListener("currentCandle", update.listener);
            this.realtimeUpdates.delete(key)
        }
    }

    protected send(ws: ClientSocketOnServer, data: TradingViewDataRes, options?: ServerSocketSendOptions) {
        return super.send(ws, data, options);
    }

    protected getStrategies(configNr: number, marketStr: string): /*StrategyMap | LendingStrategyMap*/AbstractGenericStrategy[] {
        let config = AbstractAdvisor.getConfigByNr(this.advisor.getConfigs(), configNr);
        if (!config)
            return [];
        if (this.advisor instanceof TradeAdvisor) {
            let market = Currency.CurrencyPair.fromString(marketStr);
            const configCurrencyPair = TradeConfig.createConfigCurrencyPair(config.configNr, market);
            let strategies = this.advisor.getStrategies();
            let pairStrategies = strategies.get(configCurrencyPair);
            return pairStrategies;
        }
        else if (this.advisor instanceof LendingAdvisor) {
            let market = Currency.Currency[marketStr];
            const configCurrencyPair = LendingConfig.createConfigCurrencyPair(config.configNr, market);
            let strategies = this.advisor.getLendingStrategies();
            let pairStrategies = strategies.get(configCurrencyPair);
            return pairStrategies;
        }
        logger.error("Can not get strategies for unknown advisor class %s", this.advisor.getClassName());
        return [];
    }
}