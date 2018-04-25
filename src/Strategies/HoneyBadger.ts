import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {TradeInfo} from "../Trade/AbstractTrader";

interface HoneyBadgerAction extends TechnicalStrategyAction {
    // initialize previous state (from a backtest until the point you start the bot)
    hold: number;               // KEY1
    mode: number;               // KEY2
    overbought: number;         // KEY3
    holding_assets: boolean;    // default false
    holding_currency: boolean;  // default true
}

type HoneBadgerMode =
    0 |         // init
    1 | -1 |    // Green Dragon
    3 |         // Red Dragon

    // No Dragon
    2 |         // Capitulation
    4;          // Cat Bounce

/**
 * Hone badger strategy working with SMAs.
 * Ported from HoneyBadger.py (from the now closed tradewave.net)
 */
export default class HoneyBadger extends TechnicalStrategy {
    protected static readonly MA_CANDLE_SIZE_MIN = 720;

    public action: HoneyBadgerAction;

    //protected ratio: number = (43200 / info.interval); // n // only used for logging
    protected overbought: number = 0;
    protected prev_mode: HoneBadgerMode = 0;
    //protected trades: number = 0;
    protected actionNr: number = 0; // = action
    protected signal: number = 0;
    protected hold: number = 0; // cooloff, don't trade time
    protected mode: HoneBadgerMode = 0;
    //protected currency: number = 0;
    // more currency stats ...
    protected holding_assets = false; // our crypto coin we want to trade
    protected holding_currency = true; // base currency, BTC, USD,..

    constructor(options) {
        super(options)
        this.saveState = true;
        const initValues = ["hold", "mode", "overbought", "holding_assets", "holding_currency"];
        initValues.forEach((val) => {
            if (this.action[val] !== undefined)
                this[val] = this.action[val];
        })

        this.addInfo("overbought", "overbought");
        this.addInfo("prev_mode", "prev_mode");
        this.addInfo("actionNr", "actionNr");
        this.addInfo("signal", "signal");
        this.addInfo("hold", "hold");
        this.addInfo("mode", "mode");
        this.addInfo("holding_assets", "holding_assets");
        this.addInfo("holding_currency", "holding_currency");
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);

        // update if we hold assets
        if (action === "buy") {
            this.holding_assets = true;
            this.holding_currency = false;
        }
        else { // sell or close
            this.holding_assets = false;
            this.holding_currency = true;
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        return new Promise<void>((resolve, reject) => {
            this.updateIndicators().then(() => {
                //if (this.allCustomIndicatorsReady()) { // takes about 75 days to initialize with 12h candles for 150 candle MA
                    this.chart();
                    this.think();
                    if (this.candleTicks > 1) // 1 is the first call
                        this.order();

                    // log...
                    if (this.hold < 0)
                        this.hold = 0;
                //}
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected updateIndicators() {
        return new Promise<void>((resolve, reject) => {
            let updates = []
            updates.push(this.computeCustomIndicator("ma2", this.get12hMA(2, 0)))
            updates.push(this.computeCustomIndicator("ma30", this.get12hMA(30, 0)))
            updates.push(this.computeCustomIndicator("ma55", this.get12hMA(55, 0)))
            updates.push(this.computeCustomIndicator("ma60", this.get12hMA(60, 0)))
            updates.push(this.computeCustomIndicator("ma90", this.get12hMA(90, 0)))
            updates.push(this.computeCustomIndicator("ma150", this.get12hMA(150, 0)))
            updates.push(this.computeCustomIndicator("ma2i", this.get12hMA(2, -1)))
            updates.push(this.computeCustomIndicator("ma30i", this.get12hMA(30, -1)))
            updates.push(this.computeCustomIndicator("ma55i", this.get12hMA(55, -1)))
            updates.push(this.computeCustomIndicator("ma60i", this.get12hMA(60, -1)))
            updates.push(this.computeCustomIndicator("ma90i", this.get12hMA(90, -1)))
            updates.push(this.computeCustomIndicator("ma150i", this.get12hMA(150, -1)))
            Promise.all(updates).then(() => {
                this.customIndicators.set("floor", 0.75 * this.customIndicators.get("ma55"))
                this.customIndicators.set("moon", 1.05 * this.customIndicators.get("ma55"))
                this.customIndicators.set("resistance", this.customIndicators.get("ma30") + 2.8 *
                    (this.customIndicators.get("ma30") - this.customIndicators.get("ma60")))
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    protected think() {
        // This is the primary trading logic

        let action = 0, signal = 0;
        this.mode_select();
        let hold = this.hold;
        let mode = this.mode;
        let prev_mode = this.prev_mode;
        let holding_assets = this.holding_assets;
        let holding_currency = this.holding_currency;
        if (hold <= 0) {
            // MODE <2 - GREEN DRAGON
            if (mode === 0) {
                signal = 1;
                hold = 1;
                if (holding_currency) {
                    this.log("CRYPTO LONG")
                    action = 1;
                    hold = 1;
                }
            }
            if (mode === 1) {
                signal = 1;
                hold = 1;
                if (holding_currency) {
                    this.log("GREEN DRAGON")
                    action = 1;
                    hold = 1;
                }
            }
            if (mode === -1) {
                signal = -1;
                hold = 0;
                if (holding_assets) {
                    this.log("OVERBOUGHT")
                    action = -1;
                    hold = 1;
                }
            }

            // MODE 2 - CAPITULATION
            if (mode === 2 && prev_mode !== 2) {
                signal = -1;
                this.log("CAPITULATION")
                action = -1;
                hold = 1;
            }
            if (mode === 2 && mode === 2) {
                if (this.customIndicators.get("ma2") < this.customIndicators.get("ma90")) {
                    signal = 1;
                    //hold = 0;
                    if (holding_currency) {
                        this.log("DESPAIR")
                        action = 1;
                        hold = 1;
                    }
                }
                if (this.customIndicators.get("ma2") > 1.1 * this.customIndicators.get("ma90") &&
                    this.customIndicators.get("ma2") > this.customIndicators.get("ma60")) {
                    signal = -1;
                    //hold = 0;
                    if (holding_assets) {
                        this.log("FINAL RUN OF THE BULLS - B")
                        action = -1;
                        hold = 2;
                    }
                }
            }

            // MODE 3 - RED DRAGON
            if (mode === 3 && prev_mode !== 3) {
                signal = -1;
                hold = 0;
                if (holding_assets) {
                    this.log("RED DRAGON")
                    action = -1;
                    hold = 5;
                }
            }
            if (mode === 3 && prev_mode === 3) {
                let signal_3 = this.mode_3();
                if (signal_3 === 1) {
                    signal = 1;
                    hold = 5;
                    if (holding_currency) {
                        this.log("PURGATORY")
                        action = 1;
                        hold = 5;
                    }
                }
                else if (signal_3 === -1) {
                    signal = -1;
                    hold = 0;
                    if (holding_assets) {
                        this.log("DEEPER")
                        action = -1;
                        hold = 1;
                    }
                }
            }

            // MODE 4 - CAT BOUNCE
            if (mode === 4 && prev_mode !== 4) {
                signal = 1;
                hold = 0;
                if (holding_currency) {
                    this.log("HONEY")
                    action = 1;
                    hold = 2;
                }
            }
            if (mode === 4 && prev_mode === 4) {
                if (this.customIndicators.get("ma2") < 1.05 * this.customIndicators.get("ma30") &&
                    this.customIndicators.get("ma2") > this.customIndicators.get("ma60") &&
                    this.customIndicators.get("ma90") > 1.003 * this.customIndicators.get("ma90i")) {
                    signal = -1;
                    hold = 1;
                    if (holding_assets) {
                        this.log("KARMA")
                        action = -1;
                        hold = 1;
                    }
                }
                if (this.customIndicators.get("ma2") < this.customIndicators.get("ma90") &&
                    this.customIndicators.get("ma90") < this.customIndicators.get("ma60") &&
                    this.customIndicators.get("ma90") < this.customIndicators.get("ma30") &&
                    this.customIndicators.get("ma90") > this.customIndicators.get("ma90i")) {
                    signal = 1;
                    hold = 0;
                    if (holding_currency) {
                        this.log("GOLD")
                        action = 1;
                        hold = 1;
                    }
                }
            }

            this.hold = hold * HoneyBadger.MA_CANDLE_SIZE_MIN; // set to hold it for 12h
        }

        this.hold -= this.action.candleSize;
        this.signal = signal;
        this.actionNr = action;
        this.prev_mode = this.mode;
    }

    protected mode_select() {
        // Here I define "Green Dragon and Red Dragon"
        // Cat Bounce always follows Red Dragon
        // Capitulation always follows Green Dragon

        if (this.hold <= 0) {
            // Green Dragon Market
            if (this.customIndicators.get("ma30") > this.customIndicators.get("ma60") &&
                this.customIndicators.get("ma60") > this.customIndicators.get("ma90") &&
                this.customIndicators.get("ma90") > this.customIndicators.get("ma150") &&
                this.customIndicators.get("ma2") > this.customIndicators.get("ma30") &&
                this.customIndicators.get("ma30") > 1.002 * this.customIndicators.get("ma30i") &&
                this.customIndicators.get("ma60") > 1.002 * this.customIndicators.get("ma60i") &&
                this.customIndicators.get("ma90") > 1.002 * this.customIndicators.get("ma90i")) {
                this.mode = 1;
                if (this.customIndicators.get("ma2") > this.customIndicators.get("resistance"))
                    this.overbought = 4*HoneyBadger.MA_CANDLE_SIZE_MIN; // set to overbought for 4*12 hours
                if (this.overbought > 0) {
                    // https://tradewave.net/help/api
                    // info.interval: The tick interval you specified, in seconds.
                    //this.overbought -= info.interval;
                    this.overbought -= this.action.candleSize;
                    this.mode = -1;
                }
            }
            // Red Dragon Market
            else if (this.customIndicators.get("resistance") < this.customIndicators.get("ma150") &&
                this.customIndicators.get("ma2") < this.customIndicators.get("ma90") &&
                this.customIndicators.get("ma2") < this.customIndicators.get("ma150") &&
                this.customIndicators.get("ma150") < this.customIndicators.get("ma150i") &&
                this.customIndicators.get("resistance") < this.customIndicators.get("ma90")) {
                this.mode = 3;
            }
            // Not Dragon Market
            else {
                if (this.prev_mode === 3 || this.prev_mode === 4)
                    this.mode = 4; // Cat Bounce
                if (this.prev_mode === 1 || this.prev_mode === 2)
                    this.mode = 2; // Capitulation
            }
        }
    }

    protected mode_3() {
        // This definition is used to trade Red Dragon

        let signal = 0;
        if (this.customIndicators.get("ma2") < this.customIndicators.get("floor"))
            signal = 1;
        else if (this.customIndicators.get("ma2") > this.customIndicators.get("moon"))
            signal = -1;
        else if (this.customIndicators.get("ma2") < this.customIndicators.get("ma2i") &&
            this.customIndicators.get("ma2") < this.customIndicators.get("ma30") &&
            this.customIndicators.get("ma2i") > this.customIndicators.get("ma30"))
            signal = -1;
        return signal;
    }

    protected order() {
        if (this.actionNr === 1) {
            if (this.holding_currency) {
                this.emitBuy(this.defaultWeight, "BUY OR CRY")
            }
        }
        if (this.actionNr === -1) {
            if (this.holding_assets) {
                this.emitSell(this.defaultWeight, "FIAT TIME")
            }
        }
    }

    protected chart() {
        // This just plots all the indicators, including "mode" which is on a secondary Y axis

        let mode = this.mode;
        if (mode < 2)
            mode = 1;

        this.plotData.plotMark({
            "ma2": this.customIndicators.get("ma2"),
            "ma30": this.customIndicators.get("ma2"),
            "floor": this.customIndicators.get("floor"),
            "moon": this.customIndicators.get("moon"),
            "ma60": this.customIndicators.get("ma60"),
            "ma90": this.customIndicators.get("ma90"),
            "ma150": this.customIndicators.get("ma150"),
            "resistance": this.customIndicators.get("resistance")
        });

        this.plotData.plotMark({"mode": mode}, true)
        // 1 = green dragon
        // 2 = capitulation
        // 3 = red dragon
        // 4 = cat bounce

        let buy = 0, sell = 0;
        if (this.signal === 1)
            buy = 0.5;
        if (this.signal === -1)
            sell = -0.5;
        this.plotData.plotMark({
            "buy_signal": buy,
            "sell_signal": sell
        }, true)
        if (this.candleTicks === 1)
            this.plotData.plotMark({"offset": -15}, true)
    }

    protected get12hMA(period: number, depth: number) {
        return this.getXMinuteMA(HoneyBadger.MA_CANDLE_SIZE_MIN, period, depth); // 12h
    }
}