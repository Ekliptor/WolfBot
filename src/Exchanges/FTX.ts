import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {MarketOrder, Ticker, Trade, TradeHistory, Currency} from "@ekliptor/bit-models";
import {CcxtExchange, CcxtOrderParameters} from "./CcxtExchange";
import {ExOptions, OpenOrders, OrderParameters} from "./AbstractExchange";
import * as ccxt from "ccxt";
import * as crypto from "crypto";
import {OrderResult} from "../structs/OrderResult";


export default class FTX extends CcxtExchange {
    constructor(options: ExOptions) {
        super(options);
        this.exchangeLabel = Currency.Exchange.FTX;
        this.minTradingValue = 0.001;
        this.fee = 0.001;
        this.currencies.setSwitchCurrencyPair(true);
        let config = this.getExchangeConfig();
        config.password = this.apiKey.passphrase;
        config.headers = {
            // tag should only be needed as param in buy/sell calls. but can't hurt to add here too
            "externalReferralProgram": "wolfbot",
        }
        this.apiClient = new ccxt.ftx(config);
        this.apiClient.loadMarkets().then(() => {
            this.onExchangeReady();
        }).catch((err) => {
            logger.error("Error loading %s markets", this.className, err);
        });
    }

    public async buy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: CcxtOrderParameters = {}): Promise<OrderResult> {
        let outParams = await this.verifyTradeRequest(currencyPair, rate, amount, params)
        if (this.currencies.isSwitchedCurrencyPair() === true)
            amount *= rate;
        amount = parseFloat(utils.calc.round(amount, 8) + ""); // remove trailing 0
        try {
            const outParams: any = params;
            outParams.externalReferralProgram = "wolfbot";
            let result = await this.apiClient.createOrder(outParams.pairStr as string, outParams.orderType as any, "buy", amount, outParams.rate as number, outParams);
            this.verifyTradeResponse(result, null, "buy");
            return OrderResult.fromJson(result, currencyPair, this)
        }
        catch (err) {
            throw this.formatInvalidExchangeApiResponse(err);
        }
    }

    public async sell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: CcxtOrderParameters = {}): Promise<OrderResult> {
        let outParams = await this.verifyTradeRequest(currencyPair, rate, amount, params)
        if (this.currencies.isSwitchedCurrencyPair() === true) {
            if (Currency.isFiatCurrency(currencyPair.from) === true)// not needed for binance
                amount /= rate;
            //amount *= rate;
        }

        amount = parseFloat(utils.calc.round(amount, 8) + ""); // remove trailing 0
        try {
            const outParams: any = params;
            outParams.externalReferralProgram = "wolfbot";
            let result = await this.apiClient.createOrder(outParams.pairStr as string, outParams.orderType as any, "sell", amount, outParams.rate as number, outParams);
            this.verifyTradeResponse(result, null, "sell");
            return OrderResult.fromJson(result, currencyPair, this)
        }
        catch (err) {
            throw this.formatInvalidExchangeApiResponse(err);
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

}
