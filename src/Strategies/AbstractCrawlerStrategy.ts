import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Candle, Order} from "@ekliptor/bit-models";
import * as helper from "../utils/helper";
import * as path from "path";
import * as request from "request";
import {TradingViewTicker} from "../Trade/TradingViewTicker";
import {AbstractTrailingStop, AbstractTrailingStopAction} from "./AbstractTrailingStop";
import * as cheerio from "cheerio";

export interface AbstractCrawlerStrategyAction extends AbstractTrailingStopAction {
    useProxy: boolean; // optional, default false - Use a pre-configured proxy of global WolfBot settings.
}

export interface JQueryPage {
    html: string;
    $: CheerioStatic;
}

/**
 * A strategy that fetches data from other websites to make decisions.
 * Not available during backtesting.
 */
export abstract class AbstractCrawlerStrategy extends /*AbstractStrategy*/AbstractTrailingStop {
    public action: AbstractCrawlerStrategyAction;
    protected cookieFileName: string;
    protected cookieJar; // cookies help against DDOS protection (CloudFlare) even on APIs
    protected proxy: string = "";
    protected requestCount = 0;
    protected tradingView = new TradingViewTicker();
    // TODO crawl https://bfxdata.com/positions/btcusd
    // TODO crawling mining difficulty charts could be an indicator of price movements (long term)

    constructor(options) {
        super(options)
        if (nconf.get("trader") === "Backtester")
            throw new Error(utils.sprintf("%s is not available during backtesting because it depends on real-time data feeds.", this.className))

        this.cookieFileName = path.join(utils.appDir, "temp", "cookies-" + this.className + ".json");
        setTimeout(async () => {
            await utils.file.touch(this.cookieFileName);
            this.cookieJar = utils.getNewCookieJar(this.cookieFileName);
        }, 0);
        if (this.action.useProxy === true && nconf.get("proxy"))
            this.proxy = nconf.get("proxy");
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected checkIndicators() {
        // overwrite this in child class to to TA
    }

    /**
     * Get status info of another WolfBot instance.
     * @param url The url of the bot api, usually ending with /state/
     * @param callback
     * @param options You ma specify options.apiKey if this bot uses another API key.
     */
    protected getBotInfo(url: string, callback: (err: any, json: any) => void, options: any = {}) {
        let data = {
            apiKey: options.apiKey ? options.apiKey : helper.getFirstApiKey()
        }
        let httpOpts = this.getHttpOptions();
        httpOpts.skipCertificateCheck = true;
        utils.postDataAsJson(url, data, (body, response) => {
            if (body === false)
                return callback(response, null);
            callback(null, utils.parseJson(body));
        }, httpOpts)
    }

    /**
     * Perform a HTTP GET request
     * @param address
     * @param callback
     * @param options
     */
    protected get(address: string, callback: utils.UtilsHttpCallback, options: any = {}): request.Request {
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

    /**
     * Performa HTTP POST request
     * @param address
     * @param data
     * @param callback
     * @param options
     */
    protected post(address: string, data: any, callback: utils.UtilsHttpCallback, options: any = {}): request.Request {
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

    protected jQueryLoad(htmlStr: string, normalizeWhitespace = true): CheerioStatic {
        /**
         * cheerio.load(htmlStr.replace(/>/g, "> ")
         * this workaround solves a problem with HTML like this:
         * <table><tr><th><img src="/icons/blank.gif" alt="[ICO]"></th><th><a href="?C=N;O=D">Name</a></th><th><a href="?C=M;O=A">Last modified</a></th><th><a href="?C=S;O=A">Size</a></th><th><a href="?C=D;O=A">Description</a></th></tr><tr><th colspan="5"><hr></th></tr></table>
         * where the extracted text is something like: "NameLast modifiedSizeDescription"
         * stylesheet support but 8x slower:https://github.com/tmpvar/jsdom
         */
        let $ = cheerio.load(htmlStr.replace(/>/g, "> "), {
            normalizeWhitespace: normalizeWhitespace,      // used to get much less "stuff"
            lowerCaseTags: true,            // lower case tags
            lowerCaseAttributeNames: true,  // lower case attrs
            xmlMode: true,
            decodeEntities: true
        });
        return $;
    }

    protected getHttpOptions(options: any = {}) {
        if (options.cookieJar === undefined)
            options.cookieJar = this.cookieJar;
        if (options.timeout === undefined)
            options.timeout = nconf.get('serverConfig:httpTimeoutMs')
        //if (options.cloudscraper === undefined) // not supported for POST yet
            //options.cloudscraper = true;
        return options;
    }
}