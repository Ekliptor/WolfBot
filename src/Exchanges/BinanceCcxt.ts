import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {MarketOrder, Ticker, Trade, TradeHistory, Currency} from "@ekliptor/bit-models";
import {CcxtExchange, CcxtOrderParameters} from "./CcxtExchange";
import {ExOptions, ExRequestParams, OpenOrders, OrderParameters} from "./AbstractExchange";
import * as ccxt from "ccxt";
import {OrderResult} from "../structs/OrderResult";


export default class BinanceCcxt extends CcxtExchange {
    constructor(options: ExOptions) {
        super(options);
        this.exchangeLabel = Currency.Exchange.BINANCE;
        this.minTradingValue = 0.0; // 0.001 // use 0 and hat exchange handle it
        this.fee = 0.001;
        this.currencies.setSwitchCurrencyPair(true);
        let opts = this.getExchangeConfig();
        if (opts.defaultType !== undefined) // TODO read from config and allow switch (we need multiple instances then)
            opts.options.defaultType = opts.defaultType; // 'spot', 'future', 'margin', 'delivery'
        opts.parseOrderToPrecision = true;
        this.apiClient = new ccxt.binance(opts);
        this.apiClient.loadMarkets().then(() => {
            this.onExchangeReady();
        }).catch((err) => {
            logger.error("Error loading %s markets", this.className, err);
        });
    }

    /*
    public async buy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: CcxtOrderParameters = {}): Promise<OrderResult> {
        if (this.currencies.isSwitchedCurrencyPair() === true)
            amount *= rate; // re-added 2020-10-30
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
    }*/

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected verifyTradeRequest(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: CcxtOrderParameters = {}) {
        return new Promise<ExRequestParams>((resolve, reject) => {
            if (currencyPair) {
                if (this.currencies.getExchangePair(currencyPair) === undefined)
                    return reject({txt: "Currency pair not supported by this exchange", exchange: this.className, pair: currencyPair, permanent: true});
            }
            // binance CCXT has the needed precision. wait for API failure on min balance (depending on coin)
            //if (amount > 0 && rate * amount < this.minTradingValue)
                //return reject({txt: "Value is below the min trading value", exchange: this.className, value: rate*amount, minTradingValue: this.minTradingValue, permanent: true})

            let outParams: any = {
                dummy: "use-api-client",
                orderType: params.matchBestPrice ? "market" : "limit",
                pairStr: this.currencies.getExchangePair(currencyPair),
                // precision mostly 8 or 6 http://python-binance.readthedocs.io/en/latest/binance.html#binance.client.Client.get_symbol_info
                rate: rate
            }
            resolve(outParams)
        })
    }
}
