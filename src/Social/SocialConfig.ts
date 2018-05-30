import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {Currency} from "@ekliptor/bit-models";
import {AbstractConfig} from "../Trade/AbstractConfig";


export interface SocialConfigRuntimeUpdate {
    updateMin: number;
}

export class SocialConfig extends AbstractConfig {
    public readonly updateMin: number = 5; // HTTP poll update interval (if not using websockets or API)
    // also modify ConfigEditor when adding new properties here
    //public readonly websites: any; // not stored here. websites have their own instances
    //public readonly watchers: any; // not stored here. watchers have their own instances

    protected static nextConfigNr: number = 0;

    constructor(json: any, configName: string) {
        super(json, configName)
        if (typeof json.updateMin === "number")
            this.updateMin = json.updateMin;
    }

    public static resetCounter() {
        AbstractConfig.resetCounter();
    }

    public update(update: SocialConfigRuntimeUpdate) {
        // TODO add/remove properties is not working
        for (let prop in update)
        {
            if (update[prop] !== undefined) // don't set invalid values (removing means setting them to 0/null)
                this[prop] = update[prop];
        }
    }
}