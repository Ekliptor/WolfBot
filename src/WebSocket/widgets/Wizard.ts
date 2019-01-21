import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {ClientSocketOnServer} from "../ServerSocket";
import {BotTrade, Currency} from "@ekliptor/bit-models";
import {TradeConfig} from "../../Trade/TradeConfig";
import * as path from "path";
import * as fs from "fs";
import {AbstractContractExchange} from "../../Exchanges/AbstractContractExchange";


export interface WizardData {
    exchange: string;
    currencyPair: string;
    tradingCapital: number;
    strategy: string;
    configName: string;
    replace: boolean;
}

export class Wizard {
    protected activeConfig: string; // config name without .json
    protected mode: BotTrade.TradingMode = "trading";

    constructor(activeConfig: string) {
        this.activeConfig = activeConfig;
    }

    public async addWizardConfig(wizardData: WizardData): Promise<string> {
        if (Currency.ExchangeName.has(wizardData.exchange) === false)
            return "invalidExchange";
        if (wizardData.tradingCapital < 0.0)
            wizardData.tradingCapital = 0.0;
        wizardData.strategy = wizardData.strategy.replace(/\.json$/, "");
        const available = await this.canLoadStrategy(wizardData.strategy + ".json");
        if (available === false)
            return "strategyNotAvailable";
        const currencyPair = Currency.CurrencyPair.fromString(wizardData.currencyPair);
        if (currencyPair === null)
            return "invalidCurrencyPair";
        const backupDir = TradeConfig.getConfigDirForMode(this.mode, true); // backup dir has all unmodified strategy configs
        const strategyPath = path.join(backupDir, wizardData.strategy + ".json");
        let strategyJson = utils.parseJson(await utils.file.readFile(strategyPath));
        if (strategyJson === null || Array.isArray(strategyJson.data) === false)
            return "unableLoadStrategy";
        strategyJson = this.updateStrategyJson(strategyJson, wizardData);

        wizardData.configName = (wizardData.configName || "").trim().replace(/\.json$/, "");
        if (wizardData.configName.length === 0)
            return "configNameMissing";
        if (await this.canSaveStrategy(wizardData.configName + ".json") === false) {
            return "configExistsAlready";
        }
        const configDir = TradeConfig.getConfigDirForMode(this.mode, false);
        const strategyNewPath = path.join(configDir, wizardData.configName + ".json");
        try {
            if (wizardData.replace === false) { // add the current config data in front of the new file
                let currentConf = await this.getCurrentStrategyJson();
                if (currentConf && Array.isArray(currentConf.data) === true)
                    strategyJson.data = currentConf.data.concat(strategyJson.data);
            }
            await fs.promises.writeFile(strategyNewPath, utils.stringifyBeautiful(strategyJson), {encoding: "utf8"});
        }
        catch (err) {
            logger.error("Error writing strategy config in wizard", err);
            return "errorWritingConfig";
        }
        return "";
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected updateStrategyJson(strategyJson: any, wizardData: WizardData): any {
        let first = strategyJson.data[0];
        first.exchanges = [wizardData.exchange];
        first.tradeTotalBtc = wizardData.tradingCapital;
        first.marginTrading = this.isFuturesExchange(wizardData.exchange);
        for (let strategyName in first.strategies)
        {
            let data = first.strategies[strategyName];
            data.pair = wizardData.currencyPair;
        }
        return {
            data: [first]
        };
    }

    protected canLoadStrategy(strategyName: string) {
        return new Promise<boolean>((resolve, reject) => {
            const backupDir = TradeConfig.getConfigDirForMode(this.mode, true); // backup dir has all unmodified strategy configs
            const strategyPath = path.join(backupDir, strategyName);
            fs.stat(strategyPath, (err, stats) => {
                if (err) {
                    if (err.code === "ENOENT")
                        return resolve(false);
                    logger.error("Unable to check for strategy file at %s", strategyPath, err);
                    return resolve(false);
                }
                resolve(true);
            });
        })
    }

    protected canSaveStrategy(strategyName: string) {
        return new Promise<boolean>((resolve, reject) => {
            const configDir = TradeConfig.getConfigDirForMode(this.mode, false);
            const strategyPath = path.join(configDir, strategyName);
            fs.stat(strategyPath, (err, stats) => {
                if (err) {
                    if (err.code === "ENOENT")
                        return resolve(true);
                    logger.error("Unable to check for saving of strategy file at %s", strategyPath, err);
                    return resolve(false);
                }
                resolve(false);
            });
        })
    }

    protected async getCurrentStrategyJson(): Promise<any> {
        const configDir = TradeConfig.getConfigDirForMode(this.mode, false);
        const filePath = path.join(configDir, this.activeConfig + ".json");
        return utils.parseJson(await utils.file.readFile(filePath));
    }

    protected isFuturesExchange(exchangeName: string) {
        const modulePath = path.join(__dirname, "..", "..", "Exchanges", exchangeName);
        let exchange = this.loadModule(modulePath, {});
        return exchange instanceof AbstractContractExchange;
    }

    protected loadModule<T>(modulePath: string, options = undefined): T {
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