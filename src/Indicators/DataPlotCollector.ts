import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";

export interface PlotMarkValues {
    [key: string]: number; // multiple indicators (lines) to draw. each key has a single value which will be plotted at the current date
}

export interface PlotMark {
    date: Date;
    //key: string;
    value: number;
    secondaryY: boolean; // plot the data on the secondary Y axis
    dots: boolean; // show dots instead of a line (only applies for secondaryY)
}
export class PlotMarkMap extends Map<string, PlotMark[]> { // (key, data)
    constructor() {
        super()
    }
}

/**
 * A class representing data to be plotted on the x-y price-time diagram.
 * AbstractStrategy and AbstractIndicator instances can collect such data.
 * Only the main strategy will be plotted. The keys for the main strategy + indicators get merged and
 * returned in getPlotData()
 */
export class DataPlotCollector {
    protected className: string;
    protected marketTime: Date = null;
    protected avgMarketPrice: number = -1;
    protected marks = new PlotMarkMap();

    constructor() {
        this.className = this.constructor.name;
    }

    public getMarkKeys() {
        let keys = [];
        for (let mark of this.marks)
            keys.push(mark[0])
        return keys;
    }

    public getMarkData(key: string) {
        return this.marks.get(key)
    }

    public sync(candle: Candle.Candle, avgMarketPrice: number) {
        this.marketTime = candle.start;
        if (this.marketTime && this.marketTime.getTime() > Date.now())
            this.marketTime = new Date(); // shouldn't happen // TODO why?
        this.avgMarketPrice = avgMarketPrice;
    }

    public plotMark(mark: PlotMarkValues, secondaryY = false, dots = false) {
        if (nconf.get('trader') !== "Backtester") // TODO plot on website in live mode
            return;
        for (let key in mark)
        {
            let markData = this.marks.get(key)
            if (!markData)
                markData = [];
            markData.push({
                date: this.marketTime,
                value: mark[key],
                secondaryY: secondaryY,
                dots: dots
            })
            this.marks.set(key, markData)
        }
    }

    public mergeMarkData(plotData: DataPlotCollector) {
        let merged = new DataPlotCollector();
        [this, plotData].forEach((plot) => {
            //let keys = plot.getMarkKeys();
            merged.addMarks(plot.marks)
        })
        return merged;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected addMarks(marks: PlotMarkMap) {
        for (let mark of marks)
            this.marks.set(mark[0], mark[1])
    }
}