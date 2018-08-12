import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency, Trade, Candle, Order, Funding, SocialPost, TrollShout} from "@ekliptor/bit-models";
import * as WebSocket from "ws";
import * as http from "http";
import * as db from "../database";
import {ServerSocketPublisher, ServerSocket} from "./ServerSocket";
import {AppPublisher} from "./AppPublisher";
import {WebSocketOpcode} from "./opcodes";
import {SocialController} from "../Social/SocialController";


export class SocialUpdater extends AppPublisher {
    public readonly opcode = WebSocketOpcode.SOCIAL;
    protected socialController: SocialController;

    constructor(serverSocket: ServerSocket, socialController: SocialController) {
        super(serverSocket, socialController)
        this.socialController = socialController;
        this.publishSocialUpdates();
    }

    public onSubscription(clientSocket: WebSocket, initialRequest: http.IncomingMessage): void {
        this.send(clientSocket, {
            maxAge: this.getMaxAge(),
            days: nconf.get("serverConfig:postDisplayAgeDays"),
            listTopSocialCurrencies: nconf.get("serverConfig:listTopSocialCurrencies"),
            maxLinePlotCurrencies: nconf.get("serverConfig:maxLinePlotCurrencies"),
            serverDate: new Date()
        });
        this.socialController.getAllCrawlerData().then((data) => {
            this.send(clientSocket, {full: data});
        }).catch((err) => {
            logger.error("Error getting crawler data for client", err)
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected publishSocialUpdates() {
        // no incremental updates yet. we just publish the full data
        // AbstractCrawler emits events, so we could implement it
        let publish = () => {
            if (this.skipPublishing())
                return setTimeout(publish.bind(this), nconf.get("serverConfig:socialUpdateSecUI")*1000);
            this.socialController.getAllCrawlerData().then((data) => {
                this.publish({full: data}) // gets only called for connected clients
                setTimeout(publish.bind(this), nconf.get("serverConfig:socialUpdateSecUI")*1000)
            }).catch((err) => {
                logger.error("Error publishing social updates", err)
                setTimeout(publish.bind(this), nconf.get("serverConfig:socialUpdateSecUI")*1000) // don't repeat it immediately in case DB is overloaded
            })
        }
        publish();
    }

    protected getMaxAge() {
        return new Date(Date.now() - nconf.get("serverConfig:postDisplayAgeDays")*utils.constants.DAY_IN_SECONDS*1000);
    }
}