import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
//import {AbstractSubController} from "./AbstractSubController";
import {Currency} from "@ekliptor/bit-models";
import {ServerSocket} from "./WebSocket/ServerSocket";
import {HomeUpdater} from "./WebSocket/HomeUpdater";
import {StatusUpdater} from "./WebSocket/StatusUpdater";
import {StrategyUpdater} from "./WebSocket/StrategyUpdater";
import {LendingUpdater} from "./WebSocket/LendingUpdater";
import {OracleUpdater} from "./WebSocket/OracleUpdater";
import {ConfigEditor} from "./WebSocket/ConfigEditor";
import {ScriptsUpdater} from "./WebSocket/ScriptsUpdater";
import {LogPublisher} from "./WebSocket/LogPublisher";
import {LoginUpdater} from "./WebSocket/LoginUpdater";
import TradeAdvisor from "./TradeAdvisor";
import {Brain} from "./AI/Brain";
import {LendingAdvisor} from "./Lending/LendingAdvisor";
import {SocialController} from "./Social/SocialController";
import {SocialUpdater} from "./WebSocket/SocialUpdater";
import {CoinMarketUpdater} from "./WebSocket/CoinMarketUpdater";
import {TradingViewData} from "./WebSocket/TradingViewData";
import {TradeHistoryUpdater} from "./WebSocket/TradeHistoryUpdater";
import {BacktestingUpdater} from "./WebSocket/BacktestingUpdater";
import {TradesUpdater} from "./WebSocket/TradesUpdater";

/**
 * This controller runs independently and broadcasts data to all connected clients.
 */
export default class WebSocketController /*extends AbstractSubController*/ {
    protected serverSocket: ServerSocket;
    protected tradeAdvisor: TradeAdvisor;
    protected lendingAdvisor: LendingAdvisor;
    protected socialController: SocialController;
    protected brain: Brain;

    protected homeUpdater: HomeUpdater;
    protected statusUpdater: StatusUpdater;
    protected strategyUpdater: StrategyUpdater;
    protected lendingUpdater: LendingUpdater;
    protected socialUpdater: SocialUpdater;
    protected coinMarketUpdater: CoinMarketUpdater; // uses social controller too
    protected oracleUpdater: OracleUpdater;
    protected tradeHistory: TradeHistoryUpdater;
    protected tradesUpdater: TradesUpdater;
    protected configEditor: ConfigEditor;
    protected scriptsUpdater: ScriptsUpdater;
    protected backtestingUpdater: BacktestingUpdater;
    protected logPublisher: LogPublisher;
    protected loginUpdater: LoginUpdater;
    protected tradingViewData: TradingViewData;

    constructor(serverSocket: ServerSocket, tradeAdvisor: TradeAdvisor, lendingAdvisor: LendingAdvisor, socialController: SocialController, brain: Brain) {
        this.serverSocket = serverSocket;
        this.tradeAdvisor = tradeAdvisor;
        this.lendingAdvisor = lendingAdvisor;
        this.socialController = socialController;
        this.brain = brain;

        // setup websocket broadcasters
        // TODO if all we do is call subscribe() we can move them in a subfolder and use loadModule() to add all of them dynamically
        this.homeUpdater = new HomeUpdater(this.serverSocket, this.getAdvisor());
        this.serverSocket.subscribe(this.homeUpdater);
        this.statusUpdater = new StatusUpdater(this.serverSocket, this.getAdvisor());
        this.serverSocket.subscribe(this.statusUpdater);
        this.strategyUpdater = new StrategyUpdater(this.serverSocket, this.getAdvisor());
        this.serverSocket.subscribe(this.strategyUpdater);
        if (this.lendingAdvisor) {
            this.lendingUpdater = new LendingUpdater(this.serverSocket, this.lendingAdvisor);
            this.serverSocket.subscribe(this.lendingUpdater);
        }
        if (this.socialController) {
            this.socialUpdater = new SocialUpdater(this.serverSocket, this.socialController);
            this.serverSocket.subscribe(this.socialUpdater);
            this.coinMarketUpdater = new CoinMarketUpdater(this.serverSocket, this.socialController);
            this.serverSocket.subscribe(this.coinMarketUpdater)
        }
        if (this.brain) {
            this.oracleUpdater = new OracleUpdater(this.serverSocket, this.brain);
            this.serverSocket.subscribe(this.oracleUpdater);
        }
        this.configEditor = new ConfigEditor(this.serverSocket, this.getAdvisor());
        this.serverSocket.subscribe(this.configEditor);
        this.scriptsUpdater = new ScriptsUpdater(this.serverSocket, this.getAdvisor());
        this.serverSocket.subscribe(this.scriptsUpdater);
        this.backtestingUpdater = new BacktestingUpdater(this.serverSocket, this.getAdvisor());
        this.serverSocket.subscribe(this.backtestingUpdater);
        this.tradeHistory = new TradeHistoryUpdater(this.serverSocket, this.getAdvisor());
        this.serverSocket.subscribe(this.tradeHistory);
        this.tradesUpdater = new TradesUpdater(this.serverSocket, this.getAdvisor());
        this.serverSocket.subscribe(this.tradesUpdater);
        this.logPublisher = new LogPublisher(this.serverSocket, this.getAdvisor());
        this.serverSocket.subscribe(this.logPublisher);
        this.loginUpdater = new LoginUpdater(this.serverSocket, this.getAdvisor());
        this.serverSocket.subscribe(this.loginUpdater);
        this.tradingViewData = new TradingViewData(this.serverSocket, this.getAdvisor());
        this.serverSocket.subscribe(this.tradingViewData);

        /*
        logger.stream().on('log', (log) => { // streams entries previously logged
            console.log(log);
        });
        */
        /*
        logger.on('logging', (transport, level, msg, meta) => {
            // [msg] and [meta] have now been logged at [level] to [transport]
            if (transport.name !== "file")
                return;
            console.log("[%s] and [%s] have now been logged at [%s] to [%s]", msg, JSON.stringify(meta), level, transport.name);
        });
        */
    }

    public getConfigEditor() {
        return this.configEditor;
    }

    public getLoginUpdater() {
        return this.loginUpdater;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected getAdvisor() {
        if (nconf.get("lending"))
            return this.lendingAdvisor;
        else if (nconf.get("social"))
            return this.socialController;
        return this.tradeAdvisor;
    }
}