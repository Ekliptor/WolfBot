//import {AbstractWidget} from "../classes/AbstractWidget";
import {ClientSocketReceiver, ClientSocket} from "../../classes/WebSocket/ClientSocket";
import * as $ from "jquery";
import {Chart} from "chart.js";
import {AbstractController} from "./AbstractController";

export interface PlotData {
    label: string;
    dataPoints: number[];

    // social
    dataPointsChange?: number[];
    dataPointsSentiment?: number[];
}
export class PlotChartOptions {
    legend: string[];
    dataPointsKey = "dataPoints";
    maxLines: number = Number.MAX_VALUE;
    constructor(legend: string[]) {
        this.legend = legend;
    }
}

export abstract class ChartController extends AbstractController {
    constructor(socket: ClientSocket) {
        super(socket)
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected plotLineChart(/*currencyStr: string, currencyData: SocialPost.SocialPostAggregate[]*/domID: string, plotData: PlotData[], plotOptions: PlotChartOptions) {
        let data = {
            labels: plotOptions.legend,
            datasets: [
            ]
        };
        const colors = [
            "#ff6f74",
            "#51a423",
            "#c01bff",
            "#FFCE56",
            "#b7b9eb",
            "#fbbff2",
            "#3690d8",
            "#57e232",
            "#FF6384",
            "#a4ff38",
            "#000000",
            "#ff583d",
            "#53ffd3",
            "#ff1e1a",
            "#25cdf2",
            "#ff2af0",
            "#7cf18d",
            "#ffe847",
            "#1d3fff",
            "#daded7"
        ];
        for (let i = 0; i < plotData.length; i++)
        {
            if (i >= plotOptions.maxLines) // limit the number of lines to show graphs more clearly
                break;
            let curPlotData = plotData[i];
            const nextColor = colors[i % colors.length];
            data.datasets.push({
                label: curPlotData.label,
                fill: false,
                lineTension: 0.1,
                //backgroundColor: "rgba(75,192,192,0.4)",
                backgroundColor: nextColor,
                borderColor: nextColor,
                borderCapStyle: 'butt',
                borderDash: [],
                borderDashOffset: 0.0,
                borderJoinStyle: 'miter',
                //pointBorderColor: "rgba(75,192,192,1)",
                pointBorderColor: nextColor,
                pointBackgroundColor: "#fff",
                pointBorderWidth: 1,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: nextColor,
                pointHoverBorderColor: "rgba(220,220,220,1)",
                pointHoverBorderWidth: 2,
                pointRadius: 1,
                pointHitRadius: 10,
                data: curPlotData[plotOptions.dataPointsKey],
                spanGaps: false
            })
        }
        let options = {
            scales: {
                yAxes: [{
                    ticks: {
                        beginAtZero: true // TODO improve. bad y adjustment for activity change. true/false doesn't help
                    }
                }]
            },
            legend: this.getChartLegendConfig()
        }
        let ctx = this.$(domID);
        let deletionChart = new Chart(ctx, { // TODO wait for typings fix
            type: 'line',
            data: data,
            options: options
        });
        return deletionChart;
    }

    protected getChartLibs () {
        /*
        if (!pageData.debug)
            return document.location.origin + "/js/libs/Charts.min.js";
        return [document.location.origin + "/js/libs/Chart.min.js",
            document.location.origin + "/js/libs/Chart.PieceLabel.min.js"];
        */
        return document.location.origin + "/js/libs/Chart.bundle.js";
    }

    protected getChartLegendConfig() {
        return {
            labels: {
                fontSize: 18,
                fontColor: '#000'
            }
        }
    }
}