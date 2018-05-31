import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import {BollingerBands as BollingerIndicator} from "../Indicators/BollingerBands";
import {TradeInfo} from "../Trade/AbstractTrader";

interface DayTraderAction extends TechnicalStrategyAction {
    // (optional, default 30) the number of candles to use for calculation (not really import since we only use the latest one)
    // needed for Aroon to look back
    interval: number;
    minVolatility: number; // optional, default 0.05 // Don't open positions below this value (value not relative to prices).
    makerOnly: boolean; // optional, default true Place only maker orders (never pay the taker fee).
    aroonMax: number; // optional, default 96 // The min value Aroon Up/Down must reach to be considered an up/down breakout in price.
    aroonLow: number; // optional, default 50 // The max value the other Aroon value can have for the up/down trend to be confirmed (prevent trading in sideways markets).

    // EMA cross params
    CrossMAType: "EMA" | "DEMA" | "SMA"; // optional, default SMA The indicator to use to look for line cross signals to identify an up/down trend.
    short: number; // The number of candles for the short moving average.
    long: number; // The number of candles for the long moving average.
}

/**
 * A strategy that checks for crosses of the 7-day and 2-day EMA (values can be customized).
 * Additionally it uses Aroon indicator to confirm trends (down trends are only assumed if Aroon matches the EMA trend).
 * It's an unaggressive daytrader, meaning it will only issue maker fee orders.
 */
export default class DayTrader extends TechnicalStrategy {
    //protected static readonly AROON_100 = 96;
    //protected static readonly AROON_LOW = 50;

    public action: DayTraderAction;
    protected breakoutCount = 0;
    protected lastEmaTrend: TrendDirection = "none";

    constructor(options) {
        super(options)
        if (!this.action.minVolatility)
            this.action.minVolatility = 0.05;
        if (typeof this.action.makerOnly !== "boolean")
            this.action.makerOnly = true;
        if (!this.action.aroonMax)
            this.action.aroonMax = 96;
        if (!this.action.aroonLow)
            this.action.aroonLow = 50;
        if (!this.action.CrossMAType)
            this.action.CrossMAType = "SMA";

        this.addIndicator("Aroon", "Aroon", this.action);
        this.addIndicator("EMA", this.action.CrossMAType, this.action); // can be type EMA, DEMA or SMA
        this.addIndicator("BollingerBands", "BollingerBands", this.action); // used to measure volatility in bandwith

        this.addInfo("breakoutCount", "breakoutCount");
        this.addInfoFunction("interval", () => {
            return this.action.interval;
        });
        let aroon = this.getAroon("Aroon")
        this.addInfoFunction("AroonUp", () => {
            return aroon.getUp();
        });
        this.addInfoFunction("AroonDown", () => {
            return aroon.getDown();
        });
        this.addInfoFunction("EMA line diff %", () => {
            return this.indicators.get("EMA").getLineDiffPercent();
        });
        let bollinger = this.getBollinger("BollingerBands")
        this.addInfoFunction("Bandwidth", () => {
            return bollinger.getBandwidth();
        });
    }

    public onTrade(action: TradeAction, order: Order.Order, trades: Trade.Trade[], info: TradeInfo) {
        super.onTrade(action, order, trades, info);
    }

    public forceMakeOnly() {
        return this.action.makerOnly;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        this.plotChart();
        this.updateAroon();

        // market is moving fast -> Aroon has up and down very closely together
        // market is going sideways -> no Aroon trend
        this.breakoutCount = 0;
        this.lastTrend = "none";

        //if (aroon.getUp() >= AroonTristar.AROON_100 || aroon.getDown() >= AroonTristar.AROON_100)
        //return this.log("Ignoring Tristar because we are close to Aroon up/down", utils.sprintf("Aroon up %s, down %s", aroon.getUp(), aroon.getDown()));

        let ema = this.indicators.get("EMA")
        const diff = ema.getLineDiffPercent();
        let aroon = this.getAroon("Aroon")
        let bollinger = this.getBollinger("BollingerBands")
        if (bollinger.getBandwidth() < this.action.minVolatility)
            return;

        // TODO buy more on high volatility?

        if (diff > this.action.thresholds.up ) {
            this.log("UP trend detected, line diff", diff)
            // wait until the candle actually goes up. otherwise we might buy into a turn
            if (/*this.isAroonHigh()*/ this.candleTrend === "up" && this.avgMarketPrice > this.candle.close) {
                // TODO option to schedule a trade and execute it afterwards in trade tick() if trades really go into that direction, especially for price check
                if (this.lastEmaTrend !== "up") {
                    if (this.strategyPosition === "none")
                        this.strategyPosition = "long";
                    this.emitBuy(this.defaultWeight, "EMA line diff %: " + diff);
                }
                this.lastEmaTrend = "up";
            }
            //else
                //logger.info("NOT BUYING %s %s", this.candleTrend, (this.avgMarketPrice > this.candle.close ? "true" : "false"))
        }
        else if (diff < this.action.thresholds.down) {
            this.log("DOWN trend detected, line diff", diff)
            if (this.isAroonLow() || this.strategyPosition === "long") {
                if (this.lastEmaTrend !== "down") {
                    if (this.strategyPosition === "none")
                        this.strategyPosition = "short";
                    this.emitSell(this.defaultWeight, "EMA line diff %: " + diff);
                }
                this.lastEmaTrend = "down";
            }
        }
        else {
            //this.log("no trend detected, line diff, Aroon: up %s, down %s", diff, aroon.getUp(), aroon.getDown())
            if (this.strategyPosition === "none") {
                // use Aroon as fallback for trends that go on slowly (if we don't have an open position)
                // if we have an open position only EMA (or StopLossTurn) can change it
                if (this.isAroonHigh()) {
                    this.emitBuy(this.defaultWeight, "Aroon HIGH");
                    this.strategyPosition = "long";
                }
                else if (this.isAroonLow()) {
                    this.emitSell(this.defaultWeight, "Aroon LOW");
                    this.strategyPosition = "short";
                }
            }
        }
    }

    protected updateAroon() {
        let aroon = this.getAroon("Aroon")

        const aroonMsg = utils.sprintf("Aroon up %s, down %s, breakoutCount %s", aroon.getUp(), aroon.getDown(), (this.breakoutCount + 1));
        if (aroon.getUp() >= this.action.aroonMax && aroon.getDown() < this.action.aroonLow) {
            // Aroon high
            this.log("Aroon up reached, UP trend,", aroonMsg)
            this.setTrend("up");
            this.breakoutCount++; // set it to 1 if this is a new trend, so that the check in checkIndicators() works
        }
        else if (aroon.getDown() >= this.action.aroonMax && aroon.getUp() < this.action.aroonLow) {
            // Aroon low
            this.log("Aroon down reached, DOWN trend,", aroonMsg)
            this.setTrend("down");
            this.breakoutCount++;
        }
        else {
            // market is moving fast -> Aroon has up and down very closely together
            // market is going sideways -> no Aroon trend
            this.breakoutCount = 0;
            this.lastTrend = "none";
        }
    }

    protected isAroonHigh(count = 1) {
        return this.lastTrend === "up" && this.breakoutCount >= count;
    }

    protected isAroonLow(count = 1) {
        return this.lastTrend === "down" && this.breakoutCount >= count;
    }

    protected plotChart() {
        let aroon = this.getAroon("Aroon")
        let bollinger = this.getBollinger("BollingerBands")
        this.plotData.plotMark({
            //"up": aroon.getUp(),
            //"down": aroon.getDown(),
            "bandwidth": bollinger.getBandwidth()
        }, true)

        let ema = this.indicators.get("EMA")
        this.plotData.plotMark({
            "shortEMA": ema.getShortLineValue(),
            "longEMA": ema.getLongLineValue()
        })
        /*
        this.plotData.plotMark({
            "diffEMAPercent": ema.getLineDiffPercent()
        }, true)
        */
    }

    protected setTrend(trend: TrendDirection) {
        if (this.lastTrend !== trend)
            this.breakoutCount = 0;
        this.lastTrend = trend;
    }

    protected resetValues(): void {
        //this.breakoutCount = 0;
        // don't reset trends
        super.resetValues();
    }
}