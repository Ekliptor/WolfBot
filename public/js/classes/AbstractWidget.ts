import {TranslationOptions} from "i18next";

export interface TranslationFunction {
    // any library compatible with the signature of i18next will work. basically just a function t(key) that returns a translated string
    (key: string, options?: TranslationOptions): string | any | Array<any>;
}

export abstract class AbstractWidget {
    protected className: string;
    /*
    protected t: TranslationFunction = (key: string) => {
        console.warn("No translation function provided in %s", this.className);
        return key; // dummy
    };
    */

    constructor(/*t?: TranslationFunction*/) {
        this.className = this.constructor.name;
        //if (t)
            //this.t = t;
    }

    public getClassName() {
        return this.className;
    }

    public addListeners() {
        // overwrite this to add listeners
        // removing is not required for jquery, it has it's internal cleanData() function to remove listeners when removing from DOM
        // however if we use another library for DOM manipulation & listeners we might need removeListeners() in here
        // in browsers DOM listeners are only removed via garbage collection if no JS references exist anymore
    }

    /*
    public setTranslation(t: TranslationFunction) {
        this.t = t;
    }
    */

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}