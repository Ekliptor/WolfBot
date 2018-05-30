import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency} from "@ekliptor/bit-models";
import {ConfigCurrencyPair, TradeConfig} from "../Trade/TradeConfig";

export class BrainConfig {
    public readonly name: string = "";
    public readonly exchanges: string[] = null;
    public readonly pricePoints: number = 0;
    public readonly candleSize: number = 0;
    public readonly markets: Currency.CurrencyPair[] = [];
    public readonly indicatorCount = 0;
    // indicators are stored in IndicatorAdder class
    public readonly configNr: number = 0;

    protected static nextConfigNr: number = 0;

    constructor(json: any, configName: string) {
        this.name = configName.replace(/\.json$/, "");
        if (json.exchanges) {
            if (json.exchanges === "default")
                this.exchanges = nconf.get("defaultExchanges")
            else
                this.exchanges = json.exchanges;
        }
        else
            this.exchanges = nconf.get("defaultExchanges")
        if (json.pricePoints)
            this.pricePoints = Math.floor(json.pricePoints)
        if (this.pricePoints <= 0)
            throw new Error("BrainConfig pricePoints has to be an integer greater than 0")
        if (json.candleSize) {
            if (json.candleSize === "default")
                json.candleSize = nconf.get('serverConfig:defaultCandleSize')
            this.candleSize = Math.floor(json.candleSize)
        }
        if (this.candleSize <= 0)
            throw new Error("BrainConfig candleSize has to be an integer greater than 0")
        json.markets.forEach((market) => {
            let pair = TradeConfig.getCurrencyPair(market)
            this.markets.push(pair)
        })
        if (Array.isArray(json.indicators))
            this.indicatorCount = json.indicators.length;
        this.configNr = ++BrainConfig.nextConfigNr;
    }

    public getConfigCurrencyPair(currencyPair: Currency.CurrencyPair): ConfigCurrencyPair {
        return BrainConfig.createConfigCurrencyPair(this.configNr, currencyPair);
    }

    public static createConfigCurrencyPair(configNr: number, currencyPair: Currency.CurrencyPair): ConfigCurrencyPair {
        return configNr + "-" + currencyPair.toString();
    }

    public listConfigCurrencyPairs() {
        let pairs: ConfigCurrencyPair[] = []
        this.markets.forEach((currencyPair) => {
            pairs.push(this.getConfigCurrencyPair(currencyPair))
        })
        return pairs;
    }

    public hasCurrency(currencyPair: Currency.CurrencyPair) {
        for (let i = 0; i < this.markets.length; i++)
        {
            if (this.markets[i].equals(currencyPair))
                return true;
        }
        return false;
    }
}