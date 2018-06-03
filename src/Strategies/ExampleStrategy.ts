import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, StrategyOrder, StrategyPosition, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";
import {MarginPosition} from "../structs/MarginPosition";
import {GenericStrategyState} from "./AbstractGenericStrategy";

//import * as _ from "lodash"; // useful for array operations (better than underscore library)
//import * as helper from "../utils/helper"; // more useful functions such as helper.getDiffPercent()


/**
 * This is the action interface for your strategy. It defines all parameters that are available for this strategy.
 * Those parameters can be set in the ExampleStrategy.json config file in the /config folder.
 *
 * Every config file can use this strategy, but it is good practice to create 1 config file with the same name as
 * this strategy as an example how to use your strategy - see /config/ExampleStrategy.json.
 */
interface ExampleStrategyAction extends TechnicalStrategyAction {
    interval: number; // optional, default 30 - Defines the number of candles used for other indicators to look back (such as RSI).
    mySettingSwitch: boolean; // optional, default true - This setting does nothing and will make you rich;)

    // RSI overbought and oversold thresholds
    low: number; // optional, default 30 Below this value RSI will be considered oversold.
    high: number; // Above this value RSI will be considered overbought.

    // some available settings in every strategy (from parent):
    candleSize: number; // candle size in minutes (only relevant if this strategy implements the candleTick() or checkIndicators() function)
    pair: Currency.CurrencyPair; // The currency pair this strategy trades on. (The exchange is defined in the root of the config 1 level above the strategies.)
    enableLog: boolean; // Enables logging for this strategy. call this.log() or this.warn()
}

/**
 * This is an example strategy. You can use it as a template to create your own strategy.
 * This file shows a lot available features and is therefore longer than most strategies.
 * It's possible to have your first strategy with only 50-100 lines of code. See NOOP.ts for a minimal example.
 */
export default class ExampleStrategy extends TechnicalStrategy {
    public action: ExampleStrategyAction;
    // add your custom member variables here
    protected myNumberArray: number[] = [];
    protected myValue: number = 3.1;

    constructor(options) {
        super(options)
        logger.error("%s is an example to build your own strategy. It should not be used for trading.", this.className);

        // set the default config values
        if (typeof this.action.interval !== "number")
            this.action.interval = 30;
        if (typeof this.action.mySettingSwitch !== "boolean")
            this.action.mySettingSwitch = true;
        if (typeof this.action.low !== "number")
            this.action.low = 30;

        /**
         * Add an indicator under a unique name
         * @param {name} the unique name of the indicator (must be unique within your strategy class)
         * @param {type} the type of the indicator. There must be a class with the same name available in the /Indicators folder.
         * @param {params} the parameters for this indicator. They depend on the type.
         */
        this.addIndicator("RSI", "RSI", this.action);

        // now add a 2nd RSI with different parameters
        let customParams = Object.assign({}, this.action); // copy the action to modify it
        // You can also read those RSI parameters from other "action" properties.
        // Before passing them to addIndicator() RSI expects them to be named "interval" ("low" and "high" are checked in this class only)
        customParams.interval = 25;
        this.addIndicator("myOtherRSI", "RSI", customParams);

        // Add strategy output info about the state of some variables of your strategy.
        // This information will be displayed in the "Strategy" tab during live trading.
        this.addInfo("myValue", "myValue"); // simply add a member variable
        this.addInfoFunction("RSI", () => { // add a function under a given label where you can return custom data
            return this.indicators.get("RSI").getValue();
        });
        this.addInfoFunction("random", () => {
            return utils.getRandom(0, 100);
        });
        this.saveState = true; // save the strategy state on bot restarts
        this.mainStrategy = true; // make this strategy a main strategy (meaning it can open new positions instead of just trade along existing positions)

        setTimeout(() => {
            this.demoLogFunctions();
        }, 5000);
    }

    /**
     * This is called on every trade. That includes trades from other strategies running on the same currency pair.
     * You can remove this function if you don't use it.
     * @param {TradeAction} action what type of trade just happened
     * @param {Order} order the order that started this trade
     * @param {Trade[]} trades the trades that got executed from this order. Will only be set for market orders (orders that execute
     *          immediately). For limit orders (orders placed to the order book) trades will be an empty array.
     * @param {TradeInfo} info Meta info for this trade such as:
     *          - the strategy that started it
     *          - the reason for it (used for notifications and logging)
     *          - the profit/loss of this trade (if it was a "close" action)
     *          - the exchange on which this trade happened
     */
    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo): void {
        super.onTrade(action, order, trades, info);
        if (action === "close") {
            // do some cleanup after closing a position
        }
    }

    /**
     * Your balance with the exchange has just been synced. This happens every 2-5 minutes (see updateMarginPositionsSec and
     * updatePortfolioSec). This does NOT mean your balance has changed (it might be the same).
     * Normally you only need this function to allow for manual deposits (or trading) while the strategy is running.
     * You can remove this function if you don't use it.
     * @param {number} coins the coins you hold on the exchange (for non-margin trading in config)
     * @param {MarginPosition} position the current margin position (for margin trading enabled in config)
     * @param {Exchange} exchangeLabel the exchange that has been synced
     */
    public onSyncPortfolio(coins: number, position: MarginPosition, exchangeLabel: Currency.Exchange): void {
        super.onSyncPortfolio(coins, position, exchangeLabel)
    }

    /**
     * Save the strategy state before the bot closes.
     * You can remove this function if you don't use it.
     * @returns {GenericStrategyState}
     */
    public serialize(): GenericStrategyState {
        let state = super.serialize();
        state.lastOBV = this.myNumberArray;
        state.myValue = this.myValue;
        return state;
    }

    /**
     * Restore the strategy state after the bot has restarted.
     * You can remove this function if you don't use it.
     * @param state
     */
    public unserialize(state: GenericStrategyState) {
        super.unserialize(state);
        this.myNumberArray = state.myNumberArray;
        this.myValue = state.myValue;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    /**
     * Called when new trades happen on the exchange.
     * This function is called every few seconds (depending on how many trades happen for the currency pair set with this.action.pair).
     * Use this for fast trading or fast stops, scalping, etc...
     * You can remove this function if you don't use it.
     * @param {Trade[]} trades the new trades
     * @returns {Promise<void>}
     */
    protected async tick(trades: Trade.Trade[]): Promise<void> {
        // put your code here
        return super.tick(trades);
    }

    /**
     * Called when a new candle is ready. Meaning it is called once every this.action.candleSize minutes.
     * You can remove this function if you don't use it.
     * @param {Candle} candle the new candle
     * @returns {Promise<void>}
     */
    protected async candleTick(candle: Candle.Candle): Promise<void> {
        // put your code here
        return super.candleTick(candle);
    }

    /**
     * This is called every few seconds (after tick()) with the latest candle.
     * Keep in mind that this candle is incomplete (this.action.candleSize has not fully passed yet).
     * So its values will change until the candle time has passed (except the candle.open value) and you probably don't want
     * to use this candle to compute indicators.
     * Use it for fast trading, stops, scalping, etc...
     * You can remove this function if you don't use it.
     * @param {Candle} candle the latest candle
     * @param {boolean} isNew true if it is a new candle (this.action.candleSize minutes have passed), false if it's the same
     *          candle as on the previous call
     * @returns {Promise<void>}
     */
    protected async currentCandleTick(candle: Candle.Candle, isNew: boolean): Promise<void> {
        // put your code here
        return super.currentCandleTick(candle, isNew);
    }

    /**
     * This is called right after the candleTick() function in this class (from within the parent's candleTick() function).
     * The difference to candleTick() is that it only called after ALL indicators in this strategy are ready (have enough data
     * so that they hold valid values).
     */
    protected checkIndicators(): void {
        let rsi = this.indicators.get("RSI") // get the RSI indicator we added in the constructor
        const value = rsi.getValue();
        const valueFormatted = Math.round(value * 100) / 100.0;

        if (value >= this.action.high) {
            const msg = utils.sprintf("RSI reached high: %s - expecting price reversal and selling", valueFormatted);
            this.log("SELL: " + msg);
            this.emitSell(this.defaultWeight, msg);
        }

        // add new data to our variables
        this.myNumberArray.push(valueFormatted);
        if (this.myNumberArray.length > this.action.interval)
            this.myNumberArray.shift(); // remove the oldest one
    }

    /**
     * This is called every time a trade happens. That includes trades from other strategies running on the same currency pair.
     * You can remove this function if you don't use it.
     */
    protected resetValues(): void {
        // put your code here
        this.myValue = -1;
        super.resetValues();
    }

    // ################################################################
    // Your custom functions start here

    protected demoLogFunctions() {
        // These lines will only be printed if "enableLog" is set to true in the strategy config JSON.
        // You can use them to log any output such as candles while trading.
        let price = 20000;
        this.log(utils.sprintf("I want to sell BTC for %s USD", price));
        this.warn("I can not find any buyers at that price.");

        // These lines will always be printed. You should only use them for major errors such as "invalid config"
        // when the strategy is unable to start.
        logger.info("Strategy %s is running", this.className);
        logger.warn("The current time at the %s market on the exchange is: %s", this.action.pair.toString, this.getMarketTime());
        logger.error("Your candle size is %s min. Are you a high frequency trader?", this.action.candleSize);
    }
}