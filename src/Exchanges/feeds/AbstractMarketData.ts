import * as utils from "@ekliptor/apputils";
import {ConnectionState, PushApiConnectionType} from "../AbstractExchange";
import * as WebSocket from "ws";
import * as autobahn from "autobahn";
import * as EventEmitter from 'events';
import {Currency} from "@ekliptor/bit-models";
import * as path from "path";

const logger = utils.logger
    , nconf = utils.nconf;

export type ExchangeFeed = "BitmexMarketData";
export type MarketEvent = "liquidation" | "trade" | "funding" | "ticker";

export interface AbstractMarketDataOptions {
    [name: string]: any;
}

/**
 * Class to fetch exchange data impacting all crypto currencies.
 * Other than AbstractExchange implementations this class works with API keys.
 */
export abstract class AbstractMarketData extends EventEmitter {
    protected className: string;
    protected options: AbstractMarketDataOptions;
    protected static instances = new Map<string, AbstractMarketData>(); // (className, instance)

    protected currencyPairs: Currency.CurrencyPair[] = [];
    protected exchangeLabel: Currency.Exchange;

    protected websocketTimeoutTimerID: NodeJS.Timer = null;
    //protected websocketPingTimerID: NodeJS.Timer = null;
    protected webSocketTimeoutMs: number = nconf.get('serverConfig:websocketTimeoutMs'); // set to 0 to disable it
    protected reconnectWebsocketDelayMs = 2500;
    protected reconnectWebsocketTimerID: NodeJS.Timer = null;
    protected websocketCleanupFunction: () => boolean = null;
    protected static pushApiConnections = new Map<string, autobahn.Connection | WebSocket>(); // (className, instance)
    protected pushApiConnectionType: PushApiConnectionType = PushApiConnectionType.WEBSOCKET;
    protected connectionState: ConnectionState = ConnectionState.CLOSED;

    constructor(options: AbstractMarketDataOptions) {
        super()
        this.className = this.constructor.name;
        this.options = options;
    }

    /**
     * Use this instead of the constructor when loading exchange feeds in strategy to avoid opening duplicate websocket connections.
     * @param className
     * @param options
     */
    public static getInstance(className: string, options: any = undefined, skipCache: boolean = false): AbstractMarketData {
        let instance: AbstractMarketData = skipCache === true ? undefined : AbstractMarketData.instances.get(className);
        if (instance === undefined) {
            let modulePath = path.join(__dirname, className);
            instance = AbstractMarketData.loadModule(modulePath, options);
            AbstractMarketData.instances.set(className, instance);
        }
        return instance;
    }

    public subscribe(currencyPairs: Currency.CurrencyPair[]) {
        if (this.isSubscribed() === true) {
            logger.error("Subscribe can only be called once in %s. Subscribed pairs %s, new %s", this.className, this.currencyPairs.toString(), currencyPairs.toString());
            return; // TODO improve this? the issue is that we would have to check before emitting which listener is interested in this currency
        }
        this.currencyPairs = currencyPairs;
        this.openConnection();
    }

    public isSubscribed() {
        return this.currencyPairs.length !== 0;
    }

    public getCurrencyPairs() {
        return this.currencyPairs;
    }

    public getClassName() {
        return this.className;
    }

    public getExchangeLabel() {
        return this.exchangeLabel;
    }

    public emit(event: MarketEvent, ...args: any[]): boolean {
        return super.emit(event, ...args);
    }

    public on(event: MarketEvent, listener: (...args: any[]) => void) {
        return super.on(event, listener);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected closeConnection(reason: string) {
        let socket = AbstractMarketData.pushApiConnections.get(this.className);
        try {
            if (!socket)
                logger.error("No socket available to close WebSocket connection in %s: %s", this.className, reason)
            else {
                if (this.pushApiConnectionType === PushApiConnectionType.API_WEBSOCKET)
                    this.closeApiWebsocketConnection();
                if (socket instanceof WebSocket)
                    socket.close();
                //else if (socket instanceof autobahn.Connection)
                    //socket.close();
                else if (typeof socket.close === "function")
                    socket.close(); // bitfinex and other APIs // TODO already done in BF class on error. but shouldn't matter?
                else
                    logger.error("Unanble to close unknown WebSocket connection from %s", this.className)
                if (socket instanceof EventEmitter/*typeof socket.removeAllListeners === "function"*/)
                    socket.removeAllListeners()
            }
            if (typeof this.websocketCleanupFunction === "function") {
                if (this.websocketCleanupFunction() === false)
                    logger.error("Error in %s websocket cleanup", this.className)
            }
        }
        catch (err) {
            logger.error("Error closing timed out WebSocket connection", err);
        }
        this.onConnectionClose(reason);
    }

    protected closeApiWebsocketConnection() {
        // overwrite this when using PushApiConnectionType.API_WEBSOCKET
    }

    protected resetWebsocketTimeout() {
        if (this.webSocketTimeoutMs === 0)
            return;
        clearTimeout(this.websocketTimeoutTimerID);
        this.websocketTimeoutTimerID = setTimeout(() => {
            this.closeConnection("Connection timed out");
        }, this.webSocketTimeoutMs);
    }

    protected onConnectionClose(reason: string): void {
        this.connectionState = ConnectionState.CLOSED;
        logger.warn("Websocket connection to %s closed: Reason: %s", this.className, reason);
        clearTimeout(this.websocketTimeoutTimerID);
        //clearTimeout(this.websocketPingTimerID);
        clearTimeout(this.reconnectWebsocketTimerID);
        this.reconnectWebsocketTimerID = setTimeout(this.openConnection.bind(this), this.reconnectWebsocketDelayMs);
    }

    protected openConnection(): void {
        let connection = null;
        if (this.connectionState !== ConnectionState.CLOSED) {
            logger.warn("%s connection already in state %s. Skipped connecting twice", this.className, this.connectionState);
            return;
        }
        this.connectionState = ConnectionState.OPENING;
        if (AbstractMarketData.pushApiConnections.has(this.className))
            return; // already connected
        switch (this.pushApiConnectionType) {
            case PushApiConnectionType.AUTOBAHN:
                connection = this.createConnection();
                break;
            case PushApiConnectionType.WEBSOCKET:
                connection = this.createWebsocketConnection();
                break;
            case PushApiConnectionType.API_WEBSOCKET:
                connection = this.createApiWebsocketConnection();
                break;
            default:
                utils.test.assertUnreachableCode(this.pushApiConnectionType);
        }
        if (connection) {
            AbstractMarketData.pushApiConnections.set(this.className, connection);
            setTimeout(() => { // easy way for all subclasses: just set it to connected if no error occurs
                if (this.connectionState === ConnectionState.OPENING)
                    this.connectionState = ConnectionState.OPEN;
                else
                    logger.warn("%s connection reached unknown state during connecting: %s", this.className, ConnectionState[this.connectionState]);
            }, 5000);
        }
        this.resetWebsocketTimeout();
    }

    protected createConnection(): autobahn.Connection {
        // overwrite this in the subclass and return the connection
        return null;
    }

    protected createWebsocketConnection(): WebSocket {
        // overwrite this in the subclass and return the connection
        return null;
    }

    protected createApiWebsocketConnection(): any {
        // overwrite this in the subclass and return the connection
        return null;
    }

    protected static loadModule(modulePath: string, options: any = undefined) {
        try {
            let ModuleClass = require(modulePath)
            if (ModuleClass.default)
                ModuleClass = ModuleClass.default; // fix for typescript default exports
            let instance = new ModuleClass(options)
            return instance
        }
        catch (e) { // e.code === 'MODULE_NOT_FOUND'
            logger.error('failed to load module: ' + modulePath, e)
            return null
        }
    }
}

// force loading dynamic imports for TypeScript
import "./BitmexMarketData";
