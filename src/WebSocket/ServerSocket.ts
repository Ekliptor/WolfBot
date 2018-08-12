import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as WebSocket from "ws";
import * as http from "http";
import {WebSocketOpcode, WebSocketError, AppJSONFormat} from "./opcodes";
import {ServerOptions} from "ws";

export type SubscriptionAction = "sub" | "unsub"; // {action: x}

export class ClientSocketOnServer extends WebSocket {
    public id: string = null; // unique ID for every client socket connection
    constructor(address: string, protocols?: string | string[], options?: WebSocket.ClientOptions) {
        super(address, protocols, options)
    }
}

/**
 * A class sending data to 1 or many WebSocket clients.
 */
export abstract class ServerSocketPublisher {
    public readonly opcode: WebSocketOpcode;

    protected className: string;
    protected serverSocket: ServerSocket;
    protected subscribers = new Map<WebSocket, Date>(); // (WebSocket, subscription start)
    // the client socket this publisher shall send messages to. leave undefined to broadcast to call all connected subscribers
    protected clientSocket?: WebSocket;

    constructor(serverSocket: ServerSocket, clientSocket?: WebSocket) {
        this.className = this.constructor.name;
        this.serverSocket = serverSocket;
        this.clientSocket = clientSocket;
    }

    public onSubscription(clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        // called when a new connection from a client subscribing to this publisher is opened
    }

    public onClose(clientSocket: WebSocket): void {
        // called when the connection is closed (usually the user closes the browser window)
    }

    public handleData(data: any, clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        if (data.action) {
            if (data.action === "sub") {
                if (!this.subscribers.has(clientSocket))
                    this.subscribers.set(clientSocket, new Date());
                this.onSubscription(clientSocket, initialRequest); // allow sending the data 2x if this is the first page (for persistent subscriptions)
                this.schedulePing(clientSocket);
                return;
            }
            else if (data.action === "unsub") {
                this.subscribers.delete(clientSocket);
                return;
            }
        }
        this.onData(data, clientSocket, initialRequest);
    }

    public removeSubscriber(clientSocket: WebSocket) {
        this.subscribers.delete(clientSocket);
        this.onClose(clientSocket);
    }

    public skipPublishing() {
        return this.subscribers.size === 0; // save CPU by not computing data. map only contains subscribers for the current view
    }

    protected onData(data: any, clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        // overwrite this to process data from websocket clients
    }

    protected send(ws: WebSocket, data: any, options?: ServerSocketSendOptions) {
        return this.serverSocket.send(ws, ServerSocket.stringify(this.opcode, data), options)
    }

    protected sendWithOpcode(ws: WebSocket, opcode: WebSocketOpcode, data: any, options?: ServerSocketSendOptions) {
        return this.serverSocket.send(ws, ServerSocket.stringify(opcode, data), options)
    }

    protected publish(data: any, excludeClients = new Set<WebSocket>(), options?: ServerSocketSendOptions) {
        return new Promise<void>((resolve, reject) => {
            if (this.clientSocket !== undefined) {
                this.clientSocket.send([this.opcode, data], options, (err) => {
                    if (err)
                        logger.error("Error sending WebSocket data to client", err)
                });
                return;
            }
            let clients = [];
            for (let client of this.subscribers)
            {
                if (excludeClients.has(client[0]) === false)
                    clients.push(client[0])
            }
            this.serverSocket.broadcastTo(ServerSocket.stringify(this.opcode, data), clients, options).then(() => {
                resolve();
            })
        })
    }

    protected schedulePing(clientSocket: WebSocket) {
        setTimeout(() => {
            this.sendWithOpcode(clientSocket, WebSocketOpcode.PING, {ping: Date.now()}).then((success) => {
                if (success !== false)
                    this.schedulePing(clientSocket);
            });
        }, nconf.get("serverConfig:websocketPingMs"))
    }

    // TODO add functions to publish binary data
}

export interface ServerSocketSendOptions { // from ws.send()
    mask?: boolean;
    binary?: boolean
}

export class ServerSocket extends WebSocket.Server {
    protected className: string;
    protected receivers = new Map<WebSocketOpcode, ServerSocketPublisher>();

    constructor(options?: WebSocket.ServerOptions, callback?: () => void) {
        super(options, callback)
        this.className = this.constructor.name;
        this.waitForConnections();
    }

    public static stringify(opcode: WebSocketOpcode, data: any) {
        if (AppJSONFormat === "JSON")
            return JSON.stringify([opcode, data])
        return utils.EJSON.stringify([opcode, data])
    }

    public subscribe(publisher: ServerSocketPublisher) {
        this.receivers.set(publisher.opcode, publisher);
    }

    public send(ws: WebSocket, data: any, options?: ServerSocketSendOptions) {
        return new Promise<boolean>((resolve, reject) => {
            ws.send(data, options, (err) => {
                if (err) {
                    logger.error("Error send WebSocket data", err);
                    return resolve(false);
                }
                resolve(true);
            })
        })
    }

    /**
     * Send data from the server to all connected WebSocket clients.
     * @param data
     * @param excludeClients Don't broadcast to these clients. Useful when we relay messages received from another client.
     * @param options
     * @returns {Promise<void>}
     */
    public broadcast(data: any, excludeClients = new Set<WebSocket>(), options?: ServerSocketSendOptions) {
        return new Promise<void>((resolve, reject) => {
            let sendOps = []
            this.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN && excludeClients.has(client) === false) {
                    sendOps.push(new Promise((resolve, reject) => {
                        client.send(data, options, (err) => {
                            if (err)
                                logger.error("Error broadcasting WebSocket data to client", err)
                            resolve() // continue broadcasting
                        });
                    }))
                }
            })
            Promise.all(sendOps).then(() => {
                resolve()
            })
        })
    }

    /**
     * Send data from the server to the specified WebSocket clients.
     * @param data
     * @param clients
     * @param options
     * @returns {Promise<void>}
     */
    public broadcastTo(data: any, clients: WebSocket[], options?: ServerSocketSendOptions) {
        return new Promise<void>((resolve, reject) => {
            let sendOps = []
            clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    sendOps.push(new Promise((resolve, reject) => {
                        client.send(data, options, (err) => {
                            if (err)
                                logger.error("Error broadcasting WebSocket data to client", err)
                            resolve() // continue broadcasting
                        });
                    }))
                }
            })
            Promise.all(sendOps).then(() => {
                resolve()
            })
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected waitForConnections() {
        const getUniqueID = () => {
            const s4 = () => {
                return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
            }
            return s4() + s4() + '-' + s4();
        }
        this.on("connection", (ws: ClientSocketOnServer, request) => {
            let params = utils.url.getUrlParameters(request.url)
            let keys = nconf.get('apiKeys')
            if (!params["apiKey"] || keys[params["apiKey"]] !== true) {
                logger.warn("Refusing WebSocket connection without authentication on %s from %s", request.url, request.socket.remoteAddress)
                const errorMsg: WebSocketError = nconf.get("serverConfig:premium") === true? "UnauthorizedPremium" : "Unauthorized";
                this.sendErrorAndClose(ws, errorMsg);
                // TODO create none/read/write permissions per ServerSocketPublisher? this way wey can always process the message by calling handleData()
                // but requires more developer work to check for permissions in onData()
                return;
            }
            if (ws.id === undefined)
                ws.id = getUniqueID(); // TODO instantiate subclass?
            else
                logger.error("Property 'id' is already defined for incoming WebSocket connection", ws.id)

            ws.on("message", (message) => {
                try {
                    if (typeof message !== "string")
                        return logger.warn("Received WebSocket data with unexpected type %s", typeof message);
                    const messageData = AppJSONFormat === "JSON" ? JSON.parse(message) : utils.EJSON.parse(message);
                    let receiver = this.receivers.get(messageData[0]);
                    if (receiver !== undefined)
                        receiver.handleData(messageData[1], ws, request);
                    else
                        logger.warn("Received WebSocket data without corresponding receiver. Opcode %s", messageData[0])
                }
                catch (err) {
                    logger.error("Error parsing WebSocket message in %s:", this.className, err);
                    logger.error(JSON.stringify(message))
                }
            })
            ws.on("error", (err) => {
                logger.error("WebSocket error in %s", this.className, err);
            })
            ws.on("close", (code, message) => {
                logger.verbose("WebSocket connection closed with code %s: %s", code, message);
                for (let receiver of this.receivers)
                    receiver[1].removeSubscriber(ws);
            })
            //ws.send("foo from server")

            // notify all receivers about this new connection
            //for (let receiver of this.receivers) // removed in favor of onSubscription()
                //receiver[1].onConnection(ws, request);
        })
    }

    protected sendErrorAndClose(ws: WebSocket, error: WebSocketError, options?: ServerSocketSendOptions) {
        return this.sendAndClose(ws, ServerSocket.stringify(WebSocketOpcode.FATAL_ERROR, {err: error}), options);
    }

    protected sendClose(ws: WebSocket, closeReason = "", options?: ServerSocketSendOptions) {
        return this.sendAndClose(ws, ServerSocket.stringify(WebSocketOpcode.CLOSE, {txt: closeReason}), options);
    }

    protected sendAndClose(ws: WebSocket, data: any, options?: ServerSocketSendOptions) {
        return new Promise<void>((resolve, reject) => {
            ws.send(data, options, (err) => {
                if (err)
                    logger.error("Error ending WebSocket connection with message", err)
                ws.close(); // could also send data as 2nd param, but without options?
                resolve();
            })
        })
    }
}