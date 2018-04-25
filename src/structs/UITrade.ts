import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, BotTrade} from "@ekliptor/bit-models";

// Classes that remove some properties from bit-models base class to send to the browser with less overhead.
// Additionally some properties are converted (to string) to display them directly.

// aliases (to avoid dependency on bit-models in browser)
//export type UITradeType = BotTrade.LogTradeType; // doesn't work
//export const UITradeType = BotTrade.LogTradeType; // works, but still creates a dependency on bit-models
//export const UIMarket = BotTrade.LogTradeMarket;

export class UIBotTrade extends BotTrade.BotTrade {
    public currencyPairStr: string;
    public marketStr: string;
    public typeStr: string;
    public exchangeStr: string;
    public trades: undefined; // can still be assigned with undefined, null, never
    public userToken: undefined;

    constructor(trade: BotTrade.BotTrade) {
        super(trade.time, trade.market, trade.type, trade.exchange, trade.currencyPair)
        this.currencyPairStr = this.currencyPair.toString();
    }

    public static fromTrade(trade: BotTrade.BotTrade): UIBotTrade {
        let uiTrade = Object.assign(new UIBotTrade(trade), trade);
        createUIProperties(uiTrade);
        delete uiTrade.trades;
        delete uiTrade.userToken;
        return uiTrade;
    }
}

export class UIBotLendingTrade extends BotTrade.BotLendingTrade {
    public currencyStr: string;
    public marketStr: string;
    public typeStr: string;
    public exchangeStr: string;
    public lendingTrades: undefined;
    public userToken: undefined;

    constructor(trade: BotTrade.BotLendingTrade) {
        super(trade.time, trade.market, trade.type, trade.exchange, trade.currencyPair.from) // from and to identical
        this.currencyStr = Currency.getCurrencyLabel(this.currencyPair.from)
    }

    public static fromTrade(trade: BotTrade.BotLendingTrade): UIBotLendingTrade {
        let uiTrade = Object.assign(new UIBotLendingTrade(trade), trade);
        createUIProperties(uiTrade);
        delete uiTrade.lendingTrades;
        delete uiTrade.userToken;
        return uiTrade;
    }
}

function createUIProperties(trade: UIBotTrade | UIBotLendingTrade) {
    trade.exchangeStr = Currency.Exchange[trade.exchange];
    trade.marketStr = BotTrade.LogTradeMarket[trade.market];
    trade.typeStr = BotTrade.LogTradeType[trade.type];
}