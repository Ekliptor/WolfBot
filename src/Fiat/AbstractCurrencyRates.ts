import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;

export interface CurrencyRatesOptions {

}

export class CurrencyRate {
    protected static readonly RATE_EXPIRY_MIN = 60;

    public from: string;
    public to: string;
    public rate: number;
    public time: Date = new Date();

    constructor(from: string, to: string, rate: number) {
        this.from = from;
        this.to = to;
        this.rate = rate;
    }

    public isExpired(): boolean {
        return this.time.getTime() + CurrencyRate.RATE_EXPIRY_MIN*utils.constants.MINUTE_IN_SECONDS*1000 < Date.now();
    }
}

export class CurrencyRatesCache extends Map<string, CurrencyRate> { // (from-to currency, rate)
    constructor() {
        super();
    }

    /**
     * Add or overwrite a currency rate in the cache.
     * @param rate
     */
    public addRate(rate: CurrencyRate) {
        this.set(this.getRateKey(rate.from, rate.to), rate);
    }

    /**
     * Return the rate from cache.
     * @param from
     * @param to
     * @param removeExpired (optional) Use true to remove expired rates from cache (returns undefined), false to return it.
     * @return the rate or undefined if it isn't in the cache
     */
    public getRate(from: string, to: string, removeExpired: boolean = true): CurrencyRate {
        const key = this.getRateKey(from, to);
        const rate = this.get(key);
        if (rate === undefined)
            return undefined;
        else if (removeExpired === true && rate.isExpired() === true) {
            this.delete(key);
            return undefined;
        }
        return rate;
    }

    protected getRateKey(from: string, to: string) {
        return (from + "-" + to).toUpperCase();
    }
}

export abstract class AbstractCurrencyRates {
    protected options: CurrencyRatesOptions;
    protected className: string;
    protected ratesCache = new CurrencyRatesCache();

    constructor(options: CurrencyRatesOptions = null) {
        this.options = options || {};
        this.className = this.constructor.name;
    }

    public getClassName() {
        return this.className;
    }

    /**
     * Return the currency rate or 0.0 on error.
     * @param from
     * @param to
     * @return the conversion rate
     */
    public abstract getRate(from: string, to: string): Promise<number>;

    /**
     * Return the currency rate (or 0.0 on error) from cache only. This function ignores the cache expiry time.
     * @param from
     * @param to
     * @return the conversion rate
     */
    public getRateFromCache(from: string, to: string): number {
        let cachedRate = this.ratesCache.getRate(from, to, false);
        if (cachedRate !== undefined)
            return cachedRate.rate;
        return 0.0;
    }

    /**
     * Convert a given amount.
     * @param from
     * @param to
     * @param amount
     * @return the converted amount or 0.0 on error.
     */
    public async convert(from: string, to: string, amount: number): Promise<number> {
        //return convertCurrency(from, to, amount); // better always use our own cache
        const rate = await this.getRate(from, to);
        if (rate === undefined)
            return 0.0;
        return amount * rate;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

}
