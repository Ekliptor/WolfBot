import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency} from "@ekliptor/bit-models";
import {TradeDirection} from "../Trade/AbstractTrader";
import {TradeConfig} from "../Trade/TradeConfig";


export class ArbitrageConfig extends TradeConfig {
    //public readonly exitTicks: number = 0; // Close positions after x ticks. Might cause to exit the market at a loss.
    public readonly longShortRatio: number = 1.0; // Open a higher/lower amount on one side of arbitrage. Values > 1 mean long position will be bigger. // TODO
    public readonly followExchange: boolean = false; // Follow prices of the 1st exchange. Only trade on the 2nd in the same direction (not arbitrage, instead following a major exchange). // TODO
    public readonly maxTradeBalancePercentage: number = 99.0; // Trade at most with x% of our available coins (some exchanges might add fees on top).

    // part of Strategy config
    //public readonly spreadEntry: number = 0.8; // how many % the market spread has to be to open positions
    //public readonly spreadTarget: number = 0.5; // targeted profit in % (takes trading fees into account)
    // spreadExit = spreadEntry - 4*fees - target -> will usually negative, meaning prices flipped
    //public readonly trailingSpreadStop: number = 0.08; // after reaching spreadTarget, place a trailing stop to exit the market

    //public readonly maxSlippage: number = 0.1; // in %s - look at the order books and compute the real price of the order. don't execute otherwise // TODO also for trading?
    //public readonly minLiquidity: number = 3.0; // ensure there are at least x times as many bids/asks before submitting a order (to avoid slippage)

    constructor(json: any, configName: string) {
        super(json, configName);
    }
}