import * as MongoClient from "mongodb";
// dependencies for elastic and redis are hard coded here, but you can use this module without connecting to those servers
import * as elasticsearch from "elasticsearch";
import * as redis from "redis";
import * as crypto from "crypto";


const SEARCH_LOG_VERBOSE = false
const ELASTIC_API_VER = '7.6' // 7.6, 7.5, 7.4, 7.3, 7.2, 7.1, 7.0, 6.8, 5.6, 7.7, 7.x, master
const REDIS_DEFAULT_TTL_MIN: number = 5 // set to 0 to disable TTL and only use LRU to free memory if redis memory limit is reached

export class DatbaseState {
    public mongoClient: MongoClient.MongoClient = null; // mongodb driver v3
    public db: MongoClient.Db = null;
    public searchClient: elasticsearch.Client = null;
    public redisClient: redis.RedisClient = null;
    public cacheEnabled: boolean = true;
}

let state = new DatbaseState(); // our global DB state object holding all connections

let redisPrefix = "";

export interface DatabaseOptions {
    url: string; // mongo url
    searchHosts?: string[]; // elasticsearch hosts
    redis?: RedisOptions; // redis daemon url and config
}
export interface DoneCallback {
    (err?: any): void;
}
export interface DatabaseLogger {
    debug?(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    info(...args: any[]): void;
    log(...args: any[]): void;
}
export interface RedisOptions {
    url: string;
    connectTotalMin?: number;
    maxReconnectAttempts?: number;
    cachePrefix?: string;
}

export function connectAll(options: DatabaseOptions, logger: DatabaseLogger, done: DoneCallback) {
    if (done === undefined) {
        done = logger as unknown as DoneCallback;
        logger = null
    }
    let connectDone = (resolve, reject, err) => {
        if (err)
            return reject(err)
        resolve()
    }
    let connectOps = []
    if (options.url) {
        connectOps.push(new Promise((resolve, reject) => {
            connect(options.url, connectDone.bind(this, resolve, reject))
        }))
    }
    if (options.searchHosts) {
        connectOps.push(new Promise((resolve, reject) => {
            connectSearch(options.searchHosts, logger, connectDone.bind(this, resolve, reject))
        }))
    }
    if (options.redis) {
        connectOps.push(new Promise((resolve, reject) => {
            connectRedis(options.redis, connectDone.bind(this, resolve, reject))
        }))
    }
    Promise.all(connectOps).then(() => {
        done();
    }).catch((err) => {
        done(err);
    })
}

export function connect(url: string, done: DoneCallback) {
    if (state.db !== null)
        return done();
    MongoClient.connect(url, {useUnifiedTopology: true, useNewUrlParser: true}, (err, db) => {
        if (err)
            return done(err);
        state.mongoClient = db;
        state.db = db.db();
        done();
    })
}

export function connectSearch(hosts: string[], logger: DatabaseLogger, done: DoneCallback) {
    if (done === undefined) {
        done = logger as unknown as DoneCallback;
        logger = null
    }
    if (state.searchClient !== null)
        return done();
    function createLoggerInstance(config) {
        // config is the object passed to the client constructor.
        this.close = function () { /* nothing to do */ };
        this.error = logger.error.bind(logger);
        if (SEARCH_LOG_VERBOSE === false) {
            this.warning = function() {};
            this.info = function() {};
            this.debug = function() {};
            this.trace = function() {};
            return;
        }
        this.warning = logger.warn.bind(logger);
        this.info = logger.info.bind(logger);
        let debugLogFn = typeof logger.debug === 'function' ? logger.debug : logger.log; // winston vs console logger and others
        this.debug = debugLogFn.bind(logger);
        this.trace = function (method, requestUrl, body, responseBody, responseStatus) {
            debugLogFn({
                method: method,
                requestUrl: requestUrl,
                body: body,
                responseBody: responseBody,
                responseStatus: responseStatus
            });
        };
    }
    state.searchClient = new elasticsearch.Client({
        host: hosts,
        //log: 'trace'
        log: logger ? createLoggerInstance : null,
        apiVersion: ELASTIC_API_VER
    });
    setTimeout(done, 50); // TODO there is no connected callback?
}

export function connectRedis(redisOptions: RedisOptions, done: DoneCallback) {
    if (!redisOptions.url)
        return done('Can not connect to redis without an URl')
    if (!redisOptions.connectTotalMin)
        redisOptions.connectTotalMin = 60;
    if (!redisOptions.maxReconnectAttempts)
        redisOptions.maxReconnectAttempts = 20;
    if (redisOptions.cachePrefix)
        redisPrefix = redisOptions.cachePrefix

    let redisConnected = false // close the app if we can't connect on startup
    state.redisClient = redis.createClient({
        url: redisOptions.url,
        retry_strategy: (options) => {
            if (redisConnected === false) {
                done("Error connecting to Redis Server + " + options.error.toString());
                //process.exit(1);
                return;
            }
            if (!options) // redis closed
                return 8000; // reconnect after ms
            if (options.error['code'] === 'ECONNREFUSED')
                return new Error('The redis server refused the connection');
            if (options.total_retry_time > 1000 * 60 * redisOptions.connectTotalMin) { // total time since last connection
                // End reconnecting after a specific timeout and flush all commands with a individual error
                return new Error('Retry time exhausted');
            }
            if (options.times_connected > redisOptions.maxReconnectAttempts)
                return undefined; // End reconnecting with built in error
            return Math.max(options.attempt * 100, 3000); // reconnect after ms
        }
    })
    state.redisClient.on('ready', () => {
        redisConnected = true
        done();
    })
}

export function setCacheEnabled(enabled: boolean) {
    state.cacheEnabled = enabled;
}

export function get() {
    return state.db;
}

export function getSearch() {
    return state.searchClient;
}

export function getRedis() {
    return state.redisClient;
}

export function getState() {
    return state
}

export function close(done: DoneCallback) {
    if (state.searchClient !== null) {
        state.searchClient.close(); // no callback available
        state.searchClient = null;
    }
    if (state.redisClient !== null) {
        state.redisClient.quit(); // no callback available
        state.redisClient = null;
    }
    if (state.db === null)
        return done(); // already closed
    state.mongoClient.close((err, result) => {
        state.mongoClient = null;
        state.db = null;
        done(err);
    })
}



// Redis cache functions
let getStringKey = (keyObj: any) => {
    if (typeof keyObj === 'string')
        return redisPrefix + keyObj
    let key = JSON.stringify(keyObj)
    return redisPrefix + crypto.createHash('md5').update(key, 'utf8').digest('base64')
}

let skipCache = (callback: DoneCallback = null) => {
    if (state.cacheEnabled == false) {
        setTimeout(() => {
            callback && callback(null);
        }, 0);
        return true;
    }
    return false;
}

export function addToCache(key: any, value: any, expirationMin: number = 0, callback: DoneCallback = null) {
    if (skipCache(callback))
        return;
    const keyStr = getStringKey(key);
    const valueStr = JSON.stringify(value);
    let args = [undefined, undefined];
    if (expirationMin > 0)
        args = ["EX", expirationMin*60 + ""];
    else if (REDIS_DEFAULT_TTL_MIN !== 0)
        args = ["EX", REDIS_DEFAULT_TTL_MIN*60 + ""];
    if (args[0] == undefined) {
        getRedis().set(keyStr, valueStr, (err) => {
            callback && callback(err)
        })
        return;
    }
    getRedis().set(keyStr, valueStr, args[0], args[1], (err) => {
        callback && callback(err)
    })
}

export function getFromCache(key: any, callback?: DoneCallback) {
    let getFromRedis = (callback) => {
        getRedis().get(getStringKey(key), (err, data) => {
            if (err || !data)
                return callback(null)
            callback(JSON.parse(data))
        })
    }
    if (callback === undefined) {
        return new Promise<any>((resolve, reject) => {
            if (skipCache())
                return resolve(null);
            getFromRedis((data) => {
                resolve(data)
            })
        })
    }
    if (skipCache(callback))
        return;
    getFromRedis(callback)
}

export function deleteFromCache(key: any, callback?: DoneCallback) {
    if (skipCache(callback))
        return;
    getRedis().del(getStringKey(key), (err) => {
        callback && callback(err)
    })
}
