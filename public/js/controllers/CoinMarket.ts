import {ClientSocketReceiver, ClientSocket} from "../classes/WebSocket/ClientSocket";
import {WebSocketOpcode} from "../../../src/WebSocket/opcodes";
import {PageData} from "../types/PageData";
import {AppData} from "../types/AppData";
import {AppFunc, HelpersClass} from "@ekliptor/browserutils";
import {Chart} from "chart.js";
import {SocialPost} from "@ekliptor/bit-models";
import {CoinMarketUpdate} from "../../../src/WebSocket/CoinMarketUpdater";
import {ChartController, PlotChartOptions, PlotData} from "./base/ChartController";

declare var pageData: PageData, appData: AppData;
declare var AppF: AppFunc, Hlp: HelpersClass;

type ChartContentType = "coinRateComparison";

export class CoinMarket extends ChartController {
    public readonly opcode = WebSocketOpcode.COINMARKET;

    protected chartLibsLoaded = true; // currently always included globally
    protected maxAge: Date = null;
    protected chartLegendDays: number = 0;
    protected serverDate: Date = null;
    protected crawlTickerHours: number = 0;
    protected chartLegend: string[] = [];
    protected nextData: CoinMarketUpdate = null;

    constructor(socket: ClientSocket) {
        super(socket)
    }

    public onData(data: any) {
        if (data.maxAge) {
            this.maxAge = new Date(data.maxAge); // if we use JSON (instead of EJSON)
            this.chartLegendDays = data.days;
            this.serverDate = new Date(data.serverDate);
            this.crawlTickerHours = data.crawlTickerHours;
            this.createChartLegend();
            return;
        }
        if (data.full) {
            this.$().empty(); // shouldn't be needed (if we do incremental updates, which we don't currently on this view)
            let html = AppF.translate(pageData.html.coinMarketStats.coinRates, {});
            this.$().append(html);
            this.nextData = data.full;
            this.addChartHtml("coinRateComparison");
            if (!this.chartLibsLoaded) {
                AppF.loadResource(this.getChartLibs(), this.displayChartData.bind(this), null, true);
            }
            else
                this.displayChartData();
            this.showVolumeSpikes();
            Hlp.updateTimestampsRepeating(); // used for spikes
            this.nextData = null;
            return;
        }
    }

    public render() {
        return new Promise<string>((resolve, reject) => {
            let status = AppF.translate(pageData.html.coinMarketStats.main)
            resolve(status);
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected addChartHtml(type: ChartContentType) {
        let statsHtml = AppF.translate(pageData.html.coinMarketStats.chart, {
            chartHeadline: AppF.tr(type),
            type: type
        });
        this.$("#" + type).append(statsHtml);
    }

    protected displayChartData() {
        this.chartLibsLoaded = true;
        let coinPlotData: PlotData[] = [];
        for (let currencyStr in this.nextData.coinStats)
        {
            coinPlotData.push({
                label: currencyStr,
                dataPoints: this.nextData.coinStats[currencyStr]
            });
        }
        let coinOpts = new PlotChartOptions(this.chartLegend);
        this.plotLineChart("#chart-coinRateComparison", coinPlotData, coinOpts);
    }

    protected showVolumeSpikes() {
        let html = AppF.translate(pageData.html.coinMarketStats.volumeSpikes, {
            coinVolumeSpikes: AppF.format(AppF.tr("coinVolumeSpikes"), this.crawlTickerHours)
        });
        this.$().append(html);
        for (let exchange in this.nextData.volumeSpikes)
        {
            let spikeArr = this.nextData.volumeSpikes[exchange];
            let spikes = "";
            for (let i = 0; i < spikeArr.length; i++)
            {
                spikes += i + ". " + spikeArr[i].currencyPair + " " + spikeArr[i].spikeFactor.toFixed(2) + "x";
                spikes += ", from " + Math.round(spikeArr[i].lastTicker.quoteVolume) + ", to " + Math.round(spikeArr[i].currentTicker.quoteVolume);
                spikes += ", price change " + spikeArr[i].priceChange.toFixed(2) + "%";
                let timeHtml = AppF.translate(pageData.html.misc.time, {
                    timestamp: Math.floor(spikeArr[i].date.getTime() / 1000),
                    time: spikeArr[i].date.getTime()
                });
                spikes += ", " + timeHtml  + "<br>";
            }
            html = AppF.translate(pageData.html.coinMarketStats.exchangeVolumeSpike, {
                exchange: exchange,
                spikesEx: spikes
            }, true);
            this.$("#volumeSpikes").append(html);
        }
    }

    protected createChartLegend() {
        let legend: string[] = [];
        let currentDate = new Date(this.maxAge); // copy it
        for (let i = 0; i < this.chartLegendDays * 24; i++) // we have hourly ticks on our x axis
        {
            legend.push(currentDate.toLocaleDateString(appData.locale, {timeZone: "UTC"}) + " " + currentDate.getUTCHours() + ":00");
            currentDate.setTime(currentDate.getTime() + 1*3600000)
        }
        this.chartLegend = legend;
    }
}