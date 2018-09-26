import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as WebSocket from "ws";
import * as http from "http";
import {ServerSocketPublisher, ServerSocket, ClientSocketOnServer} from "./ServerSocket";
import {AppPublisher} from "./AppPublisher";
import {WebSocketOpcode} from "./opcodes";
import TradeAdvisor, {StrategyMap} from "../TradeAdvisor";
import {TradeConfig} from "../Trade/TradeConfig";
import {LendingConfig} from "../Lending/LendingConfig";
import {AbstractStrategy, StrategyPosition} from "../Strategies/AbstractStrategy";
import {LendingAdvisor} from "../Lending/LendingAdvisor";
import {AbstractGenericStrategy} from "../Strategies/AbstractGenericStrategy";
import {AbstractAdvisor, BacktestWarmupState} from "../AbstractAdvisor";
import {AbstractConfig} from "../Trade/AbstractConfig";
import {Currency} from "@ekliptor/bit-models";

export interface StrategyMeta {
    importLabel: string;
}
export interface GenericStrategyUpdate {
    nr: number;
    exchanges: string[]; // include for lending too for easier compatibility. array with 1 element
    strategies: {
        [name: string]: {
            candleSize?: number;
        }
    };
    currencyPairStr: string;
    baseCurrency: string;
    activeNr: number;
    mainStrategyName: string;
    userToken: string;
}
export interface StrategyUpdate extends GenericStrategyUpdate {
    marginTrading: boolean;
    tradeTotalBtc: number;
    warmUpMin: number;
    quoteCurrency: string;
    position: StrategyPosition;
    positionAmount: number;
    pl: number;
    plPercent: number;
    meta: StrategyMeta;
}
export interface LendingStrategyUpdate extends GenericStrategyUpdate {
    exchange: string;
}

export class StrategyUpdater extends AppPublisher {
    public readonly opcode = WebSocketOpcode.STRATEGIES;
    protected lastUpdateMap = new Map<string, Date>(); // (strategy name, timestamp)
    protected activeConfigCurrencyNr = 1; // for tabs
    protected maxConfigNr: number;

    constructor(serverSocket: ServerSocket, advisor: AbstractAdvisor) {
        super(serverSocket, advisor)
        this.waitForConfigLoaded().then(() => {
            this.maxConfigNr = this.advisor.getConfigs().length;
            this.publishStrategyUpdates();
        });
    }

    public onSubscription(clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
        this.sendFullData(clientSocket)
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected sendFullData(clientSocket: ClientSocketOnServer) {
        if (this.advisor instanceof TradeAdvisor) {
            let update: StrategyUpdate[] = []
            let configs: TradeConfig[] = this.advisor.getConfigs();
            let strategies = this.advisor.getStrategies();
            configs.forEach((config) => {
                config.markets.forEach((market) => {
                    const configCurrencyPair = TradeConfig.createConfigCurrencyPair(config.configNr, market)
                    let pairStrategies = strategies.get(configCurrencyPair);
                    if (!pairStrategies)
                        return logger.error("No strategies found for pair %s", configCurrencyPair)
                    const mainStrategy = AbstractStrategy.getMainStrategy(pairStrategies, true);
                    const currencyPairStr = market.toString();
                    const currencyPairParts = currencyPairStr.split("_");
                    let curUpdate: StrategyUpdate = {
                        nr: config.configNr,
                        exchanges: config.exchanges,
                        marginTrading: config.marginTrading,
                        tradeTotalBtc: config.tradeTotalBtc,
                        warmUpMin: config.warmUpMin,
                        strategies: {},
                        currencyPairStr: currencyPairStr,
                        baseCurrency: currencyPairParts[0],
                        quoteCurrency: currencyPairParts[1],
                        position: mainStrategy.getStrategyPosition(),
                        positionAmount: mainStrategy.getPositionAmount(),
                        pl: mainStrategy.getProfitLoss(),
                        plPercent: mainStrategy.getProfitLossPercent(),
                        activeNr: this.activeConfigCurrencyNr,
                        mainStrategyName: mainStrategy.getClassName(),
                        userToken: nconf.get("serverConfig:userToken"),
                        meta: {
                            importLabel: this.getWarmupStateLabel(this.advisor.getBacktestWarmupState())
                        }
                    }
                    if (config.configNr === this.activeConfigCurrencyNr) { // only send strategy data for the active tab
                        pairStrategies.forEach((strat) => {
                            curUpdate.strategies[strat.getClassName()] = strat.getInfo()
                        })
                    }
                    update.push(curUpdate)
                })
            })
            this.send(clientSocket, {full: update});
        }
        else if (this.advisor instanceof LendingAdvisor) {
            let update: LendingStrategyUpdate[] = []
            let configs: LendingConfig[] = this.advisor.getConfigs();
            let strategies = this.advisor.getLendingStrategies();
            configs.forEach((config) => {
                config.markets.forEach((market) => {
                    const configCurrencyPair = LendingConfig.createConfigCurrencyPair(config.configNr, market)
                    let pairStrategies = strategies.get(configCurrencyPair);
                    if (!pairStrategies)
                        return logger.error("No strategies found for pair %s", configCurrencyPair)
                    const marketName = Currency.getCurrencyLabel(market);
                    let curUpdate: LendingStrategyUpdate = {
                        nr: config.configNr,
                        exchange: config.exchange,
                        exchanges: [config.exchange],
                        strategies: {},
                        currencyPairStr: marketName,
                        baseCurrency: marketName,
                        activeNr: this.activeConfigCurrencyNr,
                        mainStrategyName: pairStrategies[0].getClassName(), // lending doesn't have main strategies (usually only 1)
                        userToken: nconf.get("serverConfig:userToken")
                    }
                    if (config.configNr === this.activeConfigCurrencyNr) { // only send strategy data for the active tab
                        pairStrategies.forEach((strat) => {
                            curUpdate.strategies[strat.getClassName()] = strat.getInfo()
                        })
                    }
                    update.push(curUpdate)
                })
            })
            this.send(clientSocket, {full: update});
        }
    }

    protected onData(data: any, clientSocket: ClientSocketOnServer, initialRequest: http.IncomingMessage): void {
        if (typeof data.tabNr === "number" && data.tabNr >= 1 && data.tabNr <= this.maxConfigNr) {
            this.activeConfigCurrencyNr = Math.floor(data.tabNr); // shouldn't be needed
            this.sendFullData(clientSocket);
        }
        else if (typeof data.closePos === "number" && data.pair && this.advisor instanceof TradeAdvisor) {
            let config = AbstractAdvisor.getConfigByNr<TradeConfig>(this.advisor.getConfigs(), data.closePos);
            const currencyPair = Currency.CurrencyPair.fromString(data.pair);
            if (config && currencyPair) {
                let strategy = this.advisor.getMainStrategy(config.getConfigCurrencyPair(currencyPair));
                strategy.closePosition();
            }
            else
                logger.error("Unable to get config nr %s and currency pair %s", data.closePos, data.pair);
            // TODO immediately sync positions? shouldn't be needed since we receive a close event from the exchange
        }
    }

    protected publishStrategyUpdates() {
        if (this.advisor instanceof TradeAdvisor) {
            let strategies: StrategyMap = this.advisor.getStrategies();
            for (let strat of strategies) {
                strat[1].forEach((strategy) => {
                    this.publishStrategyInfo(strat[0], strategy)
                })
            }
        }
        else if (this.advisor instanceof LendingAdvisor) {
            let strategies = this.advisor.getLendingStrategies();
            for (let strat of strategies) {
                strat[1].forEach((strategy) => {
                    this.publishStrategyInfo(strat[0], strategy)
                })
            }
        }
    }

    protected publishStrategyInfo(config: string/*configCurrencyPair*/, strategy: AbstractGenericStrategy) {
        const configNr = parseInt(config.split("-")[0]);
        strategy.on("info", (info) => {
            if (configNr !== this.activeConfigCurrencyNr)
                return;
            let lastUpdate = this.lastUpdateMap.get(strategy.getClassName());
            if (lastUpdate && lastUpdate.getTime() + nconf.get("serverConfig:minStrategyUpdateMs") > Date.now())
                return; // only update every x seconds to avoid browser hanging with many strategies
            let update: any = {
                config: config,
                strategies: {},
                meta: { // TODO event system for updates. for quick backtests notifications don't show up
                    importLabel: this.getWarmupStateLabel(this.advisor.getBacktestWarmupState())
                }
            }
            if (strategy instanceof AbstractStrategy && strategy.isMainStrategy()) {
                update.position = strategy.getStrategyPosition();
                update.positionAmount = strategy.getPositionAmount();
                update.pl = strategy.getProfitLoss();
                update.plPercent = strategy.getProfitLossPercent();
            }
            update.strategies[strategy.getClassName()] = info;
            this.publish(update);
            this.lastUpdateMap.set(strategy.getClassName(), new Date());
        })
    }

    protected getWarmupStateLabel(state: BacktestWarmupState): string {
        switch (state)
        {
            case BacktestWarmupState.IDLE:
                return "";
            case BacktestWarmupState.BACKTEST_FAILED:
                return "backtestFailed";
            case BacktestWarmupState.BACKTEST_DONE:
                return "backtestDone";
            case BacktestWarmupState.BACKTESTING:
                return "backtestRunning";
            case BacktestWarmupState.IMPORTING:
                return "importRunning";
            case BacktestWarmupState.IMPORT_FAILED:
                return "importFailed";
        }
        return utils.test.assertUnreachableCode(state);
    }
}