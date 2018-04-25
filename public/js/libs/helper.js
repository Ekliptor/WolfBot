"use strict";
/**
 * Helper functions for client-side JS apps
 * requires: AppFunctions class
 * optional: bPopup, some html templates, see pageData.html.foo
 * lang: yes, no, justNow, secAgo, minAgo, hourAgo
 */

var HelpersClass = {
    cfg: {
        maxFameReloadTries: 5,
        frameReloadMs: 4000, // values under 4 seconds can result in false positives due to redirects (e.g. gateways)
        websocketConnectDelayMs: 100,
        downloadWindowKeepOpenMs: 5000 // espcically FF takes a long time
    },
    Device: {PHONE: 0, TABLET: 1, COMPUTER: 2},
    Main: function() {
        if (!pageData.protocol)
            pageData.protocol = document.location.protocol + '//';
        if (!pageData.domainBase)
            pageData.domainBase = document.location.origin;
        if (!pageData.domain)
            pageData.domain = pageData.domainBase + pageData.pathRoot;
    }
};

HelpersClass.Main.prototype = {
    device: HelpersClass.Device.COMPUTER,
    touchDevice: false,
    updateTimestampsTimer: null,
    browserTimeLocales: false,
    browserDateLocales: false,

    initHelpers: function() {
        this.checkBrowserJsSupport();
        this.initPlugins();
    },

    initPlugins: function() {
        if ($.fn.dataTable === undefined)
            return;
        $.fn.dataTable.ext.errMode = 'throw';
        $.fn.dataTableExt.oSort['dynamic-number-asc']  = function(a, b) {
            a = parseFloat($(a).attr('data-sort'));
            b = parseFloat($(b).attr('data-sort'));
            return ((a < b) ? -1 : ((a > b) ?  1 : 0));
        };
        $.fn.dataTableExt.oSort['dynamic-number-desc']  = function(a,b) {
            a = parseFloat($(a).attr('data-sort'));
            b = parseFloat($(b).attr('data-sort'));
            return ((a < b) ? 1 : ((a > b) ?  -1 : 0));
        };
        $.fn.dataTableExt.oSort['static-number-asc']  = function(a, b) {
            if (isNaN(a))
                return -1;
            else if (isNaN(b))
                return 1;
            a = parseFloat(a);
            b = parseFloat(b);
            return ((a < b) ? -1 : ((a > b) ?  1 : 0));
        };
        $.fn.dataTableExt.oSort['static-number-desc']  = function(a,b) {
            if (isNaN(a))
                return 1;
            else if (isNaN(b))
                return -1;
            a = parseFloat(a);
            b = parseFloat(b);
            return ((a < b) ? 1 : ((a > b) ?  -1 : 0));
        };
    },
    getDataSort: function(number, displayValue) {
        return '<span data-sort="' + number + '">' + displayValue + '</span>' // we need this inside because the DataTable sorter only has access to this value
    },

    initSelectSearch: function(colIndex) {
        $.fn.dataTable.ext.search.push(
            function(settings, data, dataIndex) {
                var findStr = $('#' + settings.sTableId + '_filter input').val().toLocaleLowerCase();
                if (findStr.length === 0)
                    return true;
                var table = $('#' + settings.sTableId).DataTable();
                var row = table.row(dataIndex);
                var dataArr = row.data(); // an array with colums starting at 0
                //console.log(dataArr)
                if (colIndex >= dataArr.length)
                    return true;
                var dataStr = dataArr[colIndex];
                var rowContent = $.parseHTML(dataStr); // TODO find a faster way via DataTables api instead of parsing html again
                var searchStr = "";
                //var curRowSelectedOptions = rows.eq(2 + dataIndex).find('.categoryMultiSel option:selected'); // add 2 because of header and footer
                $('option:selected', rowContent).each(function(i, element) {
                    searchStr += $(element).text();
                });
                for (var i = 0; i < dataArr.length; i++)
                {
                    if (i !== colIndex)
                        searchStr += $($.parseHTML(dataArr[i])).text(); // default search on other columns
                }
                //console.log(searchStr, findStr)
                if (searchStr.length === 0)
                    return true;
                searchStr = searchStr.toLocaleLowerCase();
                return searchStr.indexOf(findStr) !== -1;
            }
        );
    },

    setDevice: function(deviceType, canTouch) {
        // fully featured with server and client side: https://github.com/WhichBrowser/WhichBrowser
        // only JS: https://github.com/ded/bowser
        // http://modernizr.com/
        if (typeof deviceType === "number" && typeof canTouch === "boolean") { // enum
            this.device = deviceType;
            this.touchDevice = canTouch;
        }
        else {
            // Detect touch device
            try {
                document.createEvent("TouchEvent");
                this.touchDevice = true;
            } catch (e) {
                this.touchDevice = false;
            }
            // Browser detection
            if ($(window).width() < 500)
                this.device = HelpersClass.Device.PHONE;
            else if ($(window).width() < 900 || this.touchDevice === true)
                this.device = HelpersClass.Device.TABLET;
            else
                this.device = HelpersClass.Device.COMPUTER;
        }
    },
    getDevice: function() {
        return this.device;
    },
    canTouch: function() {
        return this.touchDevice;
    },
    isUserAgent: function(name) {
        var agent = navigator.userAgent.toLowerCase();
        switch (name)
        {
            case "ios":				return agent.match(/(ipod|iphone|ipad)/) !== null;
            case "android":			return agent.match(/like android/) === null && agent.match(/android/) !== null;
            case "windowsphone":	return agent.match(/windows phone/) !== null;
        }
        return false;
    },
    checkBrowserJsSupport: function() {
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleTimeString#Checking_for_support_for_locales_and_options_arguments
        try {
            new Date().toLocaleTimeString('i');
        } catch (e) {
            this.browserTimeLocales = e.name === 'RangeError';
        }
        try {
            new Date().toLocaleDateString('i');
        } catch (e) {
            this.browserDateLocales = e.name === 'RangeError';
        }
    },
    select: function(element) {
        element.focus();
        element.select();
    },
    //prompt: function(html, callback, defaultInput)
    alert: function(html) {
        if (typeof $('body').bPopup !== 'function') { // fallback if not loaded
            alert(html); // will not display HTML
            return;
        }
        if ($('#popupWnd').length === 0)
            $("body").append(pageData.html.misc.popupWindow);
        $('#popupWnd .popupWndContent').html(html);
        return $('#popupWnd').bPopup(); // only 1 will be shown at at time
    },
    confirm: function(html, callback, yesBtn, noBtn) {
        if (typeof $('body').bPopup !== 'function') { // fallback if not loaded
            var response = confirm(html); // will not display HTML
            setTimeout(function() {
                callback(response == true);
            }, 0);
            return;
        }
        if ($('#popupWnd').length === 0)
            $("body").append(pageData.html.misc.popupWindow);
        if (typeof yesBtn !== "object")
            yesBtn = {};
        if (typeof noBtn !== "object")
            noBtn = {};
        if (typeof yesBtn.title !== "string" || yesBtn.title.length === 0)
            yesBtn.title = AppF.tr("yes");
        if (typeof yesBtn.className !== "string" || yesBtn.className.length === 0)
            yesBtn.className = "confirmYesBtn btn btn-primary";
        else if (yesBtn.className.indexOf("confirmYesBtn") === -1)
            yesBtn.className = "confirmYesBtn " + yesBtn.className;
        if (typeof noBtn.title !== "string" || noBtn.title.length === 0)
            noBtn.title = AppF.tr("no");
        if (typeof noBtn.className !== "string" || noBtn.className.length === 0)
            noBtn.className = "confirmNoBtn btn btn-primary";
        else if (noBtn.className.indexOf("confirmNoBtn") === -1)
            noBtn.className = "confirmNoBtn " + noBtn.className;
        html = '<div class="confirmTxt">' + html + '</div>';
        html += '<a href="javascript:;" class="' + yesBtn.className + '" title="' + yesBtn.title + '">' + yesBtn.title + '</a>';
        html += '<a href="javascript:;" class="' + noBtn.className + '" title="' + noBtn.title + '">' + noBtn.title + '</a>';
        $('#popupWnd .popupWndContent').html(html);
        var wnd = $('#popupWnd').bPopup({
            onClose: function() {
                if (this.noCloseEvent === false)
                    callback(false);
            }
        });
        wnd.noCloseEvent = false;
        $('#popupWnd .confirmYesBtn').click(function() {
            wnd.noCloseEvent = true;
            wnd.close("aa");
            callback(true);
        });
        $('#popupWnd .confirmNoBtn').click(function() {
            wnd.noCloseEvent = true;
            wnd.close();
            callback(false);
        });
        return wnd;
    },
    resetClosedWindow: function(element, originalHtml) {
        element.html(originalHtml);
        setTimeout(function() {
            element.removeAttr('style'); // only works delayed because style gets changed on close
        }, 100);
    },
    ensureIframe: function(element, url, count) { // workaround for frames not loading when opening the 2nd time with bPopup
        var scope = this;
        if (typeof count === "undefined")
            count = 0;
        count++;
        setTimeout(function() {
            var frame = null;
            try {
                frame = element.find('iframe').get(0).contentDocument;
            }
            catch (e) {
                if (count <= HelpersClass.cfg.maxFameReloadTries)
                    scope.ensureIframe(element, url, count);
                return; // the frame has loaded correctly. same origin policy prevents us from accessing it
            }
            if (frame.location.hostname !== "") {
                if (count <= HelpersClass.cfg.maxFameReloadTries)
                    scope.ensureIframe(element, url, count);
                return;
            }
            frame.location = url;
        }, HelpersClass.cfg.frameReloadMs);
    },
    showMsg: function(text, type, removeSec) {
        if (typeof type === "undefined")
            type = 'info'; // TODO keep track of currently displaying messages to prevent showing them twice
        var vars = {type: type, text: text};
        var msg = AppF.translate(pageData.html.misc.message, vars, true);
        $('#messages').append(msg);
        $('html, body').animate({scrollTop: 0}, 150);
        if (typeof removeSec !== "number")
            return;
        //var msgId = "msg-" + Appf.getRandomString(8);
        //$('#messages > div').last().attr("id", msgId);
        var messageElement = $('#messages > div').last();
        setTimeout(function() {
            messageElement.remove();
        }, removeSec * 1000);
    },
    initMessageTimeouts: function() {
        $('div.alert').each(function(i, element) {
            var el = $(element);
            var timeout = el.attr("data-timeout");
            if (!timeout)
                return;
            var timeoutSec = parseInt(timeout);
            if (!timeoutSec)
                return;
            setTimeout(function() {
                el.remove();
            }, timeoutSec * 1000);
        });
    },
    trackNavigation: function(path/*, title*/) {
        if (typeof ga !== "function")
            return;
        ga("send", {
            "hitType": "pageview",
            "page": path
            //"title": "my overridden page"
        });
    },
    truncateWords: function(text, length) {
        if (text.length <= length)
            return text;
        var isEndChar = function(character) {
            var chars = [" ", "\t", "\r", "\n"];
            for (var key in chars)
            {
                if (character === chars[key])
                    return true;
            }
            return false;
        };
        var pos = length + 1;
        while (pos < text.length && isEndChar(text[pos]) === false)
            pos++;
        text = text.substring(0, pos) + "...";
        return text;
    },
    updateTimeStamps: function() { // always call updateTimestampsRepeating() to clear timer and force immediate timestamp-update
        var that = this;
        //var timestamp = AppF.getServerDate();
        var timestamp = AppF.getCurrentTick(false);
        var useDataTables = typeof $('body').DataTable === 'function';
        $('.dateTime').each(function() {
            var el = $(this);
            var added = $(this).attr('data-time');
            if (added == 0 || isNaN(added) === true) {
                if (useDataTables) {
                    var curString = el.text();
                    el.html(Hlp.getDataSort(0, curString));
                }
                return // not a number
            }
            var diff = timestamp - added;
            var displayDate = "";
            if (diff > 0) { // it's a date in the past
                //diff = AppF.toLocalDate(diff);
                if (diff <= 60*60) {
                    var minAgo = AppF.toInt(diff/60);
                    if (minAgo < 1)
                        displayDate = AppF.tr("justNow");
                    else
                        displayDate = AppF.format(AppF.tr("minAgo"), minAgo);
                }
                else if (diff <= 24*60*60)
                    displayDate = AppF.format(AppF.tr("hourAgo"), AppF.toInt(diff/(60*60)));
                else {
                    // use browser functions. moment.js is 60KB + 175KB all locales (minified!)
                    var addedDate = new Date(added*1000);
                    //var addedDate = AppF.toLocalDate(added*1000);
                    displayDate = that.toLocaleDateString(addedDate) + " " + that.toLocaleTimeString(addedDate);
                }
            }
            else { // it's a date in the future
                var diffAbs = -1*diff;
                if (diffAbs <= 60*60) {
                    var minFuture = AppF.toInt(diffAbs/60);
                    if (minFuture < 1)
                        displayDate = AppF.tr("justNow");
                    else
                        displayDate = AppF.format(AppF.tr("minFuture"), minFuture);
                }
                else if (diffAbs <= 24*60*60)
                    displayDate = AppF.format(AppF.tr("hourFuture"), AppF.toInt(diffAbs/(60*60)));
                else {
                    var addedDate = new Date(added * 1000);
                    displayDate = that.toLocaleDateString(addedDate) + " " + that.toLocaleTimeString(addedDate);
                }
            }
            if (useDataTables)
                displayDate = Hlp.getDataSort(added, displayDate);
            if (displayDate != "" && displayDate != el.html())
                el.html(displayDate);
        });
    },
    updateTimestampsRepeating: function() {
        if (this.updateTimestampsTimer !== null) {
            clearTimeout(this.updateTimestampsTimer);
            this.updateTimestampsTimer = null;
        }
        if ($('.dateTime').length === 0)
            return;
        this.updateTimeStamps();
        var scope = this;
        this.updateTimestampsTimer = setTimeout(function() {
            scope.updateTimestampsRepeating();
        }, 60*1000);
    },
    updateAbsoluteDates: function() {
        var that = this;
        var useDataTables = typeof $('body').DataTable === 'function';
        $('.absDateTime').each(function() {
            var el = $(this);
            var added = $(this).attr('data-time');
            if (added == 0 || isNaN(added) === true) {
                if (useDataTables) {
                    var curString = el.text();
                    el.html(Hlp.getDataSort(0, curString));
                }
                return // not a number
            }
            var addedDate = new Date(added * 1000);
            var displayDate = that.toLocaleDateString(addedDate) + " " + that.toLocaleTimeString(addedDate);
            if (useDataTables)
                displayDate = Hlp.getDataSort(added, displayDate);
            if (displayDate != "" && displayDate != el.html())
                el.html(displayDate);
        });
    },
    toLocaleDateString: function(date, locales, options) {
        if (this.browserDateLocales === false)
            return date.toLocaleDateString();
        if (!locales)
            locales = appData.lang;
        return date.toLocaleDateString(locales, options);
    },
    toLocaleTimeString: function(date, locales, options) {
        if (this.browserTimeLocales === false)
            return date.toLocaleTimeString();
        if (!locales)
            locales = appData.lang;
        return date.toLocaleTimeString(locales, options);
    },
    getDisplaySize: function(sizeBytes) {
        if (sizeBytes < 1024)
            return AppF.formatCurrency(sizeBytes) + ' ' + AppF.tr('bytes')
        else if (sizeBytes < 1024*1024)
            return AppF.formatCurrency(sizeBytes/1024) + ' ' + AppF.tr('kb')
        else if (sizeBytes < 1024*1024*1024)
            return AppF.formatCurrency(sizeBytes/(1024*1024)) + ' ' + AppF.tr('mb')
        else if (sizeBytes < 1024*1024*1024*1024)
            return AppF.formatCurrency(sizeBytes/(1024*1024*1024)) + ' ' + AppF.tr('gb')
        else// if (sizeBytes < 1024*1024*1024*1024*1024)
            return AppF.formatCurrency(sizeBytes/(1024*1024*1024*1024)) + ' ' + AppF.tr('tb')
    },
    calcNewPictureSize: function(width, height, maxWidth, maxHeight) {
        // return max values if sth went wrong
        if (width == 0 || height == 0)
            return {width: maxWidth, height: maxHeight};

        // don't increase cover size
        if (maxWidth > width)
            maxWidth = width;
        if (maxHeight > height)
            maxHeight = height;

        var newWidth, newHeight;
        if (width >= maxWidth && maxWidth != 0) {
            newWidth = maxWidth;
            newHeight = Math.floor(height*newWidth/width);
        }
        else {
            newWidth = width;
            newHeight = height;
        }
        width = newWidth;
        height = newHeight;

        if (height >= maxHeight && maxHeight != 0) {
            newHeight = maxHeight;
            newWidth = Math.floor(width*newHeight/height);
        }
        width = newWidth;
        height = newHeight;

        return {width: width, height: height};
    },
    getApi: function(path, data, callback, dataType) {
        if (typeof data === "function") {
            callback = data;
            data = null;
        }
        else if (data === undefined)
            data = null;
        var url = pageData.domainBase + path;
        if (url.indexOf('/api') === -1)
            url += '/api';
        return $.get(url, data, function(data) {
            callback(data);
        }, dataType);
    },
    postApi: function(path, data, callback, dataType) {
        var url = pageData.domainBase + path;
        if (url.indexOf('/api') === -1)
            url += '/api';
        return $.post(url, data, function(data) {
            callback(data);
        }, dataType);
    },
    postApiJson: function(path, data, callback, dataType) {
        var data = {
            data: JSON.stringify(data)
        };
        return this.postApi(path, data, callback, dataType);
    }
};

var Hlp = new HelpersClass.Main();

// exports for webpack
//window.HelpersClass = HelpersClass;
//window.Hlp = Hlp;