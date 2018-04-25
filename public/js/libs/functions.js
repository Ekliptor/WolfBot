"use strict";
/**
 * JS Helper class for WebApps
 * required values:
 * pageData (see minify.js) + {
 *  defaultLang, host
 * }
 * lang: decPoint, thousandsSep
 */

var AppFunc = {
    cfg: {}, // don't write any properties here because they get overwritten
    Functions: function() {}
};

AppFunc.Functions.prototype = {
    fileDownloadCount: 0,

    /**
     * Load a resource to DOM
     * @param filename {String/Array} the name of the javascript or css file. Can be an array of multiple files
     * @param callback {Function} (optional) a callback function once the resource is ready
     * @param checkFn {Function} (optional) a check function. If this function returns true, the resource is assumed to be already present (and not loaded)
     * @param inOrder {bool} (optional, default false) load the files in the order specified. Needed for library dependencies.
     * The callback function will fire immediately.
     */
    loadResource: function(filename, callback, checkFn, inOrder) {
        if (typeof checkFn === "function" && checkFn()) {
            setTimeout(callback, 0);
            return
        }
        if (typeof filename === "string") {
            AppF.loadScript(filename, filename.substring(filename.length - 4) === ".css", callback);
            return;
        }

        // it's an array of files. load all and fire the callback at the end
        var loadedCount = 0;
        var resourceLoaded = function() {
            loadedCount++;
            if (filename.length > loadedCount)
                return;
            callback && callback();
        }
        var loadNext = function(i) {
            if (i >= filename.length)
                return; // all loaded
            if (!inOrder) { // load them parallel -> faster
                AppF.loadScript(filename[i], filename[i].substring(filename[i].length - 4) === ".css", resourceLoaded);
                loadNext(++i);
            }
            else {
                AppF.loadScript(filename[i], filename[i].substring(filename[i].length - 4) === ".css", function() {
                    resourceLoaded();
                    loadNext(++i);
                });
            }
        }
        loadNext(0);
    },

    loadResourceDelayed: function(filename, checkFn, count) {
        if (typeof count === "undefined")
            count = 0;
        var scope = this;
        setTimeout(function() {
            if (checkFn())
                scope.loadResource(filename);
            else if (count < pageData.maxLoadRetries)
                scope.loadResourceDelayed(filename, checkFn, count+1);
        }, 100);
    },

    loadResourceAfter: function(filename, sec) {
        var scope = this;
        setTimeout(function() {
            scope.loadResource(filename);
        }, sec*1000);
    },

    loadScript: function(filename, isCSS, callback) {
        var fileref;
        if (isCSS) {
            fileref = document.createElement("link");
            fileref.setAttribute("rel", "stylesheet");
            fileref.setAttribute("type", "text/css");
            fileref.setAttribute("href", filename);
        }
        else {
            fileref = document.createElement('script');
            fileref.setAttribute("type", "text/javascript");
            fileref.setAttribute("src", filename);
        }
        if (typeof callback === "function")
            fileref.onload = callback;
        document.getElementsByTagName("head")[0].appendChild(fileref);
    },

    addDownloadFrame: function(url) {
        var frame = document.createElement("iframe");
        frame.setAttribute("src", url);
        frame.setAttribute("width", 1);
        frame.setAttribute("height", 1);
        frame.setAttribute("class", "hidden");
        var frameId = "download" + this.fileDownloadCount;
        frame.setAttribute("id", frameId);
        this.fileDownloadCount++;
        document.getElementsByTagName("body")[0].appendChild(frame);
        setTimeout(function() {
            //$("#" + frameId).remove();
            var frame = document.getElementById(frameId);
            if (frame === null)
                return;
            document.getElementsByTagName("body")[0].removeChild(frame);
        }, pageData.removeDownloadFrameSec*1000);
    },

    addParamToUrl: function(urlStr, key, value, overwrite) {
        if (!value)
            value = "1";
        var start = urlStr.indexOf('?');
        if (start !== -1 && urlStr.indexOf(key + '=') !== -1) {
            if (!overwrite)
                return urlStr // param already exists
            var search = this.escapeRegex(key + '=');
            urlStr = urlStr.replace(new RegExp(search + '[^&]*(&|$)'), ''); // remove it and add it to the end of the url
            urlStr = urlStr.replace(/(\?|&)$/, '');
        }
        var queryParam = urlStr.indexOf('?') !== -1 ? '&' : '?';
        return urlStr + queryParam + key + '=' + value;
    },

    getPageLang: function() {
        var lang = this.getCookie("lng");
        if (lang === null)
            return pageData.defaultLang;
        return lang;
    },

    getBrowserLang: function() {
        return navigator.language.substr(0, 2).toLowerCase();
    },

    getCookie: function(c_name) {
        var i, x, y;
        var ARRcookies = document.cookie.split(";");
        for (i = 0; i < ARRcookies.length; i++)
        {
            x = ARRcookies[i].substr(0, ARRcookies[i].indexOf("="));
            y = ARRcookies[i].substr(ARRcookies[i].indexOf("=") + 1);
            x = x.replace(/^\s+|\s+$/g,"");
            if (x == c_name)
                return decodeURI(y);
        }
        return null;
    },

    setCookie: function(name, value, expireDays) {
        var date = new Date();
        date = new Date(date.getTime()+1000*60*60*24* (expireDays ? expireDays : pageData.cookieLifeDays));
        //document.cookie = name + "=" + value + "; expires=" + date.toGMTString() + "; path=" + pageData.cookiePath + "; domain=." + location.host;
        document.cookie = name + "=" + value + "; expires=" + date.toGMTString() + "; path=" + pageData.cookiePath;
    },

    removeCookie: function(name) {
        //document.cookie = name + "=; expires=Thu, 02 Jan 1970 00:00:00 UTC; path=" + pageData.cookiePath + "; domain=." + location.host;
        document.cookie = name + "=; expires=Thu, 02 Jan 1970 00:00:00 UTC; path=" + pageData.cookiePath;
    },

    setLang: function(lang) {
        this.setCookie("lng", lang);
        document.location.reload();
    },

    isForeignDomain: function(host) {
        if (typeof host !== "string")
            host = pageData.host;
        return window.location.host.match("^(.+\.)?" + this.escapeRegex(host) + "$") === null;
    },

    openLink: function(url) {
        window.open(url, "", "");
    },

    log: function(args) {
        if (typeof pageData.debugLog !== "boolean" || pageData.debugLog === false ||
            typeof console !== "object" || typeof console.log !== "function")
            return;
        console.log(arguments);
    },

    tr: function(key) {
        //if (typeof language[key] === "undefined")
            //return "MISSING: " + key;
        //return language[key];
        return i18next.t(key) // will just print the key if it doesn't exist and debug is disabled
    },

    getTranslation: function(subKey, lang) {
        if (lang === undefined)
            lang = i18next.language;
        var tr = i18next.store.data[lang].translation;
        if (typeof subKey === "string")
            return tr[subKey];
        return tr;
    },

    format: function(string) {
        var start = 0;
        for (var i = 1; i < arguments.length; i++)
        {
            var search = "%" + i;
            start = string.indexOf(search, start);
            if (start === -1)
                break;
            start += 2;
            string = string.replace(search, arguments[i]);
        }
        return string;
    },

    padNumber: function(number, size) {
        var str = number + "";
        while (str.length < size)
            str = "0" + str;
        return str;
    },

    formatNumber: function(number, commaDigits, decimalSep, thousandSep) {
        var commaDigits = isNaN(commaDigits = Math.abs(commaDigits)) ? 2 : commaDigits,
            decimalSep = decimalSep == undefined ? "." : decimalSep,
            thousandSep = thousandSep == undefined ? "," : thousandSep,
            strOutput = number < 0 ? "-" : "",
            intNr = parseInt(number = Math.abs(+number || 0).toFixed(commaDigits)) + "",
            thousands = intNr.length > 3 ? intNr.length % 3 : 0;
        return strOutput + (thousands ? intNr.substr(0, thousands) + thousandSep : "") + intNr.substr(thousands).replace(/(\d{3})(?=\d)/g, "$1" + thousandSep) + (commaDigits ? decimalSep + Math.abs(number - intNr).toFixed(commaDigits).slice(2) : "");
    },

    formatCurrency: function(amount) {
        return AppF.formatNumber(amount, 2, AppF.tr("decPoint"), AppF.tr("thousandsSep"));
    },

    formatBtc: function(amount) {
        return AppF.formatNumber(amount, 8, AppF.tr("decPoint"), AppF.tr("thousandsSep"));
    },

    escapeOutput: function(text, convertNewlines) {
        if (typeof text !== "string")
            return text;
        text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        if (typeof convertNewlines === "undefined" || convertNewlines === true)
            text = text.replace(/\r?\n/g, "<br>");
        return text;
    },

    escapeRegex: function(str) {
        return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
    },

    /**
     * Populate a html template
     * @param text {String}: The html template (or just normal text with variables)
     * @param variables {Object}: the key-value pairs with variables names and their content to be set in text
     * @param safeHtml {boolean, default false}: don't escape html characters if set to true
     * @returns {String} the translated html
     */
    translate: function(text, variables, safeHtml) {
        if (typeof text !== "string") {
            try {
                text = text.toString();
            }
            catch (e) {
                this.log("Text to translate is not a string");
                return text;
            }
        }
        var start = 0, end = 0;
        while ((start = text.indexOf("{", start)) !== -1)
        {
            if (start > 0 && text.charAt(start-1) === "\\") { // escaped javascript code beginning
                start++;
                continue;
            }
            end = text.indexOf("}", start);
            if (end === -1) {
                this.log("Can not find end position while translating HTML");
                break;
            }
            var placeHolder = text.substring(start+1, end);
            var translation = null;
            if (placeHolder.substring(0, 3) === "tr:") {
                var key = placeHolder.substring(3);
                //translation = this.tr(key.toUpperCase());
                translation = this.tr(key);
            }
            else if (typeof variables === "object") {
                var textPiece = variables[placeHolder];
                if (typeof textPiece !== "undefined") {
                    if (typeof safeHtml === "boolean" && safeHtml)
                        translation = textPiece;
                    else
                        translation = this.escapeOutput(textPiece);
                }
            }
            if (translation !== null) {
                var reg = new RegExp("\\{" + placeHolder + "\\}", "g");
                text = text.replace(reg, translation);
            }
            else if (placeHolder.match("[A-Za-z0-9_]+") !== null) {
                this.log("No translation found for place holder: " + placeHolder);
                var reg = new RegExp("\\{" + placeHolder + "\\}", "g");
                text = text.replace(reg, "MISSING: " + this.escapeOutput(placeHolder));
            }
            else
                start += placeHolder.length;
        }
        text = text.replace(/\\\\\\{/, "{");
        return text;
    },

    toInt: function(number) {
        if (number < 0)
            return Math.ceil(number);
        return Math.floor(number);
    },

    urlEncode: function(text) {
        return encodeURIComponent(text).replace(/%20/g, '+');
    },

    urlDecode: function(text) {
        return decodeURIComponent(text.replace(/\+/g, '%20'));
    },

    replaceAll: function(str, search, replace) {
        return str.split(search).join(replace);
    },

    getObject: function(object, path, createNew) {
        if (typeof createNew !== "boolean")
            createNew = false;
        var paths = path.split("."),
            current = object;
        for (var i = 0; i < paths.length; i++)
        {
            if (typeof current[paths[i]] === "undefined") {
                if (createNew)
                    current[paths[i]] = new Object();
                else
                    return null;
            }
            current = current[paths[i]];
        }
        return current;
    },

    fixUrl: function(url, baseUrl) {
        if (typeof baseUrl !== "string")
            baseUrl = window.location.href;
        if (url.match("^https?://") !== null)
            return url;
        if (url[0] === "/")
            url = url.substring(1);
        if (baseUrl[baseUrl.length-1] !== "/")
            baseUrl += "/";

        if (url[0] === "#")// for anchors we have to prepend the whole url
            return baseUrl + url;
        return baseUrl + url;
    },

    getUrlParameters: function(url, decode) {
        decode = typeof decode === "boolean" && decode === true;
        var parameters = {};
        var start = url.indexOf("?");
        if (start === -1) {
            start = url.indexOf("#!");
            if (start === -1) {
                start = url.indexOf("#");
                if (start === -1)
                    return parameters;
                else
                    start += 1;
            }
            else
                start += 2;
        }
        else
            start += 1;
        url = url.substring(start);
        if (url.length === 0)
            return parameters;
        var pos = url.indexOf("#");
        if (pos !== -1)
            url = url.substring(0, pos); // don't search in both
        var fragments = url.split("&");
        for (var i = 0; i < fragments.length; i++)
        {
            var parts = fragments[i].split("=");
            if (parts.length !== 2)
                continue;
            parameters[parts[0]] = decode ? this.urlDecode(parts[1]) : parts[1];
        }
        return parameters;
    },

    hasUserPrivileges: function(level) {
        //var username = this.getCookie("username");
        //var levelSetting = this.getCookie("level");
        var username = appData.username;
        var levelSetting = appData.level;
        if (username == null || levelSetting == null)
            return false;
        return levelSetting <= level;
    },

    isLoggedIn: function() {
        return this.hasUserPrivileges(pageData.user.REGULAR);
    },

    /*
    logout: function(host, logoutFn) {
        if (this.isForeignDomain(host)) {
            this.log("Login expired on foreign domain.");
            return false;
        }
        this.removeCookie(pageData.sessionName);
        this.removeCookie("username");
        this.removeCookie("level");
        if (typeof logoutFn === "function")
            logoutFn();
        return true;
    },
    */

    dateFromString: function(date) {
        return new Date(date.replace(" ", "T"));
    },

    getServerDate: function(ms) {
        var date = new Date();
        // if we get unix time: unix time + (current timezone - server timezone)
        //var msDate = date.getTime() + (browserDate.getTimezoneOffset()-pageData.timezoneDiffMin)*60000;
        // local browser date - local timezone offset + server timezone offset
        var msDate = date.getTime() - date.getTimezoneOffset()*60000 + pageData.timezoneDiffMin*60000;
        return ms === true ? msDate : Math.floor(msDate/1000);
    },

    toLocalDate: function(dateExpr, retMs) {
        var date = new Date(dateExpr);
        var localDate = new Date();
        var ms = date.getTime() + localDate.getTimezoneOffset()*60000 - pageData.timezoneDiffMin*60000;
        return retMs === true ? ms : new Date(ms);
    },

    getCurrentTick: function(ms) {
        if (ms === undefined || ms === true)
            new Date().getTime();
        return Math.round(Date.now() / 1000.0);
    },

    dateAdd: function(date, interval, units) {
        var ret = new Date(date); //don't change original date
        switch (interval.toLowerCase()) {
            case 'year'   :  ret.setFullYear(ret.getFullYear() + units);  	break;
            case 'quarter':  ret.setMonth(ret.getMonth() + 3*units);  		break;
            case 'month'  :  ret.setMonth(ret.getMonth() + units);  		break;
            case 'week'   :  ret.setDate(ret.getDate() + 7*units);  		break;
            case 'day'    :  ret.setDate(ret.getDate() + units);  			break;
            case 'hour'   :  ret.setTime(ret.getTime() + units*3600000);  	break;
            case 'minute' :  ret.setTime(ret.getTime() + units*60000);  	break;
            case 'second' :  ret.setTime(ret.getTime() + units*1000);  		break;
            default       :  ret = undefined;  break;
        }
        return ret;
    },

    getRandomString: function(len) {
        var chars = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        var random = '';
        for (var i = 0; i < len; i++)
            random += chars.charAt(Math.floor(Math.random() * chars.length));
        return random;
    },

    /**
     * Returns a random number between min (inclusive) and max (exclusive)
     * @param min
     * @param max
     * @returns {number}
     */
    getRandom: function(min, max) {
        return Math.random() * (max - min) + min;
    },

    /**
     * Returns a random integer between min (inclusive) and max (exclusive)
     * @param min
     * @param max
     * @returns {int}
     */
    getRandomInt: function(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min)) + min;
    },

    createPopupWindow: function(width, height) {
        var popup = null;
        if (typeof width !== "numeric" || typeof height !== "numeric")
            popup = window.open("", "", "");
        else
            popup = window.open("", "", "width=" + width + ", height=" + height);
        self.focus();
        return popup;
    },

    escapeFrame: function() {
        if (window !== window.top)
            window.top.location = window.location.href;
    },

    extend: function(parentObj, obj) {
        // be aware when using this with instantiated object: it will create references from the child to parent class!
        // always make copies of objects in that case
        // or only use it with prototypes
        for (var i in obj) {
            if (obj.hasOwnProperty(i))
                parentObj[i] = obj[i];
        }
    },

    /**
     * Navigate to a new location on the top frame
     * @param url the url. use "self" to reload the current top frame or "reload" to reload without cache (adds a random url parameter)
     */
    setLocationTop: function(url) {
        if (typeof window.top === "object" && window.top !== window) {
            if (url === "self")
                window.top.location = window.top.location.href;
            else if (url === "reload")
                window.top.location = this.addParamToUrl(window.top.location.href, "ra", this.getRandomInt(0, 900000), true);
            else
                window.top.location = url;
        }
        else {
            if (url === "self")
                window.location = document.location.href;
            else if (url === "reload")
                window.location = this.addParamToUrl(document.location.href, "ra", this.getRandomInt(0, 900000), true);
            else
                window.location = url;
        }
    },

    /**
     * Helper function to read from $.serialize() and $.serializeArray()
     * note: just like with regular browser post unchecked checkboxes are not present (jquery mimics browser submits)
     * @param values
     * @param name
     */
    readSubmitValue: function(valuesArr, name) {
        for (var i = 0; i < valuesArr.length; i++)
        {
            if (valuesArr[i].name === name)
                return valuesArr[i].value;
        }
        return null;
    },

    isOldIE: function() {
        return window.navigator.userAgent.indexOf("MSIE") !== -1;
    },

    isIE11: function() {
        return window.navigator.userAgent.indexOf("like Gecko") !== -1 && window.navigator.userAgent.indexOf("Trident") !== -1;
    }
};

var AppF = new AppFunc.Functions();

// exports for webpack
//window.AppFunc = AppFunc;
//window.AppF = AppF;