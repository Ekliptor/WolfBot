
// TODO implement "Pivot Reversal Strategy" from tradingview
// http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:pivot_points
//


import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";


/**
 */
export default class PivotReversal extends AbstractStrategy {
    constructor(options) {
        super(options)
        throw new Error(this.className + " is not yet implemented");
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            resolve()
        })
    }
}

/**
 * //@version=3
 strategy("Pivot Reversal Strategy", overlay=true)

 leftBars = input(4)
 rightBars = input(2)

 swh = pivothigh(leftBars, rightBars)
 swl = pivotlow(leftBars, rightBars)

 swh_cond = not na(swh)

 hprice = 0.0
 hprice := swh_cond ? swh : hprice[1]

 le = false
 le := swh_cond ? true : (le[1] and high > hprice ? false : le[1])

 if (le)
 strategy.entry("PivRevLE", strategy.long, comment="PivRevLE", stop=hprice + syminfo.mintick)

 swl_cond = not na(swl)

 lprice = 0.0
 lprice := swl_cond ? swl : lprice[1]


 se = false
 se := swl_cond ? true : (se[1] and low < lprice ? false : se[1])

 if (se)
 strategy.entry("PivRevSE", strategy.short, comment="PivRevSE", stop=lprice - syminfo.mintick)

 //plot(strategy.equity, title="equity", color=red, linewidth=2, style=areabr)
 */