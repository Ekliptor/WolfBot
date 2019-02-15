import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as d3 from "d3-dsv";
import * as fs from "fs";


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

    public format(jsonRows: any[]): string {
        return d3.csvFormat(jsonRows);
    }

    public async writeCsvFile(jsonRows: any[], destPath: string): Promise<void> {
        let csv = this.format(jsonRows);
        try {
            await fs.promises.writeFile(destPath, csv, {encoding: "utf8"});
        }
        catch (err) {
            logger.error("Error writing CSV file to %s", destPath, err);
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

}