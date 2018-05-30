import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Candle, Currency, Trade, Order, Ticker, MarketOrder} from "@ekliptor/bit-models";
import {AbstractArbitrageStrategy, ArbitrageStrategyAction, ArbitrageTrade} from "./AbstractArbitrageStrategy";
import {ExchangeCandles} from "../ExchangeCandles";
import {MaxSpreadCandles} from "../MaxSpreadCandles";
import {TradeInfo} from "../../Trade/AbstractTrader";
import {TradeAction} from "../../Strategies/AbstractStrategy";
import {MarginPosition} from "../../structs/MarginPosition";

interface SpreadAction extends ArbitrageStrategyAction {
    spreadEntry: number; // 0.8% // how many % the market spread has to be to open positions
    spreadTarget: number; // 0.5% // targeted profit in % (takes trading fees into account)
    // spreadExit = spreadEntry - 4*fees - spreadTarget -> will usually negative, meaning prices flipped
    trailingSpreadStop: number; // 0.08% // after reaching spreadTarget, place a trailing stop to exit the market. set to 0 to exit immediately
}

/**
 * Strategy that computes the average price across exchanges.
 * If the price is x% higher/lower than avg on exchanges:
 * 1. buy at the cheaper exchange and (short) sell at the expensive exchange
 * 2. close positions after price difference moves x% closer
 */
export default class Spread extends AbstractArbitrageStrategy {
    protected action: SpreadAction;
    protected spreadTargetReached = false;
    protected trailingStopSpread = 0.0;

    constructor(options) {
        super(options)
        this.addInfo("spreadTargetReached", "spreadTargetReached");
        this.addInfo("trailingStopSpread", "trailingStopSpread");
    }

    public getArbitrageRate(arbitrageTrade: ArbitrageTrade): number {
        // overwrite this to use custom buy/sell rates
        return super.getArbitrageRate(arbitrageTrade);
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
        if (action !== "close") {
            this.spreadTargetReached = false;
            this.trailingStopSpread = 0.0;
        }
    }

    public onSyncPortfolio(coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange) {
        super.onSyncPortfolio(coins, position, exchangeLabel);
        if (this.arbitrageState === "none") {
            this.spreadTargetReached = false;
            this.trailingStopSpread = 0.0;
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected currentCandleTick(candle: Candle.Candle, isNew: boolean): Promise<void> {
        // overwrite this in your subclass if your strategy needs the current candle
        return super.currentCandleTick(candle, isNew);
    }

    protected tick(trades: Trade.Trade[]) {
        // implement this to do arbitrage more quickly (directly based on trades). remember to call the parent function in the end!
        return super.tick(trades);
    }

    protected exchangeCandleTick(candles: ExchangeCandles) {
        return new Promise<void>((resolve, reject) => {
            //console.log("EX candles", candles)
            switch (this.arbitrageState)
            {
                case "none":
                    this.checkOpenArbitrage(candles);
                    break;
                case "halfOpen":
                    break;
                case "open":
                    this.checkExitArbitrage(candles);
                    break;
            }
            resolve()
        })
    }

    protected checkOpenArbitrage(candles: ExchangeCandles) {
        let spread = this.calcMaxSpread(candles);
        if (spread.getSpreadPercentage() > this.action.spreadEntry) {
            this.log(utils.sprintf("Performing arbitrage at spread percentage at %s%%", spread.getSpreadPercentage().toFixed(2)));
            this.performArbitrage(spread.getMinCandle().exchange, spread.getMaxCandle().exchange, spread.getMinCandle().close, spread.getMaxCandle().close);
        }
        else
            this.log(utils.sprintf("Spread percentage at %s%% is too low for arbitrage", spread.getSpreadPercentage().toFixed(2)));
    }

    protected checkExitArbitrage(candles: ExchangeCandles) {
        let spread = this.calcMaxSpread(candles);
        if (this.spreadTargetReached === true && this.action.trailingSpreadStop > 0.0) {
            if (spread.getSpreadPercentage() >= this.trailingStopSpread) { // our profits increase with decreasing spread
                this.log(utils.sprintf("Arbitrage trailing stop spread %s%% reached at %s%%", this.trailingStopSpread.toFixed(2), spread.getSpreadPercentage().toFixed(2)))
                this.closeArbitragePositions();
            }
            else {
                const nextTrailingStop = spread.getSpreadPercentage() + spread.getSpreadPercentage() * this.action.trailingSpreadStop;
                if (nextTrailingStop <= this.trailingStopSpread) // update stop to lower spread = more profit
                    this.trailingStopSpread = nextTrailingStop;
            }
            return;
        }

        let fees = 0;
        if (Array.isArray(this.arbitrageExchangePair) === true) // should always be true
            fees = this.getExchangeFee(this.arbitrageExchangePair[0], "taker") + this.getExchangeFee(this.arbitrageExchangePair[1], "taker");
        if (spread.getSpreadPercentage() <= this.action.spreadTarget - 2*fees) { // 2x fees because we add buy & sell exchange separately
            this.spreadTargetReached = true;
            this.log(utils.sprintf("Arbitrage spread target reached at %s%% with %s%% fees", spread.getSpreadPercentage().toFixed(2), fees.toFixed(2)))
            if (this.action.trailingSpreadStop == 0.0) {
                // close our positions immediately
                this.closeArbitragePositions();
            }
            else {
                // place a trailing stop
                this.trailingStopSpread = spread.getSpreadPercentage() + spread.getSpreadPercentage() * this.action.trailingSpreadStop;
            }
        }
    }

    protected calcMaxSpread(candles: ExchangeCandles): MaxSpreadCandles {
        let min = Number.MAX_VALUE, max = 0, minIndex = -1, maxIndex = -1;
        for (let i = 0; i < candles.candles.length; i++)
        {
            let candle = candles.candles[i];
            if (candle.close < min) {
                min = candle.close;
                minIndex = i;
            }
            if (candle.close > max) {
                max = candle.close;
                maxIndex = i;
            }
        }
        return new MaxSpreadCandles(candles.candles[minIndex], candles.candles[maxIndex]);
    }
}