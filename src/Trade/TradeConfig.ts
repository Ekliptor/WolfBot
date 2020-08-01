import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, BotTrade} from "@ekliptor/bit-models";
import {TradeDirection} from "./AbstractTrader";
import * as path from "path";
import {AbstractConfig, BotConfigMode} from "./AbstractConfig";

export type ConfigCurrencyPair = string;
export type TradingMode = "ai" | "lending" | "arbitrage" | "social" | "trading";

export interface ConfigRuntimeUpdate {
    marginTrading: boolean;
    checkCoinBalances: boolean;
    tradeTotalBtc: number;
    maxLeverage: number;
    tradeDirection: TradeDirection;
    warmUpMin: number;
    updateIndicatorsOnTrade: boolean;
    flipPosition: boolean;
    closePositionFirst: boolean;
    closePositionAndTrade: boolean;
    limitOrderToBidAskRate: boolean;
    exchangeParams: string[];
}

export class TradeConfig extends AbstractConfig {
    //public readonly name: string = "";
    public readonly exchanges: string[] = null;
    public readonly exchangeFeeds: string[] = null; // some of the specified exchanges can be used as read-only (no trades submitted). useful to debug arbitrage
    public readonly markets: Currency.CurrencyPair[] = [];
    public readonly marginTrading: boolean = true;
    public readonly checkCoinBalances: boolean = true; // verify we don't buy/sell more than our portfolio balance has (for non-margin trading) to avoid API errors
    public readonly tradeTotalBtc = 0.0; // will be leveraged 2.5 if marginTrading is enabled
    public readonly maxLeverage = 0.0; // in AbstractExchange default is 0.0 too
    public readonly tradeDirection: TradeDirection = "both";
    public readonly warmUpMin: number = 0;
    public readonly updateIndicatorsOnTrade: boolean = false;
    public readonly flipPosition: boolean = false; // trade twice the amount on a buy/sell signal if we have an existing position to flip the position direction
    public readonly closePositionFirst: boolean = false; // close a position on a buy/sell signal opposite to our existing position
    public readonly closePositionAndTrade: boolean = false; // close a position on a buy/sell signal opposite to our existing position first and then trade
    public readonly limitOrderToBidAskRate: boolean = false; // emulate post-only orders
    // additional params for exchanges. since we only create 1 instance per exchange these are merged globally (and not per config instance)
    // requires a restart to take affect
    public readonly exchangeParams: string[] = [];
    public readonly notifyTrades: boolean = false;
    //public readonly strategies: any; // not stored here. strategies have their own instances
    //public readonly configNr: number = 0;
    // TODO an option (and exchange API call) to cancel all open stop orders when closing a position

    //protected static nextConfigNr: number = 0;

    constructor(json: any, configName: string) {
        super(json, configName)
        if (json.exchanges) {
            if (json.exchanges === "default")
                this.exchanges = nconf.get("defaultExchanges")
            else
                this.exchanges = json.exchanges;
            if (!Array.isArray(this.exchanges))
                this.exchanges = [this.exchanges] // happens when running backfind
        }
        else
            this.exchanges = nconf.get("defaultExchanges")
        if (Array.isArray(json.exchangeFeeds) === false)
            this.exchangeFeeds = [];
        else
            this.exchangeFeeds = json.exchangeFeeds;
        this.loadMarkets(json.strategies)
        /*
        json.markets.forEach((market) => {
            let pair = TradeConfig.getCurrencyPair(market)
            this.markets.push(pair)
        })
        */
        if (typeof json.marginTrading === "boolean")
            this.marginTrading = json.marginTrading;
        if (typeof json.checkCoinBalances === "boolean")
            this.checkCoinBalances = json.checkCoinBalances;
        this.tradeTotalBtc = json.tradeTotalBtc;
        if (json.tradeDirection === "up" || json.tradeDirection === "down" || json.tradeDirection === "both")
            this.tradeDirection = json.tradeDirection;
        if (json.warmUpMin)
            this.warmUpMin = parseInt(json.warmUpMin);
        if (typeof json.updateIndicatorsOnTrade === "boolean")
            this.updateIndicatorsOnTrade = json.updateIndicatorsOnTrade;
        if (typeof json.flipPosition === "boolean")
            this.flipPosition = json.flipPosition;
        if (typeof json.closePositionFirst === "boolean")
            this.closePositionFirst = json.closePositionFirst;
        if (typeof json.closePositionAndTrade === "boolean")
            this.closePositionAndTrade = json.closePositionAndTrade;
        if (typeof json.limitOrderToBidAskRate === "boolean")
            this.limitOrderToBidAskRate = json.limitOrderToBidAskRate;
        if (Array.isArray(json.exchangeParams) === true && json.exchangeParams.length !== 0 && typeof json.exchangeParams[0] === "string") {
            this.exchangeParams = json.exchangeParams;
            this.addExchangeParams();
        }
        if (typeof json.notifyTrades === "boolean")
            this.notifyTrades = json.notifyTrades;
        this.validateConfig();
    }

    public static resetCounter() {
        //TradeConfig.nextConfigNr = 0;
        AbstractConfig.resetCounter();
    }

    /**
     * Return a valid config schema or null if the schema can not be parsed.
     * @param json
     */
    public static ensureConfigSchema(json: any): any {
        if (!json || typeof json !== "object" || !json.data)
            return null;
        if (Array.isArray(json.data) === false) {
            if (typeof json.data === "object")
                json.data = [json.data];
            else
                return null;
        }
        if (json.data.length === 0)
            return null;
        return json; // assume valid
    }

    public getConfigCurrencyPair(currencyPair: Currency.CurrencyPair): ConfigCurrencyPair {
        return TradeConfig.createConfigCurrencyPair(this.configNr, currencyPair);
    }

    public static createConfigCurrencyPair(configNr: number, currencyPair: Currency.CurrencyPair): ConfigCurrencyPair {
        return configNr + "-" + currencyPair.toString();
    }

    public listConfigCurrencyPairs() {
        let pairs: ConfigCurrencyPair[] = []
        this.markets.forEach((currencyPair) => {
            pairs.push(this.getConfigCurrencyPair(currencyPair))
        })
        return pairs;
    }

    public hasCurrency(currencyPair: Currency.CurrencyPair) {
        for (let i = 0; i < this.markets.length; i++)
        {
            if (this.markets[i].equals(currencyPair))
                return true;
        }
        return false;
    }

    public static getCurrencyPair(configPair: string): Currency.CurrencyPair {
        let pair = configPair.split("_")
        let cur1 = Currency.Currency[pair[0]]
        let cur2 = Currency.Currency[pair[1]]
        if (!cur1 || !cur2) {
            logger.error("Unknown currency pair in config: %s, base %s, quote %s", configPair, cur1, cur2)
            return undefined;
        }
        return new Currency.CurrencyPair(cur1, cur2)
    }

    public update(update: ConfigRuntimeUpdate) {
        //this.warmUpMin = update.warmUpMin;
        // TODO add/remove properties is not working
        for (let prop in update)
        {
            if (update[prop] !== undefined) // don't set invalid values (removing means setting them to 0/null)
                this[prop] = update[prop];
        }
        this.validateConfig();
    }

    protected loadMarkets(strategies) {
        let markets = new Set<string>();
        // TODO move currencyPair out of strategy and to root config (and then forward it to strategies)
        for (let name in strategies)
            markets.add(strategies[name].pair)
        if (markets.size > 1)
            logger.error("More than 1 currency pair per strategy group is not supported. found %s", markets.size)
        for (let pairStr of markets)
        {
            let pair = TradeConfig.getCurrencyPair(pairStr)
            // TODO parse pairs such as USD_BCHM19 (future contracts) and ensure exchange class can handle the difference on multiple contracts of the same currency
            if (pair === undefined)
                throw new Error("Can not load config markets");
            this.markets.push(pair)
        }
    }

    public static getConfigDir(backupDir = false) {
        const root = backupDir === true ? "config-bak" : "config";
        if (nconf.get("ai"))
            return path.join(utils.appDir, root, "machine-learning")
        else if (nconf.get("lending"))
            return path.join(utils.appDir, root, "lending")
        else if (nconf.get("arbitrage"))
            return path.join(utils.appDir, root, "arbitrage")
        else if (nconf.get("social"))
            return path.join(utils.appDir, root, "social")
        return path.join(utils.appDir, root) // trading
    }

    public static getConfigDirForMode(mode: BotConfigMode, backupDir = false) {
        const root = backupDir === true ? "config-bak" : "config";
        if (mode === "ai")
            return path.join(utils.appDir, root, "machine-learning")
        else if (mode === "lending")
            return path.join(utils.appDir, root, "lending")
        else if (mode === "arbitrage")
            return path.join(utils.appDir, root, "arbitrage")
        else if (mode === "social")
            return path.join(utils.appDir, root, "social")
        return path.join(utils.appDir, root) // trading
    }

    public static getConfigRootDir() {
        return path.join(utils.appDir, "config")
    }

    public static getConfigBackupRootDir() {
        return path.join(utils.appDir, "config-bak")
    }

    public static isTradingMode() {
        return !nconf.get("ai") && !nconf.get("lending") && !nconf.get("arbitrage") && !nconf.get("social");
    }

    public static getTradingMode(): TradingMode {
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

    public static isUserConfig(configName: string): boolean {
        if (!configName)
            return false;
        if (configName[0] !== path.sep)
            configName = path.sep + configName;
        if (configName.substr(-5) !== ".json")
            configName += ".json";
        let existingConfigs = nconf.get("serverConfig:userConfigs") || [];
        return existingConfigs.indexOf(configName) !== -1;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected addExchangeParams() {
        if (this.exchangeParams.length === 0)
            return;
        let existing: string[] = nconf.get("exchangeParams");
        this.exchangeParams.forEach((param) => {
            if (existing.indexOf(param) === -1)
                existing.push(param);
        });
        nconf.set("exchangeParams", existing);
    }

    protected validateConfig() {
        super.validateConfig();
        if (this.marginTrading === false) {
            if (this.closePositionFirst === true)
                logger.error("Config error: closePositionFirst can only be used for marginTrading.");
            if (this.closePositionAndTrade === true)
                logger.error("Config error: closePositionAndTrade can only be used for marginTrading.");
        }
    }
}
