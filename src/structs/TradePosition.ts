import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency} from "@ekliptor/bit-models";
import {StrategyPosition} from "../Strategies/AbstractStrategy";


export class SimpleTrade {
    amount: number;
    rate: number;

    constructor(amount: number, rate: number) {
        this.amount = amount;
        this.rate = rate;
    }
}

/**
 * Simple equivalent of MarginPosition class.
 * Used to track profit & loss of our coin holdings if we buy/sell in
 * multiple chunks.
 * Doesn't work yet if we trade without the bot. // TODO store all coins and re-sync?
 */
export class TradePosition {
    // the margin position doesn't need arrays because we get the data from the exchange.
    // here we must track every order individually
    trades: SimpleTrade[] = [];
    //basePrice: number = 0; // TODO compute break even price
    pl: number = 0; // profit/loss in base currency (BTC)
    type: StrategyPosition = "none"; // none means no open margin position


    constructor() {
    }

    public getAmount() {
        let amount = 0.0;
        this.trades.forEach((trade) => {
            amount += trade.amount;
        });
        return amount > 0.0 ? amount : 0.0;
    }

    public getTotal() {
        let total = 0.0;
        this.trades.forEach((trade) => {
            total += trade.amount * trade.rate;
        });
        return total > 0.0 ? total : 0.0;
    }

    public getProfitLoss(currentRate: number) {
        let pl = 0.0;
        this.trades.forEach((trade) => {
            pl += (trade.amount * currentRate) - (trade.amount * trade.rate); // positive if the price wen't up after we bought
        });
        return Math.floor(pl*100000000) / 100000000; // max 8 decimals
    }

    public getAverageRate(): number {
        let sum = 0.0, vol = 0.0;
        for (let i = 0; i < this.trades.length; i++)
        {
            sum += this.trades[i].rate * this.trades[i].amount;
            vol += this.trades[i].amount;
        }
        if (vol === 0.0)
            return 0.0;
        return Math.floor(sum/vol*100000000) / 100000000; // max 8 decimals
    }

    public getType(): StrategyPosition {
        const amount = this.getAmount();
        if (amount > 0.0)
            return "long";
        else if (amount < 0.0)
            return "short"; // short is not possible without margin trading
        return "none";
    }

    /**
     * Returns the value of a position in base currency (BTC) for a given rate
     * @param rate
     * @returns {number}
     */
    public getPositionValue(rate: number) {
        if (this.type === "long")
            return this.getAmount() * rate;
        else if (this.type === "short")
            return -1*this.getAmount() * rate;
        return 0;
    }

    /**
     * Add a trade to this margin position
     * @param amount The amount of coins. MUST be negative for sells.
     * @param rate
     */
    public addTrade(amount: number, rate: number) {
        this.trades.push(new SimpleTrade(amount, rate))
    }

    /**
     * Get the profit/loss percentage.
     * Usually very low % on margin trading because leverage is included in "amount".
     * @param {number} the current rate of the coin
     * @returns {number}
     */
    public getProfitLossPercent(currentRate: number) {
        const amount = this.getAmount();
        if (amount === 0)
            return 0.0;
        let profitLoss = this.getProfitLoss(currentRate) / (Math.abs(amount) * currentRate) * 100.0;
        return profitLoss;
    }

    public isEmpty() {
        return this.getAmount() === 0.0;
    }
}
