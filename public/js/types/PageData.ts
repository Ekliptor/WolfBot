import {user} from "@ekliptor/bit-models";

export interface PageData {
    debug: boolean;
    host: string;
    defaultLang: string;
    pathRoot: string;
    path: {
        [name: string]: string;
    };
    version: string;
    removeDownloadFrameSec: number;
    timezoneDiffMin: number;
    maxLoadRetries: number;
    cookieLifeDays: number;
    cookiePath: string;
    debugLog: boolean;
    sessionName: string;
    successMsgRemoveSec: number;
    multiselect: {
        maxSelect: number;
    }
    user: typeof user.LEVEL;

    data: any;

    html: {
        [filename: string]: {
            [block: string]: string;
        };
    }
}