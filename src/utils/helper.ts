import * as utils from "@ekliptor/apputils";
const logger = utils.logger
const nconf = utils.nconf

let checkedParent = false;

export function sendMessageToParent(message: any) {
    return new Promise<void>((resolve, reject) => {
        if (typeof process.send !== "function") {
            if (checkedParent === false) {
                checkedParent = true;
                let type = message.type ? message.type : "unknown";
                logger.warn("NodeJS is not running as a child process. Skipped sending '%s' message to parent.", type)
            }
            return setTimeout(resolve.bind(this), 0);
        }
        process.send(message, undefined, undefined, (err) => {
            if (err)
                return reject({txt: "Error sending message to parent process", err: err})
            resolve()
        })
    })
}

/**
 * Returns the % difference between value1 and value2
 * @param value1
 * @param value2
 * @returns {number} the % difference > 0 if value1 > value2, < 0 otherwise
 */
export function getDiffPercent(value1: number, value2: number) {
    if (value2 === 0)
        return 0;
    return ((value1 - value2) / value2) * 100; // ((y2 - y1) / y1)*100 - positive % if value1 > value2
}

export function getFirstApiKey() {
    const apiKeys = nconf.get("apiKeys");
    for (let prop in apiKeys)
    {
        if (apiKeys[prop] === true)
            return prop;
    }
    return "";
}

export function parseFloatVal(value: string) {
    let nr = parseFloat(value)
    if (nr === Number.NaN) {
        logger.warn("Error parsing float value %s", value)
        nr = 0;
    }
    return nr;
}

export function roundDecimals(val: number, decimals: number) {
    const shift = Math.pow(10, decimals);
    return Math.round(val * shift) / shift;
}