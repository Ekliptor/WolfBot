import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {AbstractIndicator, STCIndicatorParams} from "./AbstractIndicator";
import {TaLib, TaLibParams, TaLibResult} from "./TaLib";
import {Currency, Trade, Candle} from "@ekliptor/bit-models";
import MACD from "./MACD";
import * as _ from "lodash";

/**
 * STC indicator that reacts to new trends faster than MACD.
 * The STC value oscillates between 0 and 100.
 * https://www.investopedia.com/articles/forex/10/schaff-trend-cycle-indicator.asp
 * https://forum.gekko.wizb.it/thread-56716.html
 * https://github.com/RJPGriffin/gekko/blob/develop/strategies/indicators/STC.js
 * https://www.tradingview.com/chart/lEaTj9yp/
 * https://www.prorealcode.com/prorealtime-indicators/schaff-trend-cycle2/
 */
export default class STC extends AbstractIndicator {
    protected params: STCIndicatorParams;
    protected valuesSTC: number[] = [];
    protected valuesMACD: number[] = [];
    protected f1Buffer: number[] = [];
    protected f2Buffer: number[] = [];
    protected pfBuffer: number[] = [];
    protected pffBuffer: number[] = [];

    protected macd: MACD;

    constructor(params: STCIndicatorParams) {
        super(params)
        this.params = Object.assign(new STCIndicatorParams(), this.params);
        this.macd = new MACD({
            long: this.params.slow,
            short: this.params.fast,
            signal: this.params.stcLength,
            enableLog: this.params.enableLog
        });
    }

    public addCandle(candle: Candle.Candle) {
        return new Promise<void>((resolve, reject) => {
            this.macd.addCandle(candle).then(() => {
                this.valuesSTC = this.addData(this.valuesSTC, candle.close, this.params.stcLength, false);
                let macdHist = this.macd.getHistogram();
                if (macdHist === -1 || this.valuesSTC.length < this.params.stcLength)
                    return resolve(); // not yet ready
                this.valuesMACD = this.addData(this.valuesMACD, macdHist, this.params.stcLength, false);
                if (this.valuesMACD.length < this.params.stcLength)
                    return resolve(); // not yet ready

                // v1 = lowest(m, length)
                const v1 = _.min(this.valuesMACD);
                // v2 = highest(m, length) - v1
                const v2 = _.max(this.valuesMACD) - v1;
                // f1 = (v2 > 0 ? ((m - v1) / v2) * 100 : nz(f1[1]))
                const m_minus_v1 = this.valuesMACD.map(x => x-v1);
                if (v2 > 0)
                    this.f1Buffer = m_minus_v1.map(x => (x/v2) * 100);
                else {
                    if (this.f1Buffer.length === 0)
                        this.f1Buffer.push(0);
                    else
                        this.f1Buffer.push(this.f1Buffer[this.f1Buffer.length-1]);
                }
                // pf = (na(pf[1]) ? f1 : pf[1] + (factor * (f1 - pf[1])))
                if (this.pfBuffer.length === 0)
                    this.pfBuffer = this.f1Buffer;
                else {
                    const previous_pf = this.pfBuffer[this.pfBuffer.length-1];
                    const factor_times_f1_minus_pf_last = this.f1Buffer.map(x => (x - previous_pf) * this.params.factor);
                    this.pfBuffer = factor_times_f1_minus_pf_last.map(x => x + previous_pf);
                }
                // v3 = lowest(pf, length)
                const v3 = _.min(this.pfBuffer);
                // v4 = highest(pf, length) - v3
                const v4 = _.max(this.pfBuffer) - v3;
                // f2 = (v4 > 0 ? ((pf - v3) / v4) * 100 : nz(f2[1]))
                if (v4 > 0)
                    this.f2Buffer = this.pfBuffer.map(x => ((x - v3)/v4) * 100);
                else {
                    if (this.f1Buffer.length === 0)
                        this.f2Buffer.push(0);
                    else
                        this.f2Buffer.push(this.f2Buffer[this.f2Buffer.length-1]);
                }
                if (this.pffBuffer.length === 0)
                    this.pffBuffer = this.f2Buffer;
                else {
                    const last_pff = this.pffBuffer[this.pffBuffer.length-1];
                    this.pffBuffer = this.f2Buffer.map(x => last_pff + (this.params.factor * (x - last_pff)))
                }
                this.value = this.pffBuffer[this.pffBuffer.length-1];
                //this.previousResult = this.pffBuffer[this.pffBuffer.length-2];
                this.shiftBuffers();
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    public removeLatestCandle() {
        this.valuesSTC = this.removeLatestData(this.valuesSTC);
        this.valuesMACD = this.removeLatestData(this.valuesMACD);
        this.f1Buffer = this.removeLatestData(this.f1Buffer);
        this.f2Buffer = this.removeLatestData(this.f2Buffer);
        this.pfBuffer = this.removeLatestData(this.pfBuffer);
        this.pffBuffer = this.removeLatestData(this.pffBuffer);
    }

    public isReady() {
        return this.value !== -1/* && this.valuesSTC.length >= this.params.interval*/;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected shiftBuffers() {
        // buffers have to contain exactly stcLength elements (because we pick the min/max out of them)
        if (this.f1Buffer.length > this.params.stcLength)
            this.f1Buffer.shift();
        if (this.f2Buffer.length > this.params.stcLength)
            this.f2Buffer.shift();
        if (this.pfBuffer.length > this.params.stcLength)
            this.pfBuffer.shift();
        if (this.pffBuffer.length > this.params.stcLength)
            this.pffBuffer.shift();
    }
}

export {STC}