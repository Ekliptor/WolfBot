import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as argvFunction from "minimist";
const argv = argvFunction(process.argv.slice(2));
import {controller as Controller} from '../src/Controller';
import {AbstractExchange} from "../src/Exchanges/AbstractExchange";
import {Candle, Currency, Trade} from "@ekliptor/bit-models";
import * as db from "../src/database";
import {CandleBatcher} from "../src/Trade/Candles/CandleBatcher";
import {MultipleCurrencyImportExchange, currencyImportMap} from "../configLocal";


let scheduleExit = (delayMs = 3500, code = 0) => { // higher delay because of insert
    setTimeout(() => {
        process.exit(code);
    }, delayMs);
}

let consolidateTrades = async (daysBack: number, startDays: number, candleSize: number) => {
    // our database is taking too much storage space when we store all trades
    // additionally it slows down backtesting
    // so we group old trades into "1min candles"
    // yet for small markets this might increase storage size because our candle batcher always creates 1 candle per interval (1min)
    if (startDays <= daysBack) { // higher = more back in time
        logger.error("Invalid arguments: startDays must be strictly greater than daysBack");
        return;
    }

    for (let ex of currencyImportMap) {
        const exchangeName: string = ex[0];
        const pairs: Currency.CurrencyPair[] = ex[1];
        for (let i = 0; i < pairs.length; i++)
        {
            logger.info("Start consolidating %s %s trades with candleSize %s from %s days back", exchangeName, pairs[i].toString(), candleSize, daysBack);
            await new Promise<void>((resolve, reject) => {
                consolidateExchangeTrades(daysBack, startDays, candleSize, exchangeName, pairs[i], resolve);
            });
            logger.info("Consolidated %s trades of %s", pairs[i].toString(), exchangeName);
        }
    }
    scheduleExit(); // shouldn't be needed here
}

let consolidateExchangeTrades = async (daysBack: number, startDays: number, candleSize: number, exchangeName: string, currencyPair: Currency.CurrencyPair, next: () => void) => {
    const BATCH_OP_SIZE = 5000;
    const exchange = Currency.ExchangeName.get(exchangeName);
    const batcher = new CandleBatcher<Trade.Trade>(candleSize, currencyPair, exchange);
    const end = utils.date.dateAdd(new Date(), "day", -1*daysBack);
    end.setUTCSeconds(0); // don't break between minutes
    end.setUTCMilliseconds(0);
    const sartBatchDate = utils.date.dateAdd(new Date(), "day", -1*startDays);
    sartBatchDate.setUTCSeconds(0); // don't break between minutes
    sartBatchDate.setUTCMilliseconds(0);
    let lastRate = 0.0;
    let docCount = 0, inserts = 0;

    batcher.on("candles", (candles: Candle.Candle[]) => {
        let insertTrades = [];
        // Trade.fromCandle() also exists, but doesn't allow incrementing ID
        candles.forEach((candle) => {
            let tradeObj = new Trade.Trade();
            tradeObj.tradeID = 0; // came from multiple
            tradeObj.date = candle.start;
            tradeObj.amount = candle.volume;
            tradeObj.rate = candle.vwp;
            tradeObj.type = lastRate < tradeObj.rate ? Trade.TradeType.BUY : Trade.TradeType.SELL;
            tradeObj.tradeID = inserts; // to prevent too many duplicate errors
            tradeObj = Trade.Trade.verifyNewTrade(tradeObj, currencyPair, exchange, 0.0); // since we mostly use the default exchange fee we can also use 0
            if (tradeObj.currencyPair instanceof Currency.CurrencyPair) {
                // @ts-ignore
                tradeObj.currencyPair = tradeObj.currencyPair.toNr();
            }
            insertTrades.push(tradeObj);
            lastRate = tradeObj.rate;
            inserts++;
        });
        // Trade.storeTrades() is the same with additional copying
        collection.insertMany(insertTrades, {ordered: false}, (err, result) => {
            if (err && err.code !== 11000) // ignore duplicate key errors
                logger.error("Error inserting grouped trades", err);
        });
    })

    let collection = db.get().collection(Trade.COLLECTION_NAME)
    let cursor = collection.find({
        currencyPair: currencyPair.toNr(),
        exchange: exchange,
        $and: [
            {date: {$lte: end}},
            {date: {$gt: sartBatchDate}}
        ]
    }).sort({date: 1});
    let removeTradeIDs = [];

    let deleteTrades = async (): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
            collection.deleteMany({_id: {$in: removeTradeIDs}}, (err, result) => {
                if (err)
                    logger.error("Error deleting batched trades", err);
                removeTradeIDs = [];
                resolve();
            });
        })
    }

    let candleCache = [];
    let getNextDoc = () => {
        // iterate over docs
        cursor.next(async function(err, doc) {
            if (err) {
                if (err.message && err.message.indexOf('Cursor not found') !== -1)
                    return getNextDoc(); // doc got deleted while we iterate
                logger.error("Error consolidating trades", err)
                return next();
            }
            if (doc === null) {
                batcher.addCandles(candleCache);
                batcher.flush();
                await deleteTrades();
                logger.info("Successfully consolidated %s trades to %s documents", docCount, inserts);
                return next();
            }

            docCount++;
            doc.currencyPair = Currency.CurrencyPair.fromNr(doc.currencyPair);
            let curCandle = Candle.Candle.fromTrade(doc);
            candleCache.push(curCandle);
            removeTradeIDs.push(doc._id);
            if (docCount % BATCH_OP_SIZE === 0) {
                batcher.addCandles(candleCache);
                candleCache = [];
                await deleteTrades();
                const savedPercent = 100.0 - inserts / docCount*100.0;
                logger.verbose("%s %s trade consolidation at %s fetches, %s inserts, %s%% saved", currencyPair.toString(), exchangeName, docCount, inserts, savedPercent.toFixed(2));
            }
            setTimeout(getNextDoc.bind(this), 0);
        })
    }
    getNextDoc();
}

Controller.loadServerConfig(() => {
    utils.file.touch(AbstractExchange.cookieFileName).then(() => {
        // node --use_strict --max-old-space-size=6096 app.js --debug -t=consolidate --exchange=Bitfinex -p=3151 --bitmex --days=600 --startDays=99999 --candleSize=5
        if (argv.days > 0 && argv.startDays > 0)
            consolidateTrades(argv.days, argv.startDays, argv.candleSize > 0 ? argv.candleSize : 1);
        else
            logger.error("consolidate must be called with arg --days and --startDays");
    })
});