import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {MarketOrder, Ticker, Trade, TradeHistory, Currency} from "@ekliptor/bit-models";
import {CcxtExchange, CcxtOrderParameters} from "./CcxtExchange";
import {ExOptions, OpenOrders, OrderParameters} from "./AbstractExchange";
import * as ccxt from "ccxt";
import {OrderResult} from "../structs/OrderResult";


// https://github.com/bitkub/bitkub-official-api-docs/blob/master/restful-api.md#error-codes
export default class Bitkub extends CcxtExchange {
    constructor(options: ExOptions) {
        super(options);
        this.exchangeLabel = Currency.Exchange.BITKUB;
        this.minTradingValue = 0.001;
        this.fee = 0.0025;
        this.currencies.setSwitchCurrencyPair(true);
        let config = this.getExchangeConfig();
        //config.uid = this.apiKey.passphrase;
        this.apiClient = new ccxt.bitkub(config); // https://github.com/ccxt/ccxt/issues/4488
        this.apiClient.loadMarkets().then(() => {
            this.onExchangeReady();
        }).catch((err) => {
            logger.error("Error loading %s markets", this.className, err);
        });
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    public async buy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: CcxtOrderParameters = {}): Promise<OrderResult> {
        //if (this.currencies.isSwitchedCurrencyPair() === true)
            //amount *= rate;
        let outParams = await this.verifyTradeRequest(currencyPair, rate, amount, params)
        try {
            amount = parseFloat(utils.calc.round(amount, 8) + ""); // remove trailing 0 // TODO should be fixed inside CCXT
            let result = await this.apiClient.createOrder(outParams.pairStr as string, outParams.orderType as any, "buy", amount, outParams.rate as number, params as any);
            this.verifyTradeResponse(result, null, "buy");
            return OrderResult.fromJson(result, currencyPair, this)
        }
        catch (err) {
            throw this.formatInvalidExchangeApiResponse(err);
        }
    }

    public async sell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: CcxtOrderParameters = {}): Promise<OrderResult> {
        //if (this.currencies.isSwitchedCurrencyPair() === true)
            //amount /= rate;
        let outParams = await this.verifyTradeRequest(currencyPair, rate, amount, params)
        try {
            amount = parseFloat(utils.calc.round(amount, 8) + ""); // remove trailing 0
            let result = await this.apiClient.createOrder(outParams.pairStr as string, outParams.orderType as any, "sell", amount, outParams.rate as number, params as any);
            this.verifyTradeResponse(result, null, "sell");
            return OrderResult.fromJson(result, currencyPair, this)
        }
        catch (err) {
            throw this.formatInvalidExchangeApiResponse(err);
        }
    }
}
