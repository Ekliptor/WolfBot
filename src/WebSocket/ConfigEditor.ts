import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as WebSocket from "ws";
import * as http from "http";
import {ServerSocketPublisher, ServerSocket, ServerSocketSendOptions, ClientSocketOnServer} from "./ServerSocket";
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
import {setUserUpdateSec} from "@ekliptor/bit-models/build/models/user";
import {AbstractNotification} from "../Notifications/AbstractNotification";
import Notification from "../Notifications/Notification";

export type ConfigTab = "tabGeneral" | "tabTrading" | "tabTradingDev";
const CONFIG_TABS: ConfigTab[] = ["tabGeneral", "tabTrading", "tabTradingDev"];

export interface ConfigEditorData {
    data: any[]; // TODO config types
    schema: {

    }
}
export interface ExchangeApiConfig {
    key: string;
    secret: string
    key2?: string;
    secret2?: string;
}
export interface ExchangeApiKeyMap {
    [exchangeName: string]: ExchangeApiConfig;
}
export interface NotificationKey {
    //key: string;
    receiver?: string;
}
export interface NotificationMethodMap {
    [notificationMethod: string]: NotificationKey;
}
export interface ConfigData {
    debugMode?: boolean;
    devMode?: boolean;
    restoreCfg?: boolean;
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
    activeConfig?: string;
    selectedTrader?: string;
    configFileData?: string;
    jsonEditorData?: ConfigEditorData;
    tabs?: ConfigTab[];
    exchanges?: string[];
    exchangeKeys?: ExchangeApiKeyMap;
    notifications?: NotificationMethodMap;

    changed?: boolean;
    saved?: boolean;
    restart?: boolean;
}
export interface ConfigReq extends ConfigData {
    saveConfig?: string;
    configName?: string;
    configChange?: string;
    deleteConfig?: string;
    copyConfig?: string;
    saveKey?: ExchangeApiKeyMap;
    saveNotification?: NotificationMethodMap;
    notificationMeta?: {
        title: string;
        text: string;
    }
    traderChange?: string;
    tradingModeChange?: BotTrade.TradingMode;
    setPaused?: boolean;
    setPausedOpening?: boolean;
    restart?: boolean;
}

export class ConfigEditor extends AppPublisher {
    public readonly opcode = WebSocketOpcode.CONFIG;
    // TODO add "list all currencies" button

    protected selectedTradingMode: BotTrade.TradingMode;
    protected selectedConfig: string;
    protected readonly activeConfig: string; // config file changes require a restart
    protected selectedTrader: string;
    protected savedState = false;
    protected selectedTab: ConfigTab = "tabGeneral";

    constructor(serverSocket: ServerSocket, advisor: AbstractAdvisor) {
        super(serverSocket, advisor)
        this.selectedTradingMode = nconf.get("lending") === true ? "lending" : (nconf.get("arbitrage") == true ? "arbitrage" : "trading");
        this.selectedConfig = this.advisor.getConfigName();
        this.activeConfig = this.selectedConfig;
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
                dirFiles = dirFiles.filter(f => f.substr(1).indexOf(path.sep) === -1); // filter files in subfolders (other trading modes)
                resolve(dirFiles)
            })
        })
    }

    public onSubscription(clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
        this.sendInitialData(clientSocket)
    }

    protected sendInitialData(clientSocket: ClientSocketOnServer) {
        //let configs = this.advisor.getConfigs();
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
                activeConfig: this.activeConfig,
                selectedTrader: this.selectedTrader,
                configFileData: configFileData,
                jsonEditorData: this.createEditorSchema(configFileData, this.selectedConfig),
                premium: nconf.get("serverConfig:premium"),
                debugMode: nconf.get("debugRestart"),
                devMode: nconf.get("serverConfig:user:devMode"),
                restoreCfg: nconf.get("serverConfig:user:restoreCfg"),
                tabs: CONFIG_TABS,
                selectedTab: this.selectedTab,
                exchanges: Array.from(Currency.ExchangeName.keys()),
                exchangeKeys: this.getExchangeKeys(),
                notifications: this.getNotificationMethods()
            });
        }).catch((err) => {
            logger.error("Error loading config view data", err)
        })
    }

    protected onData(data: ConfigReq, clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
        if (typeof data.configChange === "string") {
            this.readConfigFile(data.configChange).then((configFileData) => {
                this.selectedConfig = this.getPlainConfigName(data.configChange);
                this.send(clientSocket, {
                    configFileData: configFileData
                });
            }).catch((err) => {
                logger.error("Error reading config file", err)
                this.sendErrorMessage(clientSocket, "errorReadingConf");
            })
        }
        else if (typeof data.deleteConfig === "string") {
            this.removeConfigFile(data.deleteConfig).then(() => {
                this.send(clientSocket, {saved: true})
            }).catch((err) => {
                logger.error("Error deleting config file", err)
                this.sendErrorMessage(clientSocket, "errorDeletingConf");
            });
        }
        else if (typeof data.copyConfig === "string") {
            data.copyConfig = "/" + data.copyConfig.trim() + ".json";
            ConfigEditor.listConfigFiles().then(async (files) => {
                if (this.isExistingConfigFile(data.copyConfig, files))
                    return this.sendErrorMessage(clientSocket, "errorConfExists");
                await this.copyConfigFile(data.copyConfig);
                this.send(clientSocket, {saved: true, configFiles: await ConfigEditor.listConfigFiles()}); // load files again with the new one
            }).catch((err) => {
                logger.error("Error copying config file", err)
                this.sendErrorMessage(clientSocket, "errorCopyingConf");
            });
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
        else if (data.saveConfig && data.configName) {
            // TODO broadcast config change to other clients
            // JSONView sends an object, code editor a string
            if (typeof data.saveConfig === "string") {
                if (utils.parseJson(data.saveConfig) == null) { // validate JSON
                    this.send(clientSocket, {error: true, errorCode: "syntaxErrorConf"})
                    return;
                }
            }
            else
                data.saveConfig = utils.stringifyBeautiful(data.saveConfig);
            this.saveConfigFile(data.configName, data.saveConfig).then(() => {
                this.updateConfig(data.saveConfig)
                this.send(clientSocket, {saved: true})
            }).catch((err) => {
                logger.error("Error saving config", err)
                this.send(clientSocket, {error: true, errorTxt: "Error saving config."})
            })
        }
        else if (typeof data.saveKey === "object") {
            for (let exchangeName in data.saveKey)
            {
                if (Currency.ExchangeName.has(exchangeName) === false) {
                    logger.error("Can not update unknown exchange API keys %s", exchangeName);
                    continue;
                }
                // for UI users we can only have 1 set of keys per instance
                let currentKey = nconf.get("serverConfig:apiKey:exchange:" + exchangeName)[0];
                let props = Object.keys(data.saveKey[exchangeName]);
                props.forEach((prop ) => {
                    if (currentKey[prop] === undefined)
                        return;
                    else if (data.saveKey[exchangeName][prop] == "")
                        return;
                    currentKey[prop] = data.saveKey[exchangeName][prop];
                });
                nconf.set("serverConfig:apiKey:exchange:" + exchangeName, [currentKey]);
                serverConfig.saveConfigLocal();
            }
            this.send(clientSocket, {saved: true, restart: true})
        }
        else if (typeof data.saveNotification === "object") {
            const previousNotficiationSetting = JSON.stringify(nconf.get("serverConfig:apiKey:notify"));
            for (let method in data.saveNotification)
            {
                if (Currency.NotificationMethods.has(method) === false) {
                    logger.error("Can not update unknown notification method %s", method);
                    continue;
                }
                let currentKey = nconf.get("serverConfig:apiKey:notify:" + method);
                let props = Object.keys(data.saveNotification[method]);
                props.forEach((prop ) => {
                    if (currentKey[prop] === undefined)
                        return;
                    else if (data.saveNotification[method][prop] == "")
                        return;
                    currentKey[prop] = data.saveNotification[method][prop];
                });
                nconf.set("serverConfig:apiKey:notify:" + method, currentKey);
                serverConfig.saveConfigLocal();
            }
            if (JSON.stringify(nconf.get("serverConfig:apiKey:notify")) !== previousNotficiationSetting)
                this.sendTestNotification(data.notificationMeta.title, data.notificationMeta.text);
            this.send(clientSocket, {saved: true})
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
            //serverConfig.saveConfig(db.get(), nconf.get("serverConfig"))
            serverConfig.saveConfigLocal();
            this.send(clientSocket, {saved: true})
        }
        else if (typeof data.restoreCfg === "boolean") {
            nconf.set("serverConfig:user:restoreCfg", data.restoreCfg)
            serverConfig.saveConfigLocal();
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

        else if (typeof data.selectedTab === "string") {
            this.selectedTab = data.selectedTab;
            this.sendInitialData(clientSocket); // send the data again to display possibly updated values in UI
            return;
        }
    }

    public restart(forceDefaults = false) {
        if (forceDefaults === true)
            this.selectedTradingMode = "trading";
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

    protected removeConfigFile(name: string) {
        return new Promise<void>((resolve, reject) => {
            const configFile = path.join(ConfigEditor.getConfigDir(), name)
            if (!utils.file.isSafePath(configFile))
                return reject({txt: "Can not access path outside of app dir"})
            fs.unlink(configFile, (err) => {
                if (err && err.code !== "ENOENT")
                    return reject({txt: "Error removing config file", err: err});
                resolve();
            });
        })
    }

    protected copyConfigFile(nameNew: string) {
        return new Promise<void>((resolve, reject) => {
            const configFileSrc = path.join(ConfigEditor.getConfigDir(), this.selectedConfig + ".json")
            const configFileDest = path.join(ConfigEditor.getConfigDir(), nameNew)
            fs.copyFile(configFileSrc, configFileDest, (err) => {
                if (err)
                    return reject({txt: "Error copying config file", err: err});
                resolve();
            });
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
                    let websiteConf = conf.websites && conf.websites[crawler.getClassName()] ? conf.websites[crawler.getClassName()] : conf.watchers[crawler.getClassName()];
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
                        let websiteConf = conf.websites && conf.websites[crawler.getClassName()] ? conf.websites[crawler.getClassName()] : conf.watchers[crawler.getClassName()];
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
            else { // better performance, otherwise large states can make the bot unresponsive. only pack when saving async
                let packState = nconf.get("serverConfig:gzipState") ? utils.text.packGzip(jsonStateStr) : Promise.resolve(jsonStateStr)
                packState.then((packedStateStr) => {
                    fs.writeFile(filePath, packedStateStr, {encoding: "utf8"}, (err) => {
                        if (err)
                            return reject({txt: "Error saving bot state", err: err})
                        logger.verbose("Saved strategy state to: %s", filePath)
                        resolve()
                    })
                }).catch((err) => {
                    logger.error("Error packing state string", err)
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

    protected createEditorSchema(configFileData: string, configName: string): ConfigEditorData {
        let data: ConfigEditorData = {
            data: [],
            schema: {}
        }
        let jsonData = utils.parseJson(configFileData);
        if (jsonData === null || !jsonData.data || Array.isArray(jsonData.data) === false || jsonData.data.length === 0) {
            logger.error("Error loading config file data from disk")
            return data;
        }
        let properties = this.createSchemaProperties(jsonData.data[0])
        // enabling/disablen properties is done on client side. via schema we can only set global editor options (for all properties)?
        let defautlSchema = {
            title: configName,
            //type: "object",
            //properties: properties
            type: "array",
            items: {
                type: "object",
                title: "configShort",
                properties: properties
            }
        }
        data.data = jsonData.data;
        data.schema = defautlSchema;
        return data;
    }

    protected createSchemaProperties(defaultSite: any) {
        let schema = {}
        let count = 0
        for (let prop in defaultSite)
        {
            let curType = this.getSchemaType(defaultSite[prop])
            schema[prop] = {
                //title: this.req.t(prop), // don't translate those properties
                type: curType,
                propertyOrder: ++count
                //description: "foooo" // added on client-side
            }
            // create enums with select elements
            /*
            if (prop === 'cms') {
                schema[prop].type = 'array'
                schema[prop].uniqueItems = true
                schema[prop].format = 'select'
                schema[prop].items = {
                    type: 'string',
                    enum: Object.values(crawlSite.CMS)
                }
            }
            */
            if (prop === "exchanges") {
                if (nconf.get("arbitrage")) {
                    schema[prop].type =  "array";
                    /*
                    schema[prop].items = {
                        "type": "object",
                            "title": "exchange",
                            "properties": {
                            "type": {
                                "type": "string",
                                    "enum": Currency.listExchangeNames()
                            }
                        }
                    }
                    */
                    schema[prop].items = {
                        "type": "string",
                        "title": "exchange",
                        "enum": Currency.listExchangeNames()
                    }
                    //schema[prop].enum = Currency.listExchangeNames();
                }
                else {
                    schema[prop].type =  "string";
                    schema[prop].enum = Currency.listExchangeNames();
                }
                continue;
            }

            if (curType === 'array')
                this.addArraySubTypes(schema[prop], defaultSite[prop])
            else if (curType === 'object')
                this.addObjectSubTypes(schema[prop], defaultSite[prop])
        }
        return schema
    }

    protected getSchemaType(value) {
        let type = typeof value
        if (type === 'object')
            return Array.isArray(value) ? 'array' : 'object'
        return type
    }

    protected addArraySubTypes(parent, value) {
        let hasValue = value && value.length !== 0
        let curType = this.getSchemaType(hasValue ? value[0] : null) // null will result in object
        if (parent.items === undefined)
            parent.items = {}
        parent.items.type = curType
        if (curType === 'array' && hasValue)
            this.addArraySubTypes(parent.items, value[0])
        else if (curType === 'object' && hasValue)
            this.addObjectSubTypes(parent.items, value[0])
    }

    protected addObjectSubTypes(parent, value) {
        if (parent.properties === undefined)
            parent.properties = {}
        for (let prop in value)
        {
            let curType = this.getSchemaType(value[prop])
            parent.properties[prop] = {
                type: curType
            }
            if (curType === 'array')
                this.addArraySubTypes(parent.properties[prop], value[prop])
            else if (curType === 'object')
                this.addObjectSubTypes(parent.properties[prop], value[prop])
        }
    }

    protected getExchangeKeys() {
        let keys = nconf.get("serverConfig:apiKey:exchange");
        let userKeys: ExchangeApiKeyMap = {};
        for (let exchangeName in keys)
        {
            let exchangeKeys = keys[exchangeName];
            if (Array.isArray(exchangeKeys) === false || exchangeKeys.length === 0) {
                logger.warn("Invalid exchange API config for %s", exchangeName, exchangeKeys);
                userKeys[exchangeName] = { // we must return empty strings so that form inputs show up
                    key: "",
                    secret: "",
                    //key2: Currency.TwoKeyExchanges.has(exchangeName) === true ? "" : undefined, // shouldn't happen. we start with empty strings as config
                    key2: undefined,
                    secret2: ""
                };
                continue;
            }
            userKeys[exchangeName] = {
                key: exchangeKeys[0].key,
                //secret: exchangeKeys[0].secret, // don't display secrets on the client
                secret: "",
                key2: exchangeKeys[0].key2,
                //secret2: exchangeKeys[0].secret2
                secret2: ""
            };
        }
        return userKeys;
    }

    protected getNotificationMethods() {
        let keys = nconf.get("serverConfig:apiKey:notify");
        let notifyKeys: NotificationMethodMap = {};
        for (let method in keys)
        {
            notifyKeys[method] = Object.assign({}, keys[method]);
            if ((notifyKeys[method] as any).appToken) // Pushover appToken can not be changed
                delete (notifyKeys[method] as any).appToken;
        }
        return notifyKeys;
    }

    protected sendTestNotification(title: string, text: string) {
        let notifier = AbstractNotification.getInstance();
        let headline = utils.sprintf(title, nconf.get("projectNameLong"));
        let notification = new Notification(headline, text, false);
        notifier.send(notification).then(() => {
        }).catch((err) => {
            logger.error("Error sending %s notification", this.className, err)
        });
    }

    protected isExistingConfigFile(configNameNew: string, existingFiles: string[]) {
        const nameNewLower = this.getPlainConfigName(configNameNew.toLocaleLowerCase());
        for (let i = 0; i < existingFiles.length; i++)
        {
            let name = this.getPlainConfigName(existingFiles[i].toLocaleLowerCase());
            if (nameNewLower === name)
                return true;
        }
        return false;
    }

    protected getPlainConfigName(filename: string) {
        return filename.substr(1).replace(/\.json$/, "");
    }

    protected send(ws: ClientSocketOnServer, data: ConfigRes, options?: ServerSocketSendOptions) {
        return super.send(ws, data, options);
    }
}
