import {ClientSocketReceiver, ClientSocket} from "../classes/WebSocket/ClientSocket";
import {AbstractController} from "./base/AbstractController";
import {WebSocketOpcode} from "../../../src/WebSocket/opcodes";
import {PageData} from "../types/PageData";
import {AppData} from "../types/AppData";
import {AppFunc, HelpersClass} from "@ekliptor/browserutils";
import {PredictionCurrencyData} from "../../../src/AI/Brain";
import * as helper from "../utils/helper";

declare var pageData: PageData, appData: AppData;
declare var AppF: AppFunc, Hlp: HelpersClass;

export class Oracle extends AbstractController {
    public readonly opcode = WebSocketOpcode.ORACLE;

    constructor(socket: ClientSocket) {
        super(socket)
    }

    public onData(data: any) {
        if (data.predictions && data.predictions.predictions.length !== 0) {
            this.$("#waitingOracle").fadeOut("slow");
            this.$("#predictions").empty();

            for (let i = 0; i < data.predictions.predictions.length; i++)
            {
                if (i === 0)
                    this.createPredictionTables(data.predictions.predictions[i], data.predictions.current);
                let lastRealData = i > 0 ? data.predictions.realData[i-1] : null;
                this.appendPredictionRows(data.predictions.predictions[i], data.predictions.realData[i], lastRealData);
            }
            this.showTrendArrows(data.predictions.predictions[0], data.predictions.current)
        }
    }

    public render() {
        return new Promise<string>((resolve, reject) => {
            let status = AppF.translate(pageData.html.oracle.main)
            resolve(status);
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected createPredictionTables(predictions: PredictionCurrencyData, current: PredictionCurrencyData) {
        for (let currencyPair in predictions)
        {
            // create the table for each currency pair
            let vars = {
                currencyPair: AppF.escapeOutput(currencyPair),
                currentRate: current[currencyPair].toFixed(8)
            }
            let html = AppF.translate(pageData.html.oracle.predictionTable, vars, true);
            this.$("#predictions").append(html);
        }
    }

    protected appendPredictionRows(predictions: PredictionCurrencyData, realData: PredictionCurrencyData, lastRealData: PredictionCurrencyData) {
        for (let currencyPair in predictions)
        {
            let real = realData && realData[currencyPair] ? realData[currencyPair] : 0;
            const diffPercent = helper.getDiffPercent(real, predictions[currencyPair]);
            let predictionCorrect = Math.abs(diffPercent) <= pageData.data.maxPredictionOffPercent;
            if (predictionCorrect && lastRealData) { // check if the direction of the prediction was correct
                if (/*diffPercent > 0 && */realData[currencyPair] < lastRealData[currencyPair] && predictions[currencyPair] > lastRealData[currencyPair])
                    predictionCorrect = false; // the price went down, but our prediction was up
                else if (realData[currencyPair] > lastRealData[currencyPair] && predictions[currencyPair] < lastRealData[currencyPair])
                    predictionCorrect = false; // the price went up, but our prediction was down
            }
            let vars = {
                prediction: predictions[currencyPair].toFixed(8),
                realValue: real ? real.toFixed(8) : AppF.tr("minus"),
                predictionClass: real === 0 ? "" : (predictionCorrect ? "blue" : "orange")
            }
            let html = AppF.translate(pageData.html.oracle.predictionRow, vars, false);
            this.$("#predictionTable" + currencyPair + " tbody").append(html);
        }
    }

    protected showTrendArrows(predictions: PredictionCurrencyData, current: PredictionCurrencyData) {
        for (let currencyPair in predictions)
        {
            const hideArrow = predictions[currencyPair] >= current[currencyPair] ? ".fa-arrow-down" : ".fa-arrow-up";
            this.$("#prediction" + currencyPair + " " + hideArrow).addClass("hidden")
        }
    }
}