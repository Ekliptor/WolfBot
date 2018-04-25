import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, BotTrade} from "@ekliptor/bit-models";

export type BotConfigMode = BotTrade.TradingMode | "ai" | "social";

export class AbstractConfig {
    public readonly name: string = "";
    public readonly configNr: number = 0;

    protected static nextConfigNr: number = 0;

    constructor(json: any, configName: string) {
        this.name = configName.replace(/\.json$/, "");
        this.configNr = ++AbstractConfig.nextConfigNr;
    }

    public static resetCounter() {
        AbstractConfig.nextConfigNr = 0;
    }

    public static getExchangeNames(exchanges: string[]) { // in Strategies on client and AbstractConfig on server
        return exchanges.toString().replace(/,/g, ", ");
    }
}