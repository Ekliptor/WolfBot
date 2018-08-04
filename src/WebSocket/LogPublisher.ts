import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as WebSocket from "ws";
import * as http from "http";
import * as path from "path";
import {ServerSocketPublisher, ServerSocket} from "./ServerSocket";
import {AppPublisher} from "./AppPublisher";
import {WebSocketOpcode} from "./opcodes";
import {AbstractTrader} from "../Trade/AbstractTrader";
import TradeAdvisor from "../TradeAdvisor";
import {AbstractAdvisor} from "../AbstractAdvisor";

export type LogType = "a" | "t"; // app or trades. short to save bytes
export type TradingMode = "ai" | "lending" | "arbitrage" | "social" | "trading";
export interface LogUpdate {
    state?: {
        trader: {
            paused: boolean;
            pausedOpeningPositions: boolean;
        }
        mode: TradingMode;
        devMode: boolean;
        error: boolean;
    }
}

export class LogPublisher extends AppPublisher {
    public readonly opcode = WebSocketOpcode.LOG;

    protected recentLogLines = new Map<LogType, string[]>();

    constructor(serverSocket: ServerSocket, advisor: AbstractAdvisor) {
        super(serverSocket, advisor)
        this.recentLogLines.set("a", []);
        this.recentLogLines.set("t", []);
        this.startLogStream();
    }

    public onSubscription(clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        this.publish({a: this.recentLogLines.get("a")}) // moved to onData() to allow manual subscription
        this.publish({t: this.recentLogLines.get("t")})

        // some global states
        const traders = this.advisor.getTraders();
        let state: LogUpdate = {
            state: {
                trader: {
                    paused: traders.length !== 0 && traders[0].getPausedTrading(), // all should have the same value
                    pausedOpeningPositions: false
                },
                mode: this.getTradingMode(),
                devMode: nconf.get("serverConfig:user:devMode") ? true : false,
                error: this.advisor.isErrorState()
            }
        }
        if (this.advisor instanceof TradeAdvisor && traders.length !== 0)
            state.state.trader.pausedOpeningPositions = (traders[0] as AbstractTrader).getPausedOpeningPositions();
        this.publish(state)
    }

    protected onData(data: any, clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        // nothing?
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected startLogStream() {
        /*
         logger.stream().on('log', (log) => { // streams entries previously logged
         console.log(log);
         });
         */
        // start the listener before we read the file
        logger.on('logging', (transport, level, msg, meta) => {
            if (transport.name !== "file")
                return;
            // [msg] and [meta] have now been logged at [level] to [transport]
            //console.log("[%s] and [%s] have now been logged at [%s] to [%s]", msg, JSON.stringify(meta), level, transport.name);
            let line = utils.getUnixTimeStr(true) + " - " + level + ": " + msg;
            if (meta && /*Array.isArray(meta) === true*/utils.objects.isEmpty(meta) === false) {
                const logStr = typeof meta.toString === "function" ? meta.toString() : "";
                if (logStr !== "[object Object]") { // an error object
                    line += " " + logStr;
                    //meta.message is identical as toString()
                    if (meta.stack && !nconf.get("serverConfig:premium")) { // disable printing stacktraces for public apps
                        if (typeof meta.stack.toString === "function")
                            line += "\r\n" + meta.stack.toString(); // will print message again too
                        else
                            line += "\r\n" + JSON.stringify(meta.stack, null, 4);
                    }
                }
                else { // any args parameters passed into the log function
                    try {
                        line += " " + JSON.stringify(meta); // additional parameters
                    }
                    catch (err) {
                        logger.error("Error serializing log to JSON", err)
                        // Converting circular structure to JSON <- happens when we log error objects from other classes
                        try {
                            line += " " + JSON.stringify(meta, (key, value) => {
                                if (typeof value === "object" || typeof value === "function") // easy solution: filter all objects
                                    return undefined;
                                return value;
                            });
                        }
                        catch (err) {
                            logger.error("Error serializing log to JSON (2nd try)", err)
                        }
                    }
                }
            }
            if (line.indexOf("JSON string: <") === -1) // don't spam the web log with html
                this.addLogLine("a", line);
        });

        /* // logfile gets deleted and re-created on start, so it might not exist (or worse the old one exists). skip this for now
        const logfile = path.join(utils.appDir, nconf.get("logfile"));
        utils.tail(logfile, nconf.get("serverConfig:uiLogLineCount"), (err, lines) => {
            if (err)
                return logger.error("Error starting app log stream", err);
            this.recentLogLines = this.recentLogLines.concat(lines);
        })
        */

        this.advisor.getTraders().forEach((trader) => {
            trader.on("log", (line) => {
                this.addLogLine("t", line);
            })
        })
    }

    protected addLogLine(type: LogType, line: string) {
        this.recentLogLines.get(type).push(line);
        if (this.recentLogLines.get(type).length > nconf.get("serverConfig:uiLogLineCount"))
            this.recentLogLines.get(type).splice(0, 1);
        let msg = {};
        msg[type] = [line];
        this.publish(msg)
    }

    protected getTradingMode(): TradingMode {
        if (nconf.get("ai"))
            return "ai";
        else if (nconf.get("lending"))
            return "lending";
        else if (nconf.get("arbitrage"))
            return "arbitrage";
        else if (nconf.get("social"))
            return "social";
        return "trading";
    }
}