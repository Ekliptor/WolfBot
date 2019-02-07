// https://poloniex.com/support/api/

import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractExchange, ExOptions, ExApiKey, OrderBookUpdate, OpenOrders, OpenOrder, ExRequestParams, ExResponse, OrderParameters, MarginOrderParameters, CancelOrderResult, PushApiConnectionType} from "./AbstractExchange";
import {OrderResult} from "../structs/OrderResult";
import {MarginPosition, MarginPositionList} from "../structs/MarginPosition";
import MarginAccountSummary from "../structs/MarginAccountSummary";
import * as autobahn from "autobahn";
import * as WebSocket from "ws";
import * as request from "request";
import * as crypto from "crypto";
import * as querystring from "querystring";
import * as db from "../database";
import * as helper from "../utils/helper";

import EventStream from "../Trade/EventStream";
import {Currency, Ticker, Trade, TradeHistory, MarketOrder} from "@ekliptor/bit-models";
import {MarketAction} from "../Trade/MarketStream";
import {OrderBook} from "../Trade/OrderBook";
import {
    AbstractLendingExchange, ActiveLoan, ExchangeActiveLoanMap, LoanDirection, LoanOffers,
    MarginLendingParams
} from "./AbstractLendingExchange";
import {OfferResult} from "../structs/OfferResult";
import {ExternalTickerExchange} from "./ExternalTickerExchange";


// from poloniex html
const markets = {"byCurrencyPair":{"BTC_BCN":{"id":7,"baseID":28,"quoteID":17,"base":"BTC","quote":"BCN","currencyPair":"BTC_BCN"},"BTC_BTS":{"id":14,"baseID":28,"quoteID":32,"base":"BTC","quote":"BTS","currencyPair":"BTC_BTS"},"BTC_BURST":{"id":15,"baseID":28,"quoteID":34,"base":"BTC","quote":"BURST","currencyPair":"BTC_BURST"},"BTC_CLAM":{"id":20,"baseID":28,"quoteID":43,"base":"BTC","quote":"CLAM","currencyPair":"BTC_CLAM"},"BTC_DGB":{"id":25,"baseID":28,"quoteID":53,"base":"BTC","quote":"DGB","currencyPair":"BTC_DGB"},"BTC_DOGE":{"id":27,"baseID":28,"quoteID":59,"base":"BTC","quote":"DOGE","currencyPair":"BTC_DOGE"},"BTC_DASH":{"id":24,"baseID":28,"quoteID":60,"base":"BTC","quote":"DASH","currencyPair":"BTC_DASH"},"BTC_GAME":{"id":38,"baseID":28,"quoteID":93,"base":"BTC","quote":"GAME","currencyPair":"BTC_GAME"},"BTC_HUC":{"id":43,"baseID":28,"quoteID":105,"base":"BTC","quote":"HUC","currencyPair":"BTC_HUC"},"BTC_LTC":{"id":50,"baseID":28,"quoteID":125,"base":"BTC","quote":"LTC","currencyPair":"BTC_LTC"},"BTC_MAID":{"id":51,"baseID":28,"quoteID":127,"base":"BTC","quote":"MAID","currencyPair":"BTC_MAID"},"BTC_OMNI":{"id":58,"baseID":28,"quoteID":143,"base":"BTC","quote":"OMNI","currencyPair":"BTC_OMNI"},"BTC_NAV":{"id":61,"baseID":28,"quoteID":151,"base":"BTC","quote":"NAV","currencyPair":"BTC_NAV"},"BTC_NMC":{"id":64,"baseID":28,"quoteID":155,"base":"BTC","quote":"NMC","currencyPair":"BTC_NMC"},"BTC_NXT":{"id":69,"baseID":28,"quoteID":162,"base":"BTC","quote":"NXT","currencyPair":"BTC_NXT"},"BTC_PPC":{"id":75,"baseID":28,"quoteID":172,"base":"BTC","quote":"PPC","currencyPair":"BTC_PPC"},"BTC_STR":{"id":89,"baseID":28,"quoteID":198,"base":"BTC","quote":"STR","currencyPair":"BTC_STR"},"BTC_SYS":{"id":92,"baseID":28,"quoteID":204,"base":"BTC","quote":"SYS","currencyPair":"BTC_SYS"},"BTC_VIA":{"id":97,"baseID":28,"quoteID":218,"base":"BTC","quote":"VIA","currencyPair":"BTC_VIA"},"BTC_VTC":{"id":100,"baseID":28,"quoteID":221,"base":"BTC","quote":"VTC","currencyPair":"BTC_VTC"},"BTC_XCP":{"id":108,"baseID":28,"quoteID":233,"base":"BTC","quote":"XCP","currencyPair":"BTC_XCP"},"BTC_XMR":{"id":114,"baseID":28,"quoteID":240,"base":"BTC","quote":"XMR","currencyPair":"BTC_XMR"},"BTC_XPM":{"id":116,"baseID":28,"quoteID":242,"base":"BTC","quote":"XPM","currencyPair":"BTC_XPM"},"BTC_XRP":{"id":117,"baseID":28,"quoteID":243,"base":"BTC","quote":"XRP","currencyPair":"BTC_XRP"},"BTC_XEM":{"id":112,"baseID":28,"quoteID":256,"base":"BTC","quote":"XEM","currencyPair":"BTC_XEM"},"BTC_ETH":{"id":148,"baseID":28,"quoteID":267,"base":"BTC","quote":"ETH","currencyPair":"BTC_ETH"},"BTC_SC":{"id":150,"baseID":28,"quoteID":268,"base":"BTC","quote":"SC","currencyPair":"BTC_SC"},"BTC_FCT":{"id":155,"baseID":28,"quoteID":271,"base":"BTC","quote":"FCT","currencyPair":"BTC_FCT"},"BTC_DCR":{"id":162,"baseID":28,"quoteID":277,"base":"BTC","quote":"DCR","currencyPair":"BTC_DCR"},"BTC_LSK":{"id":163,"baseID":28,"quoteID":278,"base":"BTC","quote":"LSK","currencyPair":"BTC_LSK"},"BTC_LBC":{"id":167,"baseID":28,"quoteID":280,"base":"BTC","quote":"LBC","currencyPair":"BTC_LBC"},"BTC_STEEM":{"id":168,"baseID":28,"quoteID":281,"base":"BTC","quote":"STEEM","currencyPair":"BTC_STEEM"},"BTC_SBD":{"id":170,"baseID":28,"quoteID":282,"base":"BTC","quote":"SBD","currencyPair":"BTC_SBD"},"BTC_ETC":{"id":171,"baseID":28,"quoteID":283,"base":"BTC","quote":"ETC","currencyPair":"BTC_ETC"},"BTC_REP":{"id":174,"baseID":28,"quoteID":284,"base":"BTC","quote":"REP","currencyPair":"BTC_REP"},"BTC_ARDR":{"id":177,"baseID":28,"quoteID":285,"base":"BTC","quote":"ARDR","currencyPair":"BTC_ARDR"},"BTC_ZEC":{"id":178,"baseID":28,"quoteID":286,"base":"BTC","quote":"ZEC","currencyPair":"BTC_ZEC"},"BTC_STRAT":{"id":182,"baseID":28,"quoteID":287,"base":"BTC","quote":"STRAT","currencyPair":"BTC_STRAT"},"BTC_PASC":{"id":184,"baseID":28,"quoteID":289,"base":"BTC","quote":"PASC","currencyPair":"BTC_PASC"},"BTC_GNT":{"id":185,"baseID":28,"quoteID":290,"base":"BTC","quote":"GNT","currencyPair":"BTC_GNT"},"BTC_BCH":{"id":189,"baseID":28,"quoteID":292,"base":"BTC","quote":"BCH","currencyPair":"BTC_BCH"},"BTC_ZRX":{"id":192,"baseID":28,"quoteID":293,"base":"BTC","quote":"ZRX","currencyPair":"BTC_ZRX"},"BTC_CVC":{"id":194,"baseID":28,"quoteID":294,"base":"BTC","quote":"CVC","currencyPair":"BTC_CVC"},"BTC_OMG":{"id":196,"baseID":28,"quoteID":295,"base":"BTC","quote":"OMG","currencyPair":"BTC_OMG"},"BTC_GAS":{"id":198,"baseID":28,"quoteID":296,"base":"BTC","quote":"GAS","currencyPair":"BTC_GAS"},"BTC_STORJ":{"id":200,"baseID":28,"quoteID":297,"base":"BTC","quote":"STORJ","currencyPair":"BTC_STORJ"},"BTC_EOS":{"id":201,"baseID":28,"quoteID":298,"base":"BTC","quote":"EOS","currencyPair":"BTC_EOS"},"BTC_SNT":{"id":204,"baseID":28,"quoteID":300,"base":"BTC","quote":"SNT","currencyPair":"BTC_SNT"},"BTC_KNC":{"id":207,"baseID":28,"quoteID":301,"base":"BTC","quote":"KNC","currencyPair":"BTC_KNC"},"BTC_BAT":{"id":210,"baseID":28,"quoteID":302,"base":"BTC","quote":"BAT","currencyPair":"BTC_BAT"},"BTC_LOOM":{"id":213,"baseID":28,"quoteID":303,"base":"BTC","quote":"LOOM","currencyPair":"BTC_LOOM"},"BTC_QTUM":{"id":221,"baseID":28,"quoteID":304,"base":"BTC","quote":"QTUM","currencyPair":"BTC_QTUM"},"BTC_BNT":{"id":232,"baseID":28,"quoteID":305,"base":"BTC","quote":"BNT","currencyPair":"BTC_BNT"},"BTC_MANA":{"id":229,"baseID":28,"quoteID":306,"base":"BTC","quote":"MANA","currencyPair":"BTC_MANA"},"BTC_FOAM":{"id":246,"baseID":28,"quoteID":307,"base":"BTC","quote":"FOAM","currencyPair":"BTC_FOAM"},"BTC_BCHABC":{"id":236,"baseID":28,"quoteID":308,"base":"BTC","quote":"BCHABC","currencyPair":"BTC_BCHABC"},"BTC_BCHSV":{"id":238,"baseID":28,"quoteID":309,"base":"BTC","quote":"BCHSV","currencyPair":"BTC_BCHSV"},"BTC_NMR":{"id":248,"baseID":28,"quoteID":310,"base":"BTC","quote":"NMR","currencyPair":"BTC_NMR"},"BTC_POLY":{"id":249,"baseID":28,"quoteID":311,"base":"BTC","quote":"POLY","currencyPair":"BTC_POLY"},"BTC_LPT":{"id":250,"baseID":28,"quoteID":312,"base":"BTC","quote":"LPT","currencyPair":"BTC_LPT"},"USDT_BTC":{"id":121,"baseID":214,"quoteID":28,"base":"USDT","quote":"BTC","currencyPair":"USDT_BTC"},"USDT_DOGE":{"id":216,"baseID":214,"quoteID":59,"base":"USDT","quote":"DOGE","currencyPair":"USDT_DOGE"},"USDT_DASH":{"id":122,"baseID":214,"quoteID":60,"base":"USDT","quote":"DASH","currencyPair":"USDT_DASH"},"USDT_LTC":{"id":123,"baseID":214,"quoteID":125,"base":"USDT","quote":"LTC","currencyPair":"USDT_LTC"},"USDT_NXT":{"id":124,"baseID":214,"quoteID":162,"base":"USDT","quote":"NXT","currencyPair":"USDT_NXT"},"USDT_STR":{"id":125,"baseID":214,"quoteID":198,"base":"USDT","quote":"STR","currencyPair":"USDT_STR"},"USDT_XMR":{"id":126,"baseID":214,"quoteID":240,"base":"USDT","quote":"XMR","currencyPair":"USDT_XMR"},"USDT_XRP":{"id":127,"baseID":214,"quoteID":243,"base":"USDT","quote":"XRP","currencyPair":"USDT_XRP"},"USDT_ETH":{"id":149,"baseID":214,"quoteID":267,"base":"USDT","quote":"ETH","currencyPair":"USDT_ETH"},"USDT_SC":{"id":219,"baseID":214,"quoteID":268,"base":"USDT","quote":"SC","currencyPair":"USDT_SC"},"USDT_LSK":{"id":218,"baseID":214,"quoteID":278,"base":"USDT","quote":"LSK","currencyPair":"USDT_LSK"},"USDT_ETC":{"id":173,"baseID":214,"quoteID":283,"base":"USDT","quote":"ETC","currencyPair":"USDT_ETC"},"USDT_REP":{"id":175,"baseID":214,"quoteID":284,"base":"USDT","quote":"REP","currencyPair":"USDT_REP"},"USDT_ZEC":{"id":180,"baseID":214,"quoteID":286,"base":"USDT","quote":"ZEC","currencyPair":"USDT_ZEC"},"USDT_GNT":{"id":217,"baseID":214,"quoteID":290,"base":"USDT","quote":"GNT","currencyPair":"USDT_GNT"},"USDT_BCH":{"id":191,"baseID":214,"quoteID":292,"base":"USDT","quote":"BCH","currencyPair":"USDT_BCH"},"USDT_ZRX":{"id":220,"baseID":214,"quoteID":293,"base":"USDT","quote":"ZRX","currencyPair":"USDT_ZRX"},"USDT_EOS":{"id":203,"baseID":214,"quoteID":298,"base":"USDT","quote":"EOS","currencyPair":"USDT_EOS"},"USDT_SNT":{"id":206,"baseID":214,"quoteID":300,"base":"USDT","quote":"SNT","currencyPair":"USDT_SNT"},"USDT_KNC":{"id":209,"baseID":214,"quoteID":301,"base":"USDT","quote":"KNC","currencyPair":"USDT_KNC"},"USDT_BAT":{"id":212,"baseID":214,"quoteID":302,"base":"USDT","quote":"BAT","currencyPair":"USDT_BAT"},"USDT_LOOM":{"id":215,"baseID":214,"quoteID":303,"base":"USDT","quote":"LOOM","currencyPair":"USDT_LOOM"},"USDT_QTUM":{"id":223,"baseID":214,"quoteID":304,"base":"USDT","quote":"QTUM","currencyPair":"USDT_QTUM"},"USDT_BNT":{"id":234,"baseID":214,"quoteID":305,"base":"USDT","quote":"BNT","currencyPair":"USDT_BNT"},"USDT_MANA":{"id":231,"baseID":214,"quoteID":306,"base":"USDT","quote":"MANA","currencyPair":"USDT_MANA"},"XMR_BCN":{"id":129,"baseID":240,"quoteID":17,"base":"XMR","quote":"BCN","currencyPair":"XMR_BCN"},"XMR_DASH":{"id":132,"baseID":240,"quoteID":60,"base":"XMR","quote":"DASH","currencyPair":"XMR_DASH"},"XMR_LTC":{"id":137,"baseID":240,"quoteID":125,"base":"XMR","quote":"LTC","currencyPair":"XMR_LTC"},"XMR_MAID":{"id":138,"baseID":240,"quoteID":127,"base":"XMR","quote":"MAID","currencyPair":"XMR_MAID"},"XMR_NXT":{"id":140,"baseID":240,"quoteID":162,"base":"XMR","quote":"NXT","currencyPair":"XMR_NXT"},"XMR_ZEC":{"id":181,"baseID":240,"quoteID":286,"base":"XMR","quote":"ZEC","currencyPair":"XMR_ZEC"},"ETH_LSK":{"id":166,"baseID":267,"quoteID":278,"base":"ETH","quote":"LSK","currencyPair":"ETH_LSK"},"ETH_STEEM":{"id":169,"baseID":267,"quoteID":281,"base":"ETH","quote":"STEEM","currencyPair":"ETH_STEEM"},"ETH_ETC":{"id":172,"baseID":267,"quoteID":283,"base":"ETH","quote":"ETC","currencyPair":"ETH_ETC"},"ETH_REP":{"id":176,"baseID":267,"quoteID":284,"base":"ETH","quote":"REP","currencyPair":"ETH_REP"},"ETH_ZEC":{"id":179,"baseID":267,"quoteID":286,"base":"ETH","quote":"ZEC","currencyPair":"ETH_ZEC"},"ETH_GNT":{"id":186,"baseID":267,"quoteID":290,"base":"ETH","quote":"GNT","currencyPair":"ETH_GNT"},"ETH_BCH":{"id":190,"baseID":267,"quoteID":292,"base":"ETH","quote":"BCH","currencyPair":"ETH_BCH"},"ETH_ZRX":{"id":193,"baseID":267,"quoteID":293,"base":"ETH","quote":"ZRX","currencyPair":"ETH_ZRX"},"ETH_CVC":{"id":195,"baseID":267,"quoteID":294,"base":"ETH","quote":"CVC","currencyPair":"ETH_CVC"},"ETH_OMG":{"id":197,"baseID":267,"quoteID":295,"base":"ETH","quote":"OMG","currencyPair":"ETH_OMG"},"ETH_GAS":{"id":199,"baseID":267,"quoteID":296,"base":"ETH","quote":"GAS","currencyPair":"ETH_GAS"},"ETH_EOS":{"id":202,"baseID":267,"quoteID":298,"base":"ETH","quote":"EOS","currencyPair":"ETH_EOS"},"ETH_SNT":{"id":205,"baseID":267,"quoteID":300,"base":"ETH","quote":"SNT","currencyPair":"ETH_SNT"},"ETH_KNC":{"id":208,"baseID":267,"quoteID":301,"base":"ETH","quote":"KNC","currencyPair":"ETH_KNC"},"ETH_BAT":{"id":211,"baseID":267,"quoteID":302,"base":"ETH","quote":"BAT","currencyPair":"ETH_BAT"},"ETH_LOOM":{"id":214,"baseID":267,"quoteID":303,"base":"ETH","quote":"LOOM","currencyPair":"ETH_LOOM"},"ETH_QTUM":{"id":222,"baseID":267,"quoteID":304,"base":"ETH","quote":"QTUM","currencyPair":"ETH_QTUM"},"ETH_BNT":{"id":233,"baseID":267,"quoteID":305,"base":"ETH","quote":"BNT","currencyPair":"ETH_BNT"},"ETH_MANA":{"id":230,"baseID":267,"quoteID":306,"base":"ETH","quote":"MANA","currencyPair":"ETH_MANA"},"USDC_BTC":{"id":224,"baseID":299,"quoteID":28,"base":"USDC","quote":"BTC","currencyPair":"USDC_BTC"},"USDC_DOGE":{"id":243,"baseID":299,"quoteID":59,"base":"USDC","quote":"DOGE","currencyPair":"USDC_DOGE"},"USDC_LTC":{"id":244,"baseID":299,"quoteID":125,"base":"USDC","quote":"LTC","currencyPair":"USDC_LTC"},"USDC_STR":{"id":242,"baseID":299,"quoteID":198,"base":"USDC","quote":"STR","currencyPair":"USDC_STR"},"USDC_USDT":{"id":226,"baseID":299,"quoteID":214,"base":"USDC","quote":"USDT","currencyPair":"USDC_USDT"},"USDC_XMR":{"id":241,"baseID":299,"quoteID":240,"base":"USDC","quote":"XMR","currencyPair":"USDC_XMR"},"USDC_XRP":{"id":240,"baseID":299,"quoteID":243,"base":"USDC","quote":"XRP","currencyPair":"USDC_XRP"},"USDC_ETH":{"id":225,"baseID":299,"quoteID":267,"base":"USDC","quote":"ETH","currencyPair":"USDC_ETH"},"USDC_ZEC":{"id":245,"baseID":299,"quoteID":286,"base":"USDC","quote":"ZEC","currencyPair":"USDC_ZEC"},"USDC_BCH":{"id":235,"baseID":299,"quoteID":292,"base":"USDC","quote":"BCH","currencyPair":"USDC_BCH"},"USDC_FOAM":{"id":247,"baseID":299,"quoteID":307,"base":"USDC","quote":"FOAM","currencyPair":"USDC_FOAM"},"USDC_BCHABC":{"id":237,"baseID":299,"quoteID":308,"base":"USDC","quote":"BCHABC","currencyPair":"USDC_BCHABC"},"USDC_BCHSV":{"id":239,"baseID":299,"quoteID":309,"base":"USDC","quote":"BCHSV","currencyPair":"USDC_BCHSV"}},"byID":{"7":{"id":7,"baseID":28,"quoteID":17,"base":"BTC","quote":"BCN","currencyPair":"BTC_BCN"},"14":{"id":14,"baseID":28,"quoteID":32,"base":"BTC","quote":"BTS","currencyPair":"BTC_BTS"},"15":{"id":15,"baseID":28,"quoteID":34,"base":"BTC","quote":"BURST","currencyPair":"BTC_BURST"},"20":{"id":20,"baseID":28,"quoteID":43,"base":"BTC","quote":"CLAM","currencyPair":"BTC_CLAM"},"25":{"id":25,"baseID":28,"quoteID":53,"base":"BTC","quote":"DGB","currencyPair":"BTC_DGB"},"27":{"id":27,"baseID":28,"quoteID":59,"base":"BTC","quote":"DOGE","currencyPair":"BTC_DOGE"},"24":{"id":24,"baseID":28,"quoteID":60,"base":"BTC","quote":"DASH","currencyPair":"BTC_DASH"},"38":{"id":38,"baseID":28,"quoteID":93,"base":"BTC","quote":"GAME","currencyPair":"BTC_GAME"},"43":{"id":43,"baseID":28,"quoteID":105,"base":"BTC","quote":"HUC","currencyPair":"BTC_HUC"},"50":{"id":50,"baseID":28,"quoteID":125,"base":"BTC","quote":"LTC","currencyPair":"BTC_LTC"},"51":{"id":51,"baseID":28,"quoteID":127,"base":"BTC","quote":"MAID","currencyPair":"BTC_MAID"},"58":{"id":58,"baseID":28,"quoteID":143,"base":"BTC","quote":"OMNI","currencyPair":"BTC_OMNI"},"61":{"id":61,"baseID":28,"quoteID":151,"base":"BTC","quote":"NAV","currencyPair":"BTC_NAV"},"64":{"id":64,"baseID":28,"quoteID":155,"base":"BTC","quote":"NMC","currencyPair":"BTC_NMC"},"69":{"id":69,"baseID":28,"quoteID":162,"base":"BTC","quote":"NXT","currencyPair":"BTC_NXT"},"75":{"id":75,"baseID":28,"quoteID":172,"base":"BTC","quote":"PPC","currencyPair":"BTC_PPC"},"89":{"id":89,"baseID":28,"quoteID":198,"base":"BTC","quote":"STR","currencyPair":"BTC_STR"},"92":{"id":92,"baseID":28,"quoteID":204,"base":"BTC","quote":"SYS","currencyPair":"BTC_SYS"},"97":{"id":97,"baseID":28,"quoteID":218,"base":"BTC","quote":"VIA","currencyPair":"BTC_VIA"},"100":{"id":100,"baseID":28,"quoteID":221,"base":"BTC","quote":"VTC","currencyPair":"BTC_VTC"},"108":{"id":108,"baseID":28,"quoteID":233,"base":"BTC","quote":"XCP","currencyPair":"BTC_XCP"},"114":{"id":114,"baseID":28,"quoteID":240,"base":"BTC","quote":"XMR","currencyPair":"BTC_XMR"},"116":{"id":116,"baseID":28,"quoteID":242,"base":"BTC","quote":"XPM","currencyPair":"BTC_XPM"},"117":{"id":117,"baseID":28,"quoteID":243,"base":"BTC","quote":"XRP","currencyPair":"BTC_XRP"},"112":{"id":112,"baseID":28,"quoteID":256,"base":"BTC","quote":"XEM","currencyPair":"BTC_XEM"},"148":{"id":148,"baseID":28,"quoteID":267,"base":"BTC","quote":"ETH","currencyPair":"BTC_ETH"},"150":{"id":150,"baseID":28,"quoteID":268,"base":"BTC","quote":"SC","currencyPair":"BTC_SC"},"155":{"id":155,"baseID":28,"quoteID":271,"base":"BTC","quote":"FCT","currencyPair":"BTC_FCT"},"162":{"id":162,"baseID":28,"quoteID":277,"base":"BTC","quote":"DCR","currencyPair":"BTC_DCR"},"163":{"id":163,"baseID":28,"quoteID":278,"base":"BTC","quote":"LSK","currencyPair":"BTC_LSK"},"167":{"id":167,"baseID":28,"quoteID":280,"base":"BTC","quote":"LBC","currencyPair":"BTC_LBC"},"168":{"id":168,"baseID":28,"quoteID":281,"base":"BTC","quote":"STEEM","currencyPair":"BTC_STEEM"},"170":{"id":170,"baseID":28,"quoteID":282,"base":"BTC","quote":"SBD","currencyPair":"BTC_SBD"},"171":{"id":171,"baseID":28,"quoteID":283,"base":"BTC","quote":"ETC","currencyPair":"BTC_ETC"},"174":{"id":174,"baseID":28,"quoteID":284,"base":"BTC","quote":"REP","currencyPair":"BTC_REP"},"177":{"id":177,"baseID":28,"quoteID":285,"base":"BTC","quote":"ARDR","currencyPair":"BTC_ARDR"},"178":{"id":178,"baseID":28,"quoteID":286,"base":"BTC","quote":"ZEC","currencyPair":"BTC_ZEC"},"182":{"id":182,"baseID":28,"quoteID":287,"base":"BTC","quote":"STRAT","currencyPair":"BTC_STRAT"},"184":{"id":184,"baseID":28,"quoteID":289,"base":"BTC","quote":"PASC","currencyPair":"BTC_PASC"},"185":{"id":185,"baseID":28,"quoteID":290,"base":"BTC","quote":"GNT","currencyPair":"BTC_GNT"},"189":{"id":189,"baseID":28,"quoteID":292,"base":"BTC","quote":"BCH","currencyPair":"BTC_BCH"},"192":{"id":192,"baseID":28,"quoteID":293,"base":"BTC","quote":"ZRX","currencyPair":"BTC_ZRX"},"194":{"id":194,"baseID":28,"quoteID":294,"base":"BTC","quote":"CVC","currencyPair":"BTC_CVC"},"196":{"id":196,"baseID":28,"quoteID":295,"base":"BTC","quote":"OMG","currencyPair":"BTC_OMG"},"198":{"id":198,"baseID":28,"quoteID":296,"base":"BTC","quote":"GAS","currencyPair":"BTC_GAS"},"200":{"id":200,"baseID":28,"quoteID":297,"base":"BTC","quote":"STORJ","currencyPair":"BTC_STORJ"},"201":{"id":201,"baseID":28,"quoteID":298,"base":"BTC","quote":"EOS","currencyPair":"BTC_EOS"},"204":{"id":204,"baseID":28,"quoteID":300,"base":"BTC","quote":"SNT","currencyPair":"BTC_SNT"},"207":{"id":207,"baseID":28,"quoteID":301,"base":"BTC","quote":"KNC","currencyPair":"BTC_KNC"},"210":{"id":210,"baseID":28,"quoteID":302,"base":"BTC","quote":"BAT","currencyPair":"BTC_BAT"},"213":{"id":213,"baseID":28,"quoteID":303,"base":"BTC","quote":"LOOM","currencyPair":"BTC_LOOM"},"221":{"id":221,"baseID":28,"quoteID":304,"base":"BTC","quote":"QTUM","currencyPair":"BTC_QTUM"},"232":{"id":232,"baseID":28,"quoteID":305,"base":"BTC","quote":"BNT","currencyPair":"BTC_BNT"},"229":{"id":229,"baseID":28,"quoteID":306,"base":"BTC","quote":"MANA","currencyPair":"BTC_MANA"},"246":{"id":246,"baseID":28,"quoteID":307,"base":"BTC","quote":"FOAM","currencyPair":"BTC_FOAM"},"236":{"id":236,"baseID":28,"quoteID":308,"base":"BTC","quote":"BCHABC","currencyPair":"BTC_BCHABC"},"238":{"id":238,"baseID":28,"quoteID":309,"base":"BTC","quote":"BCHSV","currencyPair":"BTC_BCHSV"},"248":{"id":248,"baseID":28,"quoteID":310,"base":"BTC","quote":"NMR","currencyPair":"BTC_NMR"},"249":{"id":249,"baseID":28,"quoteID":311,"base":"BTC","quote":"POLY","currencyPair":"BTC_POLY"},"250":{"id":250,"baseID":28,"quoteID":312,"base":"BTC","quote":"LPT","currencyPair":"BTC_LPT"},"121":{"id":121,"baseID":214,"quoteID":28,"base":"USDT","quote":"BTC","currencyPair":"USDT_BTC"},"216":{"id":216,"baseID":214,"quoteID":59,"base":"USDT","quote":"DOGE","currencyPair":"USDT_DOGE"},"122":{"id":122,"baseID":214,"quoteID":60,"base":"USDT","quote":"DASH","currencyPair":"USDT_DASH"},"123":{"id":123,"baseID":214,"quoteID":125,"base":"USDT","quote":"LTC","currencyPair":"USDT_LTC"},"124":{"id":124,"baseID":214,"quoteID":162,"base":"USDT","quote":"NXT","currencyPair":"USDT_NXT"},"125":{"id":125,"baseID":214,"quoteID":198,"base":"USDT","quote":"STR","currencyPair":"USDT_STR"},"126":{"id":126,"baseID":214,"quoteID":240,"base":"USDT","quote":"XMR","currencyPair":"USDT_XMR"},"127":{"id":127,"baseID":214,"quoteID":243,"base":"USDT","quote":"XRP","currencyPair":"USDT_XRP"},"149":{"id":149,"baseID":214,"quoteID":267,"base":"USDT","quote":"ETH","currencyPair":"USDT_ETH"},"219":{"id":219,"baseID":214,"quoteID":268,"base":"USDT","quote":"SC","currencyPair":"USDT_SC"},"218":{"id":218,"baseID":214,"quoteID":278,"base":"USDT","quote":"LSK","currencyPair":"USDT_LSK"},"173":{"id":173,"baseID":214,"quoteID":283,"base":"USDT","quote":"ETC","currencyPair":"USDT_ETC"},"175":{"id":175,"baseID":214,"quoteID":284,"base":"USDT","quote":"REP","currencyPair":"USDT_REP"},"180":{"id":180,"baseID":214,"quoteID":286,"base":"USDT","quote":"ZEC","currencyPair":"USDT_ZEC"},"217":{"id":217,"baseID":214,"quoteID":290,"base":"USDT","quote":"GNT","currencyPair":"USDT_GNT"},"191":{"id":191,"baseID":214,"quoteID":292,"base":"USDT","quote":"BCH","currencyPair":"USDT_BCH"},"220":{"id":220,"baseID":214,"quoteID":293,"base":"USDT","quote":"ZRX","currencyPair":"USDT_ZRX"},"203":{"id":203,"baseID":214,"quoteID":298,"base":"USDT","quote":"EOS","currencyPair":"USDT_EOS"},"206":{"id":206,"baseID":214,"quoteID":300,"base":"USDT","quote":"SNT","currencyPair":"USDT_SNT"},"209":{"id":209,"baseID":214,"quoteID":301,"base":"USDT","quote":"KNC","currencyPair":"USDT_KNC"},"212":{"id":212,"baseID":214,"quoteID":302,"base":"USDT","quote":"BAT","currencyPair":"USDT_BAT"},"215":{"id":215,"baseID":214,"quoteID":303,"base":"USDT","quote":"LOOM","currencyPair":"USDT_LOOM"},"223":{"id":223,"baseID":214,"quoteID":304,"base":"USDT","quote":"QTUM","currencyPair":"USDT_QTUM"},"234":{"id":234,"baseID":214,"quoteID":305,"base":"USDT","quote":"BNT","currencyPair":"USDT_BNT"},"231":{"id":231,"baseID":214,"quoteID":306,"base":"USDT","quote":"MANA","currencyPair":"USDT_MANA"},"129":{"id":129,"baseID":240,"quoteID":17,"base":"XMR","quote":"BCN","currencyPair":"XMR_BCN"},"132":{"id":132,"baseID":240,"quoteID":60,"base":"XMR","quote":"DASH","currencyPair":"XMR_DASH"},"137":{"id":137,"baseID":240,"quoteID":125,"base":"XMR","quote":"LTC","currencyPair":"XMR_LTC"},"138":{"id":138,"baseID":240,"quoteID":127,"base":"XMR","quote":"MAID","currencyPair":"XMR_MAID"},"140":{"id":140,"baseID":240,"quoteID":162,"base":"XMR","quote":"NXT","currencyPair":"XMR_NXT"},"181":{"id":181,"baseID":240,"quoteID":286,"base":"XMR","quote":"ZEC","currencyPair":"XMR_ZEC"},"166":{"id":166,"baseID":267,"quoteID":278,"base":"ETH","quote":"LSK","currencyPair":"ETH_LSK"},"169":{"id":169,"baseID":267,"quoteID":281,"base":"ETH","quote":"STEEM","currencyPair":"ETH_STEEM"},"172":{"id":172,"baseID":267,"quoteID":283,"base":"ETH","quote":"ETC","currencyPair":"ETH_ETC"},"176":{"id":176,"baseID":267,"quoteID":284,"base":"ETH","quote":"REP","currencyPair":"ETH_REP"},"179":{"id":179,"baseID":267,"quoteID":286,"base":"ETH","quote":"ZEC","currencyPair":"ETH_ZEC"},"186":{"id":186,"baseID":267,"quoteID":290,"base":"ETH","quote":"GNT","currencyPair":"ETH_GNT"},"190":{"id":190,"baseID":267,"quoteID":292,"base":"ETH","quote":"BCH","currencyPair":"ETH_BCH"},"193":{"id":193,"baseID":267,"quoteID":293,"base":"ETH","quote":"ZRX","currencyPair":"ETH_ZRX"},"195":{"id":195,"baseID":267,"quoteID":294,"base":"ETH","quote":"CVC","currencyPair":"ETH_CVC"},"197":{"id":197,"baseID":267,"quoteID":295,"base":"ETH","quote":"OMG","currencyPair":"ETH_OMG"},"199":{"id":199,"baseID":267,"quoteID":296,"base":"ETH","quote":"GAS","currencyPair":"ETH_GAS"},"202":{"id":202,"baseID":267,"quoteID":298,"base":"ETH","quote":"EOS","currencyPair":"ETH_EOS"},"205":{"id":205,"baseID":267,"quoteID":300,"base":"ETH","quote":"SNT","currencyPair":"ETH_SNT"},"208":{"id":208,"baseID":267,"quoteID":301,"base":"ETH","quote":"KNC","currencyPair":"ETH_KNC"},"211":{"id":211,"baseID":267,"quoteID":302,"base":"ETH","quote":"BAT","currencyPair":"ETH_BAT"},"214":{"id":214,"baseID":267,"quoteID":303,"base":"ETH","quote":"LOOM","currencyPair":"ETH_LOOM"},"222":{"id":222,"baseID":267,"quoteID":304,"base":"ETH","quote":"QTUM","currencyPair":"ETH_QTUM"},"233":{"id":233,"baseID":267,"quoteID":305,"base":"ETH","quote":"BNT","currencyPair":"ETH_BNT"},"230":{"id":230,"baseID":267,"quoteID":306,"base":"ETH","quote":"MANA","currencyPair":"ETH_MANA"},"224":{"id":224,"baseID":299,"quoteID":28,"base":"USDC","quote":"BTC","currencyPair":"USDC_BTC"},"243":{"id":243,"baseID":299,"quoteID":59,"base":"USDC","quote":"DOGE","currencyPair":"USDC_DOGE"},"244":{"id":244,"baseID":299,"quoteID":125,"base":"USDC","quote":"LTC","currencyPair":"USDC_LTC"},"242":{"id":242,"baseID":299,"quoteID":198,"base":"USDC","quote":"STR","currencyPair":"USDC_STR"},"226":{"id":226,"baseID":299,"quoteID":214,"base":"USDC","quote":"USDT","currencyPair":"USDC_USDT"},"241":{"id":241,"baseID":299,"quoteID":240,"base":"USDC","quote":"XMR","currencyPair":"USDC_XMR"},"240":{"id":240,"baseID":299,"quoteID":243,"base":"USDC","quote":"XRP","currencyPair":"USDC_XRP"},"225":{"id":225,"baseID":299,"quoteID":267,"base":"USDC","quote":"ETH","currencyPair":"USDC_ETH"},"245":{"id":245,"baseID":299,"quoteID":286,"base":"USDC","quote":"ZEC","currencyPair":"USDC_ZEC"},"235":{"id":235,"baseID":299,"quoteID":292,"base":"USDC","quote":"BCH","currencyPair":"USDC_BCH"},"247":{"id":247,"baseID":299,"quoteID":307,"base":"USDC","quote":"FOAM","currencyPair":"USDC_FOAM"},"237":{"id":237,"baseID":299,"quoteID":308,"base":"USDC","quote":"BCHABC","currencyPair":"USDC_BCHABC"},"239":{"id":239,"baseID":299,"quoteID":309,"base":"USDC","quote":"BCHSV","currencyPair":"USDC_BCHSV"}}};
const markets_currencies = {"bySymbol":{"1CR":{"id":1,"symbol":"1CR","name":"1CRedit","canLend":0},"ABY":{"id":2,"symbol":"ABY","name":"ArtByte","canLend":0},"AC":{"id":3,"symbol":"AC","name":"AsiaCoin","canLend":0},"ACH":{"id":4,"symbol":"ACH","name":"Altcoin Herald","canLend":0},"ADN":{"id":5,"symbol":"ADN","name":"Aiden","canLend":0},"AEON":{"id":6,"symbol":"AEON","name":"AEON Coin","canLend":0},"AERO":{"id":7,"symbol":"AERO","name":"Aerocoin","canLend":0},"AIR":{"id":8,"symbol":"AIR","name":"AIRcoin","canLend":0},"APH":{"id":9,"symbol":"APH","name":"AphroditeCoin","canLend":0},"AUR":{"id":10,"symbol":"AUR","name":"Auroracoin","canLend":0},"AXIS":{"id":11,"symbol":"AXIS","name":"Axis","canLend":0},"BALLS":{"id":12,"symbol":"BALLS","name":"Snowballs","canLend":0},"BANK":{"id":13,"symbol":"BANK","name":"BankCoin","canLend":0},"BBL":{"id":14,"symbol":"BBL","name":"BitBlock","canLend":0},"BBR":{"id":15,"symbol":"BBR","name":"Boolberry","canLend":0},"BCC":{"id":16,"symbol":"BCC","name":"BTCtalkcoin","canLend":0},"BCN":{"id":17,"symbol":"BCN","name":"Bytecoin","canLend":0},"BDC":{"id":18,"symbol":"BDC","name":"Black Dragon Coin","canLend":0},"BDG":{"id":19,"symbol":"BDG","name":"Badgercoin","canLend":0},"BELA":{"id":20,"symbol":"BELA","name":"Bela Legacy","canLend":0},"BITS":{"id":21,"symbol":"BITS","name":"Bitstar","canLend":0},"BLK":{"id":22,"symbol":"BLK","name":"BlackCoin","canLend":0},"BLOCK":{"id":23,"symbol":"BLOCK","name":"Blocknet","canLend":0},"BLU":{"id":24,"symbol":"BLU","name":"BlueCoin","canLend":0},"BNS":{"id":25,"symbol":"BNS","name":"BonusCoin","canLend":0},"BONES":{"id":26,"symbol":"BONES","name":"Bones","canLend":0},"BOST":{"id":27,"symbol":"BOST","name":"BoostCoin","canLend":0},"BTC":{"id":28,"symbol":"BTC","name":"Bitcoin","canLend":1},"BTCD":{"id":29,"symbol":"BTCD","name":"BitcoinDark","canLend":0},"BTCS":{"id":30,"symbol":"BTCS","name":"Bitcoin-sCrypt","canLend":0},"BTM":{"id":31,"symbol":"BTM","name":"Bitmark","canLend":0},"BTS":{"id":32,"symbol":"BTS","name":"BitShares","canLend":1},"BURN":{"id":33,"symbol":"BURN","name":"BurnerCoin","canLend":0},"BURST":{"id":34,"symbol":"BURST","name":"Burst","canLend":0},"C2":{"id":35,"symbol":"C2","name":"Coin2.0","canLend":0},"CACH":{"id":36,"symbol":"CACH","name":"CACHeCoin","canLend":0},"CAI":{"id":37,"symbol":"CAI","name":"CaiShen","canLend":0},"CC":{"id":38,"symbol":"CC","name":"Colbert Coin","canLend":0},"CCN":{"id":39,"symbol":"CCN","name":"Cannacoin","canLend":0},"CGA":{"id":40,"symbol":"CGA","name":"Cryptographic Anomaly","canLend":0},"CHA":{"id":41,"symbol":"CHA","name":"Chancecoin","canLend":0},"CINNI":{"id":42,"symbol":"CINNI","name":"CinniCoin","canLend":0},"CLAM":{"id":43,"symbol":"CLAM","name":"CLAMS","canLend":1},"CNL":{"id":44,"symbol":"CNL","name":"ConcealCoin","canLend":0},"CNMT":{"id":45,"symbol":"CNMT","name":"Coinomat1","canLend":0},"CNOTE":{"id":46,"symbol":"CNOTE","name":"C-Note","canLend":0},"COMM":{"id":47,"symbol":"COMM","name":"CommunityCoin","canLend":0},"CON":{"id":48,"symbol":"CON","name":"Coino","canLend":0},"CORG":{"id":49,"symbol":"CORG","name":"CorgiCoin","canLend":0},"CRYPT":{"id":50,"symbol":"CRYPT","name":"CryptCoin","canLend":0},"CURE":{"id":51,"symbol":"CURE","name":"Curecoin","canLend":0},"CYC":{"id":52,"symbol":"CYC","name":"Conspiracy Coin","canLend":0},"DGB":{"id":53,"symbol":"DGB","name":"DigiByte","canLend":0},"DICE":{"id":54,"symbol":"DICE","name":"NeoDICE","canLend":0},"DIEM":{"id":55,"symbol":"DIEM","name":"Diem","canLend":0},"DIME":{"id":56,"symbol":"DIME","name":"Dimecoin","canLend":0},"DIS":{"id":57,"symbol":"DIS","name":"DistroCoin","canLend":0},"DNS":{"id":58,"symbol":"DNS","name":"BitShares DNS","canLend":0},"DOGE":{"id":59,"symbol":"DOGE","name":"Dogecoin","canLend":1},"DASH":{"id":60,"symbol":"DASH","name":"Dash","canLend":1},"DRKC":{"id":61,"symbol":"DRKC","name":"DarkCash","canLend":0},"DRM":{"id":62,"symbol":"DRM","name":"Dreamcoin","canLend":0},"DSH":{"id":63,"symbol":"DSH","name":"Dashcoin","canLend":0},"DVK":{"id":64,"symbol":"DVK","name":"DvoraKoin","canLend":0},"EAC":{"id":65,"symbol":"EAC","name":"EarthCoin","canLend":0},"EBT":{"id":66,"symbol":"EBT","name":"EBTcoin","canLend":0},"ECC":{"id":67,"symbol":"ECC","name":"ECCoin","canLend":0},"EFL":{"id":68,"symbol":"EFL","name":"Electronic Gulden","canLend":0},"EMC2":{"id":69,"symbol":"EMC2","name":"Einsteinium","canLend":0},"EMO":{"id":70,"symbol":"EMO","name":"EmotiCoin","canLend":0},"ENC":{"id":71,"symbol":"ENC","name":"Entropycoin","canLend":0},"eTOK":{"id":72,"symbol":"eTOK","name":"eToken","canLend":0},"EXE":{"id":73,"symbol":"EXE","name":"Execoin","canLend":0},"FAC":{"id":74,"symbol":"FAC","name":"Faircoin","canLend":0},"FCN":{"id":75,"symbol":"FCN","name":"Fantomcoin","canLend":0},"FIBRE":{"id":76,"symbol":"FIBRE","name":"Fibrecoin","canLend":0},"FLAP":{"id":77,"symbol":"FLAP","name":"FlappyCoin","canLend":0},"FLDC":{"id":78,"symbol":"FLDC","name":"FoldingCoin","canLend":0},"FLT":{"id":79,"symbol":"FLT","name":"FlutterCoin","canLend":0},"FOX":{"id":80,"symbol":"FOX","name":"FoxCoin","canLend":0},"FRAC":{"id":81,"symbol":"FRAC","name":"Fractalcoin","canLend":0},"FRK":{"id":82,"symbol":"FRK","name":"Franko","canLend":0},"FRQ":{"id":83,"symbol":"FRQ","name":"FairQuark","canLend":0},"FVZ":{"id":84,"symbol":"FVZ","name":"FVZCoin","canLend":0},"FZ":{"id":85,"symbol":"FZ","name":"Frozen","canLend":0},"FZN":{"id":86,"symbol":"FZN","name":"Fuzon","canLend":0},"GAP":{"id":87,"symbol":"GAP","name":"Gapcoin","canLend":0},"GDN":{"id":88,"symbol":"GDN","name":"Global Denomination","canLend":0},"GEMZ":{"id":89,"symbol":"GEMZ","name":"GetGems","canLend":0},"GEO":{"id":90,"symbol":"GEO","name":"GeoCoin","canLend":0},"GIAR":{"id":91,"symbol":"GIAR","name":"Giarcoin","canLend":0},"GLB":{"id":92,"symbol":"GLB","name":"Globe","canLend":0},"GAME":{"id":93,"symbol":"GAME","name":"GameCredits","canLend":0},"GML":{"id":94,"symbol":"GML","name":"GameleagueCoin","canLend":0},"GNS":{"id":95,"symbol":"GNS","name":"GenesisCoin","canLend":0},"GOLD":{"id":96,"symbol":"GOLD","name":"GoldEagles","canLend":0},"GPC":{"id":97,"symbol":"GPC","name":"GROUPCoin","canLend":0},"GPUC":{"id":98,"symbol":"GPUC","name":"GPU Coin","canLend":0},"GRCX":{"id":99,"symbol":"GRCX","name":"Gridcoin","canLend":0},"GRS":{"id":100,"symbol":"GRS","name":"Groestlcoin","canLend":0},"GUE":{"id":101,"symbol":"GUE","name":"Guerillacoin","canLend":0},"H2O":{"id":102,"symbol":"H2O","name":"H2O Coin","canLend":0},"HIRO":{"id":103,"symbol":"HIRO","name":"Hirocoin","canLend":0},"HOT":{"id":104,"symbol":"HOT","name":"Hotcoin","canLend":0},"HUC":{"id":105,"symbol":"HUC","name":"Huntercoin","canLend":0},"HVC":{"id":106,"symbol":"HVC","name":"Heavycoin","canLend":0},"HYP":{"id":107,"symbol":"HYP","name":"HyperStake","canLend":0},"HZ":{"id":108,"symbol":"HZ","name":"Horizon","canLend":0},"IFC":{"id":109,"symbol":"IFC","name":"Infinitecoin","canLend":0},"ITC":{"id":110,"symbol":"ITC","name":"Information Coin","canLend":0},"IXC":{"id":111,"symbol":"IXC","name":"iXcoin","canLend":0},"JLH":{"id":112,"symbol":"JLH","name":"jl777hodl","canLend":0},"JPC":{"id":113,"symbol":"JPC","name":"JackpotCoin","canLend":0},"JUG":{"id":114,"symbol":"JUG","name":"JuggaloCoin","canLend":0},"KDC":{"id":115,"symbol":"KDC","name":"KlondikeCoin","canLend":0},"KEY":{"id":116,"symbol":"KEY","name":"KeyCoin","canLend":0},"LC":{"id":117,"symbol":"LC","name":"Limecoin","canLend":0},"LCL":{"id":118,"symbol":"LCL","name":"Limecoin Lite","canLend":0},"LEAF":{"id":119,"symbol":"LEAF","name":"Leafcoin","canLend":0},"LGC":{"id":120,"symbol":"LGC","name":"Logicoin","canLend":0},"LOL":{"id":121,"symbol":"LOL","name":"LeagueCoin","canLend":0},"LOVE":{"id":122,"symbol":"LOVE","name":"LOVEcoin","canLend":0},"LQD":{"id":123,"symbol":"LQD","name":"LIQUID","canLend":0},"LTBC":{"id":124,"symbol":"LTBC","name":"LTBCoin","canLend":0},"LTC":{"id":125,"symbol":"LTC","name":"Litecoin","canLend":1},"LTCX":{"id":126,"symbol":"LTCX","name":"LiteCoinX","canLend":0},"MAID":{"id":127,"symbol":"MAID","name":"MaidSafeCoin","canLend":1},"MAST":{"id":128,"symbol":"MAST","name":"MastiffCoin","canLend":0},"MAX":{"id":129,"symbol":"MAX","name":"MaxCoin","canLend":0},"MCN":{"id":130,"symbol":"MCN","name":"Moneta Verde","canLend":0},"MEC":{"id":131,"symbol":"MEC","name":"Megacoin","canLend":0},"METH":{"id":132,"symbol":"METH","name":"CryptoMETH","canLend":0},"MIL":{"id":133,"symbol":"MIL","name":"Millennium Coin","canLend":0},"MIN":{"id":134,"symbol":"MIN","name":"Minerals","canLend":0},"MINT":{"id":135,"symbol":"MINT","name":"Mintcoin","canLend":0},"MMC":{"id":136,"symbol":"MMC","name":"MemoryCoin","canLend":0},"MMNXT":{"id":137,"symbol":"MMNXT","name":"MMNXT","canLend":0},"MMXIV":{"id":138,"symbol":"MMXIV","name":"Maieuticoin","canLend":0},"MNTA":{"id":139,"symbol":"MNTA","name":"Moneta","canLend":0},"MON":{"id":140,"symbol":"MON","name":"Monocle","canLend":0},"MRC":{"id":141,"symbol":"MRC","name":"microCoin","canLend":0},"MRS":{"id":142,"symbol":"MRS","name":"Marscoin","canLend":0},"OMNI":{"id":143,"symbol":"OMNI","name":"Omni","canLend":0},"MTS":{"id":144,"symbol":"MTS","name":"Metiscoin","canLend":0},"MUN":{"id":145,"symbol":"MUN","name":"Muniti","canLend":0},"MYR":{"id":146,"symbol":"MYR","name":"Myriadcoin","canLend":0},"MZC":{"id":147,"symbol":"MZC","name":"MazaCoin","canLend":0},"N5X":{"id":148,"symbol":"N5X","name":"N5coin","canLend":0},"NAS":{"id":149,"symbol":"NAS","name":"NAS","canLend":0},"NAUT":{"id":150,"symbol":"NAUT","name":"Nautiluscoin","canLend":0},"NAV":{"id":151,"symbol":"NAV","name":"NAVCoin","canLend":0},"NBT":{"id":152,"symbol":"NBT","name":"NuBits","canLend":0},"NEOS":{"id":153,"symbol":"NEOS","name":"Neoscoin","canLend":0},"NL":{"id":154,"symbol":"NL","name":"Nanolite","canLend":0},"NMC":{"id":155,"symbol":"NMC","name":"Namecoin","canLend":0},"NOBL":{"id":156,"symbol":"NOBL","name":"NobleCoin","canLend":0},"NOTE":{"id":157,"symbol":"NOTE","name":"DNotes","canLend":0},"NOXT":{"id":158,"symbol":"NOXT","name":"NobleNXT","canLend":0},"NRS":{"id":159,"symbol":"NRS","name":"NoirShares","canLend":0},"NSR":{"id":160,"symbol":"NSR","name":"NuShares","canLend":0},"NTX":{"id":161,"symbol":"NTX","name":"NTX","canLend":0},"NXT":{"id":162,"symbol":"NXT","name":"NXT","canLend":0},"NXTI":{"id":163,"symbol":"NXTI","name":"NXTInspect","canLend":0},"OPAL":{"id":164,"symbol":"OPAL","name":"Opal","canLend":0},"PAND":{"id":165,"symbol":"PAND","name":"PandaCoin","canLend":0},"PAWN":{"id":166,"symbol":"PAWN","name":"Pawncoin","canLend":0},"PIGGY":{"id":167,"symbol":"PIGGY","name":"New Piggycoin","canLend":0},"PINK":{"id":168,"symbol":"PINK","name":"Pinkcoin","canLend":0},"PLX":{"id":169,"symbol":"PLX","name":"ParallaxCoin","canLend":0},"PMC":{"id":170,"symbol":"PMC","name":"Premine","canLend":0},"POT":{"id":171,"symbol":"POT","name":"PotCoin","canLend":0},"PPC":{"id":172,"symbol":"PPC","name":"Peercoin","canLend":0},"PRC":{"id":173,"symbol":"PRC","name":"ProsperCoin","canLend":0},"PRT":{"id":174,"symbol":"PRT","name":"Particle","canLend":0},"PTS":{"id":175,"symbol":"PTS","name":"BitShares PTS","canLend":0},"Q2C":{"id":176,"symbol":"Q2C","name":"QubitCoin","canLend":0},"QBK":{"id":177,"symbol":"QBK","name":"Qibuck","canLend":0},"QCN":{"id":178,"symbol":"QCN","name":"QuazarCoin","canLend":0},"QORA":{"id":179,"symbol":"QORA","name":"Qora","canLend":0},"QTL":{"id":180,"symbol":"QTL","name":"Quatloo","canLend":0},"RBY":{"id":181,"symbol":"RBY","name":"Rubycoin","canLend":0},"RDD":{"id":182,"symbol":"RDD","name":"Reddcoin","canLend":0},"RIC":{"id":183,"symbol":"RIC","name":"Riecoin","canLend":0},"RZR":{"id":184,"symbol":"RZR","name":"Razor","canLend":0},"SDC":{"id":185,"symbol":"SDC","name":"Shadow","canLend":0},"SHIBE":{"id":186,"symbol":"SHIBE","name":"ShibeCoin","canLend":0},"SHOPX":{"id":187,"symbol":"SHOPX","name":"ShopX","canLend":0},"SILK":{"id":188,"symbol":"SILK","name":"Silkcoin","canLend":0},"SJCX":{"id":189,"symbol":"SJCX","name":"Storjcoin X","canLend":0},"SLR":{"id":190,"symbol":"SLR","name":"SolarCoin","canLend":0},"SMC":{"id":191,"symbol":"SMC","name":"SmartCoin","canLend":0},"SOC":{"id":192,"symbol":"SOC","name":"SocialCoin","canLend":0},"SPA":{"id":193,"symbol":"SPA","name":"Spaincoin","canLend":0},"SQL":{"id":194,"symbol":"SQL","name":"Squallcoin","canLend":0},"SRCC":{"id":195,"symbol":"SRCC","name":"SourceCoin","canLend":0},"SRG":{"id":196,"symbol":"SRG","name":"Surge","canLend":0},"SSD":{"id":197,"symbol":"SSD","name":"Sonic","canLend":0},"STR":{"id":198,"symbol":"STR","name":"Stellar","canLend":1},"SUM":{"id":199,"symbol":"SUM","name":"SummerCoin","canLend":0},"SUN":{"id":200,"symbol":"SUN","name":"Suncoin","canLend":0},"SWARM":{"id":201,"symbol":"SWARM","name":"SWARM","canLend":0},"SXC":{"id":202,"symbol":"SXC","name":"Sexcoin","canLend":0},"SYNC":{"id":203,"symbol":"SYNC","name":"Sync","canLend":0},"SYS":{"id":204,"symbol":"SYS","name":"Syscoin","canLend":0},"TAC":{"id":205,"symbol":"TAC","name":"Talkcoin","canLend":0},"TOR":{"id":206,"symbol":"TOR","name":"TorCoin","canLend":0},"TRUST":{"id":207,"symbol":"TRUST","name":"TrustPlus","canLend":0},"TWE":{"id":208,"symbol":"TWE","name":"Twecoin","canLend":0},"UIS":{"id":209,"symbol":"UIS","name":"Unitus","canLend":0},"ULTC":{"id":210,"symbol":"ULTC","name":"Umbrella-LTC","canLend":0},"UNITY":{"id":211,"symbol":"UNITY","name":"SuperNET","canLend":0},"URO":{"id":212,"symbol":"URO","name":"Uro","canLend":0},"USDE":{"id":213,"symbol":"USDE","name":"USDE","canLend":0},"USDT":{"id":214,"symbol":"USDT","name":"Tether USD","canLend":0},"UTC":{"id":215,"symbol":"UTC","name":"UltraCoin","canLend":0},"UTIL":{"id":216,"symbol":"UTIL","name":"UtilityCoin","canLend":0},"UVC":{"id":217,"symbol":"UVC","name":"UniversityCoin","canLend":0},"VIA":{"id":218,"symbol":"VIA","name":"Viacoin","canLend":0},"VOOT":{"id":219,"symbol":"VOOT","name":"VootCoin","canLend":0},"VRC":{"id":220,"symbol":"VRC","name":"VeriCoin","canLend":0},"VTC":{"id":221,"symbol":"VTC","name":"Vertcoin","canLend":0},"WC":{"id":222,"symbol":"WC","name":"WhiteCoin","canLend":0},"WDC":{"id":223,"symbol":"WDC","name":"Worldcoin","canLend":0},"WIKI":{"id":224,"symbol":"WIKI","name":"Wikicoin","canLend":0},"WOLF":{"id":225,"symbol":"WOLF","name":"InsanityCoin","canLend":0},"X13":{"id":226,"symbol":"X13","name":"X13Coin","canLend":0},"XAI":{"id":227,"symbol":"XAI","name":"Sapience AIFX","canLend":0},"XAP":{"id":228,"symbol":"XAP","name":"API Coin","canLend":0},"XBC":{"id":229,"symbol":"XBC","name":"BitcoinPlus","canLend":0},"XC":{"id":230,"symbol":"XC","name":"XCurrency","canLend":0},"XCH":{"id":231,"symbol":"XCH","name":"ClearingHouse","canLend":0},"XCN":{"id":232,"symbol":"XCN","name":"Cryptonite","canLend":0},"XCP":{"id":233,"symbol":"XCP","name":"Counterparty","canLend":0},"XCR":{"id":234,"symbol":"XCR","name":"Crypti","canLend":0},"XDN":{"id":235,"symbol":"XDN","name":"DigitalNote","canLend":0},"XDP":{"id":236,"symbol":"XDP","name":"Dogeparty","canLend":0},"XHC":{"id":237,"symbol":"XHC","name":"Honorcoin","canLend":0},"XLB":{"id":238,"symbol":"XLB","name":"Libertycoin","canLend":0},"XMG":{"id":239,"symbol":"XMG","name":"Magi","canLend":0},"XMR":{"id":240,"symbol":"XMR","name":"Monero","canLend":1},"XPB":{"id":241,"symbol":"XPB","name":"Pebblecoin","canLend":0},"XPM":{"id":242,"symbol":"XPM","name":"Primecoin","canLend":0},"XRP":{"id":243,"symbol":"XRP","name":"Ripple","canLend":1},"XSI":{"id":244,"symbol":"XSI","name":"Stability Shares","canLend":0},"XST":{"id":245,"symbol":"XST","name":"StealthCoin","canLend":0},"XSV":{"id":246,"symbol":"XSV","name":"Silicon Valley Coin","canLend":0},"XUSD":{"id":247,"symbol":"XUSD","name":"CoinoUSD","canLend":0},"XXC":{"id":248,"symbol":"XXC","name":"CREDS","canLend":0},"YACC":{"id":249,"symbol":"YACC","name":"YACCoin","canLend":0},"YANG":{"id":250,"symbol":"YANG","name":"Yangcoin","canLend":0},"YC":{"id":251,"symbol":"YC","name":"YellowCoin","canLend":0},"YIN":{"id":252,"symbol":"YIN","name":"Yincoin","canLend":0},"XVC":{"id":253,"symbol":"XVC","name":"Vcash","canLend":0},"FLO":{"id":254,"symbol":"FLO","name":"Florincoin","canLend":0},"XEM":{"id":256,"symbol":"XEM","name":"NEM","canLend":0},"ARCH":{"id":258,"symbol":"ARCH","name":"ARCHcoin","canLend":0},"HUGE":{"id":260,"symbol":"HUGE","name":"BIGcoin","canLend":0},"GRC":{"id":261,"symbol":"GRC","name":"Gridcoin Research","canLend":0},"IOC":{"id":263,"symbol":"IOC","name":"IO Digital Currency","canLend":0},"INDEX":{"id":265,"symbol":"INDEX","name":"CoinoIndex","canLend":0},"ETH":{"id":267,"symbol":"ETH","name":"Ethereum","canLend":1},"SC":{"id":268,"symbol":"SC","name":"Siacoin","canLend":0},"BCY":{"id":269,"symbol":"BCY","name":"BitCrystals","canLend":0},"EXP":{"id":270,"symbol":"EXP","name":"Expanse","canLend":0},"FCT":{"id":271,"symbol":"FCT","name":"Factom","canLend":1},"BITUSD":{"id":272,"symbol":"BITUSD","name":"BitUSD","canLend":0},"BITCNY":{"id":273,"symbol":"BITCNY","name":"BitCNY","canLend":0},"RADS":{"id":274,"symbol":"RADS","name":"Radium","canLend":0},"AMP":{"id":275,"symbol":"AMP","name":"Synereo AMP","canLend":0},"VOX":{"id":276,"symbol":"VOX","name":"Voxels","canLend":0},"DCR":{"id":277,"symbol":"DCR","name":"Decred","canLend":0},"LSK":{"id":278,"symbol":"LSK","name":"Lisk","canLend":0},"DAO":{"id":279,"symbol":"DAO","name":"The DAO","canLend":0},"LBC":{"id":280,"symbol":"LBC","name":"LBRY Credits","canLend":0},"STEEM":{"id":281,"symbol":"STEEM","name":"STEEM","canLend":0},"SBD":{"id":282,"symbol":"SBD","name":"Steem Dollars","canLend":0},"ETC":{"id":283,"symbol":"ETC","name":"Ethereum Classic","canLend":0},"REP":{"id":284,"symbol":"REP","name":"Augur","canLend":0},"ARDR":{"id":285,"symbol":"ARDR","name":"Ardor","canLend":0},"ZEC":{"id":286,"symbol":"ZEC","name":"Zcash","canLend":0},"STRAT":{"id":287,"symbol":"STRAT","name":"Stratis","canLend":0},"NXC":{"id":288,"symbol":"NXC","name":"Nexium","canLend":0},"PASC":{"id":289,"symbol":"PASC","name":"PascalCoin","canLend":0},"GNT":{"id":290,"symbol":"GNT","name":"Golem","canLend":0},"GNO":{"id":291,"symbol":"GNO","name":"Gnosis","canLend":0},"BCH":{"id":292,"symbol":"BCH","name":"Bitcoin Cash","canLend":0},"ZRX":{"id":293,"symbol":"ZRX","name":"0x","canLend":0},"CVC":{"id":294,"symbol":"CVC","name":"Civic","canLend":0},"OMG":{"id":295,"symbol":"OMG","name":"OmiseGO","canLend":0},"GAS":{"id":296,"symbol":"GAS","name":"Gas","canLend":0},"STORJ":{"id":297,"symbol":"STORJ","name":"Storj","canLend":0},"EOS":{"id":298,"symbol":"EOS","name":"EOS","canLend":0},"USDC":{"id":299,"symbol":"USDC","name":"USD Coin","canLend":0},"SNT":{"id":300,"symbol":"SNT","name":"Status","canLend":0},"KNC":{"id":301,"symbol":"KNC","name":"Kyber","canLend":0},"BAT":{"id":302,"symbol":"BAT","name":"Basic Attention Token","canLend":0},"LOOM":{"id":303,"symbol":"LOOM","name":"LOOM Network","canLend":0},"QTUM":{"id":304,"symbol":"QTUM","name":"Qtum","canLend":0},"BNT":{"id":305,"symbol":"BNT","name":"Bancor","canLend":0},"MANA":{"id":306,"symbol":"MANA","name":"Decentraland","canLend":0},"FOAM":{"id":307,"symbol":"FOAM","name":"Foam","canLend":0},"BCHABC":{"id":308,"symbol":"BCHABC","name":"Bitcoin Cash ABC","canLend":0},"BCHSV":{"id":309,"symbol":"BCHSV","name":"Bitcoin Cash SV","canLend":0},"NMR":{"id":310,"symbol":"NMR","name":"Numeraire","canLend":0},"POLY":{"id":311,"symbol":"POLY","name":"Polymath","canLend":0},"LPT":{"id":312,"symbol":"LPT","name":"Livepeer","canLend":0}},"byID":{"1":{"id":1,"symbol":"1CR","name":"1CRedit","canLend":0},"2":{"id":2,"symbol":"ABY","name":"ArtByte","canLend":0},"3":{"id":3,"symbol":"AC","name":"AsiaCoin","canLend":0},"4":{"id":4,"symbol":"ACH","name":"Altcoin Herald","canLend":0},"5":{"id":5,"symbol":"ADN","name":"Aiden","canLend":0},"6":{"id":6,"symbol":"AEON","name":"AEON Coin","canLend":0},"7":{"id":7,"symbol":"AERO","name":"Aerocoin","canLend":0},"8":{"id":8,"symbol":"AIR","name":"AIRcoin","canLend":0},"9":{"id":9,"symbol":"APH","name":"AphroditeCoin","canLend":0},"10":{"id":10,"symbol":"AUR","name":"Auroracoin","canLend":0},"11":{"id":11,"symbol":"AXIS","name":"Axis","canLend":0},"12":{"id":12,"symbol":"BALLS","name":"Snowballs","canLend":0},"13":{"id":13,"symbol":"BANK","name":"BankCoin","canLend":0},"14":{"id":14,"symbol":"BBL","name":"BitBlock","canLend":0},"15":{"id":15,"symbol":"BBR","name":"Boolberry","canLend":0},"16":{"id":16,"symbol":"BCC","name":"BTCtalkcoin","canLend":0},"17":{"id":17,"symbol":"BCN","name":"Bytecoin","canLend":0},"18":{"id":18,"symbol":"BDC","name":"Black Dragon Coin","canLend":0},"19":{"id":19,"symbol":"BDG","name":"Badgercoin","canLend":0},"20":{"id":20,"symbol":"BELA","name":"Bela Legacy","canLend":0},"21":{"id":21,"symbol":"BITS","name":"Bitstar","canLend":0},"22":{"id":22,"symbol":"BLK","name":"BlackCoin","canLend":0},"23":{"id":23,"symbol":"BLOCK","name":"Blocknet","canLend":0},"24":{"id":24,"symbol":"BLU","name":"BlueCoin","canLend":0},"25":{"id":25,"symbol":"BNS","name":"BonusCoin","canLend":0},"26":{"id":26,"symbol":"BONES","name":"Bones","canLend":0},"27":{"id":27,"symbol":"BOST","name":"BoostCoin","canLend":0},"28":{"id":28,"symbol":"BTC","name":"Bitcoin","canLend":1},"29":{"id":29,"symbol":"BTCD","name":"BitcoinDark","canLend":0},"30":{"id":30,"symbol":"BTCS","name":"Bitcoin-sCrypt","canLend":0},"31":{"id":31,"symbol":"BTM","name":"Bitmark","canLend":0},"32":{"id":32,"symbol":"BTS","name":"BitShares","canLend":1},"33":{"id":33,"symbol":"BURN","name":"BurnerCoin","canLend":0},"34":{"id":34,"symbol":"BURST","name":"Burst","canLend":0},"35":{"id":35,"symbol":"C2","name":"Coin2.0","canLend":0},"36":{"id":36,"symbol":"CACH","name":"CACHeCoin","canLend":0},"37":{"id":37,"symbol":"CAI","name":"CaiShen","canLend":0},"38":{"id":38,"symbol":"CC","name":"Colbert Coin","canLend":0},"39":{"id":39,"symbol":"CCN","name":"Cannacoin","canLend":0},"40":{"id":40,"symbol":"CGA","name":"Cryptographic Anomaly","canLend":0},"41":{"id":41,"symbol":"CHA","name":"Chancecoin","canLend":0},"42":{"id":42,"symbol":"CINNI","name":"CinniCoin","canLend":0},"43":{"id":43,"symbol":"CLAM","name":"CLAMS","canLend":1},"44":{"id":44,"symbol":"CNL","name":"ConcealCoin","canLend":0},"45":{"id":45,"symbol":"CNMT","name":"Coinomat1","canLend":0},"46":{"id":46,"symbol":"CNOTE","name":"C-Note","canLend":0},"47":{"id":47,"symbol":"COMM","name":"CommunityCoin","canLend":0},"48":{"id":48,"symbol":"CON","name":"Coino","canLend":0},"49":{"id":49,"symbol":"CORG","name":"CorgiCoin","canLend":0},"50":{"id":50,"symbol":"CRYPT","name":"CryptCoin","canLend":0},"51":{"id":51,"symbol":"CURE","name":"Curecoin","canLend":0},"52":{"id":52,"symbol":"CYC","name":"Conspiracy Coin","canLend":0},"53":{"id":53,"symbol":"DGB","name":"DigiByte","canLend":0},"54":{"id":54,"symbol":"DICE","name":"NeoDICE","canLend":0},"55":{"id":55,"symbol":"DIEM","name":"Diem","canLend":0},"56":{"id":56,"symbol":"DIME","name":"Dimecoin","canLend":0},"57":{"id":57,"symbol":"DIS","name":"DistroCoin","canLend":0},"58":{"id":58,"symbol":"DNS","name":"BitShares DNS","canLend":0},"59":{"id":59,"symbol":"DOGE","name":"Dogecoin","canLend":1},"60":{"id":60,"symbol":"DASH","name":"Dash","canLend":1},"61":{"id":61,"symbol":"DRKC","name":"DarkCash","canLend":0},"62":{"id":62,"symbol":"DRM","name":"Dreamcoin","canLend":0},"63":{"id":63,"symbol":"DSH","name":"Dashcoin","canLend":0},"64":{"id":64,"symbol":"DVK","name":"DvoraKoin","canLend":0},"65":{"id":65,"symbol":"EAC","name":"EarthCoin","canLend":0},"66":{"id":66,"symbol":"EBT","name":"EBTcoin","canLend":0},"67":{"id":67,"symbol":"ECC","name":"ECCoin","canLend":0},"68":{"id":68,"symbol":"EFL","name":"Electronic Gulden","canLend":0},"69":{"id":69,"symbol":"EMC2","name":"Einsteinium","canLend":0},"70":{"id":70,"symbol":"EMO","name":"EmotiCoin","canLend":0},"71":{"id":71,"symbol":"ENC","name":"Entropycoin","canLend":0},"72":{"id":72,"symbol":"eTOK","name":"eToken","canLend":0},"73":{"id":73,"symbol":"EXE","name":"Execoin","canLend":0},"74":{"id":74,"symbol":"FAC","name":"Faircoin","canLend":0},"75":{"id":75,"symbol":"FCN","name":"Fantomcoin","canLend":0},"76":{"id":76,"symbol":"FIBRE","name":"Fibrecoin","canLend":0},"77":{"id":77,"symbol":"FLAP","name":"FlappyCoin","canLend":0},"78":{"id":78,"symbol":"FLDC","name":"FoldingCoin","canLend":0},"79":{"id":79,"symbol":"FLT","name":"FlutterCoin","canLend":0},"80":{"id":80,"symbol":"FOX","name":"FoxCoin","canLend":0},"81":{"id":81,"symbol":"FRAC","name":"Fractalcoin","canLend":0},"82":{"id":82,"symbol":"FRK","name":"Franko","canLend":0},"83":{"id":83,"symbol":"FRQ","name":"FairQuark","canLend":0},"84":{"id":84,"symbol":"FVZ","name":"FVZCoin","canLend":0},"85":{"id":85,"symbol":"FZ","name":"Frozen","canLend":0},"86":{"id":86,"symbol":"FZN","name":"Fuzon","canLend":0},"87":{"id":87,"symbol":"GAP","name":"Gapcoin","canLend":0},"88":{"id":88,"symbol":"GDN","name":"Global Denomination","canLend":0},"89":{"id":89,"symbol":"GEMZ","name":"GetGems","canLend":0},"90":{"id":90,"symbol":"GEO","name":"GeoCoin","canLend":0},"91":{"id":91,"symbol":"GIAR","name":"Giarcoin","canLend":0},"92":{"id":92,"symbol":"GLB","name":"Globe","canLend":0},"93":{"id":93,"symbol":"GAME","name":"GameCredits","canLend":0},"94":{"id":94,"symbol":"GML","name":"GameleagueCoin","canLend":0},"95":{"id":95,"symbol":"GNS","name":"GenesisCoin","canLend":0},"96":{"id":96,"symbol":"GOLD","name":"GoldEagles","canLend":0},"97":{"id":97,"symbol":"GPC","name":"GROUPCoin","canLend":0},"98":{"id":98,"symbol":"GPUC","name":"GPU Coin","canLend":0},"99":{"id":99,"symbol":"GRCX","name":"Gridcoin","canLend":0},"100":{"id":100,"symbol":"GRS","name":"Groestlcoin","canLend":0},"101":{"id":101,"symbol":"GUE","name":"Guerillacoin","canLend":0},"102":{"id":102,"symbol":"H2O","name":"H2O Coin","canLend":0},"103":{"id":103,"symbol":"HIRO","name":"Hirocoin","canLend":0},"104":{"id":104,"symbol":"HOT","name":"Hotcoin","canLend":0},"105":{"id":105,"symbol":"HUC","name":"Huntercoin","canLend":0},"106":{"id":106,"symbol":"HVC","name":"Heavycoin","canLend":0},"107":{"id":107,"symbol":"HYP","name":"HyperStake","canLend":0},"108":{"id":108,"symbol":"HZ","name":"Horizon","canLend":0},"109":{"id":109,"symbol":"IFC","name":"Infinitecoin","canLend":0},"110":{"id":110,"symbol":"ITC","name":"Information Coin","canLend":0},"111":{"id":111,"symbol":"IXC","name":"iXcoin","canLend":0},"112":{"id":112,"symbol":"JLH","name":"jl777hodl","canLend":0},"113":{"id":113,"symbol":"JPC","name":"JackpotCoin","canLend":0},"114":{"id":114,"symbol":"JUG","name":"JuggaloCoin","canLend":0},"115":{"id":115,"symbol":"KDC","name":"KlondikeCoin","canLend":0},"116":{"id":116,"symbol":"KEY","name":"KeyCoin","canLend":0},"117":{"id":117,"symbol":"LC","name":"Limecoin","canLend":0},"118":{"id":118,"symbol":"LCL","name":"Limecoin Lite","canLend":0},"119":{"id":119,"symbol":"LEAF","name":"Leafcoin","canLend":0},"120":{"id":120,"symbol":"LGC","name":"Logicoin","canLend":0},"121":{"id":121,"symbol":"LOL","name":"LeagueCoin","canLend":0},"122":{"id":122,"symbol":"LOVE","name":"LOVEcoin","canLend":0},"123":{"id":123,"symbol":"LQD","name":"LIQUID","canLend":0},"124":{"id":124,"symbol":"LTBC","name":"LTBCoin","canLend":0},"125":{"id":125,"symbol":"LTC","name":"Litecoin","canLend":1},"126":{"id":126,"symbol":"LTCX","name":"LiteCoinX","canLend":0},"127":{"id":127,"symbol":"MAID","name":"MaidSafeCoin","canLend":1},"128":{"id":128,"symbol":"MAST","name":"MastiffCoin","canLend":0},"129":{"id":129,"symbol":"MAX","name":"MaxCoin","canLend":0},"130":{"id":130,"symbol":"MCN","name":"Moneta Verde","canLend":0},"131":{"id":131,"symbol":"MEC","name":"Megacoin","canLend":0},"132":{"id":132,"symbol":"METH","name":"CryptoMETH","canLend":0},"133":{"id":133,"symbol":"MIL","name":"Millennium Coin","canLend":0},"134":{"id":134,"symbol":"MIN","name":"Minerals","canLend":0},"135":{"id":135,"symbol":"MINT","name":"Mintcoin","canLend":0},"136":{"id":136,"symbol":"MMC","name":"MemoryCoin","canLend":0},"137":{"id":137,"symbol":"MMNXT","name":"MMNXT","canLend":0},"138":{"id":138,"symbol":"MMXIV","name":"Maieuticoin","canLend":0},"139":{"id":139,"symbol":"MNTA","name":"Moneta","canLend":0},"140":{"id":140,"symbol":"MON","name":"Monocle","canLend":0},"141":{"id":141,"symbol":"MRC","name":"microCoin","canLend":0},"142":{"id":142,"symbol":"MRS","name":"Marscoin","canLend":0},"143":{"id":143,"symbol":"OMNI","name":"Omni","canLend":0},"144":{"id":144,"symbol":"MTS","name":"Metiscoin","canLend":0},"145":{"id":145,"symbol":"MUN","name":"Muniti","canLend":0},"146":{"id":146,"symbol":"MYR","name":"Myriadcoin","canLend":0},"147":{"id":147,"symbol":"MZC","name":"MazaCoin","canLend":0},"148":{"id":148,"symbol":"N5X","name":"N5coin","canLend":0},"149":{"id":149,"symbol":"NAS","name":"NAS","canLend":0},"150":{"id":150,"symbol":"NAUT","name":"Nautiluscoin","canLend":0},"151":{"id":151,"symbol":"NAV","name":"NAVCoin","canLend":0},"152":{"id":152,"symbol":"NBT","name":"NuBits","canLend":0},"153":{"id":153,"symbol":"NEOS","name":"Neoscoin","canLend":0},"154":{"id":154,"symbol":"NL","name":"Nanolite","canLend":0},"155":{"id":155,"symbol":"NMC","name":"Namecoin","canLend":0},"156":{"id":156,"symbol":"NOBL","name":"NobleCoin","canLend":0},"157":{"id":157,"symbol":"NOTE","name":"DNotes","canLend":0},"158":{"id":158,"symbol":"NOXT","name":"NobleNXT","canLend":0},"159":{"id":159,"symbol":"NRS","name":"NoirShares","canLend":0},"160":{"id":160,"symbol":"NSR","name":"NuShares","canLend":0},"161":{"id":161,"symbol":"NTX","name":"NTX","canLend":0},"162":{"id":162,"symbol":"NXT","name":"NXT","canLend":0},"163":{"id":163,"symbol":"NXTI","name":"NXTInspect","canLend":0},"164":{"id":164,"symbol":"OPAL","name":"Opal","canLend":0},"165":{"id":165,"symbol":"PAND","name":"PandaCoin","canLend":0},"166":{"id":166,"symbol":"PAWN","name":"Pawncoin","canLend":0},"167":{"id":167,"symbol":"PIGGY","name":"New Piggycoin","canLend":0},"168":{"id":168,"symbol":"PINK","name":"Pinkcoin","canLend":0},"169":{"id":169,"symbol":"PLX","name":"ParallaxCoin","canLend":0},"170":{"id":170,"symbol":"PMC","name":"Premine","canLend":0},"171":{"id":171,"symbol":"POT","name":"PotCoin","canLend":0},"172":{"id":172,"symbol":"PPC","name":"Peercoin","canLend":0},"173":{"id":173,"symbol":"PRC","name":"ProsperCoin","canLend":0},"174":{"id":174,"symbol":"PRT","name":"Particle","canLend":0},"175":{"id":175,"symbol":"PTS","name":"BitShares PTS","canLend":0},"176":{"id":176,"symbol":"Q2C","name":"QubitCoin","canLend":0},"177":{"id":177,"symbol":"QBK","name":"Qibuck","canLend":0},"178":{"id":178,"symbol":"QCN","name":"QuazarCoin","canLend":0},"179":{"id":179,"symbol":"QORA","name":"Qora","canLend":0},"180":{"id":180,"symbol":"QTL","name":"Quatloo","canLend":0},"181":{"id":181,"symbol":"RBY","name":"Rubycoin","canLend":0},"182":{"id":182,"symbol":"RDD","name":"Reddcoin","canLend":0},"183":{"id":183,"symbol":"RIC","name":"Riecoin","canLend":0},"184":{"id":184,"symbol":"RZR","name":"Razor","canLend":0},"185":{"id":185,"symbol":"SDC","name":"Shadow","canLend":0},"186":{"id":186,"symbol":"SHIBE","name":"ShibeCoin","canLend":0},"187":{"id":187,"symbol":"SHOPX","name":"ShopX","canLend":0},"188":{"id":188,"symbol":"SILK","name":"Silkcoin","canLend":0},"189":{"id":189,"symbol":"SJCX","name":"Storjcoin X","canLend":0},"190":{"id":190,"symbol":"SLR","name":"SolarCoin","canLend":0},"191":{"id":191,"symbol":"SMC","name":"SmartCoin","canLend":0},"192":{"id":192,"symbol":"SOC","name":"SocialCoin","canLend":0},"193":{"id":193,"symbol":"SPA","name":"Spaincoin","canLend":0},"194":{"id":194,"symbol":"SQL","name":"Squallcoin","canLend":0},"195":{"id":195,"symbol":"SRCC","name":"SourceCoin","canLend":0},"196":{"id":196,"symbol":"SRG","name":"Surge","canLend":0},"197":{"id":197,"symbol":"SSD","name":"Sonic","canLend":0},"198":{"id":198,"symbol":"STR","name":"Stellar","canLend":1},"199":{"id":199,"symbol":"SUM","name":"SummerCoin","canLend":0},"200":{"id":200,"symbol":"SUN","name":"Suncoin","canLend":0},"201":{"id":201,"symbol":"SWARM","name":"SWARM","canLend":0},"202":{"id":202,"symbol":"SXC","name":"Sexcoin","canLend":0},"203":{"id":203,"symbol":"SYNC","name":"Sync","canLend":0},"204":{"id":204,"symbol":"SYS","name":"Syscoin","canLend":0},"205":{"id":205,"symbol":"TAC","name":"Talkcoin","canLend":0},"206":{"id":206,"symbol":"TOR","name":"TorCoin","canLend":0},"207":{"id":207,"symbol":"TRUST","name":"TrustPlus","canLend":0},"208":{"id":208,"symbol":"TWE","name":"Twecoin","canLend":0},"209":{"id":209,"symbol":"UIS","name":"Unitus","canLend":0},"210":{"id":210,"symbol":"ULTC","name":"Umbrella-LTC","canLend":0},"211":{"id":211,"symbol":"UNITY","name":"SuperNET","canLend":0},"212":{"id":212,"symbol":"URO","name":"Uro","canLend":0},"213":{"id":213,"symbol":"USDE","name":"USDE","canLend":0},"214":{"id":214,"symbol":"USDT","name":"Tether USD","canLend":0},"215":{"id":215,"symbol":"UTC","name":"UltraCoin","canLend":0},"216":{"id":216,"symbol":"UTIL","name":"UtilityCoin","canLend":0},"217":{"id":217,"symbol":"UVC","name":"UniversityCoin","canLend":0},"218":{"id":218,"symbol":"VIA","name":"Viacoin","canLend":0},"219":{"id":219,"symbol":"VOOT","name":"VootCoin","canLend":0},"220":{"id":220,"symbol":"VRC","name":"VeriCoin","canLend":0},"221":{"id":221,"symbol":"VTC","name":"Vertcoin","canLend":0},"222":{"id":222,"symbol":"WC","name":"WhiteCoin","canLend":0},"223":{"id":223,"symbol":"WDC","name":"Worldcoin","canLend":0},"224":{"id":224,"symbol":"WIKI","name":"Wikicoin","canLend":0},"225":{"id":225,"symbol":"WOLF","name":"InsanityCoin","canLend":0},"226":{"id":226,"symbol":"X13","name":"X13Coin","canLend":0},"227":{"id":227,"symbol":"XAI","name":"Sapience AIFX","canLend":0},"228":{"id":228,"symbol":"XAP","name":"API Coin","canLend":0},"229":{"id":229,"symbol":"XBC","name":"BitcoinPlus","canLend":0},"230":{"id":230,"symbol":"XC","name":"XCurrency","canLend":0},"231":{"id":231,"symbol":"XCH","name":"ClearingHouse","canLend":0},"232":{"id":232,"symbol":"XCN","name":"Cryptonite","canLend":0},"233":{"id":233,"symbol":"XCP","name":"Counterparty","canLend":0},"234":{"id":234,"symbol":"XCR","name":"Crypti","canLend":0},"235":{"id":235,"symbol":"XDN","name":"DigitalNote","canLend":0},"236":{"id":236,"symbol":"XDP","name":"Dogeparty","canLend":0},"237":{"id":237,"symbol":"XHC","name":"Honorcoin","canLend":0},"238":{"id":238,"symbol":"XLB","name":"Libertycoin","canLend":0},"239":{"id":239,"symbol":"XMG","name":"Magi","canLend":0},"240":{"id":240,"symbol":"XMR","name":"Monero","canLend":1},"241":{"id":241,"symbol":"XPB","name":"Pebblecoin","canLend":0},"242":{"id":242,"symbol":"XPM","name":"Primecoin","canLend":0},"243":{"id":243,"symbol":"XRP","name":"Ripple","canLend":1},"244":{"id":244,"symbol":"XSI","name":"Stability Shares","canLend":0},"245":{"id":245,"symbol":"XST","name":"StealthCoin","canLend":0},"246":{"id":246,"symbol":"XSV","name":"Silicon Valley Coin","canLend":0},"247":{"id":247,"symbol":"XUSD","name":"CoinoUSD","canLend":0},"248":{"id":248,"symbol":"XXC","name":"CREDS","canLend":0},"249":{"id":249,"symbol":"YACC","name":"YACCoin","canLend":0},"250":{"id":250,"symbol":"YANG","name":"Yangcoin","canLend":0},"251":{"id":251,"symbol":"YC","name":"YellowCoin","canLend":0},"252":{"id":252,"symbol":"YIN","name":"Yincoin","canLend":0},"253":{"id":253,"symbol":"XVC","name":"Vcash","canLend":0},"254":{"id":254,"symbol":"FLO","name":"Florincoin","canLend":0},"256":{"id":256,"symbol":"XEM","name":"NEM","canLend":0},"258":{"id":258,"symbol":"ARCH","name":"ARCHcoin","canLend":0},"260":{"id":260,"symbol":"HUGE","name":"BIGcoin","canLend":0},"261":{"id":261,"symbol":"GRC","name":"Gridcoin Research","canLend":0},"263":{"id":263,"symbol":"IOC","name":"IO Digital Currency","canLend":0},"265":{"id":265,"symbol":"INDEX","name":"CoinoIndex","canLend":0},"267":{"id":267,"symbol":"ETH","name":"Ethereum","canLend":1},"268":{"id":268,"symbol":"SC","name":"Siacoin","canLend":0},"269":{"id":269,"symbol":"BCY","name":"BitCrystals","canLend":0},"270":{"id":270,"symbol":"EXP","name":"Expanse","canLend":0},"271":{"id":271,"symbol":"FCT","name":"Factom","canLend":1},"272":{"id":272,"symbol":"BITUSD","name":"BitUSD","canLend":0},"273":{"id":273,"symbol":"BITCNY","name":"BitCNY","canLend":0},"274":{"id":274,"symbol":"RADS","name":"Radium","canLend":0},"275":{"id":275,"symbol":"AMP","name":"Synereo AMP","canLend":0},"276":{"id":276,"symbol":"VOX","name":"Voxels","canLend":0},"277":{"id":277,"symbol":"DCR","name":"Decred","canLend":0},"278":{"id":278,"symbol":"LSK","name":"Lisk","canLend":0},"279":{"id":279,"symbol":"DAO","name":"The DAO","canLend":0},"280":{"id":280,"symbol":"LBC","name":"LBRY Credits","canLend":0},"281":{"id":281,"symbol":"STEEM","name":"STEEM","canLend":0},"282":{"id":282,"symbol":"SBD","name":"Steem Dollars","canLend":0},"283":{"id":283,"symbol":"ETC","name":"Ethereum Classic","canLend":0},"284":{"id":284,"symbol":"REP","name":"Augur","canLend":0},"285":{"id":285,"symbol":"ARDR","name":"Ardor","canLend":0},"286":{"id":286,"symbol":"ZEC","name":"Zcash","canLend":0},"287":{"id":287,"symbol":"STRAT","name":"Stratis","canLend":0},"288":{"id":288,"symbol":"NXC","name":"Nexium","canLend":0},"289":{"id":289,"symbol":"PASC","name":"PascalCoin","canLend":0},"290":{"id":290,"symbol":"GNT","name":"Golem","canLend":0},"291":{"id":291,"symbol":"GNO","name":"Gnosis","canLend":0},"292":{"id":292,"symbol":"BCH","name":"Bitcoin Cash","canLend":0},"293":{"id":293,"symbol":"ZRX","name":"0x","canLend":0},"294":{"id":294,"symbol":"CVC","name":"Civic","canLend":0},"295":{"id":295,"symbol":"OMG","name":"OmiseGO","canLend":0},"296":{"id":296,"symbol":"GAS","name":"Gas","canLend":0},"297":{"id":297,"symbol":"STORJ","name":"Storj","canLend":0},"298":{"id":298,"symbol":"EOS","name":"EOS","canLend":0},"299":{"id":299,"symbol":"USDC","name":"USD Coin","canLend":0},"300":{"id":300,"symbol":"SNT","name":"Status","canLend":0},"301":{"id":301,"symbol":"KNC","name":"Kyber","canLend":0},"302":{"id":302,"symbol":"BAT","name":"Basic Attention Token","canLend":0},"303":{"id":303,"symbol":"LOOM","name":"LOOM Network","canLend":0},"304":{"id":304,"symbol":"QTUM","name":"Qtum","canLend":0},"305":{"id":305,"symbol":"BNT","name":"Bancor","canLend":0},"306":{"id":306,"symbol":"MANA","name":"Decentraland","canLend":0},"307":{"id":307,"symbol":"FOAM","name":"Foam","canLend":0},"308":{"id":308,"symbol":"BCHABC","name":"Bitcoin Cash ABC","canLend":0},"309":{"id":309,"symbol":"BCHSV","name":"Bitcoin Cash SV","canLend":0},"310":{"id":310,"symbol":"NMR","name":"Numeraire","canLend":0},"311":{"id":311,"symbol":"POLY","name":"Polymath","canLend":0},"312":{"id":312,"symbol":"LPT","name":"Livepeer","canLend":0}}};



export class PoloniexCurrencies implements Currency.ExchangeCurrencies, Currency.ExternalExchangeTicker {
    protected exchange: AbstractExchange;

    constructor(exchange: AbstractExchange) {
        this.exchange = exchange;
    }

    public getExchangeName(localCurrencyName: string): string {
        if (localCurrencyName === "NEO")
            return "NEOS";
        return localCurrencyName
    }
    public getLocalName(exchangeCurrencyName: string): string {
        if (exchangeCurrencyName === "NEOS")
            return "NEO";
        return exchangeCurrencyName
    }

    public getExchangePair(localPair: Currency.CurrencyPair): string {
        let str1 = Currency.Currency[localPair.from]
        let str2 = Currency.Currency[localPair.to]
        if (!str1 || !str2) // currently polo supports all our currencies, so this shouldn't happen
            return undefined;
        return this.getExchangeName(str1) + "_" + this.getExchangeName(str2) // BTC_LTC
    }
    public getLocalPair(exchangePair: string): Currency.CurrencyPair {
        let pair = exchangePair.split("_")
        let cur1 = Currency.Currency[this.getLocalName(pair[0])]
        let cur2 = Currency.Currency[this.getLocalName(pair[1])]
        if (!cur1 || !cur2)
            return undefined;
        return new Currency.CurrencyPair(cur1, cur2)
    }
    public toLocalTicker(exchangeTicker: any): Ticker.Ticker {
        let ticker = new Ticker.Ticker(this.exchange.getExchangeLabel());
        if (Array.isArray(exchangeTicker) === false || exchangeTicker.length !== 10) {
            logger.error("Received invalid exchange ticker data from %s", this.exchange.getClassName(), exchangeTicker)
            return undefined;
        }
        ticker.currencyPair = this.getLocalPair(exchangeTicker[0]);
        if (!ticker.currencyPair)
            return undefined; // we don't support this pair
        ticker.last = Ticker.Ticker.parseNumber(exchangeTicker[1]);
        ticker.lowestAsk = Ticker.Ticker.parseNumber(exchangeTicker[2]);
        ticker.highestBid = Ticker.Ticker.parseNumber(exchangeTicker[3]);
        ticker.percentChange = Ticker.Ticker.parseNumber(exchangeTicker[4]);
        ticker.baseVolume = Ticker.Ticker.parseNumber(exchangeTicker[5]);
        ticker.quoteVolume = Ticker.Ticker.parseNumber(exchangeTicker[6]);
        ticker.isFrozen = exchangeTicker[7] ? true : false;
        ticker.high24hr = Ticker.Ticker.parseNumber(exchangeTicker[8]);
        ticker.low24hr = Ticker.Ticker.parseNumber(exchangeTicker[9]);
        return ticker;
    }
    public toExternalTicker(exchangeTicker: any): Ticker.ExternalTicker {
        let ticker = new Ticker.ExternalTicker(this.exchange.getExchangeLabel());
        if (Array.isArray(exchangeTicker) === false || exchangeTicker.length !== 10) {
            logger.error("Received invalid exchange ticker data from %s", this.exchange.getClassName(), exchangeTicker)
            return undefined;
        }
        ticker.currencyPair = exchangeTicker[0];
        ticker.last = Ticker.Ticker.parseNumber(exchangeTicker[1]);
        ticker.lowestAsk = Ticker.Ticker.parseNumber(exchangeTicker[2]);
        ticker.highestBid = Ticker.Ticker.parseNumber(exchangeTicker[3]);
        ticker.percentChange = Ticker.Ticker.parseNumber(exchangeTicker[4]);
        ticker.baseVolume = Ticker.Ticker.parseNumber(exchangeTicker[5]);
        ticker.quoteVolume = Ticker.Ticker.parseNumber(exchangeTicker[6]);
        ticker.isFrozen = exchangeTicker[7] ? true : false;
        ticker.high24hr = Ticker.Ticker.parseNumber(exchangeTicker[8]);
        ticker.low24hr = Ticker.Ticker.parseNumber(exchangeTicker[9]);
        return ticker;
    }
}

export default class Poloniex extends AbstractLendingExchange implements ExternalTickerExchange {
    constructor(options: ExOptions) {
        super(options)
        this.publicApiUrl = "https://poloniex.com/public?";
        this.privateApiUrl = "https://poloniex.com/tradingApi";
        //this.pushApiUrl = "wss://api.poloniex.com"; // for autobahn
        this.pushApiUrl = "wss://api2.poloniex.com";
        this.pushApiConnectionType = PushApiConnectionType.WEBSOCKET;
        // TODO polo bot often becomes unresponsive when too many private requests time out. nodejs bug? try not setting "forever" to disable persistent http connections?
        this.httpKeepConnectionsAlive = true;
        this.dateTimezoneSuffix = " GMT+0000";
        this.exchangeLabel = Currency.Exchange.POLONIEX;
        this.minTradingValue = 0.01;
        this.minTradingValueMargin = 0.02; // for margin positions
        this.fee = 0.0025; // TODO use returnFeeInfo API call on startup to get accurate fees if we trade that much to get lower fees
        this.maxLeverage = 2.5;
        this.currencies = new PoloniexCurrencies(this);
        this.webSocketTimeoutMs = nconf.get('serverConfig:websocketTimeoutMs')*2;

        this.lendingFee = 0.0015;
        this.minLendingValue = 0.01;
        this.minLendingValueCurrency = Currency.Currency.BTC;
        this.pollExchangeTicker = nconf.get("lending");
    }

    public getTicker() {
        return new Promise<Ticker.TickerMap>((resolve, reject) => {
            this.publicReq("returnTicker").then((ticker) => {
                resolve(Ticker.TickerMap.fromJson(ticker, this.currencies, this.getExchangeLabel()))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getExternalTicker() {
        return new Promise<Ticker.ExternalTickerMap>((resolve, reject) => {
            this.publicReq("returnTicker").then((ticker) => {
                resolve(Ticker.ExternalTickerMap.fromJson(ticker, this.currencies, this.getExchangeLabel()))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getBalances() {
        return new Promise<Currency.LocalCurrencyList>((resolve, reject) => {
            this.privateReq("returnBalances").then((balances) => {
                /*
                console.log(balances)
                let from = Currency.fromExchangeList(balances)
                console.log(from)
                console.log(Currency.toExchangeList(from))
                */
                /*
                let pair: Currency.CurrencyPair = [Currency.Currency.BTC, Currency.Currency.LTC]
                let strPair = this.currencies.getExchangePair(pair)
                console.log(strPair)
                console.log(this.currencies.getLocalPair(strPair))
                */
                resolve(Currency.fromExchangeList(balances)) // { '1': 0.07235068, '2': 1.99743826 }
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getMarginAccountSummary() {
        return new Promise<MarginAccountSummary>((resolve, reject) => {
            this.privateReq("returnMarginAccountSummary").then((account) => {
                resolve(MarginAccountSummary.fromJson(account))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public fetchOrderBook(currencyPair: Currency.CurrencyPair, depth: number) {
        return new Promise<OrderBookUpdate<MarketOrder.MarketOrder>>((resolve, reject) => {
            const pairStr = this.currencies.getExchangePair(currencyPair)
            this.publicReq("returnOrderBook", {
                currencyPair: pairStr, // or "all"
                depth: depth
            }).then((book) => {
                let orders = new OrderBookUpdate<MarketOrder.MarketOrder>(book.seq, book.isFrozen == "1");
                ["asks", "bids"].forEach((prop) => {
                    book[prop].forEach((o) => {
                        //orders[prop].push({rate: parseFloat(o[0]), amount: parseFloat(o[1])})
                        orders[prop].push(MarketOrder.MarketOrder.getOrder(currencyPair, this.getExchangeLabel(), o[1], o[0]))
                    })
                })
                resolve(orders)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public importHistory(currencyPair: Currency.CurrencyPair, start: Date, end: Date) {
        return new Promise<void>((resolve, reject) => {
            const pairStr = this.currencies.getExchangePair(currencyPair)
            const startMs = start.getTime();
            const endMs = end.getTime();
            let currentMs = startMs;
            let tradeCount = 0;
            let stepMs = 300 * utils.constants.MINUTE_IN_SECONDS * 1000; // poloniex returns max 50k trades per call. reduce this if too high
            let importNext = () => {
                if (currentMs > endMs + stepMs) {
                    logger.info("Import of %s %s history has finished. Imported %s trades", this.className, currencyPair.toString(), tradeCount)
                    let history = new TradeHistory.TradeHistory(currencyPair, this.getExchangeLabel(), start, end);
                    if (tradeCount !== 0)
                        TradeHistory.addToHistory(db.get(), history)
                    return resolve();
                }
                this.publicReq("returnTradeHistory", {
                    currencyPair: pairStr,
                    start: Math.floor(currentMs / 1000),
                    end: Math.floor((currentMs + stepMs) / 1000)
                }).then((history) => {
                    if (history.length >= 50000) {
                        stepMs -= 20 * utils.constants.MINUTE_IN_SECONDS * 1000;
                        if (stepMs <= 1000)
                            return reject({txt: "Unable to get small enough timeframe to import all trades"})
                        logger.warn("%s trade history is incomplete. Retrying with smaller step %s ms", this.className, stepMs)
                        return importNext()
                    }
                    else if (history.length === 0) {
                        currentMs += stepMs;
                        return importNext(); // happens with last range
                    }
                    let trades = [];
                    history.forEach((poloTrade) => {
                        trades.push(Trade.Trade.fromJson(poloTrade, currencyPair, this.getExchangeLabel(), this.getFee(), this.getDateTimezoneSuffix()))
                    })
                    tradeCount += trades.length;
                    Trade.storeTrades(db.get(), trades, (err) => {
                        if (err)
                            logger.error("Error storing trades", err)
                        currentMs += stepMs;
                        logger.verbose("%s %s import at %s with %s trades", this.className, currencyPair.toString(), utils.date.toDateTimeStr(new Date(currentMs)), tradeCount)
                        importNext()
                    })
                }).catch((err) => {
                    logger.warn("Error importing %s trades", this.className, err)
                    setTimeout(importNext.bind(this), 5000); // retry
                })
            }
            importNext();
        })
    }

    public buy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                return this.privateReq("buy", outParams)
            }).then((result) => {
                // { error: 'Not enough BTC.' }
                // { orderNumber: '288867044947', resultingTrades: [] }
                //console.log(result)
                resolve(OrderResult.fromJson(result, currencyPair, this))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public sell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<OrderResult>((resolve, reject) => {
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                return this.privateReq("sell", outParams)
            }).then((result) => {
                //console.log(result)
                resolve(OrderResult.fromJson(result, currencyPair, this))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public cancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            let outParams = {
                orderNumber: orderNumber
            }
            this.privateReq("cancelOrder", outParams).then((result) => {
                resolve({exchangeName: this.className, orderNumber: orderNumber, cancelled: result.success == 1})
            }).catch((err) => {
                // check if already filled (or cancelled)
                if (err.error && err.error.toLowerCase().indexOf("or you are not the person who placed the order"))
                    return resolve({exchangeName: this.className, orderNumber: orderNumber, cancelled: true})
                reject(err)
            })
        })
    }

    public getOpenOrders(currencyPair: Currency.CurrencyPair) {
        return new Promise<OpenOrders>((resolve, reject) => {
            let outParams = {
                currencyPair: this.currencies.getExchangePair(currencyPair) // or "all"
            }
            this.privateReq("returnOpenOrders", outParams).then((result) => {
                let orders = new OpenOrders(currencyPair, this.className);
                result.forEach((o) => {
                    orders.addOrder({orderNumber: parseFloat(o.orderNumber), type: o.type, rate: o.rate, amount: o.amount, total: o.total, leverage: 1}) // TODO leverage is always 1 here, but not used
                })
                resolve(orders)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public moveOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: OrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            this.verifyTradeRequest(null, rate, amount, params).then((outParams) => {
                outParams.orderNumber = orderNumber;
                return this.privateReq("moveOrder", outParams)
            }).then((result) => {
                //console.log(result)
                resolve(OrderResult.fromJson(result, currencyPair, this))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public marginBuy(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            params.marginOrder = true;
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                return this.privateReq("marginBuy", outParams)
            }).then((result) => {
                // { orderNumber: '288867044947', resultingTrades: [] }
                //console.log(result)
                resolve(OrderResult.fromJson(result, currencyPair, this))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public marginSell(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: MarginOrderParameters) {
        return new Promise<OrderResult>((resolve, reject) => {
            params.marginOrder = true;
            this.verifyTradeRequest(currencyPair, rate, amount, params).then((outParams) => {
                return this.privateReq("marginSell", outParams)
            }).then((result) => {
                resolve(OrderResult.fromJson(result, currencyPair, this))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public marginCancelOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string) {
        return this.cancelOrder(currencyPair, orderNumber); // on poloniex orderNumbers are unique across all markets
    }

    public moveMarginOrder(currencyPair: Currency.CurrencyPair, orderNumber: number | string, rate: number, amount: number, params: MarginOrderParameters) {
        params.marginOrder = true;
        return this.moveOrder(currencyPair, orderNumber, rate, amount, params);
    }

    public getAllMarginPositions() {
        return new Promise<MarginPositionList>((resolve, reject) => {
            let outParams = {
                currencyPair: "all"
            }
            this.privateReq("getMarginPosition", outParams).then((positionList) => {
                resolve(MarginPositionList.fromJson(positionList, this.currencies, this.getMaxLeverage()))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<MarginPosition>((resolve, reject) => {
            this.verifyExchangeRequest(currencyPair).then((currencyPairStr) => {
                let outParams = {
                    currencyPair: currencyPairStr
                }
                this.privateReq("getMarginPosition", outParams).then((position) => {
                    resolve(MarginPosition.fromJson(position, this.getMaxLeverage()))
                }).catch((err) => {
                    reject(err)
                })
            })
        })
    }

    public closeMarginPosition(currencyPair: Currency.CurrencyPair) {
        return new Promise<OrderResult>((resolve, reject) => {
            this.verifyExchangeRequest(currencyPair).then((currencyPairStr) => {
                let outParams = {
                    currencyPair: currencyPairStr
                }
                this.privateReq("closeMarginPosition", outParams).then((result) => {
                    resolve(OrderResult.fromJson(result, currencyPair, this))
                }).catch((err) => {
                    reject(err)
                })
            })
        })
    }

    // ################################################################
    // ###################### LENDING FUNCTIONS #######################
    // TODO writeFundingOrderbook() and writeFundingTrade() via http pull or websocket

    public getFundingBalances() {
        return new Promise<Currency.LocalCurrencyList>((resolve, reject) => {
            this.privateReq("returnAvailableAccountBalances").then((balances) => {
                resolve(Currency.fromExchangeList(balances.lending)) // { '1': 0.07235068, '2': 1.99743826 }
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getActiveLoans() {
        return new Promise<ExchangeActiveLoanMap>((resolve, reject) => {
            this.privateReq("returnActiveLoans").then((loans) => {
                if (!loans || !loans.provided)
                    return reject({txt: "invalid response for active loans", exchange: this.className, response: loans})
                let loanMap = new ExchangeActiveLoanMap();
                loans.provided.forEach((loan) => {
                    const currencyStr = this.currencies.getLocalName(loan.currency);
                    const currency = Currency.Currency[currencyStr];
                    const rate = helper.parseFloatVal(loan.rate); // daily rate
                    const created = new Date(loan.date + this.dateTimezoneSuffix);
                    const amount = helper.parseFloatVal(loan.amount);
                    let activeLoan = new ActiveLoan(this.className, loan.id, currency, rate, loan.period, amount, created);
                    loanMap.addLoan(currencyStr, activeLoan)
                })
                resolve(loanMap)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public placeOffer(currency: Currency.Currency, rate: number, amount: number, params: MarginLendingParams) {
        return new Promise<OfferResult>((resolve, reject) => {
            this.verifyLendingRequest(currency, amount).then((exchangeCurrency) => {
                let outParams = {
                    currency: exchangeCurrency,
                    amount: amount,
                    duration: params.days,
                    autoRenew: 0,
                    lendingRate: rate // max 0.05 = 5% // TODO divide by 100?
                }
                return this.privateReq("createLoanOffer", outParams)
            }).then((result) => {
                // {"success":1,"message":"Loan order placed.","orderID":10590}
                resolve(OfferResult.fromJson(result, currency, this))
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public getAllOffers() {
        return new Promise<LoanOffers>((resolve, reject) => {
            this.privateReq("returnOpenLoanOffers").then((offerResponse) => {
                let offers = new LoanOffers(this.className);
                if (Array.isArray(offerResponse)) { // array if no offers, object otherwise
                    if (offerResponse.length === 0)
                        return resolve(offers);
                    return reject({txt: "invalid lending offer response", exchange: this.className, response: offerResponse})
                }
                for (let currency in offerResponse)
                {
                    let curOffers = offerResponse[currency];
                    curOffers.forEach((off) => {
                        let offer = {
                            offerNumber: off.id,
                            type: ("lend" as LoanDirection),
                            currency: Currency.Currency[this.currencies.getLocalName(currency)],
                            rate: off.rate, // TODO correct?
                            days: off.duration,
                            amount: off.amount,
                            remainingAmount: off.amount,
                            created: new Date(off.date + this.dateTimezoneSuffix)
                        }
                        offers.addOffer(offer)
                    })
                }
                resolve(offers)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public cancelOffer(offerNumber: number | string) {
        return new Promise<CancelOrderResult>((resolve, reject) => {
            let outParams = {
                orderNumber: offerNumber
            }
            this.privateReq("cancelLoanOffer", outParams).then((result) => {
                resolve({exchangeName: this.className, cancelled: result.success == 1, orderNumber: offerNumber})
            }).catch((err) => {
                reject(err)
            })
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected publicReq(method: string, params: ExRequestParams = {}) {
        return new Promise<ExResponse>((resolve, reject) => {
            if (!this.publicApiUrl)
                return reject({txt: "PublicApiUrl must be provided for public exchange request", exchange: this.className})

            let data = {
                command: method
            }
            data = Object.assign(data, params);
            let query = querystring.stringify(data);
            const urlStr = this.publicApiUrl + query;
            this.get(urlStr, (body, response) => {
                this.verifyExchangeResponse(body, response, method).then((json) => {
                    resolve(json)
                }).catch((err) => {
                    reject(err)
                })
            })
        })
    }

    protected privateReq(method: string, params: ExRequestParams = {}) {
        return new Promise<ExResponse>((resolve, reject) => {
            this.requestQueue = this.requestQueue.then(() => { // only do 1 request at a time because of nonce
                return new Promise((resolve, reject) => {
                    if (!this.privateApiUrl || !this.apiKey)
                        return reject({txt: "PrivateApiUrl and apiKey must be provided for private exchange request", exchange: this.className})

                    let data = {
                        "nonce": this.getNextNonce(),
                        "command": method
                    }
                    data = Object.assign(data, params);
                    let query = querystring.stringify(data);
                    let options = {
                        headers: {
                            "Key": this.apiKey.key,
                            "Sign": crypto.createHmac('sha512', this.apiKey.secret).update(query).digest('hex')
                        },
                        retry: false // don't retry failed post requests because nonce will be too low
                    }
                    this.post(this.privateApiUrl, data, (body, response) => {
                        this.verifyExchangeResponse(body, response, method).then((json) => {
                            resolve(json)
                        }).catch((err) => {
                            reject(err)
                        })
                    }, options)
                })
            }).then((res) => {
                resolve(res) // forward the result
            }).catch((err) => {
                reject(err) // forward the error
            })
        })
    }

    protected createConnection(): autobahn.Connection {
        let connection = new autobahn.Connection({
            url: this.pushApiUrl,
            realm: "realm1"
            /*
           // max_retries: 100 // https://github.com/crossbario/autobahn-js/blob/master/doc/reference.md
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36"
            }*/
        });
        connection.onopen = (session: autobahn.Session) => {
            let marketEvent = (currencyPair: Currency.CurrencyPair, marketEventStream: EventStream<MarketAction>, args, kwargs) => {
                const seq = kwargs.seq;
                marketEventStream.add(seq, args);
            }
            let tickerEvent = (args, kwargs) => {
                //console.log(args); // a single "array" with only values as information in a specific order
                let ticker = this.currencies.toLocalTicker(args);
                if (ticker)
                    this.ticker.set(ticker.currencyPair.toString(), ticker);
            }
            let trollboxEvent = (args, kwargs) => {
                console.log(args);
            }
            //session.subscribe('BTC_XRP', marketEvent);
            session.subscribe('ticker', tickerEvent);
            //session.subscribe('trollbox', trollboxEvent);
            this.currencyPairs.forEach((pair) => {
                let marketPair = this.currencies.getExchangePair(pair);
                // every market has their own sequence numbers on poloniex. we have to ensure they are piped in order
                let marketEventStream = new EventStream<any>(this.className + "-Market-" + marketPair, this.maxPendingMarketEvents);
                this.openMarketRelays.push(marketEventStream)
                marketEventStream.on("value", (value, seqNr) => {
                    this.marketStream.write(pair, value, seqNr);
                })
                session.subscribe(marketPair, marketEvent.bind(this, pair, marketEventStream));
            })
        }

        connection.onclose = (reason) => {
            this.onConnectionClose(reason);
            return true;
        }

        connection.open();
        return connection;
    }

    protected createWebsocketConnection(): WebSocket {
        let conn: WebSocket = new WebSocket(this.pushApiUrl, this.getWebsocketOptions());
        const marketEventStreamMap = new Map<string, EventStream<any>>(); // (exchange currency name, stream instance)

        conn.onopen = (e) => {
            //conn.send(JSON.stringify({command: "subscribe", channel: 1001})); // trollbox
            conn.send(JSON.stringify({command: "subscribe", channel: 1002})); // ticker
            //conn.send(JSON.stringify({command: "subscribe", channel: 1003}));
            //conn.send(JSON.stringify({command: "subscribe", channel: "BTC_MAID"}));

            this.currencyPairs.forEach((pair) => {
                let marketPair = this.currencies.getExchangePair(pair);
                // every market has their own sequence numbers on poloniex. we have to ensure they are piped in order
                let marketEventStream = new EventStream<any>(this.className + "-Market-" + marketPair, this.maxPendingMarketEvents);
                this.openMarketRelays.push(marketEventStream);
                marketEventStreamMap.set(marketPair, marketEventStream);
                marketEventStream.on("value", (value, seqNr) => {
                    this.marketStream.write(pair, value, seqNr);
                })
                // TODO if we subscribe to too many pairs we don't get updates for all (10?). poloniex limit?
                conn.send(JSON.stringify({command: "subscribe", channel: marketPair}));
            })
            this.updateOrderBooks(false); // we get it through the WebSocket connection

            // does this fix the UI stuck problem?
            // actually seems to work. we get http errors "socket hang up" and websocket errors "closed for unknown reason"
            // but after this reconnect the UI is responsive again
            // maybe we should reconnect immediately after we get "socket hang up" ?
            // cause was orderBook.removeOrder() bevore setting orderbook snapshot
            /*
            setTimeout(() => {
                this.closeConnection(utils.sprintf("Resetting %s websocket connection", this.className))
            }, 15*utils.constants.MINUTE_IN_SECONDS*1000)
            */
        }

        conn.onmessage = (e) => {
            //this.resetWebsocketTimeout(); // timeouts don't work properly for this socket // moved down. sometimes polo sends messages, but no trades
            try {
                if (typeof e.data !== "string")
                    throw new Error("Received data with invalid type " + typeof e.data);
                const msg = JSON.parse(e.data);
                switch (msg[0])
                {
                    case 1000: // subscription with userID: 10201228
                        break;
                    case 1001: // trollbox
                        /**
                         * [ 1001,
                         18201544,
                         'sd8f97hgsd',
                         'Mirai, ok thank you, that&#39;s a pretty big delay considering what I have in limbo :/. It&#39;s scary',
                         0 ]
                         */
                        break;
                    case 1002: // market updates, ticker
                        /**
                         * [ 1002,
                         null,
                         [ 168,
                         '0.00042601',
                         '0.00042601',
                         '0.00042586',
                         '-0.01773115',
                         '777.97267610',
                         '1799875.24250461',
                         0,
                         '0.00044891',
                         '0.00041202' ] ]
                         */
                        let ticker;
                        try {
                            ticker = msg[2];
                            if (!ticker) // first msg is undefined
                                return;
                            //console.log(msg[2]);
                            ticker[0] = markets.byID[ticker[0]].currencyPair; // happens when poloniex adds a new currency (update HTML vars on top)
                            ticker = this.currencies.toLocalTicker(ticker);
                            if (ticker)
                                this.ticker.set(ticker.currencyPair.toString(), ticker);
                        }
                        catch (err) {
                            logger.error("Error parsing %s ticker, likely missing ID in markets %s", this.className, ticker[0], err);
                        }
                        break;
                    case 1003: // some price ticker for main exchange currencies
                        //console.log(msg);
                        /**
                         * [ 1003, 1 ]
                         *
                         * [ 1003,
                         null,
                         [ '2017-05-30 17:03',
                         44393,
                         { BTC: '202376.300',
                           ETH: '27400.169',
                           XMR: '10914.608',
                           USDT: '90195453.425' } ] ]
                         */
                        break;
                    case 1004: // ping? [ 1004, 1 ]
                        break;
                    case 1010: // keep alive ping? [1010]
                        break;
                    default:
                        //console.log(msg);
                        try {
                            let currencyID = msg[0];
                            let market = markets.byID[currencyID];
                            if (!market) {
                                logger.error("Received %s market update for unknown currency pair", this.className, msg);
                                return;
                            }
                            msg[0] = market.currencyPair; // exchange name pair
                            //console.log(msg);
                            let marketEventStream = marketEventStreamMap.get(msg[0]);
                            if (!marketEventStream) {
                                logger.error("Received %s market update for currency pair %s we didn't subscribe to", this.className, msg[0]);
                                return;
                            }
                            this.resetWebsocketTimeout();
                            const seq = msg[1];
                            marketEventStream.add(seq, msg[2]);
                            /**
                             * [ 'BTC_XMR',
                             198320617,
                             [ [ 'o', 1, '0.01930001', '8.72448567' ],                              // order book modification
                             [ 't', '10797115', 0, '0.01930001', '1.10000000', 1496165968 ] ] ]     // trade
                             [ 'BTC_XMR',
                             198320618,
                             [ [ 'o', 1, '0.01912001', '86.43000000' ] ] ]
                             */
                        }
                        catch (err) {
                            logger.error("Error parsing %s websocket currency message", this.className, err);
                        }
                }
            }
            catch (err) {
                logger.error("Error parsing %s websocket message", this.className, err);
            }
        }

        conn.onerror = (err) => {
            logger.error("WebSocket error in %s", this.className, err);
            this.closeConnection("WebSocket error")
        }

        conn.onclose = (event) => {
            let reason = "Unknown error";
            if (event && event.reason)
                reason = event.reason;
            this.onConnectionClose(reason);
        }
        return conn;
    }

    protected verifyTradeRequest(currencyPair: Currency.CurrencyPair, rate: number, amount: number, params: OrderParameters = {}) {
        return new Promise<ExRequestParams>((resolve, reject) => {
            // TODO move more checks to parent class?
            // TODO implement params.matchBestPrice - poloniex only supports limit orders
            if (currencyPair) {
                if (this.currencies.getExchangePair(currencyPair) === undefined)
                    return reject({txt: "Currency pair not supported by this exchange", exchange: this.className, pair: currencyPair, permanent: true});
            }
            const minTradingValue = params.marginOrder ? this.minTradingValueMargin : this.minTradingValue;
            if (amount > 0 && rate * amount < minTradingValue)
                return reject({txt: "Value is below the min trading value", exchange: this.className, value: rate*amount, minTradingValue: minTradingValue, permanent: true})

            let outParams: any = {
                rate: rate
            }
            if (amount > 0)
                outParams.amount = amount;
            if (currencyPair)
                outParams.currencyPair = this.currencies.getExchangePair(currencyPair)
            for (let prop in params)
            {
                if (params[prop])
                    outParams[prop] = 1
            }
            resolve(outParams)
        })
    }

    protected verifyExchangeResponse(body: string | false, response: request.RequestResponse, method: string) {
        return new Promise<any>((resolve, reject) => {
            if (!body)
                return reject({txt: "Error on exchange request", exchange: this.className, method: method, response: response})
            let json = utils.parseJson(body)
            if (!json)
                return reject({txt: "Received invalid JSON from exchange", exchange: this.className, method: method, body: body})
            if (json.error) {
                // Unable to fill order completely. <- TODO reject might cause problems in app logic if we trade on multiple exchanges ?
                return reject({txt: "Error on exchange API call", exchange: this.className, method: method, error: json.error})
            }
            resolve(json)
        })
    }
}