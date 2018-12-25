import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, VolumeProfileParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import * as _ from "lodash";


export class VolumeProfileBar {
    public id: number; // unique number from 1 to volumeRows (including)
    public priceZoneLow: number; // the lower price end for the range of this bar
    public priceZoneHigh: number;
    public volume: number = 0.0;
    public upVolume: number = 0.0;
    public downVolume: number = 0.0;
    constructor(id, priceZoneLow: number, priceZoneHigh: number) {
        this.id = id;
        this.priceZoneLow = priceZoneLow;
        this.priceZoneHigh = priceZoneHigh;
    }
    public static unserializeBars(bars: any[]) {
        let barObjects: VolumeProfileBar[] = [];
        for (let i = 0; i < bars.length; i++)
        {
            let curBar = new VolumeProfileBar(bars[i].id, bars[i].priceZoneLow, bars[i].priceZoneHigh);
            curBar = Object.assign(curBar, bars[i]);
            barObjects.push(curBar);
        }
        return barObjects;
    }
    public isPriceWithinRange(price: number) {
        return this.priceZoneLow <= price && this.priceZoneHigh > price;
    }
    public isBelowPrice(price: number) {
        return this.priceZoneHigh < price; // or use low?
    }
    public isAbovePrice(price: number) {
        return this.priceZoneLow > price; // or use high?
    }
    public getMeanPrice() {
        return (this.priceZoneHigh + this.priceZoneLow) / 2.0;
    }

    /**
     * Get the percentage of this volume bar relative to totalVolume.
     * @param totalVolume
     */
    public getVolumePercentage(totalVolume: number) {
        if (totalVolume < 0.0)
            return 0.0;
        return this.volume / totalVolume * 100;
    }

    public toString() {
        return utils.sprintf("ID %s, low %s, high %s, vol %s (up %s, down %s)", this.id,
            this.priceZoneLow.toFixed(8), this.priceZoneHigh.toFixed(8), this.volume.toFixed(8),
            this.upVolume.toFixed(8), this.downVolume.toFixed(8));
    }
}
export class ValueArea {
    public pointOfControlID: number = 0; // the bar ID of the price level with the highest traded volume
    public profileHigh: number = 0.0; // highest price during 'interval' time period (total volume profile time range)
    public profileLow: number = Number.MAX_VALUE;
    public valueAreaVolume: number = 0.0;
    public valueArea: VolumeProfileBar[] = []; // the range of price levels with 70% of all volume was traded. Sorted from the bar with the highest volume descending.
    public valueAreaHigh: number = 0.0; // the highest price within the valueArea
    public valueAreaLow: number = Number.MAX_VALUE;
    constructor() {
    }
    public isPriceWithinArea(price: number) {
        return this.valueAreaLow <= price && this.valueAreaHigh > price;
    }
    public updateAreaHighLow(bar: VolumeProfileBar) {
        if (this.valueAreaHigh < bar.priceZoneHigh)
            this.valueAreaHigh = bar.priceZoneHigh;
        if (this.valueAreaLow > bar.priceZoneLow)
            this.valueAreaLow = bar.priceZoneLow;
        this.valueAreaVolume += bar.volume;
        this.valueArea.push(bar);
    }
    public updateAreaHighLowMultiple(bars: VolumeProfileBar[], startIndex: number, step: number) {
        for (let i = startIndex; i < startIndex+step && i < bars.length; i++)
            this.updateAreaHighLow(bars[i]);
    }
    public computeProfileHighLow(bars: VolumeProfileBar[]) {
        for (let i = 0; i < bars.length; i++)
        {
            if (this.profileHigh < bars[i].priceZoneHigh)
                this.profileHigh = bars[i].priceZoneHigh;
            if (this.profileLow > bars[i].priceZoneLow)
                this.profileLow = bars[i].priceZoneLow;
        }
    }
}

/**
 * Indicator computing the volume profile of the 'interval' time range.
 * // TODO add ACME features: http://www.ranchodinero.com/a7/acme-volume-profile-pack/
 */
export default class VolumeProfile extends AbstractIndicator {
    protected params: VolumeProfileParams;
    protected candleHistory: Candle.Candle[] = [];
    protected volumeProfileBars: VolumeProfileBar[] = []; // volume profile bars sorted from highest to lowest volume
    protected volumeProfileBarsByPrice: VolumeProfileBar[] = []; // volume profile bars sorted from lowest to highest price
    protected valueArea: ValueArea = null;

    constructor(params: VolumeProfileParams) {
        super(params)
        this.params = Object.assign(new VolumeProfileParams(), this.params);
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.addCandleHistory(candle);
            if (this.candleHistory.length < this.params.interval)
                return resolve();
            this.computeVolumeProfile();
            this.computeValueArea();
            resolve()
        })
    }

    public addTrades(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            resolve()
        })
    }

    public removeLatestCandle() {
        this.candleHistory = this.removeLatestDataAny<Candle.Candle>(this.candleHistory);
    }

    /**
     * Returns the volume profile bars sorted from highest to lowest volume.
     */
    public getVolumeProfile() {
        return this.volumeProfileBars;
    }

    /**
     * Returns the volume profile bars sorted from lowest to highest price.
     */
    public getVolumeProfileByPrice() {
        return this.volumeProfileBarsByPrice;
    }

    /**
     * Returns the value area for the current volume profile.
     * https://www.tradingview.com/wiki/Volume_Profile#TYPICAL_LEVELS_OF_SIGNIFICANCE
     */
    public getValueArea() {
        return this.valueArea;
    }

    public getTotalVolume() {
        let total = 0.0;
        for (let i = 0; i < this.volumeProfileBars.length; i++)
            total += this.volumeProfileBars[i].volume;
        return total;
    }

    public getTotalUpVolume() {
        let total = 0.0;
        for (let i = 0; i < this.volumeProfileBars.length; i++)
            total += this.volumeProfileBars[i].upVolume;
        return total;
    }

    public getTotalDownVolume() {
        let total = 0.0;
        for (let i = 0; i < this.volumeProfileBars.length; i++)
            total += this.volumeProfileBars[i].downVolume;
        return total;
    }

    public getAllValues() {
        const volumeProfile = this.getVolumeProfile();
        const valueArea = this.getValueArea();
        let values: any = {
            profileHigh: valueArea.profileHigh,
            profileLow: valueArea.profileLow,
            valueAreaVolume: valueArea.valueAreaVolume,
            valueAreaBarCount: valueArea.valueArea.length,
            valueAreaHigh: valueArea.valueAreaHigh,
            valueAreaLow: valueArea.valueAreaLow,
            totalVolume: this.getTotalVolume(),
            totalUpVolume: this.getTotalUpVolume(),
            totalDownVolume: this.getTotalDownVolume()
        }
        values = Object.assign(values, utils.objects.getPlainArrayData(volumeProfile, "profile_"));
        return values;
    }

    public isReady() {
        return this.candleHistory.length >= this.params.interval && this.valueArea !== null;
    }

    public serialize() {
        let state = super.serialize();
        state.candleHistory = this.candleHistory;
        state.volumeProfileBars = this.volumeProfileBars;
        state.volumeProfileBarsByPrice = this.volumeProfileBarsByPrice;
        state.valueArea = this.valueArea;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.candleHistory = Candle.Candle.copy(state.candleHistory);
        this.volumeProfileBars = VolumeProfileBar.unserializeBars(state.volumeProfileBars);
        this.volumeProfileBarsByPrice = VolumeProfileBar.unserializeBars(state.volumeProfileBarsByPrice);
        this.valueArea = Object.assign(new ValueArea(), state.valueArea);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected computeVolumeProfile() {
        // find high-low range of prices
        const closingPrices = this.candleHistory.map(c => c.close);
        const minPrice = _.min(closingPrices);
        const maxPrice = _.max(closingPrices);
        const priceRange = maxPrice - minPrice;
        const priceZone = priceRange / this.params.volumeRows; // create equal zones
        let currentZoneLow = minPrice;
        let volumeProfileBars = [];
        for (let i = 0; i < this.params.volumeRows; i++) // sum up volume in each zone
        {
            let high = currentZoneLow + priceZone;
            volumeProfileBars.push(this.getTradeVolumeSumInZone(i + 1, currentZoneLow, high));
            currentZoneLow = high;
        }
        this.volumeProfileBarsByPrice = volumeProfileBars;
        this.volumeProfileBars = _.orderBy(volumeProfileBars, (bar) => {
            return bar.volume; // or just specify it as a string property too?
        }, ["desc"]);
    }

    protected getTradeVolumeSumInZone(id: number, priceZoneLow: number, priceZoneHigh: number) {
        let bar = new VolumeProfileBar(id, priceZoneLow, priceZoneHigh);
        for (let i = 0; i < this.candleHistory.length; i++)
        {
            let candle = this.candleHistory[i];
            if (this.params.useSingleTrades === true && candle.tradeData !== undefined) { // undefined during backtests for faster processing
                candle.tradeData.forEach((trade) => { // TODO we could forward 1min candles to indicator and use them to be a bit more efficient
                    if (trade.rate < priceZoneLow || trade.rate >= priceZoneHigh)
                        return;
                    bar.volume += trade.amount;
                    bar.upVolume += trade.amount;
                    bar.downVolume += trade.amount;
                });
                continue
            }

            // alternatively use candle close prices
            if (candle.close < priceZoneLow || candle.close >= priceZoneHigh) // == will be in the next upper bar
                continue;
            // TV also does it on candles only?
            bar.volume += candle.volume;
            bar.upVolume += candle.upVolume;
            bar.downVolume += candle.downVolume;
        }
        return bar;
    }

    protected computeValueArea() {
        // the value area is the price area where 70% of the volume in the profile is traded in
        const totalVolumeStop = this.getTotalVolume() / 100.0 * this.params.valueAreaPercent;
        let currentValueAreaVolume = 0.0;
        const step = 2;
        let valueArea = new ValueArea();
        for (let i = 0; i < this.volumeProfileBars.length; ) // sorted by volume
        {
            const bar = this.volumeProfileBars[i];
            if (i === 0) { // we are at the POC
                i++;
                currentValueAreaVolume += bar.volume;
                valueArea.pointOfControlID = bar.id;
                valueArea.updateAreaHighLow(bar);
                if (currentValueAreaVolume >= totalVolumeStop)
                    break; // we have found our VAL
                continue;
            }
            let aboveVolume = this.getNeighborVolume(i, true, step);
            i += step; // only increment i once by 2 because only the above or below volume gets added
            let belowVolume = this.getNeighborVolume(i+step, false, step);
            if (aboveVolume > belowVolume)
                currentValueAreaVolume += aboveVolume;
            else
                currentValueAreaVolume += belowVolume;
            valueArea.updateAreaHighLowMultiple(this.volumeProfileBars, i - step, step);
            if (currentValueAreaVolume >= totalVolumeStop)
                break; // we have found our VAL
        }
        valueArea.computeProfileHighLow(this.volumeProfileBars);
        this.valueArea = valueArea;
    }

    protected getNeighborVolume(barStartID: number, above: boolean, step = 2) {
        let volume = 0.0;
        for (let i = 0; i < this.volumeProfileBarsByPrice.length; i++) // sorted by price
        {
            const bar = this.volumeProfileBarsByPrice[i];
            if (bar.id !== barStartID)
                continue;
            if (above === true) {
                for (let u = i; u < i + step && u < this.volumeProfileBarsByPrice.length; u++)
                    volume += bar.volume;
            }
            else {
                for (let u = i; u > i - step && u >= 0; u--)
                    volume += bar.volume;
            }
            break;
        }
        //if (volume === 0.0)
            //logger.warn("No volume found on neighbor bars starting at ID %s", barStartID);
        return volume;
    }

    /**
     * Returns the next 2 volume bars with the next lowest volume from startIndex.
     * @param startIndex
     */
    /*
    protected getNextPartialVolume(startIndex: number) {
        let volume = 0.0;
        for (let i = startIndex; i < startIndex+2 && i < this.volumeProfileBars.length; i++)
        {
            volume += this.volumeProfileBars[i].volume;
        }
        return volume;
    }
    */

    protected addCandleHistory(candle: Candle.Candle) {
        this.candleHistory.push(candle);
        if (this.candleHistory.length > this.params.interval)
            this.candleHistory.shift();
    }

}

export {VolumeProfile}