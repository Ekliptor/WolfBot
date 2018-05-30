import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractSubController} from "./AbstractSubController";
import {Currency, Trade, Candle, Order, Funding} from "@ekliptor/bit-models";
import * as db from "./database";
import {AbstractExchange, ExchangeMap} from "./Exchanges/AbstractExchange";
import {default as HistoryDataExchange, HistoryExchangeMap, HistoryDataExchangeOptions} from "./Exchanges/HistoryDataExchange";
import {AbstractGenericTrader} from "./Trade/AbstractGenericTrader";
import {ConfigCurrencyPair, TradeConfig} from "./Trade/TradeConfig";
import {LendingConfig} from "./Lending/LendingConfig";
import {LendingExchangeMap} from "./Exchanges/AbstractLendingExchange";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {SocialConfig} from "./Social/SocialConfig";
import {AbstractConfig} from "./Trade/AbstractConfig";
import {CurrencyCandleBatcherMap} from "./TradeAdvisor";
import {CandleMaker} from "./Trade/Candles/CandleMaker";
import {TradeBook} from "./Trade/TradeBook";


class DummyGenericStrategyMap extends Map<ConfigCurrencyPair, any[]> { // different in base classes
    constructor() {
        super()
    }
}

export abstract class AbstractAdvisor extends AbstractSubController {
    protected readonly started = new Date();
    protected candleCurrencies: string[] = [];
    protected strategies: DummyGenericStrategyMap = new DummyGenericStrategyMap();
    protected candleMakers: Map<any, any>; // types specified in subclasses
    protected candleBatchers: Map<any, any>;
    protected tradeBook: TradeBook;

    protected errorState = false;

    constructor() {
        super()
    }

    public getStarted() {
        return this.started;
    }

    public abstract getExchanges(): ExchangeMap | LendingExchangeMap;

    // complicated to iterate over lists of strategies with different types. use 2 different functions instead
    //public abstract getStrategies(): StrategyMap | LendingStrategyMap;

    public abstract getConfigName(): string;

    //public abstract getConfigs(): TradeConfig[] | LendingConfig[];
    public abstract getConfigs(): (TradeConfig | LendingConfig | SocialConfig)[];

    public static getConfigByNr<T extends AbstractConfig>(configs: T[], configNr: number): T {
        let low = Number.MAX_VALUE;
        for (let i = 0; i < configs.length; i++)
        {
            if (configs[i].configNr < low)
                low = configs[i].configNr;
            if (configs[i].configNr === configNr)
                return configs[i];
        }
        logger.error("Unable to find config nr %s in array of %s configs, lowest nr %s", configNr, configs.length, low)
        return null;
    }

    public getTraderName(forDisplay = false): string {
        if (!forDisplay || this.getTraders().length !== 0) {
            if (nconf.get("lending"))
                return nconf.get("trader").replace("Trader", "LendingTrader");
            return nconf.get("trader");
        }
        return "-";
    }

    public abstract getTraders(): AbstractGenericTrader[];

    //public abstract getCandleMaker(currencyPair: string, exchangeLabel?: Currency.Exchange): (CandleMaker<Trade.Trade> | CandleMaker<Funding.FundingTrade>);
    public getCandleMaker(currencyPair: string, exchangeLabel?: Currency.Exchange): (CandleMaker<Trade.Trade> | CandleMaker<Funding.FundingTrade>) {
        if (nconf.get("arbitrage")) {
            if (!exchangeLabel) {
                logger.error("exchange label must be provided to get candle batchers in arbitrage mode")
                return null;
            }
            const batcherKey = Currency.Exchange[exchangeLabel] + "-" + currencyPair;
            return this.candleMakers.get(batcherKey);
        }
        return this.candleMakers.get(currencyPair);
    }

    //public abstract getCandleBatchers(currencyPair: string, exchangeLabel?: Currency.Exchange): (CurrencyCandleBatcherMap<Trade.Trade> | CurrencyCandleBatcherMap<Funding.FundingTrade>);
    public getCandleBatchers(currencyPair: string, exchangeLabel?: Currency.Exchange): (CurrencyCandleBatcherMap<Trade.Trade> | CurrencyCandleBatcherMap<Funding.FundingTrade>) {
        if (nconf.get("arbitrage")) {
            if (!exchangeLabel) {
                logger.error("exchange label must be provided to get candle batchers in arbitrage mode")
                return null;
            }
            const batcherKey = Currency.Exchange[exchangeLabel] + "-" + currencyPair;
            return this.candleBatchers.get(batcherKey);
        }
        return this.candleBatchers.get(currencyPair);
    }

    public getCandleCurrencies() {
        return this.candleCurrencies;
    }

    public serializeAllStrategyData() {
        let state = {}
        for (let strat of this.strategies)
        {
            let data = {}
            let configCurrencyPair = strat[0];
            let strategies = strat[1];
            for (let i = 0; i < strategies.length; i++)
            {
                if (strategies[i].getSaveState()) {
                    data[strategies[i].getClassName()] = strategies[i].serialize();
                }
            }
            state[configCurrencyPair] = data;
        }
        return state;
    }

    public serializeStrategyData(pair: ConfigCurrencyPair) {
        let strategies = this.strategies.get(pair);
        let data = {}
        for (let i = 0; i < strategies.length; i++)
        {
            if (strategies[i].getSaveState())
                data[strategies[i].getClassName()] = strategies[i].serialize();
        }
        return data;
    }

    public abstract unserializeStrategyData(json: any, filePath: string): boolean;

    public getSaveStateFile() {
        return path.join(utils.appDir, "temp", "state-" + this.getConfigName() + ".json")
    }

    public getSaveStateBackupFile() {
        return path.join(utils.appDir, "temp", "state-" + this.getConfigName() + "-bak.json")
    }

    public isErrorState() {
        return this.errorState;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected restoreState() {
        const filePath = fs.existsSync(this.getSaveStateFile()) ? this.getSaveStateFile() : this.getSaveStateBackupFile();
        fs.readFile(filePath, {encoding: "utf8"}, (err, data) => {
            if (err) {
                if (err.code === 'ENOENT')
                    return logger.info("No state to restore has been saved for current config")
                return logger.error("Error reading file to restore state: %s", filePath, err)
            }
            if (nconf.get("debug") && (os.platform() === 'darwin' || os.platform() === 'win32'))
                return logger.verbose("Skipped restoring config state in debug mode")

            fs.stat(filePath, (err, stats) => {
                if (err)
                    return logger.error("Error getting stats of file to restore state: %s", filePath, err)
                const modifiedExpirationMs = stats.mtime.getTime() + nconf.get("serverConfig:restoreStateMaxAgeMin")*utils.constants.MINUTE_IN_SECONDS*1000;
                if (modifiedExpirationMs < Date.now())
                    return logger.warn("Skipped restoring strategy state because the file is too old")
                let state = utils.parseEJson(data)
                this.unserializeStrategyData(state, filePath)

                /* // just don't delete it. it will get overwritten
                setTimeout(() => { // delete the state later in case the bot crashes on startup
                    utils.file.deleteFiles([filePath]).then(() => {
                    }).catch((err) => {
                        logger.error("Error deleting restored state files from disk", err)
                    })
                }, nconf.get("serverConfig:saveStateMin")/2*utils.constants.MINUTE_IN_SECONDS*1000)
                */
            })
        })
    }

    protected waitForRestart() {
        this.errorState = true;
        //process.exit(1) // don't exit or else we can't restart it via http API
        logger.error("App entered error state. Please restart the app")
    }
}