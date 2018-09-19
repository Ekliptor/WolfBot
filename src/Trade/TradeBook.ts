import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Order, Funding, BotTrade} from "@ekliptor/bit-models";
import {TradeInfo} from "./AbstractTrader";
import {LendingTradeInfo} from "../Lending/AbstractLendingTrader";
import TradeAdvisor from "../TradeAdvisor";
import {LendingAdvisor} from "../Lending/LendingAdvisor";
import {ConfigCurrencyPair} from "./TradeConfig";
import * as db from "../database";


export class TradeBook {
    protected tradeAdvisor: TradeAdvisor = null; // only 1 of them will be set
    protected lendingAdvisor: LendingAdvisor = null;

    constructor(tradeAdvisor: TradeAdvisor, lendingAdvisor: LendingAdvisor) {
        this.tradeAdvisor = tradeAdvisor;
        this.lendingAdvisor = lendingAdvisor;
    }

    public logTrade(order: Order.Order, trades: Trade.Trade[], info: TradeInfo, configCurrencyPair: ConfigCurrencyPair) {
        if (nconf.get("trader") === "Backtester")
            return;
        let market = order.leverage > 1.0 || order.marginOrder ? BotTrade.LogTradeMarket.MARGIN : BotTrade.LogTradeMarket.EXCHANGE;
        let type: BotTrade.LogTradeType;
        if (market === BotTrade.LogTradeMarket.MARGIN) {
            if (order.type !== Trade.TradeType.CLOSE)
                type = order.type === Trade.TradeType.BUY ? BotTrade.LogTradeType.BUY : BotTrade.LogTradeType.SELL;
            else
                type = order.closePosition === "long" ? BotTrade.LogTradeType.CLOSE_LONG/*sell*/ : BotTrade.LogTradeType.CLOSE_SHORT;
        }
        else
            type = order.type === Trade.TradeType.BUY ? BotTrade.LogTradeType.BUY : BotTrade.LogTradeType.SELL;
        let botTrade = new BotTrade.BotTrade(order.date, market, type, order.exchange, order.currencyPair)
        let strategies = this.tradeAdvisor.getStrategies();
        let pairStrategies = strategies.get(configCurrencyPair);
        botTrade.setTradingData(this.tradeAdvisor.getConfigName(), pairStrategies.map(s => s.getClassName()), trades, info.reason);
        botTrade.setTradingAmount(order.rate, order.amount);
        // TODO get the trades worth in a user-defined tax currency (such as JPY...)
        if (info.exchange)
            botTrade.fees = info.exchange.getFee();
        if (nconf.get("arbitrage"))
            botTrade.arbitrage = true;
        this.store(botTrade);
    }

    public logLendingTrade(order: Funding.FundingOrder, trades: Funding.FundingTrade[], info: LendingTradeInfo, configCurrencyPair: ConfigCurrencyPair) {
        if (nconf.get("trader") === "Backtester")
            return;
        let botTrade = new BotTrade.BotLendingTrade(order.date, BotTrade.LogTradeMarket.LENDING, BotTrade.LogTradeType.LEND, order.exchange, order.currency)
        let strategies = this.lendingAdvisor.getLendingStrategies();
        let pairStrategies = strategies.get(configCurrencyPair);
        botTrade.setTradingData(this.tradeAdvisor.getConfigName(), pairStrategies.map(s => s.getClassName()), trades, info.reason);
        botTrade.setTradingAmount(order.rate, order.amount);
        if (info.exchange) {
            botTrade.lendingFees = info.exchange.getLendingFee();
            //botTrade.interestRate = order.rate; // daily rate
            botTrade.interestAmount = order.rate * order.amount * order.days;
            botTrade.days = order.days;
        }
        this.store(botTrade);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected store(botTrade: BotTrade.AbstractBotTrade) {
        if (nconf.get("serverConfig:userToken"))
            botTrade.userToken = nconf.get("serverConfig:userToken");
        (botTrade as any).currencyPair = botTrade.currencyPair.toNr(); // for smaller storage size. converted back when reading from DB
        BotTrade.storeTrade(db.get(), botTrade).then((success) => {
            if (success === false)
                logger.error("Failed to store bot trade", botTrade)
        }).catch((err) => {
            logger.error("Error storing bot trade", err)
        })
    }
}