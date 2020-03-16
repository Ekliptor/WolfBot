import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractCurrencyRates, CurrencyRatesOptions, CurrencyRate} from "./AbstractCurrencyRates";
import {convertCurrency, getCurrencyRate, getCurrencyRateList} from 'currencies-exchange-rates/lib';


export class ExchangeRates extends AbstractCurrencyRates {
    constructor(options: CurrencyRatesOptions = null) {
        super(options);
    }

    public async getRate(from: string, to: string): Promise<number> {
        let cachedRate = this.ratesCache.getRate(from, to);
        if (cachedRate !== undefined)
            return cachedRate.rate;

        try {
            let rate = await getCurrencyRate(from, to); //  rates: { THB: 32.2102715784 }, base: 'USD', date: '2020-03-16' }
            const rateVal = rate.rates[to];
            if (typeof rateVal !== "number")
                throw new Error(to + "rate has invalid type: " + typeof rateVal);
            this.ratesCache.addRate(new CurrencyRate(from, to, rateVal));
            return rateVal;
        }
        catch (err) {
            logger.error("Error getting currency rate in %s", this.className, err);
        }
        return 0.0;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}
