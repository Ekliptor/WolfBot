import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as EventEmitter from 'events';
import {Currency, Trade} from "@ekliptor/bit-models";
import {AbstractExchange} from "../Exchanges/AbstractExchange";

export abstract class AbstractMarketStream extends EventEmitter {
    protected className: string;
    protected exchange: AbstractExchange;
    //protected emitTradesQueue = Promise.resolve();
    //protected lastTradeMin = new Map<string, number>(); // (currency pair, minute)
    //protected pendingTrades = new Map<string, Trade.Trade>(); // (currency pair, trades)

    constructor(exchange: AbstractExchange) {
        super()
        this.className = this.constructor.name;
        this.exchange = exchange;
        // fix warning: (node:5161) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 buy listeners added. Use emitter.setMaxListeners() to increase limit
        this.setMaxListeners(nconf.get('maxEventListeners'));
    }

    public abstract write(currencyPair: Currency.CurrencyPair, actions: any[], seqNr: number);

    public close() {
        this.removeAllListeners();
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}