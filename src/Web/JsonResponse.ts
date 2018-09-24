import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;

export class JsonResponse {
    public error = false;
    public errorCode = 0;
    public errorMsg = "";

    public data: any[] = [];

    constructor() {
    }

    public setError(code: number, msg: string = "") {
        this.error = true;
        this.errorCode = code;
        this.errorMsg = msg;
    }
}