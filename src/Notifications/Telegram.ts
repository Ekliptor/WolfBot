import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractNotification, NotificationOpts} from "./AbstractNotification";
import Notification from "./Notification";
import * as querystring from "querystring";
//import {TelegramBot} from "bottender";
//import {createServer} from "bottender/express";

export default class Telegram extends AbstractNotification {
    protected static readonly API_URL = "https://api.telegram.org/bot%s/sendMessage?%s";

    // most popular, but outdated (?) https://www.npmjs.com/package/node-telegram-bot-api
    // does this plain GET post approach still work? https://medium.com/@xabaras/sending-a-message-to-a-telegram-channel-the-easy-way-eb0a0b32968
    protected bot: any; // TODO wait for typings
    protected callbackServer: any;
    // TODO make this work with private groups/channels too. they have non-readable links: https://t.me/joinchat/abc-defg

    constructor(options: NotificationOpts) {
        super(options)
        //if (!nconf.get("serverConfig:apiKey:notify:Telegram:receiver"))
            //throw new Error("Telegram receiver (token) and channel ID must be set to send Telegram notifications");
        if (!this.options.receiver || !this.options.channel)
            throw new Error("Telegram receiver (token) and channel ID must be set to send Telegram notifications");
        else if (/^-*[0-9]+$/.test(this.options.channel) === false && this.options.channel[0] !== "@")
            throw new Error("Telegram channel ID must start with @ or be a numeric channel ID from: curl -X POST https://api.telegram.org/bot[BOT_API_KEY]/getUpdates");
        // TODO add support for admin notifications

        /*
        this.bot = new TelegramBot({
            accessToken: this.options.receiver
        });
        this.bot.onEvent(async (context) => { // no events happen even though the server is listening. only works with HTTPS?
            logger.info("EVENT", context)
            await context.sendText('Hello World');
        });
        this.callbackServer = createServer(this.bot);
        // TODO randomize port for premium if we run multiple instances on same machine
        this.callbackServer.listen(nconf.get("serverConfig:apiKey:notify:Telegram:serverPort"), () => {
            logger.verbose("%s callback server is listening on port %s...", this.className, nconf.get("serverConfig:apiKey:notify:Telegram:serverPort"));
        });
         */
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected sendNotification(notification: Notification, forceAdmin: boolean) {
        return new Promise<void>((resolve, reject) => {
            let data: any = {
                chat_id: this.options.channel,
                text: notification.getMessengerText()
            }
            const urlStr = utils.sprintf(Telegram.API_URL, this.options.receiver, querystring.stringify(data));
            utils.getPageCode(urlStr, (body, response) => {
                if (!body)
                    return reject({txt: "Received invalid response from Telegram API", response: response})
                let json = utils.parseJson(body)
                if (!json)
                    return reject({txt: "Received invalid JSON from notification api", notification: this.className, body: body})
                else if (json.ok !== true)
                    return reject({txt: "Failed to send Telegram message", json: json})
                resolve()
            })
        })
    }
}
