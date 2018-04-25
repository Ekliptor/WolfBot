import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade} from "@ekliptor/bit-models";
import {AbstractExchange} from "../Exchanges/AbstractExchange";


export class OfferResult {
    //"success":1,"message":"Margin order placed.","orderNumber":"154407998","resultingTrades":{"BTC_DASH":[{"amount":"1.00000000","date":"2015-05-10 22:47:05","rate":"0.01383692","total":"0.01383692","tradeID":"1213556","type":"buy"}]}
    // "orderNumber":31226040,"resultingTrades":[{"amount":"338.8732","date":"2014-10-18 23:03:21","rate":"0.00000173","total":"0.00058625","tradeID":"16164","type":"buy"}]

    success: boolean = true; // only used with margin trading (on poloniex)
    message: string = ""; // only used with margin trading (on poloniex)
    offerNumber: number | string = 0;

    constructor() {
    }

    public static fromJson(json, currency: Currency.Currency, exchange: AbstractExchange) {
        let result = new OfferResult();
        if (!json)
            return result;
        result.success = json.success == 0 || json.result === false ? false : true; // default true if parameter is missing
        result.message = "";

        // poloniex: {"success":1,"message":"Loan order placed.","orderID":10590}
        if (json.message)
            result.message = json.message;

        if (json.orderID) // poloniex
            result.offerNumber = typeof json.orderID === "number" ? json.orderID : parseInt(json.orderID);
        else if (json.id) // Bitfinex lending
            result.offerNumber = json.id;
        if (result.offerNumber === Number.NaN || !result.offerNumber) {
            logger.warn("Missing order number in order result json:", json)
            result.offerNumber = 0;
        }

        // TODO add more data (bitfinex only?)
        /**
         * { id: 103890175,
              currency: 'BTC',
              rate: '22.995',
              period: 2,
              direction: 'lend',
              timestamp: '1507367896.52719863',
              is_live: true,
              is_cancelled: false,
              original_amount: '0.02',
              remaining_amount: '0.02',
              executed_amount: '0.0',
              offer_id: 103890175 }
         */
        return result;
    }
}