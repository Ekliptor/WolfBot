import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {MarketOrder, Ticker, Trade, TradeHistory, Currency} from "@ekliptor/bit-models";
import {CcxtExchange} from "./CcxtExchange";
import {ExOptions, OpenOrders, OrderParameters} from "./AbstractExchange";
import * as ccxt from "ccxt";
import {OrderResult} from "../structs/OrderResult";


export default class BxCo extends CcxtExchange {
    constructor(options: ExOptions) {
        super(options);
        this.exchangeLabel = Currency.Exchange.BXCO;
        this.minTradingValue = 0.001;
        this.fee = 0.0025;
        this.apiClient = new ccxt.bxinth({
            /* // can be used for custom proxy per url
            proxy(url: string) {
                return 'https://example.com/?url=' + encodeURIComponent (url)
            }
            */
            proxy: this.getProxyUrl(),
            timeout: nconf.get("serverConfig:httpTimeoutMs"),
            enableRateLimit: true,
            apiKey: this.apiKey.key,
            secret: this.apiKey.secret
        });
        this.apiClient.loadMarkets().catch((err) => {
            logger.error("Error loading %s markets", this.className, err);
        });
    }

    public async buy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}): Promise<OrderResult> {
        // their exchange wants amount in THB, not in cryptocurrency
        return super.buy(currencyPair, rate, amount * rate, params);
    }

    public async sell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}): Promise<OrderResult> {
        // their exchange wants amount in THB, not in cryptocurrency
        return super.sell(currencyPair, rate, amount * rate, params);
    }

    public async getOpenOrders(currencyPair: Currency.CurrencyPair): Promise<OpenOrders> {
        const marketPair = this.currencies.getExchangePair(currencyPair);
        try {
            // bxinth fetchOrders not supported yet, filter by symbol buggy in this exchange
            let result = await this.apiClient.fetchOpenOrders(/*marketPair*/undefined, undefined, undefined, {});
            let orders = new OpenOrders(currencyPair, this.className);
            for (let i = 0; i < result.length; i++)
            {
                let o = result[i];
                if (o instanceof Promise) // fix for unresolved Promise response
                    o = await o;
                /**
                 * { info:
                   { pairing_id: 1,
                     order_id: 11054309,
                     order_type: 'buy',
                     rate: 2500,
                     amount: 0.08,
                     date: '2019-03-01 19:35:33' },
                  id: 11054309,
                  timestamp: 1551468933000,
                  datetime: '2019-03-01T19:35:33.000Z',
                  symbol: 'BTC/THB',
                  type: 'limit',
                  side: 'buy',
                  price: 2500,
                  amount: 0.08 } }
                 */
                let orderObj = {
                    orderNumber: o.id,
                    type: (o.side === "buy" ? "buy": "sell") as any, // TODO why do we need this cast?
                    rate: typeof o.price === "number" ? o.price : parseFloat(o.price),
                    amount: typeof o.amount === "number" ? o.amount : parseFloat(o.amount),
                    total: 0,
                    leverage: 1
                }
                orderObj.total = orderObj.rate * orderObj.amount;
                orders.addOrder(orderObj)
            }
            return orders;
        }
        catch (err) {
            throw this.formatInvalidExchangeApiResponse(err);
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

}