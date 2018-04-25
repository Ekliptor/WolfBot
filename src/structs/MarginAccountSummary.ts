import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;

export default class MarginAccountSummary {
    totalValue: number = 0;
    pl: number = 0;                         // profit/loss
    lendingFees: number = 0;
    netValue: number = 0;
    totalBorrowedValue: number = 0;
    currentMargin: number = 0;

    constructor() {
    }

    public static fromJson(json): MarginAccountSummary {
        // some exchanges (poloniex/kraken) return all numbers as strings
        let account = new MarginAccountSummary();
        for (let prop in json)
        {
            if (account[prop] === undefined)
                continue;
            account[prop] = parseFloat(json[prop])
            if (account[prop] === Number.NaN) {
                logger.warn("Error parsing MarginAccountSummary: key %s, value %s", prop, json[prop])
                account[prop] = 0
            }
        }
        return account;
    }
}

// force loading dynamic imports for TypeScript
import "./ExchangeTicker"; // not used anymore, needed for updater // TODO remove?