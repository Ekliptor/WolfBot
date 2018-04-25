import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {TechnicalStrategy, TechnicalStrategyAction} from "./TechnicalStrategy";
import {AbstractIndicator, TrendDirection} from "../Indicators/AbstractIndicator";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import {BollingerBands as BollingerIndicator} from "../Indicators/BollingerBands";

interface AroonTristarAction extends TechnicalStrategyAction {
    breakout: number; // the number of candles the price has to stay at Aroon up/down to assume a breakout
    // (optional, default 30) the number of candles to use for calculation (not really import since we only use the latest one)
    // needed for Aroon to look back
    interval: number;
}

/**
 * Strategy that buys/sells according to Aroon and Tristar indicators.
 */
export default class AroonTristar extends TechnicalStrategy {
    protected static readonly AROON_100 = 96;
    protected static readonly AROON_LOW = 50;

    public action: AroonTristarAction;
    protected breakoutCount = 0;

    constructor(options) {
        super(options)
        this.addIndicator("Aroon", "Aroon", this.action);
        this.addIndicator("TristarPattern", "TristarPattern", this.action);

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
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        let aroon = this.getAroon("Aroon")

        const aroonMsg = utils.sprintf("Aroon up %s, down %s, breakoutCount %s", aroon.getUp(), aroon.getDown(), (this.breakoutCount + 1));
        if (aroon.getUp() >= AroonTristar.AROON_100 && aroon.getDown() < AroonTristar.AROON_LOW) {
            // Aroon high
            this.breakoutCount++;
            this.log("Aroon up reached, UP trend,", aroonMsg)
            if (this.lastTrend === "up" && this.breakoutCount >= this.action.breakout) {
                this.emitBuy(this.defaultWeight, aroonMsg);
            }
            this.setTrend("up");
        }
        else if (aroon.getDown() >= AroonTristar.AROON_100 && aroon.getUp() < AroonTristar.AROON_LOW) {
            // Aroon low
            this.breakoutCount++;
            this.log("Aroon down reached, DOWN trend,", aroonMsg)
            if (this.lastTrend === "down" && this.breakoutCount >= this.action.breakout) {
                this.emitSell(this.defaultWeight, aroonMsg);
            }
            this.setTrend("down");
        }
        else {
            // market is moving fast -> Aroon has up and down very closely together
            // market is going sideways -> no Aroon trend
            this.breakoutCount = 0;
            this.lastTrend = "none";

            //if (aroon.getUp() >= AroonTristar.AROON_100 || aroon.getDown() >= AroonTristar.AROON_100)
                //return this.log("Ignoring Tristar because we are close to Aroon up/down", utils.sprintf("Aroon up %s, down %s", aroon.getUp(), aroon.getDown()));

            let tristar = this.indicators.get("TristarPattern")
            if (tristar.getValue() !== 0) // TODO almost always 0. not a good indicator?
                console.log("TRISTAR IND: ", tristar.getValue())
        }
    }

    protected setTrend(trend: TrendDirection) {
        if (this.lastTrend !== trend)
            this.breakoutCount = 0;
        this.lastTrend = trend;
    }

    protected resetValues(): void {
        this.breakoutCount = 0;
        super.resetValues();
    }
}