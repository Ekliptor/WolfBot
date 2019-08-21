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
import {AbstractAdvisor, StrategyJson} from "../AbstractAdvisor";
import {LendingAdvisor} from "../Lending/LendingAdvisor";
import {LendingConfig} from "../Lending/LendingConfig";
import {Currency, BotTrade, serverConfig} from "@ekliptor/bit-models";
import * as _ from "lodash";
import {SocialController} from "../Social/SocialController";
import {SocialConfig} from "../Social/SocialConfig";
import {BotConfigMode} from "../Trade/AbstractConfig";
import * as db from "../database";
import {AbstractNotification} from "../Notifications/AbstractNotification";
import Notification from "../Notifications/Notification";
import {Wizard, WizardData} from "./widgets/Wizard";
import {serverConfig as startConfig} from "../../configLocal";

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
    passphrase: string;
    key2?: string;
    secret2?: string;
    passphrase2?: string;
}
export interface ExchangeApiKeyMap {
    [exchangeName: string]: ExchangeApiConfig;
}
export interface ExchangeLinkMap {
    [exchangeName: string]: string;
}
export interface ExchangePairMap {
    [exchangeName: string]: string[]; // list of recommended pairs per exchange
}
export interface NotificationKey {
    //key: string;
    receiver?: string;
    channel?: string;
}
export interface NotificationMethodMap {
    [notificationMethod: string]: NotificationKey;
}
export interface NotificationLinkMap {
    [notificationMethod: string]: string;
}
export interface DisplayCurrencyMap {
    [tickerName: string]: string;
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
    wizardErrorCode?: string;

    premium?: boolean;
    configWasReset?: boolean;

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
    exchangeLinks?: ExchangeLinkMap;
    exchangePairs?: ExchangePairMap;
    wizardStrategies?: string[];
    wizardCandleSizes?: string[];
    notifications?: NotificationMethodMap;
    notificationAppLinks?: NotificationLinkMap;
    notificationMethod?: string;
    currencies?: DisplayCurrencyMap;

    changed?: boolean;
    saved?: boolean;
    restart?: boolean; // notify the client he should restart
    restarting?: boolean; // restart initiated by server
}
export interface ConfigReq extends ConfigData {
    saveConfig?: string;
    configName?: string;
    configChange?: string;
    deleteConfig?: string;
    copyConfig?: string;
    saveKey?: ExchangeApiKeyMap;
    removeApiKey?: string; // exchange name
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
    getCurrencies?: boolean;
    wizardData?: WizardData;
}

export interface SaveConfigFileRes {
    saved: boolean;
    restart: boolean;
}

export class ConfigEditor extends AppPublisher {
    public readonly opcode = WebSocketOpcode.CONFIG;

    protected selectedTradingMode: BotTrade.TradingMode;
    protected selectedConfig: string;
    protected static activeConfig: string; // config file changes require a restart
    protected static instance: ConfigEditor = null; // to access it from outside. readonly is not available for static members
    protected selectedTrader: string;
    protected savedState = false;
    protected selectedTab: ConfigTab = "tabGeneral";
    protected configErrorTimer: NodeJS.Timer = null;
    protected lastWorkingExchanges: string[] = [];
    protected pairChangePendingRestart = false;
    protected initialPairs = new Set<string>();

    constructor(serverSocket: ServerSocket, advisor: AbstractAdvisor) {
        super(serverSocket, advisor)
        if (ConfigEditor.instance === null)
            ConfigEditor.instance = this;
        this.selectedTradingMode = nconf.get("lending") === true ? "lending" : (nconf.get("arbitrage") == true ? "arbitrage" : "trading");
        this.selectedConfig = this.advisor.getConfigName();
        ConfigEditor.activeConfig = this.selectedConfig;
        this.selectedTrader = this.getSelectedTrader();
        nconf.set("debugRestart", nconf.get("debug"));
        serverConfig.saveConfigLocal();

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
        /*
        setTimeout(() => { // used if we uploaded temp config files
            const configDir =TradeConfig.getConfigDirForMode("trading");
            const configBackupDir =TradeConfig.getConfigDirForMode("trading", true);
            utils.file.deleteFiles([path.join(configDir, "gWeekPredictorg.json"), path.join(configDir, "ggWeekPredictorgg.json"),
                path.join(configBackupDir, "gWeekPredictorg.json"), path.join(configBackupDir, "ggWeekPredictorgg.json")]);
        }, 0);
        */
    }

    public static getInstance() {
        return ConfigEditor.instance;
    }

    public static getActiveConfig() {
        return ConfigEditor.activeConfig;
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
                if (nconf.get("serverConfig:premium") === true) { // filter local backtesting files
                    dirFiles = dirFiles.filter(f => f.substr(0, 6) !== "/Back-");
                }
                resolve(dirFiles)
            })
        })
    }

    public onSubscription(clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
        const exchangeController = this.advisor.getExchangeController();
        if (!exchangeController || exchangeController.isExchangesIdle() === true) {
            setTimeout(() => {
                logger.warn("Delayed sending initial client data because exchange connection(s) are not ready yet.");
                this.sendInitialData(clientSocket)
            }, 2000);
        }
        else
            this.sendInitialData(clientSocket)
    }

    protected sendInitialData(clientSocket: ClientSocketOnServer) {
        //let configs = this.advisor.getConfigs();
        let configFiles;
        ConfigEditor.listConfigFiles().then((files) => {
            configFiles = files;
            return this.readConfigFile(this.selectedConfig)
        }).then((configFileData) => {
            let validConfigFile = this.validateConfigArray(configFileData); // TODO how does this error happen on restart? external/manual edit?
            if (validConfigFile)
                configFileData = utils.stringifyBeautiful(validConfigFile);
            else
                logger.error("Invalid config file %s on initial client data", this.selectedConfig);

            this.send(clientSocket, {
                tradingModes: BotTrade.TRADING_MODES,
                configFiles: configFiles,
                traders: nconf.get("traders"),
                lending: nconf.get("lending") ? true : false,
                arbitrage: nconf.get("arbitrage") ? true : false,
                social: nconf.get("social") ? true : false,
                selectedTradingMode: this.selectedTradingMode,
                selectedConfig: this.selectedConfig,
                activeConfig: ConfigEditor.activeConfig,
                selectedTrader: this.selectedTrader,
                configFileData: configFileData,
                jsonEditorData: this.createEditorSchema(configFileData, this.selectedConfig),
                premium: nconf.get("serverConfig:premium"),
                debugMode: nconf.get("debugRestart"),
                devMode: nconf.get("serverConfig:user:devMode"),
                restoreCfg: nconf.get("serverConfig:user:restoreCfg"),
                configWasReset: nconf.get("serverConfig:configReset"),
                tabs: CONFIG_TABS,
                selectedTab: this.selectedTab,
                exchanges: Array.from(Currency.ExchangeName.keys()),
                exchangeKeys: this.getExchangeKeys(),
                // @ts-ignore
                exchangeLinks: Currency.ExchangeLink.toObject(),
                exchangePairs: Currency.ExchangeRecommendedPairs.toObject(),
                wizardStrategies: nconf.get("serverConfig:wizardStrategies"),
                wizardCandleSizes: nconf.get("serverConfig:wizardCandleSizes"),
                notifications: this.getNotificationMethods(),
                notificationAppLinks: serverConfig.NotificationMethodLinks.toObject(),
                notificationMethod: nconf.get("serverConfig:notificationMethod")
            });
            this.setLastWorkingConfig();
            if (nconf.get("serverConfig:configReset") === true)
                nconf.set("serverConfig:configReset", false);
        }).catch((err) => {
            logger.error("Error loading config view data", err)
            this.restart(true); // user will likely not be able to change config
        })
    }

    protected onData(data: ConfigReq, clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
        if (typeof data.configChange === "string") {
            this.readConfigFile(data.configChange).then((configFileData) => {
                let configName = this.getPlainConfigName(data.configChange);
                if (configName)
                    this.selectedConfig = configName;
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
                if (TradeConfig.isUserConfig(data.deleteConfig) === true) // if it's a default config we will restor it with original values on restart
                    return this.removeConfigFile(data.deleteConfig, true);
            }).then(() => {
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
                this.changeTradingMode(data, clientSocket);
            }
            else
                this.send(clientSocket, {error: true, errorTxt: "This trading mode doesn't exist."})
        }
        else if (data.saveConfig && data.configName) {
            // TODO broadcast config change to other clients
            // JSONView sends an object, code editor a string
            let configObj: any = null;
            if (typeof data.saveConfig === "string") {
                configObj = utils.parseJson(data.saveConfig);
                if (configObj == null) { // validate JSON
                    this.send(clientSocket, {error: true, errorCode: "syntaxErrorConf"})
                    return;
                }
                configObj = this.validateConfigArray(configObj);
            }
            else
                configObj = this.validateConfigArray(data.saveConfig);
            if (configObj === null) {
                this.send(clientSocket, {error: true, errorCode: "invalidConfSchema"})
                return;
            }
            data.saveConfig = utils.stringifyBeautiful(configObj);
            this.saveConfigFile(data.configName, data.saveConfig).then(() => {
                let requireRestrt = this.updateConfig(data.saveConfig);
                this.send(clientSocket, {saved: true, restart: requireRestrt});
                setTimeout(() => { // make sure JSONview has the latest data
                    this.sendInitialData(clientSocket);
                }, 0);
                // causes problems when reading changes, possible reverting currency pair
                //return this.readConfigFile(this.selectedConfig)
            /*}).then((configFileData) => {
                this.send(clientSocket, { // make sure we display latest values
                    configFileData: configFileData,
                    jsonEditorData: this.createEditorSchema(configFileData, this.selectedConfig),
                });
            */}).catch((err) => {
                logger.error("Error saving config", err)
                this.send(clientSocket, {error: true, errorTxt: "Error saving config."})
            });
        }
        else if (typeof data.saveKey === "object") {
            const wasEmpty = serverConfig.isEmptyApiKeys(nconf.get("serverConfig:apiKey:exchange"));
            let firstExchange = "";
            for (let exchangeName in data.saveKey)
            {
                if (Currency.ExchangeName.has(exchangeName) === false) {
                    logger.error("Can not update unknown exchange API keys %s", exchangeName);
                    continue;
                }
                // for UI users we can only have 1 set of keys per instance
                let currentExchangeKeys = nconf.get("serverConfig:apiKey:exchange:" + exchangeName);
                //if (Array.isArray(currentExchangeKeys) === false || currentExchangeKeys.length === 0) // already done when loading exchanges with values from serverConfig
                    //currentExchangeKeys.push({});
                let currentKey = currentExchangeKeys[0];
                let props = Object.keys(data.saveKey[exchangeName]);
                props.forEach((prop ) => {
                    if (currentKey[prop] === undefined)
                        return;
                    else if (data.saveKey[exchangeName][prop] == "")
                        return;
                    currentKey[prop] = data.saveKey[exchangeName][prop];
                });
                if (nconf.get("serverConfig:apiKey:exchange:" + exchangeName) && (!currentKey || !currentKey.key))
                    continue; // ensure we never overwrite to empty keys
                if (firstExchange.length === 0)
                    firstExchange = exchangeName;
                nconf.set("serverConfig:apiKey:exchange:" + exchangeName, [currentKey]);
            }
            serverConfig.saveConfigLocal();
            if (wasEmpty === true && firstExchange.length !== 0)
                this.setExchangeInConfig(firstExchange);
            this.send(clientSocket, {saved: true, restart: true});
        }
        else if (typeof data.removeApiKey === "string") {
            const exchangeName = data.removeApiKey;
            let currentKey = nconf.get("serverConfig:apiKey:exchange:" + exchangeName)[0];
            if (currentKey) {
                for (let prop in currentKey) {
                    if (typeof currentKey[prop] === "string")
                        currentKey[prop] = "";
                }
                nconf.set("serverConfig:apiKey:exchange:" + exchangeName, [currentKey]);
                serverConfig.saveConfigLocal();
            }
            this.send(clientSocket, {saved: true, restart: true});
        }
        else if (typeof data.saveNotification === "object") {
            const previousNotficiationSetting = JSON.stringify(nconf.get("serverConfig:apiKey:notify"));
            for (let method in data.saveNotification)
            {
                if (serverConfig.NotificationMethodLinks.has(method) === false) {
                    logger.error("Can not update unknown notification method %s", method);
                    continue;
                }
                let currentKey = nconf.get("serverConfig:apiKey:notify:" + method) || startConfig.apiKey.notify[method];
                let props = Object.keys(data.saveNotification[method]);
                props.forEach((prop ) => {
                    if (currentKey[prop] === undefined)
                        return;
                    else if (data.saveNotification[method][prop] == "")
                        return;
                    currentKey[prop] = data.saveNotification[method][prop];
                });
                nconf.set("serverConfig:apiKey:notify:" + method, currentKey);
                nconf.set("serverConfig:notificationMethod", method);
                serverConfig.saveConfigLocal();
            }
            if (JSON.stringify(nconf.get("serverConfig:apiKey:notify")) !== previousNotficiationSetting) {
                setTimeout(() => { // delay this to ensure we use the latest config
                    this.sendTestNotification(data.notificationMeta.title, data.notificationMeta.text);
                }, 1000);
            }
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
        else if (typeof data.getCurrencies === "boolean") {
            this.send(clientSocket, {currencies: this.getDisplayCurrencyMap()})
        }

        else if (typeof data.selectedTab === "string") {
            this.selectedTab = data.selectedTab;
            this.sendInitialData(clientSocket); // send the data again to display possibly updated values in UI
            return;
        }
        else if (typeof data.wizardData === "object") {
            this.addWizardConfig(data.wizardData, clientSocket);
            return;
        }
    }

    public restart(forceDefaults = false, resetMode = false) {
        const configFile = this.getFirstFileForMode(resetMode ? "trading" : this.selectedTradingMode);
        if (resetMode)
            this.selectedTradingMode = "trading"; // just to be sure
        if (forceDefaults === true) {
            const paramsFile = path.join(/*utils.appDir, */nconf.get("lastParamsFile")); // use working dir
            fs.unlink(paramsFile, (err) => {
                if (err && err.code !== "ENOENT")
                    logger.warn("Error deleting last params file on restart", err);
            });
            let resetAll = false;
            if (this.selectedTradingMode !== "trading") {
                // try the 1st config file of that mode if we aren't already using it
                if (this.selectedConfig !== configFile)
                    this.selectedConfig = configFile;
                else
                    resetAll = true;
            }
            if (this.lastRestartWasPreviously() === true)
                resetAll = true;
            if (resetAll === true) {
                this.selectedTradingMode = "trading";
                // bad idea to just restore to "Noop" because the user might not have API keys or modified/broke that config
                this.selectedConfig = nconf.get("serverConfig:lastWorkingConfigName");
                if (fs.existsSync(path.join(TradeConfig.getConfigDirForMode(this.selectedTradingMode), this.selectedConfig + ".json")) === false)
                    this.selectedConfig = configFile;
                nconf.set("serverConfig:configReset", true);
                //this.selectedConfig = nconf.get("serverConfig:fallbackTradingConfig");
            }
            nconf.set("serverConfig:lastRestartTime", new Date()); // only count forced (auto) restarts
            serverConfig.saveConfigLocal();
        }
        this.saveState().then(async () => {
            await utils.promiseDelay(3500); // ensure LastParams is deleted and give the restart more time
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
                //encoding: 'utf8',
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

    /**
     * Return the config as javascript object.
     * @param configNr starting at 1. Use 0 to return the full config array for all trading pairs.
     * @param configFile The config file to load. Defaults to the currently active file
     * @return the JS object or null on failure
     */
    public static async getConfigData(configNr: number, configFileName: string = ""): Promise<any> {
        if (!configFileName)
            configFileName = ConfigEditor.activeConfig;
        if (configFileName.substr(-5) !== ".json")
            configFileName += ".json";
        const configFile = path.join(ConfigEditor.getConfigDir(), configFileName);
        if (!utils.file.isSafePath(configFile))
            throw "Can not access path outside of app dir";
        let configStr = await utils.file.readFile(configFile);
        let configObj = utils.parseJson(configStr);
        if (configObj === null || Array.isArray(configObj.data) === false || configObj.data.length < configNr)
            return null;
        if (configNr === 0)
            return configObj.data;
        let configForNr = configObj.data[configNr-1];
        if (!configForNr || !configForNr.strategies)
            return null;
        return configForNr;
    }

    /**
     * Return the strategy config as javascript object.
     * @param configNr starting at 1
     * @param strategyName
     * @param configFile The config file to load. Defaults to the currently active file
     * @return the JS object or null on failure
     */
    public static async getStrategyConfig(configNr: number, strategyName: string, configFileName: string = ""): Promise<any> {
        let configForNr = await ConfigEditor.getConfigData(configNr, configFileName);
        for (let name in configForNr.strategies)
        {
            if (name === strategyName)
                return configForNr.strategies[name];
        }
        logger.warn("Strategy named %s (config nr %s) not found in config file %s", strategyName, configNr, configFileName);
        return null;
    }

    public saveConfigUpdate(configName: string, data: string) {
        return new Promise<SaveConfigFileRes>((resolve, reject) => {
            this.saveConfigFile(configName, data).then(() => {
                let requireRestrt = this.updateConfig(data);
                resolve({saved: true, restart: requireRestrt});
            }).catch((err) => {
                logger.error("Error saving config", err)
                resolve({saved: false, restart: false});
            });
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected lastRestartWasPreviously() {
        let lastRestart = new Date(nconf.get("serverConfig:lastRestartTime") || 0);
        return lastRestart.getTime() + nconf.get("serverConfig:restartPreviouslyIntervalMin")*utils.constants.MINUTE_IN_SECONDS*1000 >= Date.now();
    }

    protected async readConfigFile(name: string, updateStrategyValues: boolean = true): Promise<string> {
        let dataStr = await this.readConfigFileSafe(name, updateStrategyValues, false);
        if (dataStr)
            return dataStr;
        logger.warn("Loading config JSON failed. Retrying with backup");
        dataStr = await this.readConfigFileSafe(name, updateStrategyValues, true);
        if (dataStr)
            return dataStr;
        // TODO also try with updateStrategyValues = false ?
        this.sendConfigNotification("Config error", "Please check your config JSON and exchange API keys. Trading disabled!");
        return "";
    }

    protected readConfigFileSafe(name: string, updateStrategyValues: boolean = true, backup: boolean = false) {
        return new Promise<string>((resolve, reject) => {
            if (name.substr(-5) !== ".json")
                name += ".json";
            //const configFile = path.join(ConfigEditor.getConfigDir(), name) // better for selecte dmode
            const configFile = path.join(TradeConfig.getConfigDirForMode(this.selectedTradingMode, backup), name)
            if (!utils.file.isSafePath(configFile))
                return reject({txt: "Can not access path outside of app dir"})
            fs.readFile(configFile, "utf8", (err, data) => {
                if (err)
                    reject(err)
                if (updateStrategyValues) {
                    try {
                        data = this.updateStrategyValues(data);
                    }
                    catch (err) {
                        logger.error("Error updating %s strategy values", name, err);
                        this.sendConfigErrorOnce();
                    }
                }
                data = this.ensureProperConfigFileData(data);
                resolve(data)
            })
        })
    }

    protected ensureProperConfigFileData(data: string): string {
        let json = utils.parseJson(data);
        if (json === null || Array.isArray(json.data) === false) {
            logger.error("Invalid config JSON data found") // TODO empty string on startup
            return data;
        }
        // ensure no errors (happens after we update config pairs to same value)
        json.data.forEach((curData) => {
            for (let strategyName in curData.strategies)
            {
                let strategyData = curData.strategies[strategyName];
                if (typeof strategyData.pair !== "string")
                    strategyData.pair = this.ensureCurrencyPairString(strategyData.pair);
                else if (this.initialPairs.has(strategyData.pair) === false)
                    this.pairChangePendingRestart = true;
            }
        });
        return utils.stringifyBeautiful(json);
    }

    /**
     * Return the fixed JSON if it can be repaired or null otherwise.
     * @param json
     */
    protected canFixInvalidConfigJson(json: any): any {
        return json;
    }

    protected ensureCurrencyPairString(pair: any): string {
        if (typeof pair === "string")
            return pair;
        if (pair instanceof Currency.CurrencyPair)
            return pair.toString();
        if (!pair.from || !pair.to) {
            logger.error("Unknown currency pair data provided: %s", JSON.stringify(pair));
            return (new Currency.CurrencyPair(Currency.Currency.USD, Currency.Currency.BTC)).toString();
        }
        let pairStr = (new Currency.CurrencyPair(pair.from, pair.to)).toString(); // TODO lending mode?
        if (this.initialPairs.has(pairStr) === false)
            this.pairChangePendingRestart = true;
        return pairStr;
    }

    protected async readConfigFileParsed(name: string, updateStrategyValues: boolean = true) {
        let configStr = await this.readConfigFile(name, updateStrategyValues);
        return utils.parseJson(configStr);
    }

    protected saveConfigFile(name: string, data: string) {
        return new Promise<void>((resolve, reject) => {
            if (name.substr(-5) !== ".json")
                name += ".json";
            try {
                let configObj = utils.parseJson(data);
                for (let i = 0; i < configObj.data.length; i++)
                {
                    configObj.data[i].strategies = this.copyFirstStrategyCurrencyPair(configObj.data[i].strategies);
                }
                let dataUpdated = utils.stringifyBeautiful(configObj);
                if (dataUpdated)
                    data = dataUpdated;
            }
            catch (err) {
                logger.error("Error copying strategy currency pair of config file %s", name, err);
            }
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

    protected removeConfigFile(name: string, removeBackupOnly = false) {
        return new Promise<void>((resolve, reject) => {
            const configFile = path.join(TradeConfig.getConfigDir(removeBackupOnly === true), name);
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
            fs.copyFile(configFileSrc, configFileDest, async (err) => {
                if (err)
                    return reject({txt: "Error copying config file", err: err});
                let existingConfigs = nconf.get("serverConfig:userConfigs") || [];
                if (existingConfigs.indexOf(nameNew) === -1) {
                    existingConfigs.push(nameNew);
                    nconf.set("serverConfig:userConfigs", existingConfigs);
                    serverConfig.saveConfigLocal();
                }
                if (nconf.get("serverConfig:copyOnlyFirstConfig") === true)
                    await this.truncateToFirstConfigGroup(nameNew);
                resolve();
            });
        })
    }

    protected async truncateToFirstConfigGroup(configName: string): Promise<void> {
        const configFilePath = path.join(ConfigEditor.getConfigDir(), configName);
        try {
            let fileData = await utils.file.readFile(configFilePath);
            let json = utils.parseJson(fileData);
            if (!json || Array.isArray(json.data) === false || json.data.length === 0)
                throw Error("Invalid config file data");
            let outData = utils.stringifyBeautiful({
                data: json.data[0]
            });
            await fs.promises.writeFile(configFilePath, outData, {encoding: "utf8"});
        }
        catch (err) {
            logger.error("Error truncating config file %s", configFilePath, err);
        }
    }

    protected copyFirstStrategyCurrencyPair(json: StrategyJson, firstCurrencyPair: string = null) {
        // lending strategies have their currency pair one level above in config
        let missingPair = false;
        if (firstCurrencyPair !== null && typeof firstCurrencyPair !== "string")
            firstCurrencyPair = this.ensureProperConfigFileData(firstCurrencyPair);
        for (let name in json)
        {
            let conf = json[name];
            if (firstCurrencyPair === null && (!conf.pair || typeof conf.pair !== "string")) {
                logger.error("Missing currency pair in %s strategy config", name);
                missingPair = true;
                continue;
            }
            if (firstCurrencyPair === null) {
                firstCurrencyPair = this.ensureCurrencyPairString(conf.pair);
                continue;
            }
            else if (conf.pair !== firstCurrencyPair) {
                logger.warn("Different currency pairs for strategies found. Updating %s to %s in %s strategy", conf.pair, firstCurrencyPair, name);
                conf.pair = firstCurrencyPair;
                this.pairChangePendingRestart = true;
            }
        }
        if (missingPair === true && firstCurrencyPair !== null)
            return this.copyFirstStrategyCurrencyPair(json, firstCurrencyPair);
        return json;
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
        const firstLoad = this.initialPairs.size === 0;
        if (this.advisor instanceof TradeAdvisor) {
            let configs: TradeConfig[] = this.advisor.getConfigs();
            let strategies = this.advisor.getStrategies();
            for (let i = 0; i < json.data.length; i++) {
                let conf = json.data[i]
                if (!configs[i]) { // sometimes undefined when changing configs when removing currencies // TODO why?
                    logger.error("Unable to get trading config at pos %s to show current strategy values, configs %s", i, JSON.stringify(configs))
                    return jsonStr;
                }

                let pairs = configs[i].listConfigCurrencyPairs();
                pairs.forEach((pair) => {
                    let strategyList = strategies.get(pair); // get values from all strategies for this config-currency pair
                    strategyList.forEach((strat) => {
                        let action = strat.getAction();
                        if (firstLoad === true)
                            this.initialPairs.add(action.pair.toString());
                        let strategyConf = conf.strategies[strat.getClassName()];
                        if (!strategyConf)
                            return logger.error("Strategy settings are missing in loaded config for strategy %s", strat.getClassName())
                        for (let prop in strategyConf) {
                            // check if the value in the json string "conf" is idential to the current live state
                            // compare as strings to be sure comparison works for objects such as CurrencyPair
                            if (strategyConf[prop] !== undefined && action[prop] !== undefined && strategyConf[prop].toString() !== action[prop].toString()) {
                                if (prop === "pair" && (this.pairChangePendingRestart === true || this.initialPairs.has(strategyConf[prop]) === false))
                                    continue;
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
                    logger.error("Unable to get lending config at pos %s to show current strategy values, configs %s", i, JSON.stringify(configs))
                    return jsonStr;
                }

                let currencies = configs[i].listConfigCurrencies();
                // we don't have to update currency values when loading data here, because unlike strategy actions they can't change by themselves
                // values of all strategy instances should be the same
                currencies.forEach((currency) => {
                    let strategyList = strategies.get(currency); // get values from all strategies for this config-currency pair
                    strategyList.forEach((strat) => {
                        let action = strat.getAction();
                        if (firstLoad === true)
                            this.initialPairs.add(action.currency.toString());
                        let strategyConf = conf.strategies[strat.getClassName()];
                        if (!strategyConf)
                            return logger.error("Strategy settings are missing in loaded config for strategy %s", strat.getClassName())
                        for (let prop in strategyConf) {
                            // check if the value in the json string "conf" is idential to the current live state
                            // compare as strings to be sure comparison works for objects such as CurrencyPair
                            if (strategyConf[prop] !== undefined && action[prop] !== undefined && strategyConf[prop].toString() !== action[prop].toString()) {
                                if ((prop === "pair" || prop === "currency") && (this.pairChangePendingRestart === true || this.initialPairs.has(strategyConf[prop]) === false))
                                    continue;
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
                    logger.error("Unable to get social config at pos %s to show current strategy values, configs %s", i, JSON.stringify(configs))
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

    protected updateConfig(jsonStr: string): boolean {
        let json = utils.parseJson(jsonStr);
        if (!json || !Array.isArray(json.data))
            return false;
        // TODO config updates are wrong if the user puts them in another order
        let requireRestart = false;
        try {
            if (this.advisor instanceof TradeAdvisor) {
                let configs: TradeConfig[] = this.advisor.getConfigs();
                let strategies = this.advisor.getStrategies();
                if (json.data.length !== configs.length)
                    requireRestart = true; // simple way. just tell the user to restart
                for (let i = 0; i < json.data.length/* && i < configs.length*/; i++) {
                    let conf = json.data[i]
                    let update = {
                        marginTrading: conf.marginTrading,
                        tradeTotalBtc: conf.tradeTotalBtc,
                        maxLeverage: conf.maxLeverage ? parseFloat(conf.maxLeverage) : 1.0,
                        tradeDirection: conf.tradeDirection,
                        warmUpMin: conf.warmUpMin,
                        updateIndicatorsOnTrade: conf.updateIndicatorsOnTrade,
                        flipPosition: conf.flipPosition,
                        exchangeParams: conf.exchangeParams
                    }
                    if (configs.length > i)
                        configs[i].update(update)
                    else {
                        configs.push(new TradeConfig(conf, this.advisor.getConfigName())); // the user added a new currency pair to config
                        //requireRestart = true;
                        continue;
                    }
                    if (update.maxLeverage !== 1.0)
                        this.setMaxLeverage(configs[i], update.maxLeverage);

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
                if (json.data.length !== configs.length)
                    requireRestart = true; // simple way. just tell the user to restart
                for (let i = 0; i < json.data.length && i < configs.length; i++) {
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
        return requireRestart;
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
                newArgs.push('--config="' + this.selectedConfig + '"');
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
                return AbstractAdvisor.backupOriginalConfig(nconf.get("serverConfig:userConfigs"));
            }).then(() => {
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
            logger.error("Error loading config file data from disk", jsonData)
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
            let hasPassphrase = Currency.PassphraseExchanges.has(exchangeName);
            if (Array.isArray(exchangeKeys) === false || exchangeKeys.length === 0) {
                logger.warn("Invalid exchange API config for %s", exchangeName, exchangeKeys);
                userKeys[exchangeName] = { // we must return empty strings so that form inputs show up
                    key: "",
                    secret: "",
                    passphrase: hasPassphrase ? "" : undefined,
                    //key2: Currency.TwoKeyExchanges.has(exchangeName) === true ? "" : undefined, // shouldn't happen. we start with empty strings as config
                    key2: undefined,
                    secret2: "",
                    passphrase2: hasPassphrase ? "" : undefined
                };
                continue;
            }
            if (Currency.PassphraseExchanges.has(exchangeName) === false) // only use user input as fallback
                hasPassphrase = exchangeKeys[0].passphrase && exchangeKeys[0].passphrase != "";
            userKeys[exchangeName] = {
                key: exchangeKeys[0].key,
                //secret: exchangeKeys[0].secret, // don't display secrets on the client
                secret: "",
                passphrase: hasPassphrase ? "" : undefined,
                key2: exchangeKeys[0].key2,
                //secret2: exchangeKeys[0].secret2
                secret2: "",
                passphrase2: hasPassphrase ? "" : undefined
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
        for (let method in startConfig.apiKey.notify) // add missing default values (empty)
        {
            if (notifyKeys[method] === undefined)
                notifyKeys[method] = startConfig.apiKey.notify[method];
        }
        return notifyKeys;
    }

    protected sendTestNotification(title: string, text: string) {
        // TODO should be sent after restart if user changes notification method
        let headline = utils.sprintf(title, nconf.get("projectNameLong"));
        this.sendConfigNotification(headline, text, false);
    }

    protected sendConfigNotification(title: string, text: string, confirm = false) {
        let notifier = AbstractNotification.getInstance();
        let notification = new Notification(title, text, confirm);
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

    /**
     * Return a valid config object or null if if the schema is invalid
     * @param clientConfig
     */
    protected validateConfigArray(clientConfig: any): any {
        if (typeof clientConfig === "string") {
            clientConfig = utils.parseJson(clientConfig);
            if (clientConfig === null)
                return null;
        }
        let configObj: any = clientConfig;
        if (configObj.data === undefined || Array.isArray(configObj.data) === false) {
            configObj = {
                data: configObj
            }
        }
        // TODO add more validation
        if (configObj.data.data)
            return null;
        configObj = TradeConfig.ensureConfigSchema(configObj);
        if (configObj === null)
            return null;

        for (let i = 0; i < configObj.data.length; i++)
        {
            if (Array.isArray(configObj.data[i].exchanges) === false)
                configObj.data[i].exchanges = [configObj.data[i].exchanges]; // JSONView sends a string with the exchange
            // ensure only valid exchange names are set
            let validExchanges = [];
            for (let u = 0; u < configObj.data[i].exchanges.length; u++)
            {
                const exchangeName = configObj.data[i].exchanges[u];
                if (Currency.ExchangeName.has(exchangeName) === true)
                    validExchanges.push(exchangeName);
                else
                    logger.error("Filtered invalid exchange %s from config", exchangeName);
            }
            if (validExchanges.length === 0 || (nconf.get("arbitrage") === true && validExchanges.length !== 2)) {
                logger.error("Invalid number of of exchanges %s in config. Going back to previous setting", validExchanges.length);
                const requiredLen = nconf.get("arbitrage") === true ? 2 : 1;
                const existingExchanges = Array.from(Currency.ExchangeName.keys());
                let count = 0;
                while (validExchanges.length < requiredLen) {
                    let next = this.lastWorkingExchanges.length > count ? this.lastWorkingExchanges[count] : existingExchanges[count];
                    validExchanges.push(next);
                }
            }
            configObj.data[i].exchanges = validExchanges;

            if (!configObj.data[i].strategies || Object.keys(configObj.data[i].strategies).length === 0) {
                logger.error("Config at pos %s contains no strategies", i);
                return null;
            }

            // validate coin pairs
            if (!nconf.get("lending")) {
                if (this.validateStrategyCurrencyPairs(configObj.data[i].strategies) === null)
                    return null;
            }
        }
        return configObj;
    }

    protected validateStrategyCurrencyPairs(strategyJson: any) {
        for (let strategyName in strategyJson)
        {
            const json = strategyJson[strategyName];
            if (!json.pair || typeof json.pair !== "string") {
                logger.error("Invalid currency pair %s in config", json.pair);
                return null;
            }
            let pairParsed = Currency.CurrencyPair.fromString(json.pair, logger.error);
            if (pairParsed === null) {
                logger.error("Unrecognized currency pair %s in config", json.pair);
                return null;
            }
        }
        return strategyJson;
    }

    protected setMaxLeverage(config: TradeConfig, maxLeverage: number) {
        let exchanges = this.advisor.getExchanges();
        for (let ex of exchanges)
        {
            if (config.exchanges.indexOf(ex[0]) !== -1)
                ex[1].setMaxLeverage(maxLeverage);
        }
    }

    protected getDisplayCurrencyMap(): DisplayCurrencyMap {
        let map = {}
        for (let cur of Currency.CurrencyName)
        {
            let tickerSymbol = Currency.getCurrencyLabel(cur[0]);
            let currencyName = cur[1][0]; // get the first of possibly many (similar) names/typings
            map[tickerSymbol] = currencyName;
        }
        return map;
    }

    protected send(ws: ClientSocketOnServer, data: ConfigRes, options?: ServerSocketSendOptions) {
        return super.send(ws, data, options);
    }

    protected getFirstFileForMode(mode: BotTrade.TradingMode) {
        const dirPath = TradeConfig.getConfigDirForMode(mode);
        try {
            let files = fs.readdirSync(dirPath);
            if (files.length > 0)
                return files[0].replace(/\.json$/, "");
        }
        catch (err) {
            logger.error("Error getting 1st config file for mode %s in %s", mode, dirPath);
        }
        return "";
    }

    protected setLastWorkingConfig() {
        if (this.selectedTradingMode === "trading") {
            setTimeout(() => {
                if (typeof this.selectedConfig === "string" && this.selectedConfig.length !== 0) {
                    nconf.set("serverConfig:lastWorkingConfigName", this.selectedConfig);
                    nconf.set("serverConfig:lastWorkingConfigTime", new Date());
                    this.lastWorkingExchanges = utils.uniqueArrayValues<string>(Array.from(this.advisor.getExchanges().keys()));
                }
            }, 30*1000);
            serverConfig.saveConfigLocal();
        }
    }

    protected sendConfigErrorOnce() {
        if (this.configErrorTimer !== null)
            clearTimeout(this.configErrorTimer);
        this.configErrorTimer = setTimeout(() => {
            this.publish({error: true, errorCode: "confEditError", restart: true});
        }, 1000);
    }

    protected setExchangeInConfig(exchangeName: string) {
        return new Promise<void>((resolve, reject) => {
            this.readConfigFileParsed(this.selectedConfig).then((config) => {
                logger.info("Setting default exchange in config %s to %s", this.selectedConfig, exchangeName);
                config.data.forEach((curConfig) => {
                    if (!curConfig.exchanges) {
                        logger.warn("No exchanges set in config %s", exchangeName);
                        return;
                    }
                    if (curConfig.exchanges.length === 1)
                        curConfig.exchanges[0] = exchangeName;
                });
                return this.saveConfigFile(this.selectedConfig, utils.stringifyBeautiful(config));
            }).then(() => {
                resolve();
            }).catch((err) => {
                logger.error("Error saving config while setting 1st exchange", err)
                resolve();
            });
        })
    }

    protected changeTradingMode(data: ConfigReq, clientSocket: ClientSocketOnServer) {
        return new Promise<void>((resolve, reject) => {
            this.selectedTradingMode = data.tradingModeChange;
            ConfigEditor.listConfigFiles(this.selectedTradingMode).then((configFiles) => {
                if (configFiles.length === 0)
                    return Promise.reject("No config files available for mode: " + this.selectedTradingMode);
                this.selectedConfig = configFiles[0].substr(1).replace(/\.json$/, "");
                this.send(clientSocket, {
                    //changed: true, // just a dummy response
                    saved: true,
                    configFiles: configFiles
                });
            }).catch((err) => {
                logger.error("Error changing trading mode", err);
            });
        })
    }

    protected async addWizardConfig(wizardData: WizardData, clientSocket: ClientSocketOnServer): Promise<void> {
        this.selectedTradingMode = "trading"; // just to be sure
        let wizard = new Wizard(ConfigEditor.activeConfig);
        let errorMsg = await wizard.addWizardConfig(wizardData);
        if (errorMsg) {
            this.send(clientSocket, {wizardErrorCode: errorMsg});
            return;
        }
        this.selectedConfig = wizardData.configName;
        this.send(clientSocket, {saved: true, restarting: true});
        setTimeout(() => {
            this.restart(false);
        }, 1000);
    }
}
