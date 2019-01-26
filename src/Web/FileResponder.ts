import * as utils from "@ekliptor/apputils";
const logger = utils.logger
const nconf = utils.nconf
import * as db from'../database';
import * as http from "http";
import * as fs from "fs";
import * as path from "path";


export class FileResponder {
    constructor() {
    }

    public async respond(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            if (req.params.bt)
                return this.respondWithBacktestFile(req, res);
            res.writeHead(404, {'Content-Type': 'text/html; charset=UTF-8'});
            res.end("File not found - Unknown/missing URL parameters")
        }
        catch (err) {
            logger.error("Error responding with file", err);
            res.writeHead(500, {'Content-Type': 'text/html; charset=UTF-8'})
            res.end('Error processing request')
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected async respondWithBacktestFile(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const download = req.params.dl === "1";
        // path.join(utils.appDir, nconf.get("tradesDir"), nconf.get("backfindDir")); // TODO backfinding for web interface
        const localPath = path.join(utils.appDir, nconf.get("tradesDir"), req.params.bt);
        try {
            let data = await utils.file.readFile(localPath);
            let headers: any = {'Content-Type': 'text/html; charset=UTF-8'}
            if (download === true)
                headers["Content-Disposition"] = utils.sprintf('attachment; filename="%s"', req.params.bt); // params already get decoded
            res.writeHead(200, headers);
            res.end(data);
        }
        catch (err) {
            logger.error("Error sending backtest file %s", localPath, err);
            res.writeHead(404, {'Content-Type': 'text/html; charset=UTF-8'});
            res.end("File not found") // the most likely cause
        }
    }
}