const MongoClient = require('mongodb').MongoClient;
// dependencies for elastic and redis are hard coded here, but you can use this module without connecting to those servers
import elasticsearch = require('elasticsearch');
import redis = require('redis');
import crypto = require('crypto');

const SEARCH_LOG_VERBOSE = false
const ELASTIC_API_VER = '5.0'
const REDIS_DEFAULT_TTL_MIN: number = 5 // set to 0 to disable TTL and only use LRU to free memory if redis memory limit is reached

let db = module.exports;
export = db;

let state = {
    db: null,
    searchClient: null,
    redisClient: null,
    cacheEnabled: true
}

let redisPrefix = ''

db.connectAll = function(options, logger, done) {
    if (done === undefined) {
        done = logger
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
            db.connect(options.url, connectDone.bind(this, resolve, reject))
        }))
    }
    if (options.searchHosts) {
        connectOps.push(new Promise((resolve, reject) => {
            db.connectSearch(options.searchHosts, logger, connectDone.bind(this, resolve, reject))
        }))
    }
    if (options.redis) {
        connectOps.push(new Promise((resolve, reject) => {
            db.connectRedis(options.redis, connectDone.bind(this, resolve, reject))
        }))
    }
    Promise.all(connectOps).then(() => {
        done();
    }).catch((err) => {
        done(err);
    })
}

db.connect = function(url, done) {
    if (state.db !== null)
        return done();
    MongoClient.connect(url, (err, db) => {
        if (err)
            return done(err);
        state.db = db;
        done();
    })
}

db.connectSearch = function(hosts, logger, done) {
    if (done === undefined) {
        done = logger
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

db.connectRedis = function(redisOptions, done) {
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

db.setCacheEnabled = function(enabled) {
    state.cacheEnabled = enabled;
}

db.get = function() {
    return state.db;
}

db.getSearch = function() {
    return state.searchClient;
}

db.getRedis = function() {
    return state.redisClient;
}

db.getState = function() {
    return state
}

db.close = function(done) {
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
    state.db.close((err, result) => {
        state.db = null;
        done(err);
    })
}



// Redis cache functions
let getStringKey = (keyObj) => {
    if (typeof keyObj === 'string')
        return redisPrefix + keyObj
    let key = JSON.stringify(keyObj)
    return redisPrefix + crypto.createHash('md5').update(key, 'utf8').digest('base64')
}

let skipCache = (callback = null) => {
    if (state.cacheEnabled == false) {
        setTimeout(() => {
            callback && callback(null);
        }, 0);
        return true;
    }
    return false;
}

db.addToCache = function(key, value, expirationMin = 0, callback = null) {
    if (skipCache(callback))
        return;
    let args = [getStringKey(key)] // SET key value [EX seconds] [PX milliseconds] [NX|XX]
    args.push(JSON.stringify(value))
    if (expirationMin > 0)
        args.push('EX', expirationMin*60 + "")
    else if (REDIS_DEFAULT_TTL_MIN !== 0)
        args.push('EX', REDIS_DEFAULT_TTL_MIN*60 + "")
    db.getRedis().set(args, (err) => {
        callback && callback(err)
    })
}

db.getFromCache = function(key, callback) {
    let getFromRedis = (callback) => {
        db.getRedis().get(getStringKey(key), (err, data) => {
            if (err || !data)
                return callback(null)
            callback(JSON.parse(data))
        })
    }
    if (callback === undefined) {
        return new Promise((resolve, reject) => {
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

db.deleteFromCache = function(key, callback) {
    if (skipCache(callback))
        return;
    db.getRedis().del(getStringKey(key), (err) => {
        callback && callback(err)
    })
}