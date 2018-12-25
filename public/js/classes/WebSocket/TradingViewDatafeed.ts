import {ClientSocketReceiver, ClientSocket} from "./ClientSocket";
import {WebSocketOpcode} from "../../../../src/WebSocket/opcodes";
import {AppData} from "../../types/AppData";
import {PageData} from "../../types/PageData";
import {AppFunc, HelpersClass} from "@ekliptor/browserutils";
import * as TradingView from "../../libs/tv/charting_library.min";
import {
    CandleBarArray,
    ChartSymbolUpdate,
    RealtimeUpdate,
    TradingViewDataReq,
    TradingViewDataRes
} from "../../../../src/WebSocket/TradingViewData";


declare var pageData: PageData, appData: AppData;
declare var AppF: AppFunc, Hlp: HelpersClass;

interface TradingViewCallbacks {
    onSuccess: Function;
    onError?: Function;
}
class CallbackMap extends Map<string, TradingViewCallbacks> { // (request function name, callback functions)
    constructor() {
        super()
    }
}

export class TradingViewDatafeed extends ClientSocketReceiver implements TradingView.IDatafeedChartApi {
    public readonly opcode = WebSocketOpcode.TRADINGVIEW;
    protected callbacks = new CallbackMap();
    protected realtimeCallbacks = new Map<string, /*Function*/TradingView.SubscribeBarsCallback>(); // (subscription ID, callback function)

    protected configNr: number = 0;
    protected currencyPair: string = "";
    protected baseCurrency: string = "";
    protected strategyName: string = "";
    protected hasData = false;
    protected candleSize: number = 0; // of the strategy
    protected serverTimeSec: number = 0;

    constructor(socket: ClientSocket) {
        super(socket)
    }

    public onData(data: TradingViewDataRes) {
        // data from the server
        //console.log(data)
        if (data.resolution)
            return this.respondWithCallback("onReady", data.resolution);
        else if (data.symbol)
            return this.respondWithCallback("resolveSymbol", data.symbol);
        else if (data.barArr)
            return this.respondWithCallback("getBars-" + data.reqMs, data.barArr);
        else if (data.realtime)
            return this.updateRealtimeCandle(data.realtime);
        else if (data.timeSec)
            return this.respondWithCallback("getServerTime", data.timeSec);
    }

    public onReady(callback: TradingView.OnReadyCallback): void {
        let dataReady = (resolution: number) => {
            callback({
                exchanges: [], // don't filter by exchanges in view
                symbols_types: [],
                //supported_resolutions: ["1", "15", "240", "D", "6M"],
                supported_resolutions: [resolution.toString()],
                supports_marks: false, // TODO add marks for stops etc...
                supports_timescale_marks: false,
                supports_time: true
                //futures_regex: null // not yet present in types + not used by us
            })
        }
        this.callbacks.set("onReady", {onSuccess: dataReady});
        this.send({initPair: this.currencyPair, configNr: this.configNr, strategy: this.strategyName});
    }

    public searchSymbols(userInput: string, exchange: string, symbolType: string, onResultReadyCallback: TradingView.SearchSymbolsCallback): void {
        setTimeout(() => {
            onResultReadyCallback([]) // our symbol search is currently hidden
        }, 0)
    }

    public resolveSymbol(symbolName: string, onSymbolResolvedCallback: TradingView.ResolveCallback, onResolveErrorCallback: TradingView.ErrorCallback): void {
        let dataReady = (symbol: ChartSymbolUpdate) => {
            this.candleSize = symbol.resolution;
            onSymbolResolvedCallback({
                name: symbol.name,
                full_name: symbol.name,
                description: symbol.name,
                type: "bitcoin",
                //session: "0000-2400",
                session: "24x7", // https://github.com/tradingview/charting_library/wiki/Trading-Sessions
                exchange: symbol.exchange,
                listed_exchange: symbol.exchange,
                timezone: symbol.timezone, // GMT0
                pricescale: 100000000, // show 8 decimals
                minmov: 1,
                has_intraday: true,
                supported_resolutions: [symbol.resolution.toString()],
                has_seconds: true,
                has_empty_bars: false, // generate missing bars. should be done by server
                volume_precision: 4,
                data_status: "streaming",
                currency_code: symbol.baseCurrency
            });
        }
        this.callbacks.set("resolveSymbol", {onSuccess: dataReady, onError: onResolveErrorCallback});
        this.send({resolve: this.currencyPair, configNr: this.configNr, strategy: this.strategyName});
    }

    public getBars(symbolInfo: TradingView.LibrarySymbolInfo, resolution: TradingView.ResolutionString, from: number, to: number, onHistoryCallback: TradingView.HistoryCallback, onErrorCallback: TradingView.ErrorCallback, firstDataRequest: boolean): void {
        const now = Date.now();
        let dataReady = (barArr: number[][]) => {
            if (this.hasData === false && barArr.length !== 0)
                this.hasData = true;
            let bars = this.fromBarArray(barArr);
            let meta: TradingView.HistoryMetadata = {noData: false}
            if (/*this.hasData === false*/barArr.length === 0) { // should always be set when there is no new data, else it will start the same request again
                meta.noData = true;
                //meta.nextTime = this.serverTimeSec + this.candleSize*60; // closest time to requested period where we have data
                //meta.nextTime = Math.floor(Date.now() / 1000) + this.candleSize*60; // should be identical
            }
            //onHistoryCallback(bars, {noData: this.hasData === false})
            onHistoryCallback(bars, meta)
        }
        this.callbacks.set("getBars-" + now, {onSuccess: dataReady, onError: onErrorCallback});
        this.send(
            {bars: {
                    configNr: this.configNr,
                    currencyPair: this.currencyPair,
                    from: from,
                    to: to,
                    first: firstDataRequest
                },
                strategy: this.strategyName,
                reqMs: now
        });
    }

    public subscribeBars(symbolInfo: TradingView.LibrarySymbolInfo, resolution: TradingView.ResolutionString, onRealtimeCallback: TradingView.SubscribeBarsCallback, subscriberUID: string, onResetCacheNeededCallback: () => void): void {
        let reqData = {realtime: {
                configNr: this.configNr,
                currencyPair: this.currencyPair,
                //id: this.configNr + "-" + this.currencyPair + "-" + this.strategyName
                strategy: this.strategyName,
                candleSize: this.candleSize,
                id: subscriberUID.toString()
            },
            strategy: this.strategyName
        }
        this.realtimeCallbacks.set(reqData.realtime.id, onRealtimeCallback)
        this.send(reqData);
    }

    public unsubscribeBars(subscriberUID: string): void {
        this.realtimeCallbacks.delete(subscriberUID);
        this.send({unsubscribeID: subscriberUID});
    }

    public calculateHistoryDepth(resolution: TradingView.ResolutionString, resolutionBack: TradingView.ResolutionBackValues, intervalBack: number): TradingView.HistoryDepth | undefined {
        // optionally change the history depth we request from server
        return undefined;
    }

    public getMarks(symbolInfo: TradingView.LibrarySymbolInfo, startDate: number, endDate: number, onDataCallback: TradingView.GetMarksCallback<TradingView.Mark>, resolution: TradingView.ResolutionString): void {
        // optional, currently disabled
    }

    public getTimescaleMarks(symbolInfo: TradingView.LibrarySymbolInfo, startDate: number, endDate: number, onDataCallback: TradingView.GetMarksCallback<TradingView.TimescaleMark>, resolution: TradingView.ResolutionString): void {
        // optional, currently disabled
    }

    public getServerTime(callback: TradingView.ServerTimeCallback): void {
        let dataReady = (serverTimeSec: number) => {
            this.serverTimeSec = serverTimeSec;
            callback(serverTimeSec);
        }
        this.callbacks.set("getServerTime", {onSuccess: dataReady});
        this.send({time: true});
    }

    // TODO add trading terminal API functions

    public setCurrencyPair(configNr: number, currencyPairStr: string, strategyName) {
        this.configNr = configNr;
        this.currencyPair = currencyPairStr;
        this.baseCurrency = currencyPairStr.split("_")[0];
        this.strategyName = strategyName;
        this.hasData = false;
        for (let cb of this.realtimeCallbacks)
            this.unsubscribeBars(cb[0]);
    }

    public resetCurrencyPair() {
        this.configNr = 0;
        this.currencyPair = "";
        this.baseCurrency = "";
        this.strategyName = "";
        this.hasData = false;
        for (let cb of this.realtimeCallbacks)
            this.unsubscribeBars(cb[0]);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected respondWithCallback(reqFunctionName: string, ...params: any[]): void {
        let callbacks = this.callbacks.get(reqFunctionName);
        if (callbacks) {
            // TODO could there be a situation where we want to queue multiple events with the same name? events should use request ms as key then
            this.callbacks.delete(reqFunctionName);
            callbacks.onSuccess(...params);
        }
        else
            AppF.log("Error: TradingView callback not found: " + reqFunctionName);
    }

    protected respondWithError(reqFunctionName: string, error: string): void {
        let callbacks = this.callbacks.get(reqFunctionName);
        if (callbacks) {
            this.callbacks.delete(reqFunctionName);
            if (typeof callbacks.onError === "function")
                callbacks.onError(error);
            else
                AppF.log("Error: TradingView error callback not set: " + reqFunctionName);
        }
        else
            AppF.log("Error: TradingView error callback not found: " + reqFunctionName);
    }

    protected updateRealtimeCandle(update: RealtimeUpdate) {
        let bars = this.fromBarArray(update.candles);
        let callback = this.realtimeCallbacks.get(update.id)
        if (callback)
            callback(bars[0]);
        else
            AppF.log("Error: TradingView error realtime callback not found: " + update.id);
    }

    /*
    protected getCurrencyPair(symbolInfo: TradingView.LibrarySymbolInfo) {
        let pair = symbolInfo.name.split(" ");
        return pair[0];
    }

    protected getStrategyName(symbolInfo: TradingView.LibrarySymbolInfo) {
        let pair = symbolInfo.name.split(" ");
        return pair[1];
    }
    */

    protected fromBarArray(barArr: CandleBarArray): TradingView.Bar[] {
        let bars: TradingView.Bar[] = [];
        for (let i = 0; i < barArr.length; i++)
        {
            bars.push({
                time: barArr[i][0],
                open: barArr[i][1],
                high: barArr[i][2],
                low: barArr[i][3],
                close: barArr[i][4],
                volume: barArr[i][5]
            })
        }
        return bars;
    }

    protected send(data: TradingViewDataReq) {
        return super.send(data);
    }
}