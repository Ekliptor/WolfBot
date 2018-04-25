import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Candle, Order, Funding} from "@ekliptor/bit-models";
import * as WebSocket from "ws";
import * as http from "http";
import {ServerSocketPublisher, ServerSocket} from "./ServerSocket";
import {AppPublisher} from "./AppPublisher";
import {WebSocketOpcode} from "./opcodes";
import {LendingAdvisor} from "../Lending/LendingAdvisor";
import {CurrencyJson, LendingConfig} from "../Lending/LendingConfig";
import {OfferResult} from "../structs/OfferResult";
import {
    CoinStatusMap,
    ExchangeCoinStatusMap,
    GlobalExchangeInterest, GlobalInterestMap, GlobalLendingStatsMap, InterestMap, LendingRateMap,
    LendingTradeInfo, TotalEquityMap
} from "../Lending/AbstractLendingTrader";
import {CancelOrderResult} from "../Exchanges/AbstractExchange";
import {CoinMap} from "../Trade/PortfolioTrader";

export interface LendingUpdate {
    nr: number;
    exchange: string;
    configCurrencies: CurrencyJson;
    balances: Currency.LocalCurrencyList;
    balancesTaken: Currency.LocalCurrencyList;
    balancesTakenPercent: Currency.LocalCurrencyList; // keys are the same, values represent % values
    lendingRates: { // ExchangeLendingRateMap to object
        [currencyStr: string]: {
            [prop: string]: number;
        }
    };
    interest: GlobalExchangeInterest;
    minLendingRates: InterestMap;
    coinStatus: ExchangeCoinStatusMap;
    totalEquity: number;
    currencies: Currency.CurrencyMap;
    /*
    strategies: {
        [name: string]: {

        }
    }
    */
}

export class LendingUpdater extends AppPublisher {
    public readonly opcode = WebSocketOpcode.LENDING;
    protected lendingAdvisor: LendingAdvisor;

    constructor(serverSocket: ServerSocket, lendingAdvisor: LendingAdvisor) {
        super(serverSocket, lendingAdvisor)
        this.lendingAdvisor = lendingAdvisor;
        this.publishLendingUpdates();
    }

    public onSubscription(clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        let configs = this.lendingAdvisor.getConfigs();
        //let strategies = this.lendingAdvisor.getLendingStrategies();
        let traders = this.lendingAdvisor.getTraders();
        const balances = traders[0].getBalances(); // balances static, identical in all traders
        const balancesTaken = traders[0].getBalancesTaken();
        const balancesTakenPercent = traders[0].getBalancesTakenPercent();
        const lendingRates = traders[0].getLendingRates();
        const interest = traders[0].getGlobalInterestStats();
        const minLendingRates = traders[0].getMinLendingRates();
        const coinStatus = traders[0].getCoinStatusMap();
        const totalEquity = traders[0].getTotalEquity();
        let updatedExchanges = new Set<string>(); // only send data once for every exchange
        let update: LendingUpdate[] = []
        configs.forEach((config) => {
            config.markets.forEach((market) => {
                if (updatedExchanges.has(config.exchange))
                    return;
                //const configCurrencyPair = LendingConfig.createConfigCurrencyPair(config.configNr, market)
                //let pairStrategies = strategies.get(configCurrencyPair);
                //if (!pairStrategies)
                    //return logger.error("No lending strategies found for pair %s", configCurrencyPair)
                let curUpdate: LendingUpdate = {
                    nr: config.configNr,
                    exchange: config.exchange,
                    configCurrencies: LendingConfig.getCurrencyJson(configs),
                    balances: balances.get(config.exchange),
                    balancesTaken: balancesTaken.get(config.exchange),
                    balancesTakenPercent: balancesTakenPercent.get(config.exchange),
                    lendingRates: lendingRates.get(config.exchange).toObject(), // Map can't be serialized
                    interest: interest.get(config.exchange),
                    minLendingRates: minLendingRates.get(config.exchange).toObject(),
                    coinStatus: coinStatus.get(config.exchange).toObject(),
                    totalEquity: totalEquity.get(config.exchange),
                    currencies: Currency.getCurrencyMap()
                    //strategies: {
                    //}
                }

                /*
                pairStrategies.forEach((strat) => {
                    curUpdate.strategies[strat.getClassName()] = strat.getInfo()
                })
                */
                update.push(curUpdate)
                updatedExchanges.add(config.exchange);
            })
        })
        this.send(clientSocket, {full: update});
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected publishLendingUpdates() {
        let configs = this.lendingAdvisor.getConfigs();
        let traders = this.lendingAdvisor.getTraders();
        traders.forEach((trader) => {
            /*
            trader.on("placed", (offer: Funding.FundingOrder, result: OfferResult, info: LendingTradeInfo) => {
            })
            trader.on("cancelled", (offer: Funding.FundingOrder, result: CancelOrderResult, info: LendingTradeInfo) => {
            })
            */
            // event should only be emitted once since coins are static in trader
            trader.on("synced", (balances: CoinMap, balancesTaken: CoinMap, balancesTakenPercent: CoinMap, lendingRates: LendingRateMap,
                                 interest: GlobalLendingStatsMap, minLendingRates: GlobalInterestMap, coinStatus: CoinStatusMap, totalEquity: TotalEquityMap) => {
                //logger.verbose("synced", balances, balancesTaken, balancesTakenPercent);
                // we don't know which exchange has been synced. but in lending mode there is only 1
                let updatedExchanges = new Set<string>(); // only send data once for every exchange
                configs.forEach((config) => {
                    if (updatedExchanges.has(config.exchange))
                        return;
                    let update = {
                        nr: config.configNr,
                        exchange: config.exchange,
                        balances: balances.get(config.exchange),
                        balancesTaken: balancesTaken.get(config.exchange),
                        balancesTakenPercent: balancesTakenPercent.get(config.exchange),
                        lendingRates: lendingRates.get(config.exchange).toObject(), // Map can't be serialized
                        interest: interest.get(config.exchange),
                        minLendingRates: minLendingRates.get(config.exchange).toObject(),
                        coinStatus: coinStatus.get(config.exchange).toObject(),
                        totalEquity: totalEquity.get(config.exchange)
                    }
                    this.publish(update);
                    updatedExchanges.add(config.exchange);
                })
            })
        })
    }
}