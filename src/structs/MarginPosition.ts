import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency} from "@ekliptor/bit-models";
import {StrategyPosition} from "../Strategies/AbstractStrategy";


export class MarginTrade {
    amount: number;
    rate: number;

    constructor(amount: number, rate: number) {
        this.amount = amount;
        this.rate = rate;
    }
}

/**
 * A "coin balance" for an open margin position.
 * This is returned by getAllMarginPositions()
 * For non-margin trading getBalances() returns Currency.LocalCurrencyList
 */
export class MarginPosition {
    amount: number = 0; // negative for short positions
    contracts?: number; // present for some futures exchanges (needed to close the correct amount)
    total: number = 0; // how much the we won/lost in currency of "amount" (without fees)
    basePrice: number = 0; // average entry price
    liquidationPrice: number = -1;
    pl: number = 0; // profit/loss in base currency (BTC)
    lendingFees: number = 0;
    type: StrategyPosition = "none"; // none means no open margin position
    leverage = 2.5;

    trades: MarginTrade[] = [];

    constructor(leverage: number) {
        this.leverage = leverage;
    }

    public static fromJson(json, leverage: number, filterEmpyPositions = true) {
        // some exchanges (poloniex) return all numbers as strings
        let position = new MarginPosition(leverage);
        for (let prop in json)
        {
            if (position[prop] === undefined)
                continue;
            else if (filterEmpyPositions) {
                if (prop === "type" && json[prop] === "none") // poloniex
                    return undefined;
                else if (prop === "amount" && json[prop] == 0) // more general filter for easier compatibility
                    return undefined;
            }

            if (prop === "type") {
                position[prop] = json[prop];
                if (position[prop] !== "long" && position[prop] !== "short")
                    logger.error("Unknown margin position type %s", position[prop], json);
                continue;
            }
            position[prop] = parseFloat(json[prop])
            if (position[prop] === Number.NaN) {
                logger.warn("Error parsing MarginPosition: key %s, value %s", prop, json[prop])
                position[prop] = 0
            }
        }
        return position;
    }

    public initTrades() {
        let trades = [];
        this.trades.forEach((trade) => {
            trades.push(new MarginTrade(trade.amount, trade.rate));
        });
        this.trades = trades;
    }

    public computePl(closePrice: number) {
        // TODO improve this. this is really basic and doesn't consider lending fees or even trading fees
        // it just looks if we have long or short and compares the price difference
        // also note that AbstractTrader currently doesn't allow to go short if we have an open long position for that currency pair (no mixed trading)
        // but this function should work nevertheless
        // TODO must be done FIFO for multiple trades in different directions
        if (typeof closePrice !== "number" || closePrice < 0.0) {
            logger.warn("Skipping p/l calculation because supplied market rate is invalid: %s", closePrice);
            return;
        }

        let totalBase = 0;
        let totalAmount = 0;
        this.trades.forEach((trade) => {
            totalBase += trade.amount * trade.rate;
            totalAmount += trade.amount;
        })
        if (this.type === "long") { // totalAmount > 0
            // we can sell our coins (hopefully at a higher price)
            this.pl = totalAmount*closePrice - totalBase;
        }
        else if (this.type === "short") { // totalAmount < 0
            // we have to buy coins (hopefully at a lower price)
            this.pl = Math.abs(totalBase) - Math.abs(totalAmount*closePrice)
        }
        this.pl = Math.floor(this.pl*100000000) / 100000000; // max 8 decimals
    }

    /**
     * Returns the value of a position in base currency (BTC) for a given rate
     * @param rate
     * @returns {number}
     */
    public getPositionValue(rate: number) {
        if (this.type === "long")
            return this.amount * rate;
        else if (this.type === "short")
            return -1*this.amount * rate;
        return 0;
    }

    /**
     * Add a trade to this margin position
     * @param amount The amount of coins. MUST be negative for sells.
     * @param rate
     */
    public addTrade(amount: number, rate: number) {
        this.trades.push(new MarginTrade(amount, rate))
    }

    /**
     * Adds the total amount traded.
     * @param amount The amount of coins. MUST be negative for sells.
     */
    public addAmount(amount: number) {
        this.amount += amount;
        if (this.amount > 0.0)
            this.type = "long";
        else if (this.amount < 0.0)
            this.type = "short";
        else
            this.type = "none";
    }

    /**
     * Combines another margin position of the same currency pair with this one by adding the position value and profits/losses.
     * @param {MarginPosition} otherPosition
     */
    public combine(otherPosition: MarginPosition) {
        this.amount += otherPosition.amount;
        this.total += otherPosition.total;
        this.pl += otherPosition.pl;
        // TODO basePrice and liqPrice based on volume
    }

    /**
     * Get the profit/loss percentage.
     * Usually very low % on margin trading because leverage is included in "amount".
     * @param {number} the current rate of the coin
     * @param {number} sepcify an optional leverage factor "amount" was leveraged with
     * @returns {number}
     */
    public getProfitLossPercent(currentRate: number, leverage = 0.0) {
        if (this.amount === 0)
            return 0;
        let profitLoss = this.pl / (Math.abs(this.amount) * currentRate) * 100.0;
        if (leverage > 0)
            profitLoss *= leverage;
        //else
            //profitLoss *= this.leverage;
        return profitLoss;
    }

    /**
     * Returns true if we have an open margin position
     */
    public isEmpty() {
        return this.amount === 0.0;
    }

    /**
     * Returns true if the amount of the other margin position is different.
     * @param o the other position to check against
     */
    public equals(o: any) {
        if (o instanceof MarginPosition === false)
            return false;
        return this.amount === o.amount;
    }
}

export class MarginPositionList extends Map<string, MarginPosition> { // (currency pair, margin pos)
    constructor() {
        super()
    }

    public static fromJson(json, currencies: Currency.ExchangeCurrencies, leverage: number, filterEmpyPositions = true): MarginPositionList {
        let list = new MarginPositionList();
        for (let prop in json)
        {
            let pair = currencies.getLocalPair(prop);
            if (pair === undefined)
                continue;
            let position = MarginPosition.fromJson(json[prop], leverage, filterEmpyPositions);
            if (position !== undefined)
                list.set(pair.toString(), position);
        }
        return list;
    }
}
