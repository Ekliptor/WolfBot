import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, LiquidatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle, Liquidation} from "@ekliptor/bit-models";
import {AbstractMarketData} from "../Exchanges/feeds/AbstractMarketData";
import {OrderbookFullSnapshot} from "./OrderbookHeatmap";

export type LiquidationVolumeType = "buy" | "sell" | "both";

export class CandleLiquidations {
    public start: Date; // candle start date
    public liquidations: Liquidation.Liquidation[] = [];

    constructor(start: Date) {
        this.start = start;
    }
    public add(liquidation: Liquidation.Liquidation) {
        this.liquidations.push(liquidation);
    }
    public static unserialize(candleLiq: any) {
        let candleLiqObj = new CandleLiquidations(new Date(candleLiq.start));
        for (let i = 0; i < candleLiq.liquidations.length; i++)
        {
            let liq = Object.assign(new Liquidation.Liquidation(), candleLiq.liquidations[i]);
            candleLiqObj.liquidations.push(liq);
        }
        return candleLiqObj;
    }
    public static unserializeAll(candleLiqArr: any[]): CandleLiquidations[] {
        let liqs = [];
        for (let i = 0; i < candleLiqArr.length; i++)
            liqs.push(CandleLiquidations.unserialize(candleLiqArr[i]));
        return liqs;
    }
}

export default class Liquidator extends AbstractIndicator {
    protected params: LiquidatorParams;
    protected feed: AbstractMarketData;
    protected liquidations: CandleLiquidations[] = []; // one entry per candle

    constructor(params: LiquidatorParams) {
        super(params)
        this.params = Object.assign(new LiquidatorParams(), this.params);
        if (nconf.get("trader") === "Backtester") // TODO store liquidations in DB and make them available for customers during backtesting
            throw new Error(utils.sprintf("%s indicator is not available during backtesting because it depends on real-time data feeds.", this.className));

        if (!this.params.feed)
            return; // disabled
        this.feed = AbstractMarketData.getInstance(this.params.feed);
        if (this.feed === null)
            return;
        if (this.feed.isSubscribed() === false)
            this.feed.subscribe(this.params.getPairs());
        else {
            let subscribedPairs = this.feed.getCurrencyPairs();
            let currentPairs = this.params.getPairs();
            currentPairs.forEach((pair) => {
                let found = false;
                for (let i = 0; i < subscribedPairs.length; i++)
                {
                    if (subscribedPairs[i].equals(pair) === true) {
                        found = true;
                        break;
                    }
                }
                if (found === false)
                    this.warn(utils.sprintf("Currency pair %s has not been subscribed to in %s. This indicator must use the same pairs for all its strategies.", pair.toString(), this.className));
            });
        }
        this.feed.on("liquidation", (liquidations: Liquidation.Liquidation[]) => {
            for (let i = 0; i < liquidations.length; i++)
                this.addLiquidation(liquidations[i]);
        });
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            if (this.liquidations.length !== 0) {
                let latest = this.liquidations[this.liquidations.length-1];
                if (latest.start.getTime() === candle.start.getTime())
                    return resolve(); // already bucket present
            }
            this.liquidations.push(new CandleLiquidations(candle.start));
            if (this.liquidations.length < this.params.interval)
                return resolve(); // not enough data yet

            while (this.liquidations.length > this.params.interval)
                this.liquidations.shift();
            resolve();
        })
    }

    public removeLatestCandle() {
        // we only insert on new candles
    }

    public isReady() {
        return this.liquidations.length >= this.params.interval;
    }

    /**
     * Get the total liquidation volume of the latest 'interval' candles.
     * @param type
     */
    public getTotalVolume(type: LiquidationVolumeType) {
        let volume = 0.0;
        this.liquidations.forEach((candleLiq) => {
            candleLiq.liquidations.forEach((liq) => {
                volume = this.addCandleLiquidationVolume(volume, type, liq);
            });
        });
        return volume;
    }

    /**
     * Return all liquidations. The liquidation for the latest (current) candle are at the end of the array.
     */
    public getLiquidations() {
        return this.liquidations;
    }

    /**
     * Return all liquidations of the current/latest candle.
     */
    public getCurrentLiquidations(): Liquidation.Liquidation[] {
        if (this.liquidations.length === 0)
            return [];
        let latest = this.liquidations[this.liquidations.length-1];
        return latest.liquidations;
    }

    /**
     * Return the single latest liquidation or null if no liquidation occurred yet.
     * @param type
     */
    public getLatest(type: LiquidationVolumeType): Liquidation.Liquidation {
        if (this.liquidations.length === 0)
            return null; // no candle
        for (let i = this.liquidations.length-1; i >= 0; i--)
        {
            let latest = this.liquidations[i];
            if (latest.liquidations.length === 0)
                continue; // no liquidations in latest/current candle
            for (let u = latest.liquidations.length-1; u >= 0; u--)
            {
                if (type === "both")
                    return latest.liquidations[u];
                else if (type === "buy" && latest.liquidations[u].type === Trade.TradeType.BUY)
                    return latest.liquidations[u];
                else if (type === "sell" && latest.liquidations[u].type === Trade.TradeType.SELL)
                    return latest.liquidations[u];
            }
        }
        return null;
    }

    /**
     * Get the total liquidation volume of the current candle.
     * @param type
     */
    public getCurrentLiquidationVolume(type: LiquidationVolumeType) {
        if (this.liquidations.length === 0)
            return 0.0;
        let latest = this.liquidations[this.liquidations.length-1];
        let volume = 0.0;
        for (let i = 0; i < latest.liquidations.length; i++)
            volume = this.addCandleLiquidationVolume(volume, type, latest.liquidations[i]);
        return volume;
    }

    /**
     * Get the average liquidation volume (SMA) of the latest 'interval' candles.
     * @param type
     */
    public getAveragelVolume(type: LiquidationVolumeType) {
        if (this.liquidations.length === 0)
            return 0.0;
        let volume = this.getTotalVolume(type);
        return volume / this.liquidations.length;
    }

    public getAllValues() {
        return {
            totalVolume: this.getTotalVolume("both"),
            currentVolume: this.getCurrentLiquidationVolume("both"),
            averageVolume: this.getAveragelVolume("both")
        }
    }

    public serialize() {
        let state = super.serialize();
        state.liquidations = this.liquidations;
        return state;
    }

    public unserialize(state: any) {
        super.unserialize(state);
        this.liquidations = CandleLiquidations.unserializeAll(state.liquidations);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected addLiquidation(liq: Liquidation.Liquidation) {
        if (this.liquidations.length === 0)
            return; // wait for 1st candle
        let latest = this.liquidations[this.liquidations.length-1];
        latest.liquidations.push(liq);
    }

    protected addCandleLiquidationVolume(volume: number, type: LiquidationVolumeType, liq: Liquidation.Liquidation) {
        if (type === "both")
            volume += liq.amount;
        else if (type === "buy" && liq.type === Trade.TradeType.BUY)
            volume += liq.amount;
        else if (type === "sell" && liq.type === Trade.TradeType.SELL)
            volume += liq.amount;
        return volume;
    }
}

export {Liquidator}