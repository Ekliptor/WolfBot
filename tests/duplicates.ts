import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as argvFunction from "minimist";
const argv = argvFunction(process.argv.slice(2));
import {controller as Controller} from '../src/Controller';
import {AbstractExchange} from "../src/Exchanges/AbstractExchange";
import {Currency, Trade} from "@ekliptor/bit-models";
import * as db from "../src/database";


let scheduleExit = (delayMs = 500, code = 0) => {
    setTimeout(() => {
        process.exit(code);
    }, delayMs);
}

let getAggregateOpts = () => {
    return {
        maxTimeMS: nconf.get("mongoTimeoutSec") * 100 * 1000,
        allowDiskUse: true
    }
}

let deleteDuplicates = async () => {
    // a slower alternative would be to create a new collection and indices using getInitFunctions() and
    // copy the data while ignoring duplicate key errors
    let collection = db.get().collection(Trade.COLLECTION_NAME)
    let cursor = collection.aggregate([
        {
            $group: {
                _id: "$uniqueID",
                duplicates: {$push: "$_id"},
                count: {$sum: 1}
            }
        }, {
            $match: {
                count: {$gt: 1}
            }
        }, {
            $project: {duplicates: 1}
        }
    ], getAggregateOpts());
    let docCount = 0, duplicates = 0;
    let getNextDoc = () => {
        // iterate over docs
        cursor.next(function(err, doc) {
            if (err) {
                if (err.message && err.message.indexOf('Cursor not found') !== -1)
                    return getNextDoc(); // doc got deleted while we iterate
                logger.error("Error deleting duplicates", err)
                return scheduleExit();
            }
            if (doc === null) {
                logger.info("Successfully deleted %s duplicates of %s documents", duplicates, docCount);
                return scheduleExit();
            }

            doc.duplicates.shift(); // remove the first one to keep it in DB
            docCount++;
            if (doc.duplicates && Array.isArray(doc.duplicates) === true)
                duplicates += doc.duplicates.length;
            else
                return setTimeout(getNextDoc.bind(this), 0);
            collection.deleteMany({_id: {$in: doc.duplicates}}, (err, result) => {
                if (err)
                    logger.error("Error deleting duplicate docs of %s", doc._id, err);
                logger.verbose("Duplicate deletion at %s duplicates of %s docs", duplicates, docCount);
                setTimeout(getNextDoc.bind(this), 0);
            });
        })
    }
    getNextDoc();
}

Controller.loadServerConfig(() => {
    utils.file.touch(AbstractExchange.cookieFileName).then(() => {
        deleteDuplicates();
    })
});