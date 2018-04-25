import {ClientSocketReceiver, ClientSocket} from "../classes/WebSocket/ClientSocket";
import {AbstractController} from "./base/AbstractController";
import {WebSocketOpcode} from "../../../src/WebSocket/opcodes";
import {PageData} from "../types/PageData";
import {AppData} from "../types/AppData";
import {AppFunc, HelpersClass} from "@ekliptor/browserutils";
import {LendingConfig} from "../../../src/Lending/LendingConfig";
import {LendingUpdate} from "../../../src/WebSocket/LendingUpdater";

declare var pageData: PageData, appData: AppData;
declare var AppF: AppFunc, Hlp: HelpersClass;

export class Lending extends AbstractController {
    public readonly opcode = WebSocketOpcode.LENDING;

    protected currencies: any; //Currency.CurrencyMap;
    protected configCurrencies: any; //CurrencyJson;

    constructor(socket: ClientSocket) {
        super(socket)
    }

    public onData(data: any) {
        if (data.full) {
            this.$().empty(); // shouldn't be needed
            data.full.forEach((config: LendingUpdate) => {
                this.currencies = config.currencies;
                this.configCurrencies = config.configCurrencies;
                let html = AppF.translate(pageData.html.lending.lendingExchange, {
                    nr: config.nr,
                    exchange: config.exchange
                });
                this.$().append(html);
                let globalHtml = this.getGlobalHtml(config);
                this.$("#exchange-" + config.exchange).append(globalHtml);
                $.each(config.balances, (i, value) => {
                    // TODO option to sort coins by lent amount
                    let exchangeHtml = this.getCurrencyHtml(config, parseInt(i))
                    if (exchangeHtml)
                        this.$("#exchange-" + config.exchange).append(exchangeHtml);
                });
            })
            Hlp.updateTimestampsRepeating(); // currently not used
            return;
        }
        else if (!data.balances)
            return;

        let config: LendingUpdate = data; // update for 1 exchange
        let globalHtml = this.getGlobalHtml(config);
        let nodes = this.$("#exchange-" + config.exchange + " .globalStats");
        for (let i = 1; i < nodes.length; i++) // remove all global stat nodes and replace the first one with the new html
            nodes[i].remove();
        nodes.eq(0).replaceWith(globalHtml);
        $.each(data.balances, (i, value) => {
            const currencyStr = this.currencies[i];
            if (!currencyStr)
                return;
            let exchangeHtml = this.getCurrencyHtml(config, parseInt(i))
            if (this.$("#exchange-" + config.exchange + " ." + currencyStr).length === 0)
                this.$("#exchange-" + config.exchange).append(exchangeHtml); // loan for a new currency
            else
                this.$("#exchange-" + config.exchange + " ." + currencyStr).replaceWith(exchangeHtml); // replace the existing data
        })
        Hlp.updateTimestampsRepeating();
    }

    public render() {
        return new Promise<string>((resolve, reject) => {
            let status = AppF.translate(pageData.html.lending.main)
            resolve(status);
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected getGlobalHtml(config: LendingUpdate): string {
        let html = "";
        const digits = config.interest.currencyStr === "USD" ? 2 : 8;
        let equityAttr = {
            nr: config.nr,
            //currency: currencyStr,
            equity_val: AppF.format(AppF.tr("equity_val"), config.totalEquity.toFixed(digits), config.interest.currencyStr)
        }
        html += AppF.translate(pageData.html.lending.totalEquity, equityAttr);

        let perHourAmount = config.interest.perHour;
        let perHourUnit = config.interest.currencyStr;
        if (config.interest.currencyStr === "BTC") {
            perHourAmount *= 100000000;
            perHourUnit = AppF.tr("satoshi");
        }
        let attributes = {
            nr: config.nr,
            //currency: currencyStr,
            btc_year: AppF.format(AppF.tr("btc_year"), config.interest.perYear.toFixed(8), config.interest.currencyStr),
            btc_month: AppF.format(AppF.tr("btc_month"), config.interest.perMonth.toFixed(8), config.interest.currencyStr),
            btc_week: AppF.format(AppF.tr("btc_week"), config.interest.perWeek.toFixed(8), config.interest.currencyStr),
            btc_day: AppF.format(AppF.tr("btc_day"), config.interest.perDay.toFixed(8), config.interest.currencyStr),
            satoshi_hour: AppF.format(AppF.tr("satoshi_hour"), perHourAmount.toFixed(8), perHourUnit)
        }
        html += AppF.translate(pageData.html.lending.globalLendingData, attributes);
        return html;
    }

    protected getCurrencyHtml(config: LendingUpdate, currencyIndex: number): string {
        // Average loan rate, simple average calculation of active loans rates.
        // Effective loan rate, considering lent precentage and poloniex 15% fee.
        // Effective loan rate, considering poloniex 15% fee. // other mode
        // Compound rate, the result of reinvesting the interest.
        const currencyStr = this.currencies[currencyIndex];
        const lendingData = config.lendingRates[currencyStr];
        if (!lendingData)
            return ""; // undefined for currencies without lending/margin support
        if (this.configCurrencies[currencyStr] === undefined)
            return; // bot not enabled for this currency
        const balanceLent = config.balancesTaken[currencyIndex];
        //if (balanceLent == 0.0)
            //return ""; // hide coins we don't have any active loans
        const rateDay = lendingData.rate;
        const rateDayEff = rateDay * (1 - lendingData.lendingFee) * (config.balancesTakenPercent[currencyIndex] / 100.0);
        const rateYear = rateDayEff * 365; // no reinvestment, use effective rate to be more accurate
        const rateYearComp = (Math.pow(rateDayEff + 1, 365) - 1); // with daily reinvestment, accurate if our bot already runs longer than max loan days of the exchange
        const minLendingRate = config.minLendingRates[currencyStr] ? config.minLendingRates[currencyStr] : 0;
        const isLimited = config.coinStatus[currencyStr] ? config.coinStatus[currencyStr].limited : false; // if no offers are placed = not limited
        let attributes = {
            nr: config.nr,
            currency: currencyStr,
            lent_txt: AppF.format(AppF.tr("lent_txt"), balanceLent.toFixed(8), config.balances[currencyIndex].toFixed(8), config.balancesTakenPercent[currencyIndex]),
            current_rate: AppF.format(AppF.tr("current_rate"), minLendingRate.toFixed(8)),
            min_rate: AppF.format(AppF.tr("min_rate"), this.configCurrencies[currencyStr].minDailyRate.toFixed(8)),
            is_limited: AppF.tr("is_limited") + AppF.tr("colon") + AppF.tr(isLimited ? "yes" : "no"),
            lent_day: AppF.format(AppF.tr("lent_day"), (rateDay * 100).toFixed(8)),
            lent_day_eff: AppF.format(AppF.tr("lent_day_eff"), (rateDayEff * 100).toFixed(8)),
            lent_year: AppF.format(AppF.tr("lent_year"), (rateYear * 100).toFixed(8)),
            lent_year_comp: AppF.format(AppF.tr("lent_year_comp"), (rateYearComp * 100).toFixed(8))
        }
        return AppF.translate(pageData.html.lending.lendingData, attributes);
    }
}