import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Candle, Order, Funding} from "@ekliptor/bit-models";
import * as db from "../database";
import {AbstractExchange, ExchangeMap} from "../Exchanges/AbstractExchange";
import {default as HistoryDataExchange, HistoryExchangeMap, HistoryDataExchangeOptions} from "../Exchanges/HistoryDataExchange";
import {LendingConfig} from "./LendingConfig";
import {ConfigCurrencyPair} from "../Trade/TradeConfig";
import {CandleMaker} from "../Trade/Candles/CandleMaker";
import {CandleBatcher} from "../Trade/Candles/CandleBatcher";
import {
    GenericCandleMakerMap, GenericTraderMap, GenericStrategyMap, CurrencyCandleBatcherMap,
    LastSentTradesGeneric
} from "../TradeAdvisor";
import * as path from "path";
import * as fs from "fs";
import {AbstractLendingTrader, LendingTradeInfo} from "./AbstractLendingTrader";
import {AbstractLendingStrategy, LendingStrategyOrder, LendingTradeAction} from "./Strategies/AbstractLendingStrategy";
import {AbstractLendingExchange, LendingExchangeMap} from "../Exchanges/AbstractLendingExchange";
import {CandleMarketStream} from "../Trade/CandleMarketStream";
import {AbstractAdvisor, RestoryStrategyStateMap} from "../AbstractAdvisor";
import {TradeBook} from "../Trade/TradeBook";
import ExchangeController from "../ExchangeController";


export class CandleMakerMap extends GenericCandleMakerMap<Funding.FundingTrade> {
    constructor() {
        super()
    }
}
export class CandleBatcherMap extends Map<string, CurrencyCandleBatcherMap<Funding.FundingTrade>> { // 1 candle batcher per currency pair per interval
    constructor() {
        super()
    }
}
export class StrategyMap extends GenericStrategyMap<AbstractLendingStrategy> {
    constructor() {
        super()
    }
}
export class TraderMap extends GenericTraderMap<AbstractLendingTrader> {
    constructor() {
        super()
    }
}

export class LastSentTradesMap extends Map<string, LastSentTradesGeneric<Funding.FundingTrade>> { // (currency str, trades)
    constructor() {
        super()
    }
}

export class ExchangeCurrencyMap extends Map<string, Currency.Currency[]> { // (exchange name, currency)
    constructor() {
        super()
    }
}

/**
 * Main class that watches loan requests on exchanges and grants loans.
 */
export class LendingAdvisor extends AbstractAdvisor {
    protected configs: LendingConfig[] = [];
    protected trader: TraderMap = new TraderMap(); // 1 trader per config
    protected configFilename: string;
    protected exchanges: LendingExchangeMap; // (exchange name, instance)
    protected strategies: StrategyMap = new StrategyMap();
    protected lendingTrader: string = "RealTimeLendingTrader"; // currently the only implementation
    protected candleMakers = new CandleMakerMap();
    protected candleBatchers = new CandleBatcherMap();
    protected lastSentTrades = new LastSentTradesMap();

    constructor(configFilename: string, /*exchanges: ExchangeMap*/exchangeController: ExchangeController) {
        super()
        this.configFilename = configFilename;
        if (!this.configFilename) {
            logger.error("Please specify a config file with the command line option --config=")
            logger.error("example: --config=Bitfinex")
            this.waitForRestart();
            return
        }
        if (this.configFilename.substr(-5) !== ".json")
            this.configFilename += ".json";
        //this.exchanges = exchanges
        this.exchangeController = exchangeController;
        let exchanges = this.exchangeController.getExchanges();
        this.exchanges = new LendingExchangeMap();
        for (let ex of exchanges)
            this.exchanges.set(ex[0], ex[1] as AbstractLendingExchange);

        this.tradeBook = new TradeBook(null, this);
        this.checkRestoreConfig().then(() => {
            if (this.exchangeController.isExchangesIdle() === true)
                return;
            this.loadConfig();
            if (this.errorState)
                return;
            AbstractAdvisor.backupOriginalConfig();
            this.ensureDefaultFallbackConfig();
            this.loadTrader();
            this.connectTrader();
            this.connectCandles();

            // sanity check
            for (let strategyList of this.strategies)
            {
                const configCurrencyPair = strategyList[0];
                if (strategyList[1].length !== 1)
                    logger.error("There should be exactly 1 lending strategy per currency: %s - count: %s", configCurrencyPair, strategyList.length)
            }

            if (nconf.get('trader') !== "Backtester")
                this.restoreState();
            this.loadedConfig = true;
        });
    }

    public process() {
        return super.process();
    }

    public getExchanges() {
        return this.exchanges;
    }

    public getLendingStrategies() { // getStrategies()
        return this.strategies;
    }

    public getConfigName() {
        return this.configFilename.replace(/\.json$/, "");
    }

    public getConfigs() {
        return this.configs;
    }

    public getTraders() {
        return this.trader.getAll();
    }

    public getCandleMaker(currencyPair: string, exchangeLabel?: Currency.Exchange): CandleMaker<Funding.FundingTrade> {
        return super.getCandleMaker(currencyPair, exchangeLabel) as CandleMaker<Funding.FundingTrade>;
    }

    public getCandleBatchers(currencyPair: string, exchangeLabel?: Currency.Exchange): CurrencyCandleBatcherMap<Funding.FundingTrade> {
        return super.getCandleBatchers(currencyPair, exchangeLabel);
    }

    public getStrategyInfos() {
        let infos = {}
        for (let strat of this.strategies)
        {
            let configCurrencyPair = strat[0];
            let strategies = strat[1];
            let strategyInfos = strategies.map(s => s.getInfo()) // TODO remove spaces from keys for nicer JSON?
            infos[configCurrencyPair] = strategyInfos;
        }
        return infos;
    }

    public unserializeStrategyData(json: any, filePath: string) {
        let strategies = this.getLendingStrategies();
        let configs = this.getConfigs();
        let restored = false; // check if we restored at least 1 state
        configs.forEach((config) => {
            let currencies = config.listConfigCurrencies();
            currencies.forEach((currency) => {
                if (!json[currency]) {
                    let found = false;
                    if (nconf.get("serverConfig:searchAllPairsForState")) {
                        // it's in the other config. just check if it matches
                        const maxLen = Math.max(currencies.length, configs.length, Object.keys(json).length);
                        for (let i = 1; i <= maxLen; i++)
                        {
                            currency = currency.replace(/^[0-9]+/, i.toString())
                            if (json[currency]) {
                                found = true;
                                break;
                            }
                        }
                    }
                    if (!found)
                        return logger.warn("Skipped restoring state for config currency pair %s because no data was provided", currency);
                }
                let restoreData = json[currency];
                currency = currency.replace(/^[0-9]+/, config.configNr.toString()) // restore the real config number in case we changed it
                let fallback = new RestoryStrategyStateMap();
                let missingStrategyStates = [];
                let confStrategies = strategies.get(currency);
                confStrategies.forEach((strategy) => {
                    let strategyName = strategy.getClassName();
                    if (!restoreData[strategyName]) {
                        strategyName = strategy.getBacktestClassName();
                        if (!restoreData[strategyName]) {
                            missingStrategyStates.push(strategy);
                            return; // no data for this strategy
                        }
                    }
                    fallback.add(restoreData[strategyName]);
                    if (!strategy.getSaveState())
                        return;
                    if (!strategy.canUnserialize(restoreData[strategyName]))
                        return;
                    strategy.unserialize(restoreData[strategyName])
                    logger.info("Restored lending strategy state of %s %s from %s", currency, strategyName, path.basename(filePath))
                    restored = true;
                });
                if (nconf.get("serverConfig:restoreStateFromOthers")) {
                    missingStrategyStates.forEach((strategy) => {
                        let strategyName = strategy.getClassName();
                        let state = fallback.get(strategy.getAction().candleSize);
                        if (!state)
                            return;
                        if (!strategy.canUnserialize(state, true)) // be sure and check candle size again
                            return;
                        try {
                            strategy.unserialize(state)
                            logger.info("Restored strategy state of %s %s using fallback from %s", currency, strategyName, path.basename(filePath))
                            restored = true;
                        }
                        catch (err) {
                            logger.warn("Unable to restore %s %s from another strategy state", currency, strategyName, err);
                        }
                    });
                }
            })
        })
        return restored;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected loadTrader() {
        let traderMap = new Map<string, AbstractLendingTrader>(); // (trader path, instance) map to deduplicate trader instances
        // currently we only allow 1 global trader in config

        const modulePath = path.join(__dirname, this.lendingTrader);
        this.configs.forEach((config) => {
            const key = modulePath + config.exchanges.toString();
            let cachedInstance = traderMap.get(key);
            //if (!cachedInstance) { // config such as marginTrading is different per instance
                cachedInstance = this.loadModule(modulePath, config);
                traderMap.set(key, cachedInstance);
            //}
            if (!cachedInstance) {
                logger.error("Error loading trader %s", nconf.get("trader"))
                return this.waitForRestart()
            }
            cachedInstance.setExchanges(this);
            this.trader.set(config.configNr, cachedInstance); // in this map the instance can be present multiple times
        })
    }

    protected connectTrader() {
        // our strategies send events on which the trader can act
        // if the trader acts he will send an event back to the strategy
        const actions: LendingTradeAction[] = ["place"/*, "cancel"*/]; // don't emit cancel events (mostly moving loans)
        //let traders = this.trader.getUniqueInstances();
        let traders = this.trader.getAll();
        actions.forEach((action) => {
            //for (let trader of this.trader)
            for (let i = 0; i < traders.length; i++)
            {
                //trader[1].removeAllListeners(action);
                traders[i].on(action, (order: Funding.FundingOrder, trades: Funding.FundingTrade[], info: LendingTradeInfo) => {
                    // trades should only be 1?
                    // strategyList will only contain 1 instance (only 1 strategy for lending)
                    let tradingConfigCurrencyPair: ConfigCurrencyPair = null;
                    for (let strategyList of this.strategies)
                    {
                        const configCurrencyPair = strategyList[0];
                        const configNr = parseInt(configCurrencyPair.split("-")[0]);
                        strategyList[1].forEach((strategyInstance) => {
                            if (!this.isInterestedStrategy(strategyInstance, order.currency, configNr, traders[i]))
                                return;
                            if (tradingConfigCurrencyPair === null)
                                tradingConfigCurrencyPair = configCurrencyPair;
                            else if (tradingConfigCurrencyPair !== configCurrencyPair)
                                logger.error("Multiple config currency pairs executed the same trade. first %s, second %s", tradingConfigCurrencyPair, configCurrencyPair)
                            //console.log("CONNECTING", action, strategyInstance.getAction().pair.toString(), strategyInstance.getClassName())
                            strategyInstance.onTrade(action, order, trades, info);
                        })
                    }
                    this.tradeBook.logLendingTrade(order, trades, info, tradingConfigCurrencyPair);
                })

            }
        })

        const simpleActions: LendingTradeAction[] = ["takenAll"];
        simpleActions.forEach((action) => {
            //for (let trader of this.trader)
            for (let i = 0; i < traders.length; i++)
            {
                //trader[1].removeAllListeners(action);
                traders[i].on(action, (currency: Currency.Currency) => {
                    // trades should only be 1?
                    // strategyList will only contain 1 instance (only 1 strategy for lending)
                    for (let strategyList of this.strategies)
                    {
                        const configCurrencyPair = strategyList[0];
                        const configNr = parseInt(configCurrencyPair.split("-")[0]);
                        strategyList[1].forEach((strategyInstance) => {
                            if (!this.isInterestedStrategy(strategyInstance, currency, configNr, traders[i]))
                                return;
                            //console.log("CONNECTING", action, strategyInstance.getAction().pair.toString(), strategyInstance.getClassName())
                            strategyInstance.onTrade(action, null, null, null);
                        })
                    }
                })
            }
        })
    }

    protected connectCandles() {
        // forward to strategies
        for (let candle of this.candleMakers)
        {
            candle[1].on("candles", (candles: Candle.Candle[]) => {
                // forward 1min candles to CandleBatcher
                // TODO option to drop 1st candle here if we are in realtime mode (first candle is generally incomplete until we can fetch history data)
                const currencyStr = Currency.Currency[candle[1].getCurrencyPair().from];
                let interestedBatchers = this.candleBatchers.get(currencyStr);
                if (!interestedBatchers)
                    return;
                for (let bat of interestedBatchers)
                {
                    bat[1].removeAllListeners(); // attach them again every round (every candles event from the maker) // TODO improve
                    bat[1].on("candles", (candles: Candle.Candle[]) => {
                        // forward x min candles from batcher to strategies which are interested in this specific interval
                        candles.forEach((candle) => {
                            for (let strategyList of this.strategies)
                            {
                                strategyList[1].forEach((strategyInstance) => {
                                    if (strategyInstance.getAction().currency !== candle.currencyPair.from)
                                        return; // this strategy is not set for this currency pair
                                    if (candle.interval === 1)
                                        strategyInstance.send1minCandleTick(candle);
                                    if (strategyInstance.getAction().candleSize === candle.interval) // both can be true
                                        strategyInstance.sendCandleTick(candle);
                                })
                            }

                            // forward to traders
                            //if (bat[1].getMax() === false)
                                //return;
                            this.trader.getAll().forEach((trader) => {
                                trader.sendCandleTick(candle);
                            })
                        })
                    })
                    bat[1].addCandles(candles); // has to be called AFTER we attach the event above
                }
            });
            candle[1].on("currentCandle", (candle: Candle.Candle) => {
                for (let strategyList of this.strategies)
                {
                    strategyList[1].forEach((strategyInstance) => {
                        if (strategyInstance.getAction().currency !== candle.currencyPair.from)
                            return; // this strategy is not set for this currency pair
                        strategyInstance.sendCurrentCandleTick(candle);
                    })
                }
            });
        }
    }

    protected pipeMarketStreams(config: LendingConfig) {
        let connectedExchanges: string[] = []
        const exchangeNames = config.exchanges;
        for (let ex of this.exchanges) // should only be 1 for lending
        {
            if (exchangeNames.indexOf(ex[0]) === -1)
                continue; // this exchange is not part of our config

            connectedExchanges.push(ex[0])
            ex[1].getMarketStream().on("tradesFunding", (currency: Currency.Currency, trades: Funding.FundingTrade[]) => {
                if (!config.hasCurrency(currency))
                    return; // another config is interested in this
                //console.log("%s %s TRADES", ex[0], currencyPair, trades)
                //if (!this.warmUpDone(config)) // moved to Trader because technical strategies need to collect data
                    //return;

                // batch trades and send them at most every x sec to save CPU
                let tradesToSend = [];
                if (nconf.get('trader') === "Backtester")
                    tradesToSend = trades;
                else {
                    const currencyStr = Currency.Currency[currency];
                    let lastSent = this.lastSentTrades.get(currencyStr)
                    const forwardTradesMs = (nconf.get("serverConfig:forwardTradesSec") + nconf.get("serverConfig:forwardTradesAddPerMarketSec")*this.candleCurrencies.length)*1000;
                    if (!lastSent || lastSent.last.getTime() + forwardTradesMs < Date.now()) {
                        if (lastSent)
                            tradesToSend = lastSent.pendingTrades;
                        tradesToSend = tradesToSend.concat(trades);
                        this.lastSentTrades.set(currencyStr, {pendingTrades: [], last: new Date()})
                    }
                    else {
                        lastSent.pendingTrades = lastSent.pendingTrades.concat(trades);
                        return;
                    }
                }
                if (tradesToSend.length !== 0) {
                    const configCurrencyPair = config.getConfigCurrencyPair(currency);
                    let strategies = this.strategies.get(configCurrencyPair)
                    strategies.forEach((strategy) => {
                        strategy.sendTick(tradesToSend)
                    })
                }
            })
            ex[1].getMarketStream().on("ordersFunding", (currency: Currency.Currency, orders: Funding.FundingOrder[]) => {
                if (!config.hasCurrency(currency))
                    return; // another config is interested in this
                //console.log("%s %s ORDERS", ex[0], currencyPair, orders)
            })
        }
        return connectedExchanges
    }

    protected pipeGlobalMarketStreams() {
        for (let ex of this.exchanges)
        {
            // has to be checked after the stream starts
            //const isCandleStream = ex[1].getMarketStream() instanceof CandleMarketStream && (ex[1].getMarketStream() as CandleMarketStream).isStreamingCandles();
            const isCandleStream = () => {
                return ex[1].getMarketStream() instanceof CandleMarketStream && (ex[1].getMarketStream() as CandleMarketStream).isStreamingCandles();
            }
            ex[1].getMarketStream().on("tradesFunding", (currency: Currency.Currency, trades: Funding.FundingTrade[]) => {
                if (nconf.get("serverConfig:storeLendingTrades") && nconf.get('trader') !== "Backtester") { // speeds up backtesting a lot
                    /*
                    Trade.storeTrades(db.get(), trades, (err) => {
                        if (err)
                            logger.error("Error storing trades", err)
                    })
                    */
                    logger.warn("Storing of funding trades is not yet implemented") // TODO
                }
                if (!isCandleStream()) {
                    const currencyStr = Currency.Currency[currency];
                    this.candleMakers.get(currencyStr).addTrades(trades); // TODO trades have a different type -> we need a new candle batcher after all?
                }
                this.trader.getAll().forEach((trader) => {
                    trader.sendTick(trades);
                })
            })
            ex[1].getMarketStream().on("ordersFunding", (currency: Currency.Currency, orders: Funding.FundingOrder[]) => {
                this.trader.getAll().forEach((trader) => {
                    trader.sendOrderTick(orders);
                })
            })
            ex[1].getMarketStream().on("candlesFunding", (currency: Currency.Currency, candles: Candle.Candle[]) => {
                if (isCandleStream()) {
                    const currencyStr = Currency.Currency[currency];
                    this.candleMakers.get(currencyStr).addCandles(candles);
                }
            })
        }
    }

    protected connectStrategyEvents(config: LendingConfig, strategy: AbstractLendingStrategy, currency: Currency.Currency) {
        // there is only 1 strategy per currency, so this we don't have to wait for all ticks to
        // finish as in TradeAdvisor
        // TODO improve this if we allow multiple strategies for lending (probably never?)

        //const actions: LendingTradeAction[] = ["place"/*, "cancel"*/];
        const actions: LendingStrategyOrder[] = ["place"];
        actions.forEach((actionName) => {
            strategy.on(actionName, (reason: string) => {
                this.trader.get(config.configNr).callAction(actionName, strategy, reason);
            })
        })

        const configCurrencyPair = config.getConfigCurrencyPair(currency);
        strategy.on("startTick", (curStrategy: AbstractLendingStrategy) => {
            // since we only use 1 strategy we don't have to count ticks and wait for all strategies to emit their events
        })
        strategy.on("doneTick", (curStrategy: AbstractLendingStrategy) => {
            // no actionHeap, executed immediately in connectStrategyEvents() above
            //this.trader.get(config.configNr).callAction(action.action, curStrategy, action.reason);
        })

        strategy.on("startCandleTick", (curStrategy: AbstractLendingStrategy) => {
        })
        strategy.on("doneCandleTick", (curStrategy: AbstractLendingStrategy) => {
        })
    }

    protected loadConfig() {
        const filePath = path.join(utils.appDir, "config", "lending", this.configFilename);
        let data = "";
        try {
            data = fs.readFileSync(filePath, {encoding: "utf8"});
        }
        catch (err) {
            logger.error("Error reading lending config file under: %s", filePath, err)
            return this.waitForRestart()
        }
        if (!data) {
            logger.error("Can not load lending config file under: %s", filePath)
            return this.waitForRestart()
        }
        let json = utils.parseJson(data);
        if (!json || !json.data) {
            logger.error("Invalid JSON in config file: %s", filePath)
            return this.waitForRestart()
        }
        if (json.data.length > 10)
            logger.error("WARNING: Config has %s entries. For more than 10 entries som exchanges might not send updates anymore", json.data.length);

        let currencies = new ExchangeCurrencyMap();
        let connectedExchanges = []
        if (json.data.length === 1)
            json.data = LendingConfig.expandConfig(json.data[0]);
        json.data.forEach((conf) => {
            let config = new LendingConfig(conf, this.configFilename);
            try {
                if (!Array.isArray(config.exchanges) || config.exchanges.length > 1)
                    throw "You must configure exactly 1 exchange per currency pair for trading."
            }
            catch (e) {
                logger.error("Error loading config. Please fix your config and restart the app", e);
                this.waitForRestart()
                return;
            }
            this.configs.push(config)

            // connect exchanges -> strategies
            const configExchanges = this.pipeMarketStreams(config);
            connectedExchanges = connectedExchanges.concat(configExchanges);
            if (this.exchanges.has(configExchanges[0]) === false) {
                logger.error("Your config is set to use the exchange %s, but you don't have an API key set. Please add an API key or change your config and restart the app.", configExchanges[0]);
                this.waitForRestart()
                return;
            }
            config.markets.forEach((currency) => {
                config.exchanges.forEach((exchangeName) => {
                    let pairs = currencies.get(exchangeName)
                    if (!pairs)
                        pairs = []
                    pairs.push(currency)
                    currencies.set(exchangeName, pairs)
                })

                // load strategies (new strategy instance per exchange + currency)
                //let isMainStrategy = true; // only 1 strategy used for lending
                const configCurrencyPair = config.getConfigCurrencyPair(currency);
                for (let className in conf.strategies)
                {
                    const modulePath = path.join(__dirname, "Strategies", className)
                    let strategyInstance: AbstractLendingStrategy = this.loadModule(modulePath, conf.strategies[className])
                    if (!strategyInstance)
                        continue;
                    if (strategyInstance.getAction().currency != currency)
                        continue; // this strategy is not set for this currency
                    //strategyInstance.setMainStrategy(isMainStrategy); // we can have multiple main strategies based on internal config
                    let strategies = this.strategies.get(configCurrencyPair)
                    if (!strategies)
                        strategies = []
                    strategies.push(strategyInstance)
                    this.strategies.set(configCurrencyPair, strategies)
                    this.connectStrategyEvents(config, strategyInstance, currency);

                    // candle config
                    const currencyStr = Currency.Currency[currency];
                    const ledingPair = new Currency.CurrencyPair(currency, currency); // create a pseudo pair "BTC_BTC" for candle batchers // TODO improve batchers?
                    //const lendingPairStr = ledingPair.toString();
                    if (!this.candleMakers.get(currencyStr))
                        this.candleMakers.set(currencyStr, new CandleMaker<Funding.FundingTrade>(ledingPair));

                    // always add 1min candles (so strategies can create candles of arbitrary size). don't set it as max batcher
                    if (!this.candleBatchers.get(currencyStr))
                        this.candleBatchers.set(currencyStr, new CurrencyCandleBatcherMap());
                    // overwrites existing instances before they are connected
                    let smallBatcher = new CandleBatcher(1, ledingPair);
                    this.candleBatchers.get(currencyStr).set(1, smallBatcher);

                    let candleSize = strategyInstance.getAction().candleSize
                    if (candleSize) { // is this strategy interested in candles?
                        if (typeof candleSize === "string" && candleSize === "default")
                            candleSize = nconf.get('serverConfig:defaultCandleSize')
                        let batcher = new CandleBatcher(candleSize, ledingPair);
                        this.candleBatchers.get(currencyStr).set(candleSize, batcher);
                    }

                    // forward the orderbook to strategy
                    if (nconf.get('trader') !== "Backtester") {
                        // order books are only available via APIs of exchanges for real time trading (no history data)
                        // and we have to wait with connecting it until it is loaded
                        let timer = setInterval(() => {
                            let allReady = true;
                            configExchanges.forEach((exchange) => {
                                const exchangeInstance = this.exchanges.get(exchange);
                                const currencyStr = Currency.Currency[strategyInstance.getAction().currency];
                                const orderBook = exchangeInstance.getLendingOrderBook().get(currencyStr);
                                if (!strategyInstance.isLendingOrderBookReady()) {
                                    if (orderBook)
                                        strategyInstance.setLendingOrderBook(orderBook);
                                    else
                                        logger.warn("%s Lending Order book of %s not ready", currencyStr, exchange)
                                }

                                // TODO fetch lending ticker if we need it for strategies
                                /*
                                const ticker = exchangeInstance.getLendingTickerMap();
                                if (!strategyInstance.isLendingTickerReady()) {
                                    if (ticker && ticker.has(currencyStr))
                                        strategyInstance.setLendingTicker(ticker.get(currencyStr))
                                    else
                                        logger.warn("%s Lending Ticker of %s not ready", currencyStr, exchange)
                                }
                                */

                                if (!orderBook/* || !ticker || !ticker.has(currencyStr)*/)
                                    allReady = false;
                            })
                            if (allReady) {
                                //logger.info("All tickers and orderbooks are ready"); // logged once per strategy
                                clearInterval(timer);
                            }
                        }, 8000)
                    }
                }
            })
        })

        this.logCandleSubscriptions(); // log candle subscriptions

        connectedExchanges = utils.uniqueArrayValues(connectedExchanges); // shouldn't change anything
        if (connectedExchanges.length === 1) {
            for (let maker of this.candleMakers)
                maker[1].setExchange(this.exchanges.get(connectedExchanges[0]).getExchangeLabel())
        }
        this.pipeGlobalMarketStreams();
        connectedExchanges.forEach((exchangeName) => {
            let ex = this.exchanges.get(exchangeName)
            let supportedCurrencies = currencies.get(exchangeName)
            ex.subscribeToFundingMarkets(supportedCurrencies)
        })
        for (let ex of this.exchanges)
        {
            if (connectedExchanges.indexOf(ex[0]) === -1) {
                logger.verbose("Removing not used exchange %s", ex[0])
                this.exchanges.delete(ex[0])
            }
        }
    }

    protected logCandleSubscriptions() {
        for (let maker of this.candleMakers)
        {
            this.candleCurrencies.push(Currency.Currency[maker[1].getCurrencyPair().from])
        }
        let batchers = []
        for (let batcherMap of this.candleBatchers)
        {
            for (let bat of batcherMap[1])
            {
                batchers.push(bat[1].getCurrencyPair().toString() + ": " + bat[1].getInterval() + " min")
            }
        }
        if (this.candleCurrencies.length !== 0)
            logger.info("Active lending candle makers:", this.candleCurrencies);
        if (batchers.length !== 0)
            logger.info("Active lending candle batchers:", batchers);
    }

    protected isInterestedStrategy(strategyInstance: AbstractLendingStrategy, currency: Currency.Currency, configNr: number, trader: AbstractLendingTrader) {
        if (strategyInstance.getAction().currency != currency)
            return false; // this strategy is not set for this currency
        else if (LendingConfig.createConfigCurrencyPair(configNr, currency) !== trader.getConfig().getConfigCurrencyPair(currency))
            return false; // just to be sure
        return true;
    }
}