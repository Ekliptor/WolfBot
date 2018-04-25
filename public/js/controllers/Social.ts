import {ClientSocketReceiver, ClientSocket} from "../classes/WebSocket/ClientSocket";
import {WebSocketOpcode} from "../../../src/WebSocket/opcodes";
import {PageData} from "../types/PageData";
import {AppData} from "../types/AppData";
import {AppFunc, HelpersClass} from "@ekliptor/browserutils";
import {SocialConfig} from "../../../src/Social/SocialConfig";
import {SocialUpdate} from "../../../src/Social/SocialController";
import {Chart} from "chart.js";
import {SocialPost} from "@ekliptor/bit-models";
import {ChartController, PlotData, PlotChartOptions} from "./base/ChartController";

declare var pageData: PageData, appData: AppData;
declare var AppF: AppFunc, Hlp: HelpersClass;

type ChartContentType = "activity" | "activityChange" | "sentiment";

export class Social extends ChartController {
    public readonly opcode = WebSocketOpcode.SOCIAL;

    protected chartLibsLoaded = true; // currently always included globally
    protected maxAge: Date = null;
    protected listTopSocialCurrencies: number = 0;
    protected chartLegendDays: number = 0;
    protected serverDate: Date = null;
    protected chartLegend: string[] = [];
    protected nextData: SocialUpdate = null;

    constructor(socket: ClientSocket) {
        super(socket)
    }

    public onData(data: any) {
        if (data.maxAge) {
            this.maxAge = new Date(data.maxAge); // if we use JSON (instead of EJSON)
            this.chartLegendDays = data.days;
            this.listTopSocialCurrencies = data.listTopSocialCurrencies;
            this.serverDate = new Date(data.serverDate);
            this.createChartLegend();
            return;
        }
        if (data.full) {
            this.$().empty(); // shouldn't be needed
            let html = AppF.translate(pageData.html.social.global, {
                utcTime: this.getUtcTimeStr()
            });
            this.$().append(html);
            this.nextData = data.full;
            let networks = Object.keys(this.nextData);
            networks.forEach((network) => {
                let html = AppF.translate(pageData.html.social.socialNetwork, {
                    network: network,
                    networkHeadline: network === "MULTIPLE" ? AppF.tr("news") : network
                });
                this.$().append(html);
                this.addChartHtml(network, "activity");
                this.addChartHtml(network, "activityChange");
                this.addChartHtml(network, "sentiment");
            })
            Hlp.updateTimestampsRepeating(); // currently not used
            if (!this.chartLibsLoaded) {
                // TODO find a way to load it delayed. currently it must be loaded in index.html because otherwise webpack internals say
                // "Chart is not defined". defining it as an empty object casuses Chart.js to load incorrectly
                AppF.loadResource(this.getChartLibs(), this.displayChartData.bind(this), null, true);
            }
            else
                this.displayChartData();
            return;
        }
    }

    public render() {
        return new Promise<string>((resolve, reject) => {
            let status = AppF.translate(pageData.html.social.main)
            resolve(status);
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected addChartHtml(network: string, type: ChartContentType) {
        let statsHtml = AppF.translate(pageData.html.social.chart, {
            chartHeadline: AppF.tr(type),
            network: network,
            type: type
        });
        this.$("#network-" + network).append(statsHtml);
    }

    protected displayChartData() {
        this.chartLibsLoaded = true;
        for (let network in this.nextData)
        {
            let activityPlotData: PlotData[] = [];
            let activitySortable = [];
            let data = this.nextData[network];
            for (let currencyStr in data.postStats)
            {
                let currencyData: SocialPost.SocialPostAggregate[] = data.postStats[currencyStr];
                let yesterdayIndex = currencyData.length - 2; // -1 causes problems around midnight when we don't have all points yet // TODO improve crawler
                if (yesterdayIndex < 0)
                    yesterdayIndex = 0;
                activityPlotData.push({
                    label: currencyStr,
                    dataPoints: currencyData.map(d => d.postCount + d.commentCount),
                    dataPointsChange: currencyData.map(d => d.activityChange),
                    dataPointsSentiment: currencyData.map((d) =>  {
                        if (network === "MULTIPLE")
                            return Math.round(d.sentimentHeadline.compAvg * 10000.0) / 10000.0
                        return Math.round(d.sentiment.compAvg * 10000.0) / 10000.0
                    })
                });
                activitySortable.push({
                    label: currencyStr,
                    views: currencyData[yesterdayIndex].postCount + currencyData[yesterdayIndex].commentCount // only keep the value of yesterday to sort by it
                });
            }

            // sort activity data by todays activity
            activitySortable.sort((a, b) => {
                return b.views - a.views // sort descending
            })
            let activityPlotDataSorted: PlotData[] = [];
            activitySortable.forEach((activity) => {
                let value = activityPlotData.find(d => d.label === activity.label);
                activityPlotDataSorted.push(value);
            })
            let activityOpts = new PlotChartOptions(this.chartLegend);
            this.plotLineChart("#chart-" + network + "-activity", activityPlotDataSorted, activityOpts);
            this.listTopCurrencies("#chart-" + network + "-activity", network, activityPlotDataSorted);
            let activityChangeOpts = new PlotChartOptions(this.chartLegend);
            activityChangeOpts.dataPointsKey = "dataPointsChange";
            this.plotLineChart("#chart-" + network + "-activityChange", activityPlotDataSorted, activityChangeOpts);
            let sentimentOpts = new PlotChartOptions(this.chartLegend);
            sentimentOpts.dataPointsKey = "dataPointsSentiment";
            this.plotLineChart("#chart-" + network + "-sentiment", activityPlotDataSorted, sentimentOpts);
        }
        this.nextData = null;
    }

    protected listTopCurrencies(domID: string, network: string, plotData: PlotData[]) {
        let toplist = "";
        for (let i = 0; i < this.listTopSocialCurrencies && i < plotData.length; i++)
        {
            let prevPoint = plotData[i].dataPoints.length - 1; // array indices start at 0
            if (prevPoint >= 1)
                prevPoint -= 1;
            else
                prevPoint = 0;
            toplist += (i+1) + ". " +  plotData[i].label + ": " + plotData[i].dataPoints[prevPoint] + "<br>";
        }
        let html = AppF.translate(pageData.html.social.topCurrencies, {
            network: network,
            topCurrencies: AppF.format(AppF.tr("topCurrencies"), network),
            toplist: toplist
        }, true);
        $(html).insertAfter(domID)
    }

    protected createChartLegend() {
        let legend: string[] = [];
        let currentDate = new Date(this.maxAge); // copy it
        for (let i = 0; i < this.chartLegendDays; i++)
        {
            legend.push(currentDate.toLocaleDateString(appData.locale, {timeZone: "UTC"}));
            currentDate.setDate(currentDate.getDate() + 1);
        }
        this.chartLegend = legend;
    }

    protected getUtcTimeStr() {
        if (!this.serverDate)
            return "";
        return this.serverDate.toLocaleDateString(appData.locale,{timeZone:"UTC"}) + " " + this.serverDate.toLocaleTimeString(appData.locale,{timeZone:"UTC"});
    }
}