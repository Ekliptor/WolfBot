import * as utils from "@ekliptor/apputils";
import * as fs from "fs";
// compressor = nconf.get('debug') ? null : require('node-minify')
// we stick with v1 for now, v2 buggy and very slow (gcc port to javascript?)
// still not fixed https://github.com/srod/node-minify/issues/122 - but we use TS use-strict flag for all files now
//import * as compressor from "node-minify";
import * as HtmlMinifier from "html-minifier";
const htmlMinify = HtmlMinifier.minify
//import * as xutils from "expressutils";
import * as async from 'async';
import * as path from "path";
const nconf = utils.nconf
import {user} from "@ekliptor/bit-models";

const minifyBufferMb = 10

interface MinifyReadOp {
    filename: string;
    text: string;
}

let getTemplate = function(fileContents, block) {
    let template = fileContents.split("<!-- " + block + " -->\n", 2)
    if (template.length !== 2) // messy because of different line breaks on windows and unix
        template = fileContents.split("<!-- " + block + " -->\r\n", 2)
    template = template[1].split("<!-- /" + block + " -->", 2)
    return template[0]
}

/**
 * Load html tmeplates as an object. Filenames will be the first child property and block-names the second.
 * @param callback (err, htmlObject)
 */
let loadHtmlTemplates = function(callback) {
    // alternative overkill: client-side jade https://www.npmjs.com/package/express-jade
    let subTemplateDir = utils.appDir + path.join('views') + path.sep
    fs.readdir(subTemplateDir, (err, files) => {
        if (err)
            return callback && callback(err)
        let readQueue = []
        files.forEach((file) => {
            if (file.substr(-5) !== '.html')
                return
            readQueue.push((cb) => {
                fs.readFile(subTemplateDir + file, 'utf8', (err, text) => {
                    cb(err, {
                        filename: file,
                        text: text
                    })
                })
            })
        })
        async.series<MinifyReadOp, any>(readQueue, (err, results) => {
            if (err)
                return callback && callback(err)
            let html = {}
            results.forEach((result) => {
                let options = {startPos: 0}
                let filename = result.filename.replace(/\.html$/, '')
                html[filename] = {}
                let block: string | false = ''
                while ((block = utils.text.getBetween(result.text, '<!-- ', ' -->', options)) !== false)
                {
                    if (block[0] === '/') // check that it's not the ending of a block
                        continue
                    html[filename][block] = getTemplate(result.text, block)
                    if (nconf.get('debug') === false) { // not really a bit improvement, since our html has just little parts
                        html[filename][block] = htmlMinify(html[filename][block], {
                            //removeAttributeQuotes: true
                        }).replace(/\r\n|\n+/g, '')
                    }
                }
            })
            callback(null, html)
        })
    })
}

export interface WriteConstantsOptions {
    copyFiles?: string[];
}

/**
 * Write javascript data for the browser
 * @param options {
 *      copyFiles: [] An array of strings with files to be copied to public/js/libs/ (for shared JS source on client and server)
 * }
 * @param callback
 */
export function writeConstants(options: WriteConstantsOptions = {}, callback) {
    if (typeof options === 'function') {
        callback = options
        options = {}
    }
    if (!options.copyFiles)
        options.copyFiles = []

    let pageData = {
        debug: nconf.get('debug'),
        //protocol: nconf.get('protocol'),
        host: nconf.get('host'),
        // don't leak private data if we are behind an nginx reverse proxy on our server, set variables on client-side
        //domain: nconf.get('domain'),
        //domainBase: nconf.get('domainBase'),
        defaultLang: nconf.get('defaultLang'),
        pathRoot: nconf.get('pathRoot'),
        path: nconf.get('path'),
        version: nconf.get('version'), // all.min.js will have the version string. so it will always be the latest
        // for functions.js
        removeDownloadFrameSec: nconf.get('removeDownloadFrameSec'),
        timezoneDiffMin: nconf.get('timezoneDiffMin'),
        maxLoadRetries: nconf.get('maxLoadRetries'),
        cookieLifeDays: nconf.get('cookieLifeDays'),
        cookiePath: nconf.get('pathRoot'),
        debugLog: nconf.get('debug'),
        sessionName: nconf.get('sessionName'),
        successMsgRemoveSec: nconf.get('successMsgRemoveSec'),
        multiselect: nconf.get('multiselect'),
        user: user.LEVEL, // levels
        data: {
            maxPredictionOffPercent: nconf.get('data:maxPredictionOffPercent')
        },
        html: {
            //misc.popupWindow and more, see below
        }
    }
    loadHtmlTemplates((err, templates) => {
        if (err)
            return callback && callback(err)
        pageData.html = templates
        // write everything together
        let js = 'var pageData = ' + JSON.stringify(pageData, null, 4) + ';'
        fs.writeFile(utils.appDir + 'public/js/constants.js', js, (err) => {
            if (err)
                return callback && callback(err)

            // copy shared js sources
            let copyOps = []
            const destDir = path.join(utils.appDir, 'public', 'js', 'libs') + path.sep
            options.copyFiles.forEach((copySrc) => {
                let fileName = path.basename(copySrc)
                copyOps.push(utils.file.copy(copySrc, path.join(destDir, fileName)))
            })
            Promise.all(copyOps).then(() => {
                callback && callback()
            }).catch((err) => {
                callback && callback(err)
            })
        })
    })
}

export function minifyResourcesDelayed(javascriptFiles: string[], cssFiles: string[], delayMs = 3000) {
    throw new Error("Not implemented without express")
}

export function minifyResources(javascriptFiles: string[], cssFiles: string[], outJavascript = "all.min.js", outCss = "style.min.css") {
    throw new Error("Not implemented without express")
}

export function minifyJavascriptFile(fileIn) {
    throw new Error("Not implemented without express")
}