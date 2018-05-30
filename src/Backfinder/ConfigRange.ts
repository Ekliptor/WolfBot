import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;

export abstract class ConfigRange<T> {
    public values: any[];
    public currentValue: any;
    public isConfigRange = true; // used for easier instance checking then "instanceof" with all subclasses

    constructor() {
    }

    public static getRange(arr: any[]): StringConfigRange | NumberConfigRange | BooleanConfigRange {
        const type = typeof arr[0] // all array elements should have the same type
        switch (type)
        {
            case "string":
                return new StringConfigRange(arr);
            case "number":
                return new NumberConfigRange(arr);
            case "boolean":
                return new BooleanConfigRange(arr);
            default:
                logger.error("Can not add range config of type %s:", type, arr);
                return null;
        }
    }

    public setCurrentValue(value: any) {
        this.currentValue = value;
    }

    public setRandomValue() {
        let minMax = this.getMinMax();
        this.currentValue = minMax[utils.getRandomInt(0, minMax.length)];
    }

    protected abstract getMinMax(): T[];
}

export class StringConfigRange extends ConfigRange<string> {
    public values: string[];
    public currentValue: string;

    constructor(arr: string[]) {
        super()
        this.values = arr;
    }

    protected getMinMax() {
        return this.values;
    }
}

export class NumberConfigRange extends ConfigRange<number> {
    public values: number[];
    public currentValue: number;
    protected isFloat: boolean;

    constructor(arr: number[]) {
        super()
        this.values = arr;
        this.isFloat = this.checkIsFloat();
    }

    public setRandomValue() {
        let minMax = this.getMinMax();
        // we can choose any number between min and max (inclusive)
        if (this.isFloat) {
            let factor = nconf.get("serverConfig:optimizeNumberDecimals") // any digit after that decimal gets lost during optimization (set to 0)
            this.currentValue = utils.getRandomInt(minMax[0]*factor, (minMax[1] + 1)*factor);
            this.currentValue = this.currentValue / factor;
        }
        else
            this.currentValue = utils.getRandomInt(minMax[0], minMax[1] + 1);
    }

    protected getMinMax() {
        let min: number = Number.POSITIVE_INFINITY;
        let max: number = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < this.values.length; i++)
        {
            if (this.values[i] < min)
                min = this.values[i];
            if (this.values[i] > max)
                max = this.values[i];
        }
        return [min, max];
    }

    protected checkIsFloat() {
        for (let i = 0; i < this.values.length; i++)
        {
            if (Math.floor(this.values[i]) !== this.values[i])
                return true;
        }
        return false;
    }
}

export class BooleanConfigRange extends ConfigRange<boolean> {
    public values: boolean[];
    public currentValue: boolean;

    constructor(arr: boolean[]) {
        super()
        this.values = arr;
    }

    protected getMinMax() {
        return utils.uniqueArrayValues<boolean>(this.values);
    }
}