
export const enum WebSocketOpcode {
    // general opcodes
    FATAL_ERROR = 1,                // an error that closes the connection
    ERROR = 2,
    WARNING = 3,
    CLOSE = 4,

    // application opcodes
    STATUS = 10,
    LOG = 11,
    STRATEGIES = 12,
    CONFIG = 13,
    ORACLE = 14,
    LENDING = 15,
    SOCIAL = 16,
    COINMARKET = 17,
    TRADINGVIEW = 18,
    TRADE_HISTORY = 19,
    BACKTESTING = 20,
    SCRIPTS = 21,
    HOME = 22,
    LOGIN = 23
}

export type WebSocketError = "Unauthorized";

export type JSONFormat = "JSON" | "EJSON";
export const AppJSONFormat: JSONFormat = "EJSON";