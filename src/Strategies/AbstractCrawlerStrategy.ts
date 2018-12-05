import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractStrategy, StrategyAction, TradeAction, StrategyOrder} from "./AbstractStrategy";
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import * as helper from "../utils/helper";
import * as path from "path";
import * as request from "request";

interface AbstractCrawlerAction extends StrategyAction {
    useProxy: boolean;      // default false
}

/**
 * A strategy that fetches data from other websites to make decisions.
 * Not available during backtesting.
 */
export abstract class AbstractCrawlerStrategy extends AbstractStrategy {
    protected action: AbstractCrawlerAction;
    protected cookieFileName: string;
    protected cookieJar; // cookies help against DDOS protection (CloudFlare) even on APIs
    protected proxy: string = "";
    protected requestCount = 0;
    // TODO crawl https://bfxdata.com/positions/btcusd
    // TODO crawling miniing dificulty charts could be an indicator of price movements (long term)

    constructor(options) {
        super(options)
        if (nconf.get("trader") === "Backtester")
            throw new Error(utils.sprintf("%s is not available during backtesting.", this.className))

        this.cookieFileName = path.join(utils.appDir, "temp", "cookies-" + this.className + ".json");
        this.cookieJar = utils.getNewCookieJar(this.cookieFileName);
        if (this.action.useProxy === true && nconf.get("proxy"))
            this.proxy = nconf.get("proxy");
        utils.file.touch(this.cookieFileName);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected getBotInfo(url: string, callback, options: any = {}) {
        let data = {
            apiKey: options.apiKey ? options.apiKey : helper.getFirstApiKey()
        }
        let httpOpts = this.getHttpOptions();
        httpOpts.skipCertificateCheck = true;
        utils.postDataAsJson(url, data, (body, response) => {
            callback(body, response);
        }, httpOpts)
    }

    protected get(address, callback, options: any = {}): request.Request {
        ++this.requestCount;
        if (nconf.get("logStrategyRequests"))
            logger.verbose("GET: %s", address)
        if (this.proxy.length !== 0 && !options.proxy)
            options.proxy = this.proxy
        //options.forever = true; // keep connections alive
        // TODO detect >You are being rate limited< and change IP via proxy or other CF errors instead of json
        // @ts-ignore
        return utils.getPageCode(address, (body, response) => {
            callback(body, response);
        }, this.getHttpOptions(options))
    }

    protected post(address, data, callback, options: any = {}): request.Request {
        ++this.requestCount;
        if (nconf.get("logStrategyRequests")) {
            logger.verbose("POST: %s", address)
            logger.verbose(data)
        }
        if (options.urlencoded === undefined)
            options.urlencoded = true
        if (this.proxy.length !== 0 && !options.proxy)
            options.proxy = this.proxy
        //options.forever = true; // keep connections alive
        // @ts-ignore
        return utils.postData(address, data, (body, response) => {
            callback(body, response);
        }, this.getHttpOptions(options))
    }

    protected getHttpOptions(options: any = {}) {
        if (options.cookieJar === undefined)
            options.cookieJar = this.cookieJar;
        if (options.timeout === undefined)
            options.timeout = nconf.get('serverConfig:httpTimeoutMs')
        //if (options.cloudscraper === undefined)
            //options.cloudscraper = true;
        return options;
    }
}