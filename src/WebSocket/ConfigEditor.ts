import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as WebSocket from "ws";
import * as http from "http";
import {ServerSocketPublisher, ServerSocket, ServerSocketSendOptions} from "./ServerSocket";
import {AppPublisher} from "./AppPublisher";
import {WebSocketOpcode} from "./opcodes";
import TradeAdvisor from "../TradeAdvisor";
import {TradeConfig, ConfigRuntimeUpdate, ConfigCurrencyPair} from "../Trade/TradeConfig";
import * as path from "path";
import * as fs from "fs";
import * as childProcess from "child_process";
import {AbstractAdvisor} from "../AbstractAdvisor";
import {LendingAdvisor} from "../Lending/LendingAdvisor";
import {LendingConfig} from "../Lending/LendingConfig";
import {Currency, BotTrade, serverConfig} from "@ekliptor/bit-models";
import * as _ from "lodash";
import {SocialController} from "../Social/SocialController";
import {SocialConfig} from "../Social/SocialConfig";
import {BotConfigMode} from "../Trade/AbstractConfig";
import * as db from "../database";

export type ConfigTab = "tabGeneral" | "tabTrading" | "tabTradingDev";
const CONFIG_TABS: ConfigTab[] = ["tabGeneral", "tabTrading", "tabTradingDev"];

export interface ConfigData {
    debugMode?: boolean;
    devMode?: boolean;
    selectedTab?: ConfigTab;
}
export interface ConfigRes extends ConfigData {
    error?: boolean;
    errorTxt?: string;
    errorCode?: string;

    premium?: boolean;

    tradingModes?: BotTrade.TradingMode[];
    configFiles?: string[];
    traders?: string[];
    lending?: boolean;
    arbitrage?: boolean;
    social?: boolean;
    selectedTradingMode?: BotTrade.TradingMode;
    selectedConfig?: string;
    selectedTrader?: string;
    configFileData?: string;
    tabs?: ConfigTab[];

    changed?: boolean;
    saved?: boolean;
}
export interface ConfigReq extends ConfigData {
    saveConfig?: string;
    configName?: string;
    configChange?: string;
    traderChange?: string;
    tradingModeChange?: BotTrade.TradingMode;
    setPaused?: boolean;
    setPausedOpening?: boolean;
    restart?: boolean;
}

export class ConfigEditor extends AppPublisher {
    public readonly opcode = WebSocketOpcode.CONFIG;

    protected selectedTradingMode: BotTrade.TradingMode;
    protected selectedConfig: string;
    protected selectedTrader: string;
    protected savedState = false;
    protected selectedTab: ConfigTab = "tabGeneral";

    constructor(serverSocket: ServerSocket, advisor: AbstractAdvisor) {
        super(serverSocket, advisor)
        this.selectedTradingMode = nconf.get("lending") === true ? "lending" : (nconf.get("arbitrage") == true ? "arbitrage" : "trading");
        this.selectedConfig = this.advisor.getConfigName();
        this.selectedTrader = this.getSelectedTrader();
        nconf.set("debugRestart", nconf.get("debug"))

        // store results on exit (kill signal)
        // strange place for this code. but in here the state gets stored on regular exit
        //process.stdin.resume();//so the program will not close instantly
        let exitHandler = (options, err) => {
            logger.info("Exiting main process. Please wait...");
            if (options.cleanup) {
                if (!this.savedState && nconf.get("trader") !== "Backtester") // don't overwrite last results if this session didn't crawl anything
                    this.saveState(true).catch((err) => {
                        logger.error("Error saving state on exit", err)
                    })
            }
            if (err)
                logger.error(err.stack);
            if (options.exit)
                //process.exit(0);
                setTimeout(process.exit.bind(this, 0), 1500);
        }
        //do something when app is closing (parent will kill the child in ProcessForker)
        process.on('exit', exitHandler.bind(null, {cleanup:true}));
        process.on('SIGTERM', exitHandler.bind(null, {cleanup:true, exit:true}));
        //catches ctrl+c event
        process.on('SIGINT', exitHandler.bind(null, {exit:true}));
        //catches uncaught exceptions
        process.on('uncaughtException', exitHandler.bind(null, {exit:true}));

        this.scheduleSaveState();
    }

    public static getConfigDir() {
        return TradeConfig.getConfigDir();
    }

    public static listConfigFiles(mode?: BotConfigMode) {
        return new Promise<string[]>((resolve, reject) => {
            const configDir = mode ? TradeConfig.getConfigDirForMode(mode) : TradeConfig.getConfigDir();
            utils.file.listDir(configDir, (err, dirFiles) => {
                if (err)
                    reject(err)
                resolve(dirFiles)
            })
        })
    }

    public onSubscription(clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        let configs = this.advisor.getConfigs();
        let configFiles;
        ConfigEditor.listConfigFiles().then((files) => {
            configFiles = files;
            return this.readConfigFile(this.selectedConfig)
        }).then((configFileData) => {
            this.send(clientSocket, {
                tradingModes: BotTrade.TRADING_MODES,
                configFiles: configFiles,
                traders: nconf.get("traders"),
                lending: nconf.get("lending") ? true : false,
                arbitrage: nconf.get("arbitrage") ? true : false,
                social: nconf.get("social") ? true : false,
                selectedTradingMode: this.selectedTradingMode,
                selectedConfig: this.selectedConfig,
                selectedTrader: this.selectedTrader,
                configFileData: configFileData,
                premium: nconf.get("serverConfig:premium"),
                debugMode: nconf.get("debugRestart"),
                devMode: nconf.get("serverConfig:user:devMode"),
                tabs: CONFIG_TABS,
                selectedTab: this.selectedTab
            });
        }).catch((err) => {
            logger.error("Error loading config view data", err)
        })
    }

    protected onData(data: ConfigReq, clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        if (typeof data.configChange === "string") {
            this.readConfigFile(data.configChange).then((configFileData) => {
                this.selectedConfig = data.configChange.substr(1).replace(/\.json$/, "");
                this.send(clientSocket, {
                    configFileData: configFileData
                });
            }).catch((err) => {
                const msg = "Error reading config file"
                logger.error(msg, err)
                this.send(clientSocket, {
                    error: true,
                    errorTxt: msg
                });
            })
        }
        else if (typeof data.traderChange === "string") {
            let traders = nconf.get("traders");
            if (traders.indexOf(data.traderChange) !== -1) {
                this.selectedTrader = data.traderChange;
                this.send(clientSocket, {changed: true})
            }
            else
                this.send(clientSocket, {error: true, errorTxt: "This trader doesn't exist."})
        }
        else if (typeof data.tradingModeChange === "string") {
            if (BotTrade.TRADING_MODES.indexOf(data.tradingModeChange) !== -1) {
                this.selectedTradingMode = data.tradingModeChange;
                this.send(clientSocket, {changed: true})
            }
            else
                this.send(clientSocket, {error: true, errorTxt: "This trading mode doesn't exist."})
        }
        else if (typeof data.saveConfig === "string" && data.configName) {
            // TODO broadcast config change to other clients
            if (utils.parseJson(data.saveConfig) == null)
                this.send(clientSocket, {error: true, errorCode: "syntaxErrorConf"})
            else {
                this.saveConfigFile(data.configName, data.saveConfig).then(() => {
                    this.updateConfig(data.saveConfig)
                    this.send(clientSocket, {saved: true})
                }).catch((err) => {
                    logger.error("Error saving config", err)
                    this.send(clientSocket, {error: true, errorTxt: "Error saving config."})
                })
            }
        }
        else if (typeof data.debugMode === "boolean") {
            if (nconf.get("serverConfig:premium")) {
                logger.error("Can not set debug mode in premium bot");
                return;
            }
            nconf.stores.env.readOnly = false;
            nconf.set("debugRestart", data.debugMode) // changing "debug" doesn't work. why? but we have to restart either way to re-initialized log
            this.send(clientSocket, {saved: true})
        }
        else if (typeof data.devMode === "boolean") {
            nconf.set("serverConfig:user:devMode", data.devMode)
            serverConfig.saveConfig(db.get(), nconf.get("serverConfig"))
            this.send(clientSocket, {saved: true})
        }
        else if (data.restart === true) {
            this.restart()
        }
        else if (typeof data.setPaused === "boolean") {
            this.advisor.getTraders().forEach((trader) => {
                trader.setPausedTrading(data.setPaused)
            })
            this.send(clientSocket, {saved: true})
        }
        else if (typeof data.setPausedOpening === "boolean" && this.advisor instanceof TradeAdvisor) {
            this.advisor.getTraders().forEach((trader) => {
                trader.setPausedOpeningPositions(data.setPausedOpening)
            })
            this.send(clientSocket, {saved: true})
        }
    }

    public restart() {
        this.saveState().then(() => {
            let processArgs = Object.assign([], process.execArgv)
            for (let i=0; i < processArgs.length; i++) {
                if (processArgs[i].substr(0,12) == "--debug-brk=") {
                    processArgs[i] = "--debug-brk=" + (nconf.get('debuggerPort') ? nconf.get('debuggerPort') : 43207)
                    //dbg = true
                    //break
                }
                //else if (processArgs[i].substr(0, 21) == "--max-old-space-size=")
                    //processArgs[i] = "--max-old-space-size=1224"; // reduce max memory
            }
            let options = {
                encoding: 'utf8',
                //timeout: timeoutMs, // send killSignal after timeout ms
                //maxBuffer: 500 * 1024 * 1024, // max bytes in stdout or stderr // 500 mb
                killSignal: 'SIGTERM',
                cwd: process.cwd(),
                env: process.env, // key-value pairs
                detached: true,
                stdio: 'ignore'
            }

            let args = this.getRestartArgs(processArgs.concat(process.argv.slice(1)))
            const child = childProcess.spawn(process.argv[0], args, options)
            child.unref()
            process.exit(0)
        }).catch((err) => {
            logger.error("Error restarting bot", err)
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected readConfigFile(name: string, updateStrategyValues: boolean = true) {
        return new Promise<string>((resolve, reject) => {
            if (name.substr(-5) !== ".json")
                name += ".json";
            const configFile = path.join(ConfigEditor.getConfigDir(), name)
            if (!utils.file.isSafePath(configFile))
                return reject({txt: "Can not access path outside of app dir"})
            fs.readFile(configFile, "utf8", (err, data) => {
                if (err)
                    reject(err)
                if (updateStrategyValues)
                    data = this.updateStrategyValues(data);
                resolve(data)
            })
        })
    }

    protected saveConfigFile(name: string, data: string) {
        return new Promise<void>((resolve, reject) => {
            if (name.substr(-5) !== ".json")
                name += ".json";
            const configFile = path.join(ConfigEditor.getConfigDir(), name)
            if (!utils.file.isSafePath(configFile))
                return reject({txt: "Can not access path outside of app dir"})
            fs.writeFile(configFile, data, {encoding: "utf8"}, (err) => {
                if (err)
                    reject(err)
                resolve()
            })
        })
    }

    /**
     * Update strategy values to reflect current state, so that we can easier edit & save without changing/resetting values
     * @param {string} jsonStr
     * @returns {string}
     */
    protected updateStrategyValues(jsonStr: string) {
        let json = utils.parseJson(jsonStr);
        if (!json || !Array.isArray(json.data))
            return jsonStr;
        if (this.advisor instanceof TradeAdvisor) {
            let configs: TradeConfig[] = this.advisor.getConfigs();
            let strategies = this.advisor.getStrategies();
            for (let i = 0; i < json.data.length; i++) {
                let conf = json.data[i]
                if (!configs[i]) { // sometimes undefined when changing configs when removing currencies // TODO why?
                    logger.error("Unable to get config at pos %s to show current strategy values", i, configs)
                    return jsonStr;
                }

                let pairs = configs[i].listConfigCurrencyPairs();
                pairs.forEach((pair) => {
                    let strategyList = strategies.get(pair); // get values from all strategies for this config-currency pair
                    strategyList.forEach((strat) => {
                        let action = strat.getAction();
                        let strategyConf = conf.strategies[strat.getClassName()];
                        if (!strategyConf)
                            return logger.error("Strategy settings are missing in loaded config for strategy %s", strat.getClassName())
                        for (let prop in strategyConf) {
                            // check if the value in the json string "conf" is idential to the current live state
                            // compare as strings to be sure comparison works for objects such as CurrencyPair
                            if (strategyConf[prop] !== undefined && action[prop] !== undefined && strategyConf[prop].toString() !== action[prop].toString()) {
                                logger.verbose("updating strategy %s %s %s from %s to %s", strat.getAction().pair.toString(), strat.getClassName(), prop, strategyConf[prop], action[prop])
                                strategyConf[prop] = action[prop];
                            }
                        }
                    })
                })
            }
        }
        else if (this.advisor instanceof LendingAdvisor) {
            let configs: LendingConfig[] = this.advisor.getConfigs();
            let strategies = this.advisor.getLendingStrategies();
            for (let i = 0; i < json.data.length; i++) {
                let conf = json.data[i]
                if (!configs[i]) { // sometimes undefined when changing configs when removing currencies // TODO why?
                    logger.error("Unable to get config at pos %s to show current strategy values", i, configs)
                    return jsonStr;
                }

                let currencies = configs[i].listConfigCurrencies();
                // we don't have to update currency values when loading data here, because unlike strategy actions they can't change by themselves
                // values of all strategy instances should be the same
                currencies.forEach((currency) => {
                    let strategyList = strategies.get(currency); // get values from all strategies for this config-currency pair
                    strategyList.forEach((strat) => {
                        let action = strat.getAction();
                        let strategyConf = conf.strategies[strat.getClassName()];
                        if (!strategyConf)
                            return logger.error("Strategy settings are missing in loaded config for strategy %s", strat.getClassName())
                        for (let prop in strategyConf) {
                            // check if the value in the json string "conf" is idential to the current live state
                            // compare as strings to be sure comparison works for objects such as CurrencyPair
                            if (strategyConf[prop] !== undefined && action[prop] !== undefined && strategyConf[prop].toString() !== action[prop].toString()) {
                                logger.verbose("updating strategy %s %s %s from %s to %s", strat.getAction().currency.toString(), strat.getClassName(), prop, strategyConf[prop], action[prop])
                                strategyConf[prop] = action[prop];
                            }
                        }
                    })
                })
            }
        }
        else if (this.advisor instanceof SocialController) {
            let configs: SocialConfig[] = this.advisor.getConfigs();
            let crawlers = this.advisor.getCrawlers();
            for (let i = 0; i < json.data.length; i++) {
                let conf = json.data[i]
                if (!configs[i]) { // sometimes undefined when changing configs when removing currencies // TODO why?
                    logger.error("Unable to get config at pos %s to show current strategy values", i, configs)
                    return jsonStr;
                }

                // just go through all crawlers and update their settings
                crawlers.forEach((crawler) => {
                    let crawlerConf = crawler.getConfig();
                    let websiteConf = conf.websites[crawler.getClassName()];
                    for (let prop in crawlerConf) {
                        if (websiteConf[prop] !== undefined && crawlerConf[prop] !== undefined && websiteConf[prop].toString() !== crawlerConf[prop]) {
                            logger.verbose("updating crawler %s %s from %s to %s", crawler.getClassName(), prop, crawlerConf[prop], websiteConf[prop])
                            crawlerConf[prop] = websiteConf[prop];
                        }
                    }
                })
            }
        }
        // TODO not formatted identically to string on disk, but beautiful;)
        return utils.stringifyBeautiful(json); // convert the updated data back to string
    }

    protected updateConfig(jsonStr: string) {
        let json = utils.parseJson(jsonStr);
        if (!json || !Array.isArray(json.data))
            return;
        // TODO config updates are wrong if the user puts them in another order
        try {
            if (this.advisor instanceof TradeAdvisor) {
                let configs: TradeConfig[] = this.advisor.getConfigs();
                let strategies = this.advisor.getStrategies();
                for (let i = 0; i < json.data.length; i++) {
                    let conf = json.data[i]
                    let update = {
                        marginTrading: conf.marginTrading,
                        tradeTotalBtc: conf.tradeTotalBtc,
                        tradeDirection: conf.tradeDirection,
                        warmUpMin: conf.warmUpMin
                    }
                    configs[i].update(update)

                    let pairs = configs[i].listConfigCurrencyPairs();
                    pairs.forEach((pair) => {
                        let strategyList = strategies.get(pair); // update all strategies for this config-currency pair
                        strategyList.forEach((strat) => {
                            let action = strat.getAction();
                            //let prevAction = _.cloneDeep(action); // TODO bad idea because of default action values
                            let strategyConf = conf.strategies[strat.getClassName()];
                            if (!strategyConf)
                                return logger.error("Strategy settings are missing in new config for strategy %s", strat.getClassName())
                            this.updateStrategyProp(strategyConf, action)
                            if (JSON.stringify(action) !== JSON.stringify(strat.getAction()))
                                strat.onConfigChanged();
                        })
                    })
                }
            }
            else if (this.advisor instanceof LendingAdvisor) {
                let configs: LendingConfig[] = this.advisor.getConfigs();
                let strategies = this.advisor.getLendingStrategies();
                for (let i = 0; i < json.data.length; i++) {
                    let conf = json.data[i]
                    let update = {
                        pollTimeActive: conf.marginTrading,
                        pollTimeInactive: conf.tradeTotalBtc,
                        xDayThreshold: conf.tradeDirection,
                        xDays: conf.warmUpMin
                    }

                    let updatedConfigInstances = new Set<ConfigCurrencyPair>();
                    for (let u = 0; u < configs.length; u++)
                    {
                        // loop through all config instances and find the matching ones
                        if (configs[u].exchange !== conf.exchange)
                            continue;
                        for (let currencyStr in conf.currencies)
                        {
                            const currencyNr = Currency.Currency[currencyStr]
                            if (!configs[u].hasCurrency(currencyNr) || updatedConfigInstances.has(configs[u].getConfigCurrencyPair(currencyNr)))
                                continue;
                            // strategy updates must be set for all config instances (each currency has its own strategy instance)

                            configs[u].update(update)

                            let currencies = configs[u].listConfigCurrencies();
                            currencies.forEach((currency) => {
                                let strategyList = strategies.get(currency); // update all strategies for this config-currency pair
                                strategyList.forEach((strat) => {
                                    let action = strat.getAction();
                                    //let prevAction = _.cloneDeep(action);
                                    let strategyConf = conf.strategies[strat.getClassName()];
                                    if (!strategyConf)
                                        return logger.error("Strategy settings are missing in new config for strategy %s", strat.getClassName())
                                    this.updateStrategyProp(strategyConf, action)
                                    updatedConfigInstances.add(configs[u].getConfigCurrencyPair(currencyNr))
                                    if (JSON.stringify(action) !== JSON.stringify(strat.getAction()))
                                        strat.onConfigChanged();
                                })
                            })
                        }
                    }
                }

                // check for currency specific updates and set them. each currency has it's own config instance internally
                // json.data will only have 1 entry, so this has to be another loop
                json.data.forEach((lendingConfJson) => {
                    for (let jsonCur in lendingConfJson.currencies)
                    {
                        for (let i = 0; i < configs.length; i++) // find the matching config instance for this currency from json
                        {
                            const currencyNr = Currency.Currency[jsonCur];
                            if (configs[i].markets.indexOf(currencyNr) !== -1) {
                                let update = {
                                    maxActiveAmount: lendingConfJson.currencies[jsonCur].maxActiveAmount ? lendingConfJson.currencies[jsonCur].maxActiveAmount : 1,
                                    minLoanSize: lendingConfJson.currencies[jsonCur].minLoanSize,
                                    minDailyRate: lendingConfJson.currencies[jsonCur].minDailyRate,
                                    maxToLend: lendingConfJson.currencies[jsonCur].maxToLend ? lendingConfJson.currencies[jsonCur].maxToLend : 0,
                                    maxPercentToLend: lendingConfJson.currencies[jsonCur].maxPercentToLend ? lendingConfJson.currencies[jsonCur].maxPercentToLend : 100,
                                    returnDateUTC: lendingConfJson.currencies[jsonCur].returnDateUTC ? lendingConfJson.currencies[jsonCur].returnDateUTC : ""
                                }
                                configs[i].updateCurrency(update)
                                break; // we can update more than 1 currency, but then within the same inner loop
                            }
                        }
                    }
                })
            }
            else if (this.advisor instanceof SocialController) {
                let configs: SocialConfig[] = this.advisor.getConfigs();
                let crawlers = this.advisor.getCrawlers();
                for (let i = 0; i < json.data.length; i++) {
                    let conf = json.data[i]
                    let update = {
                        updateMin: conf.updateMin
                    }
                    configs[i].update(update)

                    crawlers.forEach((crawler) => {
                        let crawlerConf = crawler.getConfig();
                        let websiteConf = conf.websites[crawler.getClassName()];
                        this.updateStrategyProp(websiteConf, crawlerConf)
                        if (JSON.stringify(crawlerConf) !== JSON.stringify(crawler.getConfig()))
                            crawler.onConfigChanged();
                    })
                }
            }
        }
        catch (err) {
            logger.error("Error processing config update", err)
        }
    }

    protected updateStrategyProp(values: any, root: any) {
        for (let prop in values)
        {
            const type = typeof values[prop]
            if (type === "object") {
                if (Array.isArray(values[prop]))
                    root[prop] = values[prop];
                else
                    this.updateStrategyProp(values[prop], root[prop]) // update recursively
            }
            else if (type === "string" || type === "number" || type === "boolean") {
                if (typeof root[prop] === type) // only update generic types (not objects such as CurrencyPair)
                    root[prop] = values[prop];
            }
            else
                logger.warn("Can not update config property %s of unknown type %s", prop, type)
        }
    }

    protected getSelectedTrader() {
        let trader = this.advisor.getTraderName();
        if (trader === "RealTimeLendingTrader" || nconf.get("lending")) // lending only supports real time for now // TODO
            return "realTime";
        else if (trader === "RealTimeTrader")
            return nconf.get("tradeMode") === 1 ? "realTimePaper": "realTime"
        else if (trader === "TradeNotifier")
            return "notifier"
        else if (trader === "Backtester")
            return trader;
        logger.error("Unknown trader %s selected", trader)
        return trader;
    }

    protected getRestartArgs(args: string[]) {
        let newArgs = []
        let foundTrader = false;
        let foundLending = false;
        let foundArbitrage = false;
        let getTraderParams = () => {
            if (this.selectedTrader === "realTime")
                return ["--trader=RealTimeTrader"];
            else if (this.selectedTrader === "realTimePaper")
                return ["--trader=RealTimeTrader",  "--paper"];
            else if (this.selectedTrader === "notifier")
                return ["--trader=TradeNotifier"];
            logger.error("Unknown trader %s selected for restart", this.selectedTrader)
            return [""];
        }
        for (let i = 0; i < args.length; i++)
        {
            if (args[i] === "--paper")
                continue; // only added together with another arg
            else if (args[i] === "--debug" && !nconf.get("debugRestart"))
                continue;
            if (args[i].substr(0, 8) === "--config")
                newArgs.push("--config=" + this.selectedConfig);
            else if (args[i].substr(0, 8) === "--trader") {
                let params = getTraderParams();
                newArgs.push(...params)
                foundTrader = true;
            }

            // change the trading mode for restart
            else if (args[i] === "--lending") {
                if (this.selectedTradingMode === "lending")
                    newArgs.push(args[i])
                foundLending = true;
            }
            else if (args[i] === "--arbitrage") {
                if (this.selectedTradingMode === "arbitrage")
                    newArgs.push(args[i])
                foundArbitrage = true;
            }
            else
                newArgs.push(args[i])
        }
        if (!foundTrader) {
            let params = getTraderParams();
            newArgs.push(...params)
        }
        if (!foundLending && this.selectedTradingMode === "lending")
            newArgs.push("--lending");
        else if (!foundArbitrage && this.selectedTradingMode === "arbitrage")
            newArgs.push("--arbitrage");
        if (nconf.get("debugRestart") && newArgs.indexOf("--debug") === -1)
            newArgs.push("--debug")
        return newArgs
    }

    protected saveState(sync: boolean = false) {
        return new Promise<void>((resolve, reject) => {
            this.savedState = true; // set saved even if it fails
            let state = this.advisor.serializeAllStrategyData();
            const filePath = this.advisor.getSaveStateFile()
            const filePathBackup = this.advisor.getSaveStateBackupFile()
            let jsonStateStr: string;
            try {
                jsonStateStr = utils.EJSON.stringify(state);
            }
            catch (e) {
                logger.error("Error serializing state to save bot state, retrying", e)
                try { // maybe some circular dependencies EJSON couldn't handle (though our bot shouldn't have that and EJSON can handle it!!?)
                    jsonStateStr = utils.EJSON.stringify(JSON.parse(JSON.stringify(state)));
                }
                catch (e) {
                    return reject({txt: "Error serializing state to save bot state", err: e})
                }
            }

            if (sync) { // do it sync for exit handler
                try {
                    if (fs.existsSync(filePath))
                        fs.renameSync(filePath, filePathBackup) // keep a backup copy in case something crashes while writing (or reading?)
                    fs.writeFileSync(filePath, jsonStateStr, {encoding: "utf8"})
                }
                catch (e) {
                    return reject({txt: "Error saving bot state sync", err: e})
                }
                logger.verbose("Saved strategy state to: %s", filePath)
                resolve()
            }
            else { // better performance, otherwise large states can make the bot unresponsive
                fs.writeFile(filePath, jsonStateStr, {encoding: "utf8"}, (err) => {
                    if (err)
                        return reject({txt: "Error saving bot state", err: err})
                    logger.verbose("Saved strategy state to: %s", filePath)
                    resolve()
                })
            }
        })
    }

    protected scheduleSaveState() {
        if (nconf.get("serverConfig:saveStateMin") == 0)
            return;
        setTimeout(() => {
            this.saveState().then(() => {
                this.scheduleSaveState();
            }).catch((err) => {
                logger.error("Error on scheduled save state", err)
                this.scheduleSaveState();
            })
        }, nconf.get("serverConfig:saveStateMin") * utils.constants.MINUTE_IN_SECONDS*1000)
    }

    protected send(ws: WebSocket, data: ConfigRes, options?: ServerSocketSendOptions) {
        return super.send(ws, data, options);
    }
}