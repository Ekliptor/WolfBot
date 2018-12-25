import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as _ from "lodash";
import {Currency, Trade, Order, Candle} from "@ekliptor/bit-models";
import {CandleStream, TradeBase} from "./CandleStream";
import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs";

/**
 * Class to create 1 minute candles from trades of TradeStream
 * http://stockcharts.com/school/doku.php?id=chart_school:chart_analysis:introduction_to_candlesticks
 */
export class CandleMaker<T extends TradeBase> extends CandleStream<T> {
    public static readonly TEMP_DATA_DIR = "candles";
    // TODO cleanup candle files older than x days on startup

    // we collect all trades for every min in a bucket before creating the candle
    protected buckets = new Map<string, T[]>(); // (minute string, trades)
    protected threshold: Date = new Date(0); // start date for candles. we filter trades older than this date
    //protected lastTrade: Trade.Trade = null;
    protected lastTrade: T = null;
    protected candleCache: Candle.Candle[] = []; // cache for faster repeated backtests (on the same time period)

    constructor(currencyPair: Currency.CurrencyPair, exchange: Currency.Exchange = Currency.Exchange.ALL) {
        super(currencyPair, exchange)
    }

    public addTrades(trades: T[]) {
        //if (_.isEmpty(trades)) // shouldn't happen
            //return;

        trades = this.filter(trades);
        this.fillBuckets(trades);
        let candles = this.calculateCandles();

        candles = this.addEmptyCandles(candles);

        // the last candle is not complete, don't emit it & keep it in here (in buckets)
        let last = candles.pop();
        if (last) { // the latest trades are kept in this.buckets
            this.threshold = last.start;
            this.emitCurrentCandle(last);
        }

        if (nconf.get('trader') !== "Backtester") { // don't spam our backtest log
            const exchange = Currency.Exchange[this.exchange];
            candles.forEach((candle) => {
                logger.verbose("1min %s candle %s: high %s, low %s, close %s, volume %s, trades %s", exchange, candle.currencyPair.toString(),
                    candle.high.toFixed(8), candle.low.toFixed(8), candle.close.toFixed(8), candle.volume.toFixed(8), candle.trades);
            })
        }
        this.emitCandles(candles);
    }

    /**
     * Function to pass-through cached candles for faster backtesting.
     * @param candles
     */
    public addCandles(candles: Candle.Candle[]) {
        this.emitCandles(candles);
    }

    public store() {
        return new Promise<void>((resolve, reject) => {
            const filePath = path.join(utils.appDir, nconf.get("tempDir"), CandleMaker.TEMP_DATA_DIR, this.getOwnCachedCandleKey() + ".json")
            if (fs.existsSync(filePath))
                return resolve();
            let json = {
                candles1min: Candle.Candle.copy(this.candleCache)
            }
            fs.writeFile(filePath, utils.EJSON.stringify(json), {encoding: "utf8"}, (err) => {
                if (err)
                    return reject({txt: "Error storing candle data", err: err})
                resolve()
            })
        })
    }

    public static getCachedCandles(currencyPair: Currency.CurrencyPair, exchange: Currency.Exchange): Candle.Candle[] {
        if (!nconf.get("serverConfig:backtest:cacheCandles") || nconf.get('trader') !== "Backtester")
            return null;
        const key = CandleMaker.getCachedCandleKey(currencyPair, exchange)
        const filePath = path.join(utils.appDir, nconf.get("tempDir"), CandleMaker.TEMP_DATA_DIR, key + ".json")
        if (!fs.existsSync(filePath))
            return null;
        let data = fs.readFileSync(filePath, {encoding: "utf8"})
        let json = utils.parseEJson(data);
        if (!json)
            return null;
        return Candle.Candle.copy(json.candles1min) // create real Candle instances from type any
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected emitCandles(candles: Candle.Candle[]) {
        if (candles.length !== 0 && nconf.get("serverConfig:backtest:cacheCandles") && nconf.get('trader') === "Backtester")
            this.candleCache = this.candleCache.concat(candles);
        super.emitCandles(candles)
    }

    protected emitCurrentCandle(candle: Candle.Candle) {
        this.emit("currentCandle1min", candle);
    }

    protected filter(trades: T[]) {
        // make sure we only include trades more recent
        // than the previous emitted candle
        // TODO remove since our market stream already orders trades strictly ascending?
        return _.filter(trades, (trade) => {
            return trade.date > this.threshold;
        });
    }

    protected fillBuckets(trades: T[]) {
        // put each trade in a per minute bucket
        // our trades are in ascending order from MarketStream // TODO verify again to be safe?
        _.each(trades, (trade) => {
            const minute = this.getMinuteStr(trade);
            if (!this.buckets.has(minute))
                this.buckets.set(minute, []);
            this.buckets.get(minute).push(trade);
        });

        this.lastTrade = _.last(trades);
    }

    protected calculateCandles() {
        // convert each bucket into a candle
        //const minutes = this.buckets.size;

        let lastMinute = "";
        if (this.lastTrade)
            lastMinute = this.getMinuteStr(this.lastTrade);

        let candles: Candle.Candle[] = [];
        for (let bucket of this.buckets)
        {
            let candle = this.calculateCandle(bucket[1]);
            // clean all buckets, except the last one:
            // this candle is not complete
            if(bucket[0] !== lastMinute)
                this.buckets.delete(bucket[0]);
            candles.push(candle);
        }

        return candles;
    }

    protected calculateCandle(trades: T[]) {
        const first = _.first<T>(trades);
        const last = _.last<T>(trades);
        const isTradesFeed = first instanceof Trade.Trade;
        //const f = parseFloat;

        const candle = new Candle.Candle(this.currencyPair);
        candle.exchange = this.exchange;
        candle.start = this.resetToMinuteStart(first.date);
        candle.open = first.rate;
        candle.high = first.rate;
        candle.low = first.rate;
        candle.close = last.rate;
        //candle.trades = _.size(trades);
        candle.trades = trades.length;

        _.each<T>(trades, (trade: T) => {
            candle.high = _.max([candle.high, trade.rate]);
            candle.low = _.min([candle.low, trade.rate]);
            candle.volume += trade.amount;
            if (trade instanceof Trade.Trade) { // only these trades are from live feed or history. we don't have separate up/down volume otherwise
                //const unknownTrade = trade as unknown; // only way to cast to Trade is through unknown
                if (trade.type == Trade.TradeType.BUY)
                    candle.upVolume += trade.amount;
                else // SELL
                    candle.downVolume += trade.amount;
            }
            candle.vwp += trade.rate * trade.amount;
        });

        candle.vwp /= candle.volume;
        if (isTradesFeed) { // faster check, skip loop otherwise
            let realTrades: Trade.Trade[] = [];
            trades.forEach((tr) => {
                if (tr instanceof Trade.Trade)
                    realTrades.push(tr as Trade.Trade);
            })
            //candle.tradeData = trades as Trade.Trade;
            //if (realTrades.length !== 0) // set it to empty array
                candle.tradeData = realTrades;
            const totalUpDownVolume = candle.upVolume + candle.downVolume;
            const volumeDiff = Math.abs(candle.volume - totalUpDownVolume);
            if (volumeDiff > 1.0) // there is fractional diff // TODO remove this check later
                logger.error("Volume up/down mismatch on candle. actual %s, computed %s, diff %s", candle.volume.toFixed(8), totalUpDownVolume.toFixed(8), volumeDiff.toFixed(8));
        }
        CandleStream.computeCandleTrend(candle);
        candle.init();
        return candle;
    }

    protected addEmptyCandles(candles: Candle.Candle[]) {
        // we need a candle every minute. if nothing happened during a particilar minute add empty candles with:
        // - open, high, close, low, vwp are the same as the close of the previous candle.
        // - trades, volume are 0
        const amount = _.size(candles);
        if (!amount)
            return candles;

        let start = new Date(_.first<Candle.Candle>(candles).start);
        const end = _.last<Candle.Candle>(candles).start;
        let i, j = -1;

        let minutes = _.map(candles, (candle) => {
            return candle.start.getTime();
        });

        while (start.getTime() < end.getTime())
        {
            start = utils.date.dateAdd(start, 'minute', 1);
            i = start.getTime(); // +start would convert string to float
            j++;

            if (_.includes(minutes, i)) // includes
                continue; // we have a candle for this minute

            const lastPrice = candles[j].close;
            const emptyCandle = new Candle.Candle(this.currencyPair);
            emptyCandle.exchange = this.exchange;
            emptyCandle.start = new Date(start);
            emptyCandle.open = lastPrice;
            emptyCandle.high = lastPrice;
            emptyCandle.low = lastPrice;
            emptyCandle.close = lastPrice;
            emptyCandle.vwp = lastPrice;
            emptyCandle.tradeData = [];
            emptyCandle.init();
            candles.splice(j + 1, 0, emptyCandle); // insert a new candle
        }
        return candles;
    }

    protected getMinuteStr(trade: T) {
        const when = trade.date;
        let date = when.getUTCFullYear() + '-' + (when.getUTCMonth()+1) + '-' + when.getUTCDate() + ' ' + when.getUTCHours() + ':' + when.getUTCMinutes()
        return date
    }

    protected resetToMinuteStart(date: Date) {
        let res = new Date(date);
        //res.setMilliseconds(0);
        //res.setSeconds(0);
        res.setUTCMilliseconds(0);
        res.setUTCSeconds(0);
        return res;
    }

    protected getOwnCachedCandleKey() {
        return CandleMaker.getCachedCandleKey(this.currencyPair, this.exchange)
    }

    protected static getCachedCandleKey(currencyPair: Currency.CurrencyPair, exchange: Currency.Exchange) {
        const keyInput = currencyPair.toString() + exchange + JSON.stringify(nconf.get("serverConfig"))
        return crypto.createHash('sha512').update(keyInput, 'utf8').digest('hex').substr(0, 16);
    }
}