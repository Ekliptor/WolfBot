import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction} from "./AbstractStrategy";
import {Currency, Trade} from "@ekliptor/bit-models";

interface MassOrderAction extends StrategyAction {
    avgLowSec: number; // 30 sec
    avgHighSec: number; // 600 sec = 10 min
    spikePercent: number; // 150 // how much higher the number of trades in avgLowSec have to be
    volumeDiffPercent: number; // 20 // how much higher/lower the sell volume (in BTC) has to be to emit a buy/sell signal
}

/**
 * count the number of trades in the last 30 sec and compare it to the average of the last 10min
 * if it's 2x/4x (spikePercent) as much as in avgHighSec we assume a bot and jump on that buy/sell wave
 */
export default class MassOrderJumper extends AbstractStrategy {
    protected action: MassOrderAction;
    protected avgLowQueue: Trade.Trade[] = [];
    protected avgHighQueue: Trade.Trade[] = [];
    protected avgLowTrades: number = 0;
    protected avgHighTrades: number = 0;
    protected lowBuyVolume: number = 0;
    protected lowSellVolume: number = 0;

    constructor(options) {
        super(options)
        if (this.action.avgLowSec >= this.action.avgHighSec) {
            logger.error("wrong %s config. avgLowSec has to be lower than avgHighSec", this.className)
            this.action.avgHighSec = this.action.avgLowSec * 2;
        }
        this.defaultWeight = 90;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected tick(trades: Trade.Trade[]) {
        return new Promise<void>((resolve, reject) => {
            trades.forEach((trade) => {
                this.avgLowQueue.push(trade)
                this.avgHighQueue.push(trade)
            })
            this.avgLowQueue = this.removeOldTrades(this.avgLowQueue, this.action.avgLowSec);
            this.avgHighQueue = this.removeOldTrades(this.avgHighQueue, this.action.avgHighSec);
            this.avgLowTrades = this.computeAvgTrades(this.avgLowQueue, this.action.avgLowSec);
            this.avgHighTrades = this.computeAvgTrades(this.avgHighQueue, this.action.avgHighSec);

            if (this.strategyStart.getTime() + this.action.avgHighSec * 1000 <= this.marketTime.getTime()) {
                // we have enough data to give trade advice
                this.lowBuyVolume = this.getTradeVolume(this.avgLowQueue, Trade.TradeType.BUY);
                this.lowSellVolume = this.getTradeVolume(this.avgLowQueue, Trade.TradeType.SELL);
                this.checkSpike()
            }
            resolve()
        })
    }

    protected removeOldTrades(queue: Trade.Trade[], expirationSec) {
        const deleteSec = this.marketTime.getTime() - expirationSec * 1000;
        let i = 0
        for (; i < queue.length; i++)
        {
            if (queue[i].date.getTime() > deleteSec)
                break; // this order is newer than expirationSec
        }
        if (i > 0)
            queue.splice(0, i)
        return queue;
    }

    protected computeAvgTrades(queue: Trade.Trade[], expirationSec) {
        return queue.length / expirationSec; // return trades per second
    }

    protected getTradeVolume(queue: Trade.Trade[], type: Trade.TradeType) {
        let vol = 0;
        for (let i = 0; i < queue.length; i++)
        {
            if (queue[i].type === type)
                vol += queue[i].total;
        }
        return vol;
    }

    protected checkSpike() {
        // values < 100% mean the trade frequency is decreasing (> 100% increasing)
        const lowHighPercent = this.avgLowTrades / this.avgHighTrades * 100;
        if (this.tradeTick >= nconf.get('serverConfig:tradeTickLog')) {
            this.tradeTick -= nconf.get('serverConfig:tradeTickLog');
            this.log("avgLowTrades:", this.avgLowTrades.toFixed(3), "avgHighTrades:", this.avgHighTrades.toFixed(3), "lowHighPercent:", lowHighPercent.toFixed(2))
        }

        /*if (lowHighPercent < this.action.spikePercent) {
            this.log("trading slowed down to", lowHighPercent);
            //this.emitSellClose(Number.MAX_VALUE);
        }
        else */if (lowHighPercent >= 100 + this.action.spikePercent) {
            // values < 100% mean many sells (> 100% buys)
            const buySellVolumePercent = this.lowBuyVolume / this.lowSellVolume * 100;
            let msg = "trading speed up to " + lowHighPercent.toFixed(3) + "% buySellVolumePercent " + buySellVolumePercent.toFixed(3) + "%";
            //if (this.lowBuyVolume > this.lowSellVolume)
            if (buySellVolumePercent >= 100 + this.action.volumeDiffPercent) {
                this.log(msg);
                this.emitBuy(this.defaultWeight, msg);
            }
            else if (buySellVolumePercent <= this.action.volumeDiffPercent) {
                this.log(msg);
                this.emitSell(this.defaultWeight, msg);
            }
        }
    }
}