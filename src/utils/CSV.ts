import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as d3 from "d3-dsv";


export class CSV {
    constructor() {
    }

    public parse(csvText: string): d3.DSVRowArray {
        return d3.csvParse(csvText);
    }

    public parseUrl(urlStr: string) {
        return new Promise<d3.DSVRowArray>((resolve, reject) => {
            let options = {
                cloudscraper: true
            }
            utils.getPageCode(urlStr, (body, res) => {
                if (body === false)
                    return reject({txt: "Error loading CSV data from URL", url: urlStr, err: res});
                resolve(d3.csvParse(body));
            }, options)
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

}