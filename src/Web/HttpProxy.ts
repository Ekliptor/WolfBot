import * as utils from "@ekliptor/apputils";
const logger = utils.logger
const nconf = utils.nconf
import * as db from'../database';
import * as http from "http";


/**
 * A simple HTTP proxy class that proxies requests coming to localhost to another server.
 * The (current) purpose of this file is to redirect requests for the TradingView charting library
 * since their license doesn't allow shipping the library with the bot.
 */
export class HttpProxy {
    protected readonly cookieJar = utils.getNewCookieJar();

    constructor() {
    }

    public async respond(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const urlStr = nconf.get("projectUrl") + req.url;
        const responseType = ""; // can be used to enforce a certain response type

        let urlObj = utils.parseUrl(urlStr)
        let options = {
            cookieJar: this.cookieJar, // if we logged in that jar will hold our cookies
            headers: {
                'Referer': urlObj.protocol + '//' + urlObj.host // to bypass hotlink protection of images
            },
            followRedirect: true,
            forever: true,
            localAddress: nconf.get('debug') === true || !nconf.get('localAddress') ? null : nconf.get('localAddress'),
            proxy: nconf.get('proxy'),
            cloudscraper: false, // solve CloudFlare challenge pages
            url: undefined
        };
        let request = utils.getRequest()
        options.url = urlStr
        let curRequest = request(options)
            .on('response', (response) => {
                let headers = response.headers
                if (!headers['cache-control'])
                    res.setCacheHeaders(nconf.get('cachingMin:proxyDefaultCache'))
                if (responseType && headers['content-type'] && headers['content-type'].indexOf(responseType) === -1) {
                    logger.warn("Aborting request to %s because of wrong content type: %s (requested. %s)", urlStr, headers['content-type'], responseType)
                    curRequest.abort();
                    res.sendStatus(404)
                    res.end()
                    return;
                }
                let status = response.statusCode === 200 ? 200 : 404 // always print 200 or 404 to avoid spamming our error stack handler for requests
                res.writeHead(status, headers)
            })
            .on('error', (err) => {
                logger.error("Proxy request error", err)
                res.sendStatus(500)
                res.end()
            });
        curRequest.pipe(res)
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}