// do the first initialization of the app
// such as creating collections and files/permissions
// use multiple such files such as update1.js to roll out updates

import * as utils from "@ekliptor/apputils";
const logger = utils.logger;
const nconf = utils.nconf;
import * as db from "../../src/database";
import * as async from "async"; // Promise.all() doesn't guarantee the execution order
import {user, serverConfig, conversation, CoinMarketInfo, Trade, TradeHistory, Order, LoanOrder, Liquidation, Candle, Ticker, TickerVolumeSpike, Process, FearGreedIndex, SocialPost, TrollShout, SystemMessage, BotTrade} from "@ekliptor/bit-models";


let addInitFn = (queue, addFunctions) => {
    addFunctions.forEach((fn) => {
        queue.push(fn);
    })
}

export async function run(): Promise<void> {
    let ready = await checkDatabaseReady();
    if (ready === true)
        return Promise.resolve();

    logger.info("Initializing database: Creating collections on first start")
    let actions = [
        /*(callback) => {
         db.dropDatabase(callback);
         }*/
    ];

    addInitFn(actions, [(callback) => {
        let NewMessage = SystemMessage.SystemMessage(db.get());
        NewMessage.createCollection(callback);
    }]);
    addInitFn(actions, user.getInitFunctions(db.get()));
    addInitFn(actions, serverConfig.getInitFunctions(db.get()));
    addInitFn(actions, conversation.getInitFunctions(db.get()));
    addInitFn(actions, Trade.getInitFunctions(db.get()));
    addInitFn(actions, TradeHistory.getInitFunctions(db.get()));
    addInitFn(actions, Order.getInitFunctions(db.get()));
    addInitFn(actions, LoanOrder.getInitFunctions(db.get()));
    addInitFn(actions, Liquidation.getInitFunctions(db.get()));
    addInitFn(actions, Candle.getInitFunctions(db.get()));
    addInitFn(actions, Process.getInitFunctions(db.get()));
    addInitFn(actions, SocialPost.getInitFunctions(db.get()));
    addInitFn(actions, TrollShout.getInitFunctions(db.get()));
    addInitFn(actions, CoinMarketInfo.getInitFunctions(db.get()));
    addInitFn(actions, Ticker.getInitFunctions(db.get()));
    addInitFn(actions, TickerVolumeSpike.getInitFunctions(db.get()));
    addInitFn(actions, BotTrade.getInitFunctions(db.get()));
    addInitFn(actions, FearGreedIndex.getInitFunctions(db.get()));

    return new Promise<void>((resolve, reject) => {
        async.series(actions, (err) => {
            if (err) {
                logger.error(JSON.stringify(err));
                logger.error("Error during first start initialization. Please ensure you have proper access rights to your database and filesystem.")
                process.exit(1);
            }
            logger.info("Finished initializing database");
            resolve()
        })
    });
}

function checkDatabaseReady() {
    return new Promise<boolean>((resolve, reject) => {
        // just check if 1 collection exists
        db.get().collection(Trade.COLLECTION_NAME, {strict: true}, (err, col) => {
            if (err) {
                logger.verbose("%s collection access error. Probably first start", Trade.COLLECTION_NAME, err)
                return resolve(false)
            }
            resolve(true)
        })
    })
}
