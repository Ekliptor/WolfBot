/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId]) {
/******/ 			return installedModules[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.l = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// define getter function for harmony exports
/******/ 	__webpack_require__.d = function(exports, name, getter) {
/******/ 		if(!__webpack_require__.o(exports, name)) {
/******/ 			Object.defineProperty(exports, name, { enumerable: true, get: getter });
/******/ 		}
/******/ 	};
/******/
/******/ 	// define __esModule on exports
/******/ 	__webpack_require__.r = function(exports) {
/******/ 		if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 		}
/******/ 		Object.defineProperty(exports, '__esModule', { value: true });
/******/ 	};
/******/
/******/ 	// create a fake namespace object
/******/ 	// mode & 1: value is a module id, require it
/******/ 	// mode & 2: merge all properties of value into the ns
/******/ 	// mode & 4: return value when already ns object
/******/ 	// mode & 8|1: behave like require
/******/ 	__webpack_require__.t = function(value, mode) {
/******/ 		if(mode & 1) value = __webpack_require__(value);
/******/ 		if(mode & 8) return value;
/******/ 		if((mode & 4) && typeof value === 'object' && value && value.__esModule) return value;
/******/ 		var ns = Object.create(null);
/******/ 		__webpack_require__.r(ns);
/******/ 		Object.defineProperty(ns, 'default', { enumerable: true, value: value });
/******/ 		if(mode & 2 && typeof value != 'string') for(var key in value) __webpack_require__.d(ns, key, function(key) { return value[key]; }.bind(null, key));
/******/ 		return ns;
/******/ 	};
/******/
/******/ 	// getDefaultExport function for compatibility with non-harmony modules
/******/ 	__webpack_require__.n = function(module) {
/******/ 		var getter = module && module.__esModule ?
/******/ 			function getDefault() { return module['default']; } :
/******/ 			function getModuleExports() { return module; };
/******/ 		__webpack_require__.d(getter, 'a', getter);
/******/ 		return getter;
/******/ 	};
/******/
/******/ 	// Object.prototype.hasOwnProperty.call
/******/ 	__webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";
/******/
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(__webpack_require__.s = "./public/js/index.ts");
/******/ })
/************************************************************************/
/******/ ({

/***/ "../../../NodeJS/Packets/browserutils/build/utils.js":
/*!***************************************************************************!*\
  !*** /Volumes/untitled/Coding/NodeJS/Packets/browserutils/build/utils.js ***!
  \***************************************************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const EJSON = __webpack_require__(/*! ejson */ "../../../NodeJS/Packets/browserutils/node_modules/ejson/index.js");
exports.EJSON = EJSON;
//window["EJSON"] = EJSON;
let BrowserUtils = { EJSON };
exports.BrowserUtils = BrowserUtils;
/*
namespace BrowserUtils {
    export type AppFunc = AppFuncLocal;
    export type HelpersClass = HelpersClassLocal;
}
*/
//export {BrowserUtils}


/***/ }),

/***/ "../../../NodeJS/Packets/browserutils/node_modules/ejson/index.js":
/*!****************************************************************************************!*\
  !*** /Volumes/untitled/Coding/NodeJS/Packets/browserutils/node_modules/ejson/index.js ***!
  \****************************************************************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

module.exports = (function () {
"use strict";
var Meteor = { _noYieldsAllowed:function nope(f) { return f(); }};
var EJSON, EJSONTest, i, Base64, root = {};
var _ = __webpack_require__(/*! underscore */ "../../../NodeJS/Packets/browserutils/node_modules/underscore/underscore.js");
// Base 64 encoding

var BASE_64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

var BASE_64_VALS = {};

for (var i = 0; i < BASE_64_CHARS.length; i++) {
  BASE_64_VALS[BASE_64_CHARS.charAt(i)] = i;
};

Base64 = {};

Base64.encode = function (array) {

  if (typeof array === "string") {
    var str = array;
    array = Base64.newBinary(str.length);
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      if (ch > 0xFF) {
        throw new Error(
          "Not ascii. Base64.encode can only take ascii strings.");
      }
      array[i] = ch;
    }
  }

  var answer = [];
  var a = null;
  var b = null;
  var c = null;
  var d = null;
  for (var i = 0; i < array.length; i++) {
    switch (i % 3) {
    case 0:
      a = (array[i] >> 2) & 0x3F;
      b = (array[i] & 0x03) << 4;
      break;
    case 1:
      b = b | (array[i] >> 4) & 0xF;
      c = (array[i] & 0xF) << 2;
      break;
    case 2:
      c = c | (array[i] >> 6) & 0x03;
      d = array[i] & 0x3F;
      answer.push(getChar(a));
      answer.push(getChar(b));
      answer.push(getChar(c));
      answer.push(getChar(d));
      a = null;
      b = null;
      c = null;
      d = null;
      break;
    }
  }
  if (a != null) {
    answer.push(getChar(a));
    answer.push(getChar(b));
    if (c == null)
      answer.push('=');
    else
      answer.push(getChar(c));
    if (d == null)
      answer.push('=');
  }
  return answer.join("");
};

var getChar = function (val) {
  return BASE_64_CHARS.charAt(val);
};

var getVal = function (ch) {
  if (ch === '=') {
    return -1;
  }
  return BASE_64_VALS[ch];
};

// XXX This is a weird place for this to live, but it's used both by
// this package and 'ejson', and we can't put it in 'ejson' without
// introducing a circular dependency. It should probably be in its own
// package or as a helper in a package that both 'base64' and 'ejson'
// use.
Base64.newBinary = function (len) {
  if (typeof Uint8Array === 'undefined' || typeof ArrayBuffer === 'undefined') {
    var ret = [];
    for (var i = 0; i < len; i++) {
      ret.push(0);
    }
    ret.$Uint8ArrayPolyfill = true;
    return ret;
  }
  return new Uint8Array(new ArrayBuffer(len));
};

Base64.decode = function (str) {
  var len = Math.floor((str.length*3)/4);
  if (str.charAt(str.length - 1) == '=') {
    len--;
    if (str.charAt(str.length - 2) == '=')
      len--;
  }
  var arr = Base64.newBinary(len);

  var one = null;
  var two = null;
  var three = null;

  var j = 0;

  for (var i = 0; i < str.length; i++) {
    var c = str.charAt(i);
    var v = getVal(c);
    switch (i % 4) {
    case 0:
      if (v < 0)
        throw new Error('invalid base64 string');
      one = v << 2;
      break;
    case 1:
      if (v < 0)
        throw new Error('invalid base64 string');
      one = one | (v >> 4);
      arr[j++] = one;
      two = (v & 0x0F) << 4;
      break;
    case 2:
      if (v >= 0) {
        two = two | (v >> 2);
        arr[j++] = two;
        three = (v & 0x03) << 6;
      }
      break;
    case 3:
      if (v >= 0) {
        arr[j++] = three | v;
      }
      break;
    }
  }
  return arr;
};

/**
 * @namespace
 * @summary Namespace for EJSON functions
 */
EJSON = {};
EJSONTest = {};



// Custom type interface definition
/**
 * @class CustomType
 * @instanceName customType
 * @memberOf EJSON
 * @summary The interface that a class must satisfy to be able to become an
 * EJSON custom type via EJSON.addType.
 */

/**
 * @function typeName
 * @memberOf EJSON.CustomType
 * @summary Return the tag used to identify this type.  This must match the tag used to register this type with [`EJSON.addType`](#ejson_add_type).
 * @locus Anywhere
 * @instance
 */

/**
 * @function toJSONValue
 * @memberOf EJSON.CustomType
 * @summary Serialize this instance into a JSON-compatible value.
 * @locus Anywhere
 * @instance
 */

/**
 * @function clone
 * @memberOf EJSON.CustomType
 * @summary Return a value `r` such that `this.equals(r)` is true, and modifications to `r` do not affect `this` and vice versa.
 * @locus Anywhere
 * @instance
 */

/**
 * @function equals
 * @memberOf EJSON.CustomType
 * @summary Return `true` if `other` has a value equal to `this`; `false` otherwise.
 * @locus Anywhere
 * @param {Object} other Another object to compare this to.
 * @instance
 */


var customTypes = {};
// Add a custom type, using a method of your choice to get to and
// from a basic JSON-able representation.  The factory argument
// is a function of JSON-able --> your object
// The type you add must have:
// - A toJSONValue() method, so that Meteor can serialize it
// - a typeName() method, to show how to look it up in our type table.
// It is okay if these methods are monkey-patched on.
// EJSON.clone will use toJSONValue and the given factory to produce
// a clone, but you may specify a method clone() that will be
// used instead.
// Similarly, EJSON.equals will use toJSONValue to make comparisons,
// but you may provide a method equals() instead.
/**
 * @summary Add a custom datatype to EJSON.
 * @locus Anywhere
 * @param {String} name A tag for your custom type; must be unique among custom data types defined in your project, and must match the result of your type's `typeName` method.
 * @param {Function} factory A function that deserializes a JSON-compatible value into an instance of your type.  This should match the serialization performed by your type's `toJSONValue` method.
 */
EJSON.addType = function (name, factory) {
  if (_.has(customTypes, name))
    throw new Error("Type " + name + " already present");
  customTypes[name] = factory;
};

var isInfOrNan = function (obj) {
  return _.isNaN(obj) || obj === Infinity || obj === -Infinity;
};

var builtinConverters = [
  { // Date
    matchJSONValue: function (obj) {
      return _.has(obj, '$date') && _.size(obj) === 1;
    },
    matchObject: function (obj) {
      return obj instanceof Date;
    },
    toJSONValue: function (obj) {
      return {$date: obj.getTime()};
    },
    fromJSONValue: function (obj) {
      return new Date(obj.$date);
    }
  },
  { // NaN, Inf, -Inf. (These are the only objects with typeof !== 'object'
    // which we match.)
    matchJSONValue: function (obj) {
      return _.has(obj, '$InfNaN') && _.size(obj) === 1;
    },
    matchObject: isInfOrNan,
    toJSONValue: function (obj) {
      var sign;
      if (_.isNaN(obj))
        sign = 0;
      else if (obj === Infinity)
        sign = 1;
      else
        sign = -1;
      return {$InfNaN: sign};
    },
    fromJSONValue: function (obj) {
      return obj.$InfNaN/0;
    }
  },
  { // Binary
    matchJSONValue: function (obj) {
      return _.has(obj, '$binary') && _.size(obj) === 1;
    },
    matchObject: function (obj) {
      return typeof Uint8Array !== 'undefined' && obj instanceof Uint8Array
        || (obj && _.has(obj, '$Uint8ArrayPolyfill'));
    },
    toJSONValue: function (obj) {
      return {$binary: Base64.encode(obj)};
    },
    fromJSONValue: function (obj) {
      return Base64.decode(obj.$binary);
    }
  },
  { // Escaping one level
    matchJSONValue: function (obj) {
      return _.has(obj, '$escape') && _.size(obj) === 1;
    },
    matchObject: function (obj) {
      if (_.isEmpty(obj) || _.size(obj) > 2) {
        return false;
      }
      return _.any(builtinConverters, function (converter) {
        return converter.matchJSONValue(obj);
      });
    },
    toJSONValue: function (obj) {
      var newObj = {};
      _.each(obj, function (value, key) {
        newObj[key] = EJSON.toJSONValue(value);
      });
      return {$escape: newObj};
    },
    fromJSONValue: function (obj) {
      var newObj = {};
      _.each(obj.$escape, function (value, key) {
        newObj[key] = EJSON.fromJSONValue(value);
      });
      return newObj;
    }
  },
  { // Custom
    matchJSONValue: function (obj) {
      return _.has(obj, '$type') && _.has(obj, '$value') && _.size(obj) === 2;
    },
    matchObject: function (obj) {
      return EJSON._isCustomType(obj);
    },
    toJSONValue: function (obj) {
      var jsonValue = Meteor._noYieldsAllowed(function () {
        return obj.toJSONValue();
      });
      return {$type: obj.typeName(), $value: jsonValue};
    },
    fromJSONValue: function (obj) {
      var typeName = obj.$type;
      if (!_.has(customTypes, typeName))
        throw new Error("Custom EJSON type " + typeName + " is not defined");
      var converter = customTypes[typeName];
      return Meteor._noYieldsAllowed(function () {
        return converter(obj.$value);
      });
    }
  }
];

EJSON._isCustomType = function (obj) {
  return obj &&
    typeof obj.toJSONValue === 'function' &&
    typeof obj.typeName === 'function' &&
    _.has(customTypes, obj.typeName());
};

EJSON._getTypes = function () {
  return customTypes;
};

EJSON._getConverters = function () {
  return builtinConverters;
};

// for both arrays and objects, in-place modification.
var adjustTypesToJSONValue =
EJSON._adjustTypesToJSONValue = function (obj) {
  // Is it an atom that we need to adjust?
  if (obj === null)
    return null;
  var maybeChanged = toJSONValueHelper(obj);
  if (maybeChanged !== undefined)
    return maybeChanged;

  // Other atoms are unchanged.
  if (typeof obj !== 'object')
    return obj;

  // Iterate over array or object structure.
  _.each(obj, function (value, key) {
    if (typeof value !== 'object' && value !== undefined &&
        !isInfOrNan(value))
      return; // continue

    var changed = toJSONValueHelper(value);
    if (changed) {
      obj[key] = changed;
      return; // on to the next key
    }
    // if we get here, value is an object but not adjustable
    // at this level.  recurse.
    adjustTypesToJSONValue(value);
  });
  return obj;
};

// Either return the JSON-compatible version of the argument, or undefined (if
// the item isn't itself replaceable, but maybe some fields in it are)
var toJSONValueHelper = function (item) {
  for (var i = 0; i < builtinConverters.length; i++) {
    var converter = builtinConverters[i];
    if (converter.matchObject(item)) {
      return converter.toJSONValue(item);
    }
  }
  return undefined;
};

/**
 * @summary Serialize an EJSON-compatible value into its plain JSON representation.
 * @locus Anywhere
 * @param {EJSON} val A value to serialize to plain JSON.
 */
EJSON.toJSONValue = function (item) {
  var changed = toJSONValueHelper(item);
  if (changed !== undefined)
    return changed;
  if (typeof item === 'object') {
    item = EJSON.clone(item);
    adjustTypesToJSONValue(item);
  }
  return item;
};

// for both arrays and objects. Tries its best to just
// use the object you hand it, but may return something
// different if the object you hand it itself needs changing.
//
var adjustTypesFromJSONValue =
EJSON._adjustTypesFromJSONValue = function (obj) {
  if (obj === null)
    return null;
  var maybeChanged = fromJSONValueHelper(obj);
  if (maybeChanged !== obj)
    return maybeChanged;

  // Other atoms are unchanged.
  if (typeof obj !== 'object')
    return obj;

  _.each(obj, function (value, key) {
    if (typeof value === 'object') {
      var changed = fromJSONValueHelper(value);
      if (value !== changed) {
        obj[key] = changed;
        return;
      }
      // if we get here, value is an object but not adjustable
      // at this level.  recurse.
      adjustTypesFromJSONValue(value);
    }
  });
  return obj;
};

// Either return the argument changed to have the non-json
// rep of itself (the Object version) or the argument itself.

// DOES NOT RECURSE.  For actually getting the fully-changed value, use
// EJSON.fromJSONValue
var fromJSONValueHelper = function (value) {
  if (typeof value === 'object' && value !== null) {
    if (_.size(value) <= 2
        && _.all(value, function (v, k) {
          return typeof k === 'string' && k.substr(0, 1) === '$';
        })) {
      for (var i = 0; i < builtinConverters.length; i++) {
        var converter = builtinConverters[i];
        if (converter.matchJSONValue(value)) {
          return converter.fromJSONValue(value);
        }
      }
    }
  }
  return value;
};

/**
 * @summary Deserialize an EJSON value from its plain JSON representation.
 * @locus Anywhere
 * @param {JSONCompatible} val A value to deserialize into EJSON.
 */
EJSON.fromJSONValue = function (item) {
  var changed = fromJSONValueHelper(item);
  if (changed === item && typeof item === 'object') {
    item = EJSON.clone(item);
    adjustTypesFromJSONValue(item);
    return item;
  } else {
    return changed;
  }
};

/**
 * @summary Serialize a value to a string.

For EJSON values, the serialization fully represents the value. For non-EJSON values, serializes the same way as `JSON.stringify`.
 * @locus Anywhere
 * @param {EJSON} val A value to stringify.
 * @param {Object} [options]
 * @param {Boolean | Integer | String} options.indent Indents objects and arrays for easy readability.  When `true`, indents by 2 spaces; when an integer, indents by that number of spaces; and when a string, uses the string as the indentation pattern.
 * @param {Boolean} options.canonical When `true`, stringifies keys in an object in sorted order.
 */
EJSON.stringify = function (item, options) {
  var json = EJSON.toJSONValue(item);
  if (options && (options.canonical || options.indent)) {
    return EJSON._canonicalStringify(json, options);
  } else {
    return JSON.stringify(json);
  }
};

/**
 * @summary Parse a string into an EJSON value. Throws an error if the string is not valid EJSON.
 * @locus Anywhere
 * @param {String} str A string to parse into an EJSON value.
 */
EJSON.parse = function (item) {
  if (typeof item !== 'string')
    throw new Error("EJSON.parse argument should be a string");
  return EJSON.fromJSONValue(JSON.parse(item));
};

/**
 * @summary Returns true if `x` is a buffer of binary data, as returned from [`EJSON.newBinary`](#ejson_new_binary).
 * @param {Object} x The variable to check.
 * @locus Anywhere
 */
EJSON.isBinary = function (obj) {
  return !!((typeof Uint8Array !== 'undefined' && obj instanceof Uint8Array) ||
    (obj && obj.$Uint8ArrayPolyfill));
};

/**
 * @summary Return true if `a` and `b` are equal to each other.  Return false otherwise.  Uses the `equals` method on `a` if present, otherwise performs a deep comparison.
 * @locus Anywhere
 * @param {EJSON} a
 * @param {EJSON} b
 * @param {Object} [options]
 * @param {Boolean} options.keyOrderSensitive Compare in key sensitive order, if supported by the JavaScript implementation.  For example, `{a: 1, b: 2}` is equal to `{b: 2, a: 1}` only when `keyOrderSensitive` is `false`.  The default is `false`.
 */
EJSON.equals = function (a, b, options) {
  var i;
  var keyOrderSensitive = !!(options && options.keyOrderSensitive);
  if (a === b)
    return true;
  if (_.isNaN(a) && _.isNaN(b))
    return true; // This differs from the IEEE spec for NaN equality, b/c we don't want
                 // anything ever with a NaN to be poisoned from becoming equal to anything.
  if (!a || !b) // if either one is falsy, they'd have to be === to be equal
    return false;
  if (!(typeof a === 'object' && typeof b === 'object'))
    return false;
  if (a instanceof Date && b instanceof Date)
    return a.valueOf() === b.valueOf();
  if (EJSON.isBinary(a) && EJSON.isBinary(b)) {
    if (a.length !== b.length)
      return false;
    for (i = 0; i < a.length; i++) {
      if (a[i] !== b[i])
        return false;
    }
    return true;
  }
  if (typeof (a.equals) === 'function')
    return a.equals(b, options);
  if (typeof (b.equals) === 'function')
    return b.equals(a, options);
  if (a instanceof Array) {
    if (!(b instanceof Array))
      return false;
    if (a.length !== b.length)
      return false;
    for (i = 0; i < a.length; i++) {
      if (!EJSON.equals(a[i], b[i], options))
        return false;
    }
    return true;
  }
  // fallback for custom types that don't implement their own equals
  switch (EJSON._isCustomType(a) + EJSON._isCustomType(b)) {
    case 1: return false;
    case 2: return EJSON.equals(EJSON.toJSONValue(a), EJSON.toJSONValue(b));
  }
  // fall back to structural equality of objects
  var ret;
  if (keyOrderSensitive) {
    var bKeys = [];
    _.each(b, function (val, x) {
        bKeys.push(x);
    });
    i = 0;
    ret = _.all(a, function (val, x) {
      if (i >= bKeys.length) {
        return false;
      }
      if (x !== bKeys[i]) {
        return false;
      }
      if (!EJSON.equals(val, b[bKeys[i]], options)) {
        return false;
      }
      i++;
      return true;
    });
    return ret && i === bKeys.length;
  } else {
    i = 0;
    ret = _.all(a, function (val, key) {
      if (!_.has(b, key)) {
        return false;
      }
      if (!EJSON.equals(val, b[key], options)) {
        return false;
      }
      i++;
      return true;
    });
    return ret && _.size(b) === i;
  }
};

/**
 * @summary Return a deep copy of `val`.
 * @locus Anywhere
 * @param {EJSON} val A value to copy.
 */
EJSON.clone = function (v) {
  var ret;
  if (typeof v !== "object")
    return v;
  if (v === null)
    return null; // null has typeof "object"
  if (v instanceof Date)
    return new Date(v.getTime());
  // RegExps are not really EJSON elements (eg we don't define a serialization
  // for them), but they're immutable anyway, so we can support them in clone.
  if (v instanceof RegExp)
    return v;
  if (EJSON.isBinary(v)) {
    ret = EJSON.newBinary(v.length);
    for (var i = 0; i < v.length; i++) {
      ret[i] = v[i];
    }
    return ret;
  }
  // XXX: Use something better than underscore's isArray
  if (_.isArray(v) || _.isArguments(v)) {
    // For some reason, _.map doesn't work in this context on Opera (weird test
    // failures).
    ret = [];
    for (i = 0; i < v.length; i++)
      ret[i] = EJSON.clone(v[i]);
    return ret;
  }
  // handle general user-defined typed Objects if they have a clone method
  if (typeof v.clone === 'function') {
    return v.clone();
  }
  // handle other custom types
  if (EJSON._isCustomType(v)) {
    return EJSON.fromJSONValue(EJSON.clone(EJSON.toJSONValue(v)), true);
  }
  // handle other objects
  ret = {};
  _.each(v, function (value, key) {
    ret[key] = EJSON.clone(value);
  });
  return ret;
};

/**
 * @summary Allocate a new buffer of binary data that EJSON can serialize.
 * @locus Anywhere
 * @param {Number} size The number of bytes of binary data to allocate.
 */
// EJSON.newBinary is the public documented API for this functionality,
// but the implementation is in the 'base64' package to avoid
// introducing a circular dependency. (If the implementation were here,
// then 'base64' would have to use EJSON.newBinary, and 'ejson' would
// also have to use 'base64'.)
EJSON.newBinary = Base64.newBinary;

// Based on json2.js from https://github.com/douglascrockford/JSON-js
//
//    json2.js
//    2012-10-08
//
//    Public Domain.
//
//    NO WARRANTY EXPRESSED OR IMPLIED. USE AT YOUR OWN RISK.

function quote(string) {
  return JSON.stringify(string);
}

var str = function (key, holder, singleIndent, outerIndent, canonical) {

  // Produce a string from holder[key].

  var i;          // The loop counter.
  var k;          // The member key.
  var v;          // The member value.
  var length;
  var innerIndent = outerIndent;
  var partial;
  var value = holder[key];

  // What happens next depends on the value's type.

  switch (typeof value) {
  case 'string':
    return quote(value);
  case 'number':
    // JSON numbers must be finite. Encode non-finite numbers as null.
    return isFinite(value) ? String(value) : 'null';
  case 'boolean':
    return String(value);
  // If the type is 'object', we might be dealing with an object or an array or
  // null.
  case 'object':
    // Due to a specification blunder in ECMAScript, typeof null is 'object',
    // so watch out for that case.
    if (!value) {
      return 'null';
    }
    // Make an array to hold the partial results of stringifying this object value.
    innerIndent = outerIndent + singleIndent;
    partial = [];

    // Is the value an array?
    if (_.isArray(value) || _.isArguments(value)) {

      // The value is an array. Stringify every element. Use null as a placeholder
      // for non-JSON values.

      length = value.length;
      for (i = 0; i < length; i += 1) {
        partial[i] = str(i, value, singleIndent, innerIndent, canonical) || 'null';
      }

      // Join all of the elements together, separated with commas, and wrap them in
      // brackets.

      if (partial.length === 0) {
        v = '[]';
      } else if (innerIndent) {
        v = '[\n' + innerIndent + partial.join(',\n' + innerIndent) + '\n' + outerIndent + ']';
      } else {
        v = '[' + partial.join(',') + ']';
      }
      return v;
    }


    // Iterate through all of the keys in the object.
    var keys = _.keys(value);
    if (canonical)
      keys = keys.sort();
    _.each(keys, function (k) {
      v = str(k, value, singleIndent, innerIndent, canonical);
      if (v) {
        partial.push(quote(k) + (innerIndent ? ': ' : ':') + v);
      }
    });


    // Join all of the member texts together, separated with commas,
    // and wrap them in braces.

    if (partial.length === 0) {
      v = '{}';
    } else if (innerIndent) {
      v = '{\n' + innerIndent + partial.join(',\n' + innerIndent) + '\n' + outerIndent + '}';
    } else {
      v = '{' + partial.join(',') + '}';
    }
    return v;
  }
}

// If the JSON object does not yet have a stringify method, give it one.

EJSON._canonicalStringify = function (value, options) {
  // Make a fake root object containing our value under the key of ''.
  // Return the result of stringifying the value.
  options = _.extend({
    indent: "",
    canonical: false
  }, options);
  if (options.indent === true) {
    options.indent = "  ";
  } else if (typeof options.indent === 'number') {
    var newIndent = "";
    for (var i = 0; i < options.indent; i++) {
      newIndent += ' ';
    }
    options.indent = newIndent;
  }
  return str('', {'': value}, options.indent, "", options.canonical);
};

  return EJSON;
}).call(this);

/***/ }),

/***/ "../../../NodeJS/Packets/browserutils/node_modules/underscore/underscore.js":
/*!**************************************************************************************************!*\
  !*** /Volumes/untitled/Coding/NodeJS/Packets/browserutils/node_modules/underscore/underscore.js ***!
  \**************************************************************************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

var __WEBPACK_AMD_DEFINE_ARRAY__, __WEBPACK_AMD_DEFINE_RESULT__;//     Underscore.js 1.8.3
//     http://underscorejs.org
//     (c) 2009-2015 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.

(function() {

  // Baseline setup
  // --------------

  // Establish the root object, `window` in the browser, or `exports` on the server.
  var root = this;

  // Save the previous value of the `_` variable.
  var previousUnderscore = root._;

  // Save bytes in the minified (but not gzipped) version:
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;

  // Create quick reference variables for speed access to core prototypes.
  var
    push             = ArrayProto.push,
    slice            = ArrayProto.slice,
    toString         = ObjProto.toString,
    hasOwnProperty   = ObjProto.hasOwnProperty;

  // All **ECMAScript 5** native function implementations that we hope to use
  // are declared here.
  var
    nativeIsArray      = Array.isArray,
    nativeKeys         = Object.keys,
    nativeBind         = FuncProto.bind,
    nativeCreate       = Object.create;

  // Naked function reference for surrogate-prototype-swapping.
  var Ctor = function(){};

  // Create a safe reference to the Underscore object for use below.
  var _ = function(obj) {
    if (obj instanceof _) return obj;
    if (!(this instanceof _)) return new _(obj);
    this._wrapped = obj;
  };

  // Export the Underscore object for **Node.js**, with
  // backwards-compatibility for the old `require()` API. If we're in
  // the browser, add `_` as a global object.
  if (true) {
    if ( true && module.exports) {
      exports = module.exports = _;
    }
    exports._ = _;
  } else {}

  // Current version.
  _.VERSION = '1.8.3';

  // Internal function that returns an efficient (for current engines) version
  // of the passed-in callback, to be repeatedly applied in other Underscore
  // functions.
  var optimizeCb = function(func, context, argCount) {
    if (context === void 0) return func;
    switch (argCount == null ? 3 : argCount) {
      case 1: return function(value) {
        return func.call(context, value);
      };
      case 2: return function(value, other) {
        return func.call(context, value, other);
      };
      case 3: return function(value, index, collection) {
        return func.call(context, value, index, collection);
      };
      case 4: return function(accumulator, value, index, collection) {
        return func.call(context, accumulator, value, index, collection);
      };
    }
    return function() {
      return func.apply(context, arguments);
    };
  };

  // A mostly-internal function to generate callbacks that can be applied
  // to each element in a collection, returning the desired result — either
  // identity, an arbitrary callback, a property matcher, or a property accessor.
  var cb = function(value, context, argCount) {
    if (value == null) return _.identity;
    if (_.isFunction(value)) return optimizeCb(value, context, argCount);
    if (_.isObject(value)) return _.matcher(value);
    return _.property(value);
  };
  _.iteratee = function(value, context) {
    return cb(value, context, Infinity);
  };

  // An internal function for creating assigner functions.
  var createAssigner = function(keysFunc, undefinedOnly) {
    return function(obj) {
      var length = arguments.length;
      if (length < 2 || obj == null) return obj;
      for (var index = 1; index < length; index++) {
        var source = arguments[index],
            keys = keysFunc(source),
            l = keys.length;
        for (var i = 0; i < l; i++) {
          var key = keys[i];
          if (!undefinedOnly || obj[key] === void 0) obj[key] = source[key];
        }
      }
      return obj;
    };
  };

  // An internal function for creating a new object that inherits from another.
  var baseCreate = function(prototype) {
    if (!_.isObject(prototype)) return {};
    if (nativeCreate) return nativeCreate(prototype);
    Ctor.prototype = prototype;
    var result = new Ctor;
    Ctor.prototype = null;
    return result;
  };

  var property = function(key) {
    return function(obj) {
      return obj == null ? void 0 : obj[key];
    };
  };

  // Helper for collection methods to determine whether a collection
  // should be iterated as an array or as an object
  // Related: http://people.mozilla.org/~jorendorff/es6-draft.html#sec-tolength
  // Avoids a very nasty iOS 8 JIT bug on ARM-64. #2094
  var MAX_ARRAY_INDEX = Math.pow(2, 53) - 1;
  var getLength = property('length');
  var isArrayLike = function(collection) {
    var length = getLength(collection);
    return typeof length == 'number' && length >= 0 && length <= MAX_ARRAY_INDEX;
  };

  // Collection Functions
  // --------------------

  // The cornerstone, an `each` implementation, aka `forEach`.
  // Handles raw objects in addition to array-likes. Treats all
  // sparse array-likes as if they were dense.
  _.each = _.forEach = function(obj, iteratee, context) {
    iteratee = optimizeCb(iteratee, context);
    var i, length;
    if (isArrayLike(obj)) {
      for (i = 0, length = obj.length; i < length; i++) {
        iteratee(obj[i], i, obj);
      }
    } else {
      var keys = _.keys(obj);
      for (i = 0, length = keys.length; i < length; i++) {
        iteratee(obj[keys[i]], keys[i], obj);
      }
    }
    return obj;
  };

  // Return the results of applying the iteratee to each element.
  _.map = _.collect = function(obj, iteratee, context) {
    iteratee = cb(iteratee, context);
    var keys = !isArrayLike(obj) && _.keys(obj),
        length = (keys || obj).length,
        results = Array(length);
    for (var index = 0; index < length; index++) {
      var currentKey = keys ? keys[index] : index;
      results[index] = iteratee(obj[currentKey], currentKey, obj);
    }
    return results;
  };

  // Create a reducing function iterating left or right.
  function createReduce(dir) {
    // Optimized iterator function as using arguments.length
    // in the main function will deoptimize the, see #1991.
    function iterator(obj, iteratee, memo, keys, index, length) {
      for (; index >= 0 && index < length; index += dir) {
        var currentKey = keys ? keys[index] : index;
        memo = iteratee(memo, obj[currentKey], currentKey, obj);
      }
      return memo;
    }

    return function(obj, iteratee, memo, context) {
      iteratee = optimizeCb(iteratee, context, 4);
      var keys = !isArrayLike(obj) && _.keys(obj),
          length = (keys || obj).length,
          index = dir > 0 ? 0 : length - 1;
      // Determine the initial value if none is provided.
      if (arguments.length < 3) {
        memo = obj[keys ? keys[index] : index];
        index += dir;
      }
      return iterator(obj, iteratee, memo, keys, index, length);
    };
  }

  // **Reduce** builds up a single result from a list of values, aka `inject`,
  // or `foldl`.
  _.reduce = _.foldl = _.inject = createReduce(1);

  // The right-associative version of reduce, also known as `foldr`.
  _.reduceRight = _.foldr = createReduce(-1);

  // Return the first value which passes a truth test. Aliased as `detect`.
  _.find = _.detect = function(obj, predicate, context) {
    var key;
    if (isArrayLike(obj)) {
      key = _.findIndex(obj, predicate, context);
    } else {
      key = _.findKey(obj, predicate, context);
    }
    if (key !== void 0 && key !== -1) return obj[key];
  };

  // Return all the elements that pass a truth test.
  // Aliased as `select`.
  _.filter = _.select = function(obj, predicate, context) {
    var results = [];
    predicate = cb(predicate, context);
    _.each(obj, function(value, index, list) {
      if (predicate(value, index, list)) results.push(value);
    });
    return results;
  };

  // Return all the elements for which a truth test fails.
  _.reject = function(obj, predicate, context) {
    return _.filter(obj, _.negate(cb(predicate)), context);
  };

  // Determine whether all of the elements match a truth test.
  // Aliased as `all`.
  _.every = _.all = function(obj, predicate, context) {
    predicate = cb(predicate, context);
    var keys = !isArrayLike(obj) && _.keys(obj),
        length = (keys || obj).length;
    for (var index = 0; index < length; index++) {
      var currentKey = keys ? keys[index] : index;
      if (!predicate(obj[currentKey], currentKey, obj)) return false;
    }
    return true;
  };

  // Determine if at least one element in the object matches a truth test.
  // Aliased as `any`.
  _.some = _.any = function(obj, predicate, context) {
    predicate = cb(predicate, context);
    var keys = !isArrayLike(obj) && _.keys(obj),
        length = (keys || obj).length;
    for (var index = 0; index < length; index++) {
      var currentKey = keys ? keys[index] : index;
      if (predicate(obj[currentKey], currentKey, obj)) return true;
    }
    return false;
  };

  // Determine if the array or object contains a given item (using `===`).
  // Aliased as `includes` and `include`.
  _.contains = _.includes = _.include = function(obj, item, fromIndex, guard) {
    if (!isArrayLike(obj)) obj = _.values(obj);
    if (typeof fromIndex != 'number' || guard) fromIndex = 0;
    return _.indexOf(obj, item, fromIndex) >= 0;
  };

  // Invoke a method (with arguments) on every item in a collection.
  _.invoke = function(obj, method) {
    var args = slice.call(arguments, 2);
    var isFunc = _.isFunction(method);
    return _.map(obj, function(value) {
      var func = isFunc ? method : value[method];
      return func == null ? func : func.apply(value, args);
    });
  };

  // Convenience version of a common use case of `map`: fetching a property.
  _.pluck = function(obj, key) {
    return _.map(obj, _.property(key));
  };

  // Convenience version of a common use case of `filter`: selecting only objects
  // containing specific `key:value` pairs.
  _.where = function(obj, attrs) {
    return _.filter(obj, _.matcher(attrs));
  };

  // Convenience version of a common use case of `find`: getting the first object
  // containing specific `key:value` pairs.
  _.findWhere = function(obj, attrs) {
    return _.find(obj, _.matcher(attrs));
  };

  // Return the maximum element (or element-based computation).
  _.max = function(obj, iteratee, context) {
    var result = -Infinity, lastComputed = -Infinity,
        value, computed;
    if (iteratee == null && obj != null) {
      obj = isArrayLike(obj) ? obj : _.values(obj);
      for (var i = 0, length = obj.length; i < length; i++) {
        value = obj[i];
        if (value > result) {
          result = value;
        }
      }
    } else {
      iteratee = cb(iteratee, context);
      _.each(obj, function(value, index, list) {
        computed = iteratee(value, index, list);
        if (computed > lastComputed || computed === -Infinity && result === -Infinity) {
          result = value;
          lastComputed = computed;
        }
      });
    }
    return result;
  };

  // Return the minimum element (or element-based computation).
  _.min = function(obj, iteratee, context) {
    var result = Infinity, lastComputed = Infinity,
        value, computed;
    if (iteratee == null && obj != null) {
      obj = isArrayLike(obj) ? obj : _.values(obj);
      for (var i = 0, length = obj.length; i < length; i++) {
        value = obj[i];
        if (value < result) {
          result = value;
        }
      }
    } else {
      iteratee = cb(iteratee, context);
      _.each(obj, function(value, index, list) {
        computed = iteratee(value, index, list);
        if (computed < lastComputed || computed === Infinity && result === Infinity) {
          result = value;
          lastComputed = computed;
        }
      });
    }
    return result;
  };

  // Shuffle a collection, using the modern version of the
  // [Fisher-Yates shuffle](http://en.wikipedia.org/wiki/Fisher–Yates_shuffle).
  _.shuffle = function(obj) {
    var set = isArrayLike(obj) ? obj : _.values(obj);
    var length = set.length;
    var shuffled = Array(length);
    for (var index = 0, rand; index < length; index++) {
      rand = _.random(0, index);
      if (rand !== index) shuffled[index] = shuffled[rand];
      shuffled[rand] = set[index];
    }
    return shuffled;
  };

  // Sample **n** random values from a collection.
  // If **n** is not specified, returns a single random element.
  // The internal `guard` argument allows it to work with `map`.
  _.sample = function(obj, n, guard) {
    if (n == null || guard) {
      if (!isArrayLike(obj)) obj = _.values(obj);
      return obj[_.random(obj.length - 1)];
    }
    return _.shuffle(obj).slice(0, Math.max(0, n));
  };

  // Sort the object's values by a criterion produced by an iteratee.
  _.sortBy = function(obj, iteratee, context) {
    iteratee = cb(iteratee, context);
    return _.pluck(_.map(obj, function(value, index, list) {
      return {
        value: value,
        index: index,
        criteria: iteratee(value, index, list)
      };
    }).sort(function(left, right) {
      var a = left.criteria;
      var b = right.criteria;
      if (a !== b) {
        if (a > b || a === void 0) return 1;
        if (a < b || b === void 0) return -1;
      }
      return left.index - right.index;
    }), 'value');
  };

  // An internal function used for aggregate "group by" operations.
  var group = function(behavior) {
    return function(obj, iteratee, context) {
      var result = {};
      iteratee = cb(iteratee, context);
      _.each(obj, function(value, index) {
        var key = iteratee(value, index, obj);
        behavior(result, value, key);
      });
      return result;
    };
  };

  // Groups the object's values by a criterion. Pass either a string attribute
  // to group by, or a function that returns the criterion.
  _.groupBy = group(function(result, value, key) {
    if (_.has(result, key)) result[key].push(value); else result[key] = [value];
  });

  // Indexes the object's values by a criterion, similar to `groupBy`, but for
  // when you know that your index values will be unique.
  _.indexBy = group(function(result, value, key) {
    result[key] = value;
  });

  // Counts instances of an object that group by a certain criterion. Pass
  // either a string attribute to count by, or a function that returns the
  // criterion.
  _.countBy = group(function(result, value, key) {
    if (_.has(result, key)) result[key]++; else result[key] = 1;
  });

  // Safely create a real, live array from anything iterable.
  _.toArray = function(obj) {
    if (!obj) return [];
    if (_.isArray(obj)) return slice.call(obj);
    if (isArrayLike(obj)) return _.map(obj, _.identity);
    return _.values(obj);
  };

  // Return the number of elements in an object.
  _.size = function(obj) {
    if (obj == null) return 0;
    return isArrayLike(obj) ? obj.length : _.keys(obj).length;
  };

  // Split a collection into two arrays: one whose elements all satisfy the given
  // predicate, and one whose elements all do not satisfy the predicate.
  _.partition = function(obj, predicate, context) {
    predicate = cb(predicate, context);
    var pass = [], fail = [];
    _.each(obj, function(value, key, obj) {
      (predicate(value, key, obj) ? pass : fail).push(value);
    });
    return [pass, fail];
  };

  // Array Functions
  // ---------------

  // Get the first element of an array. Passing **n** will return the first N
  // values in the array. Aliased as `head` and `take`. The **guard** check
  // allows it to work with `_.map`.
  _.first = _.head = _.take = function(array, n, guard) {
    if (array == null) return void 0;
    if (n == null || guard) return array[0];
    return _.initial(array, array.length - n);
  };

  // Returns everything but the last entry of the array. Especially useful on
  // the arguments object. Passing **n** will return all the values in
  // the array, excluding the last N.
  _.initial = function(array, n, guard) {
    return slice.call(array, 0, Math.max(0, array.length - (n == null || guard ? 1 : n)));
  };

  // Get the last element of an array. Passing **n** will return the last N
  // values in the array.
  _.last = function(array, n, guard) {
    if (array == null) return void 0;
    if (n == null || guard) return array[array.length - 1];
    return _.rest(array, Math.max(0, array.length - n));
  };

  // Returns everything but the first entry of the array. Aliased as `tail` and `drop`.
  // Especially useful on the arguments object. Passing an **n** will return
  // the rest N values in the array.
  _.rest = _.tail = _.drop = function(array, n, guard) {
    return slice.call(array, n == null || guard ? 1 : n);
  };

  // Trim out all falsy values from an array.
  _.compact = function(array) {
    return _.filter(array, _.identity);
  };

  // Internal implementation of a recursive `flatten` function.
  var flatten = function(input, shallow, strict, startIndex) {
    var output = [], idx = 0;
    for (var i = startIndex || 0, length = getLength(input); i < length; i++) {
      var value = input[i];
      if (isArrayLike(value) && (_.isArray(value) || _.isArguments(value))) {
        //flatten current level of array or arguments object
        if (!shallow) value = flatten(value, shallow, strict);
        var j = 0, len = value.length;
        output.length += len;
        while (j < len) {
          output[idx++] = value[j++];
        }
      } else if (!strict) {
        output[idx++] = value;
      }
    }
    return output;
  };

  // Flatten out an array, either recursively (by default), or just one level.
  _.flatten = function(array, shallow) {
    return flatten(array, shallow, false);
  };

  // Return a version of the array that does not contain the specified value(s).
  _.without = function(array) {
    return _.difference(array, slice.call(arguments, 1));
  };

  // Produce a duplicate-free version of the array. If the array has already
  // been sorted, you have the option of using a faster algorithm.
  // Aliased as `unique`.
  _.uniq = _.unique = function(array, isSorted, iteratee, context) {
    if (!_.isBoolean(isSorted)) {
      context = iteratee;
      iteratee = isSorted;
      isSorted = false;
    }
    if (iteratee != null) iteratee = cb(iteratee, context);
    var result = [];
    var seen = [];
    for (var i = 0, length = getLength(array); i < length; i++) {
      var value = array[i],
          computed = iteratee ? iteratee(value, i, array) : value;
      if (isSorted) {
        if (!i || seen !== computed) result.push(value);
        seen = computed;
      } else if (iteratee) {
        if (!_.contains(seen, computed)) {
          seen.push(computed);
          result.push(value);
        }
      } else if (!_.contains(result, value)) {
        result.push(value);
      }
    }
    return result;
  };

  // Produce an array that contains the union: each distinct element from all of
  // the passed-in arrays.
  _.union = function() {
    return _.uniq(flatten(arguments, true, true));
  };

  // Produce an array that contains every item shared between all the
  // passed-in arrays.
  _.intersection = function(array) {
    var result = [];
    var argsLength = arguments.length;
    for (var i = 0, length = getLength(array); i < length; i++) {
      var item = array[i];
      if (_.contains(result, item)) continue;
      for (var j = 1; j < argsLength; j++) {
        if (!_.contains(arguments[j], item)) break;
      }
      if (j === argsLength) result.push(item);
    }
    return result;
  };

  // Take the difference between one array and a number of other arrays.
  // Only the elements present in just the first array will remain.
  _.difference = function(array) {
    var rest = flatten(arguments, true, true, 1);
    return _.filter(array, function(value){
      return !_.contains(rest, value);
    });
  };

  // Zip together multiple lists into a single array -- elements that share
  // an index go together.
  _.zip = function() {
    return _.unzip(arguments);
  };

  // Complement of _.zip. Unzip accepts an array of arrays and groups
  // each array's elements on shared indices
  _.unzip = function(array) {
    var length = array && _.max(array, getLength).length || 0;
    var result = Array(length);

    for (var index = 0; index < length; index++) {
      result[index] = _.pluck(array, index);
    }
    return result;
  };

  // Converts lists into objects. Pass either a single array of `[key, value]`
  // pairs, or two parallel arrays of the same length -- one of keys, and one of
  // the corresponding values.
  _.object = function(list, values) {
    var result = {};
    for (var i = 0, length = getLength(list); i < length; i++) {
      if (values) {
        result[list[i]] = values[i];
      } else {
        result[list[i][0]] = list[i][1];
      }
    }
    return result;
  };

  // Generator function to create the findIndex and findLastIndex functions
  function createPredicateIndexFinder(dir) {
    return function(array, predicate, context) {
      predicate = cb(predicate, context);
      var length = getLength(array);
      var index = dir > 0 ? 0 : length - 1;
      for (; index >= 0 && index < length; index += dir) {
        if (predicate(array[index], index, array)) return index;
      }
      return -1;
    };
  }

  // Returns the first index on an array-like that passes a predicate test
  _.findIndex = createPredicateIndexFinder(1);
  _.findLastIndex = createPredicateIndexFinder(-1);

  // Use a comparator function to figure out the smallest index at which
  // an object should be inserted so as to maintain order. Uses binary search.
  _.sortedIndex = function(array, obj, iteratee, context) {
    iteratee = cb(iteratee, context, 1);
    var value = iteratee(obj);
    var low = 0, high = getLength(array);
    while (low < high) {
      var mid = Math.floor((low + high) / 2);
      if (iteratee(array[mid]) < value) low = mid + 1; else high = mid;
    }
    return low;
  };

  // Generator function to create the indexOf and lastIndexOf functions
  function createIndexFinder(dir, predicateFind, sortedIndex) {
    return function(array, item, idx) {
      var i = 0, length = getLength(array);
      if (typeof idx == 'number') {
        if (dir > 0) {
            i = idx >= 0 ? idx : Math.max(idx + length, i);
        } else {
            length = idx >= 0 ? Math.min(idx + 1, length) : idx + length + 1;
        }
      } else if (sortedIndex && idx && length) {
        idx = sortedIndex(array, item);
        return array[idx] === item ? idx : -1;
      }
      if (item !== item) {
        idx = predicateFind(slice.call(array, i, length), _.isNaN);
        return idx >= 0 ? idx + i : -1;
      }
      for (idx = dir > 0 ? i : length - 1; idx >= 0 && idx < length; idx += dir) {
        if (array[idx] === item) return idx;
      }
      return -1;
    };
  }

  // Return the position of the first occurrence of an item in an array,
  // or -1 if the item is not included in the array.
  // If the array is large and already in sort order, pass `true`
  // for **isSorted** to use binary search.
  _.indexOf = createIndexFinder(1, _.findIndex, _.sortedIndex);
  _.lastIndexOf = createIndexFinder(-1, _.findLastIndex);

  // Generate an integer Array containing an arithmetic progression. A port of
  // the native Python `range()` function. See
  // [the Python documentation](http://docs.python.org/library/functions.html#range).
  _.range = function(start, stop, step) {
    if (stop == null) {
      stop = start || 0;
      start = 0;
    }
    step = step || 1;

    var length = Math.max(Math.ceil((stop - start) / step), 0);
    var range = Array(length);

    for (var idx = 0; idx < length; idx++, start += step) {
      range[idx] = start;
    }

    return range;
  };

  // Function (ahem) Functions
  // ------------------

  // Determines whether to execute a function as a constructor
  // or a normal function with the provided arguments
  var executeBound = function(sourceFunc, boundFunc, context, callingContext, args) {
    if (!(callingContext instanceof boundFunc)) return sourceFunc.apply(context, args);
    var self = baseCreate(sourceFunc.prototype);
    var result = sourceFunc.apply(self, args);
    if (_.isObject(result)) return result;
    return self;
  };

  // Create a function bound to a given object (assigning `this`, and arguments,
  // optionally). Delegates to **ECMAScript 5**'s native `Function.bind` if
  // available.
  _.bind = function(func, context) {
    if (nativeBind && func.bind === nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
    if (!_.isFunction(func)) throw new TypeError('Bind must be called on a function');
    var args = slice.call(arguments, 2);
    var bound = function() {
      return executeBound(func, bound, context, this, args.concat(slice.call(arguments)));
    };
    return bound;
  };

  // Partially apply a function by creating a version that has had some of its
  // arguments pre-filled, without changing its dynamic `this` context. _ acts
  // as a placeholder, allowing any combination of arguments to be pre-filled.
  _.partial = function(func) {
    var boundArgs = slice.call(arguments, 1);
    var bound = function() {
      var position = 0, length = boundArgs.length;
      var args = Array(length);
      for (var i = 0; i < length; i++) {
        args[i] = boundArgs[i] === _ ? arguments[position++] : boundArgs[i];
      }
      while (position < arguments.length) args.push(arguments[position++]);
      return executeBound(func, bound, this, this, args);
    };
    return bound;
  };

  // Bind a number of an object's methods to that object. Remaining arguments
  // are the method names to be bound. Useful for ensuring that all callbacks
  // defined on an object belong to it.
  _.bindAll = function(obj) {
    var i, length = arguments.length, key;
    if (length <= 1) throw new Error('bindAll must be passed function names');
    for (i = 1; i < length; i++) {
      key = arguments[i];
      obj[key] = _.bind(obj[key], obj);
    }
    return obj;
  };

  // Memoize an expensive function by storing its results.
  _.memoize = function(func, hasher) {
    var memoize = function(key) {
      var cache = memoize.cache;
      var address = '' + (hasher ? hasher.apply(this, arguments) : key);
      if (!_.has(cache, address)) cache[address] = func.apply(this, arguments);
      return cache[address];
    };
    memoize.cache = {};
    return memoize;
  };

  // Delays a function for the given number of milliseconds, and then calls
  // it with the arguments supplied.
  _.delay = function(func, wait) {
    var args = slice.call(arguments, 2);
    return setTimeout(function(){
      return func.apply(null, args);
    }, wait);
  };

  // Defers a function, scheduling it to run after the current call stack has
  // cleared.
  _.defer = _.partial(_.delay, _, 1);

  // Returns a function, that, when invoked, will only be triggered at most once
  // during a given window of time. Normally, the throttled function will run
  // as much as it can, without ever going more than once per `wait` duration;
  // but if you'd like to disable the execution on the leading edge, pass
  // `{leading: false}`. To disable execution on the trailing edge, ditto.
  _.throttle = function(func, wait, options) {
    var context, args, result;
    var timeout = null;
    var previous = 0;
    if (!options) options = {};
    var later = function() {
      previous = options.leading === false ? 0 : _.now();
      timeout = null;
      result = func.apply(context, args);
      if (!timeout) context = args = null;
    };
    return function() {
      var now = _.now();
      if (!previous && options.leading === false) previous = now;
      var remaining = wait - (now - previous);
      context = this;
      args = arguments;
      if (remaining <= 0 || remaining > wait) {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        previous = now;
        result = func.apply(context, args);
        if (!timeout) context = args = null;
      } else if (!timeout && options.trailing !== false) {
        timeout = setTimeout(later, remaining);
      }
      return result;
    };
  };

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds. If `immediate` is passed, trigger the function on the
  // leading edge, instead of the trailing.
  _.debounce = function(func, wait, immediate) {
    var timeout, args, context, timestamp, result;

    var later = function() {
      var last = _.now() - timestamp;

      if (last < wait && last >= 0) {
        timeout = setTimeout(later, wait - last);
      } else {
        timeout = null;
        if (!immediate) {
          result = func.apply(context, args);
          if (!timeout) context = args = null;
        }
      }
    };

    return function() {
      context = this;
      args = arguments;
      timestamp = _.now();
      var callNow = immediate && !timeout;
      if (!timeout) timeout = setTimeout(later, wait);
      if (callNow) {
        result = func.apply(context, args);
        context = args = null;
      }

      return result;
    };
  };

  // Returns the first function passed as an argument to the second,
  // allowing you to adjust arguments, run code before and after, and
  // conditionally execute the original function.
  _.wrap = function(func, wrapper) {
    return _.partial(wrapper, func);
  };

  // Returns a negated version of the passed-in predicate.
  _.negate = function(predicate) {
    return function() {
      return !predicate.apply(this, arguments);
    };
  };

  // Returns a function that is the composition of a list of functions, each
  // consuming the return value of the function that follows.
  _.compose = function() {
    var args = arguments;
    var start = args.length - 1;
    return function() {
      var i = start;
      var result = args[start].apply(this, arguments);
      while (i--) result = args[i].call(this, result);
      return result;
    };
  };

  // Returns a function that will only be executed on and after the Nth call.
  _.after = function(times, func) {
    return function() {
      if (--times < 1) {
        return func.apply(this, arguments);
      }
    };
  };

  // Returns a function that will only be executed up to (but not including) the Nth call.
  _.before = function(times, func) {
    var memo;
    return function() {
      if (--times > 0) {
        memo = func.apply(this, arguments);
      }
      if (times <= 1) func = null;
      return memo;
    };
  };

  // Returns a function that will be executed at most one time, no matter how
  // often you call it. Useful for lazy initialization.
  _.once = _.partial(_.before, 2);

  // Object Functions
  // ----------------

  // Keys in IE < 9 that won't be iterated by `for key in ...` and thus missed.
  var hasEnumBug = !{toString: null}.propertyIsEnumerable('toString');
  var nonEnumerableProps = ['valueOf', 'isPrototypeOf', 'toString',
                      'propertyIsEnumerable', 'hasOwnProperty', 'toLocaleString'];

  function collectNonEnumProps(obj, keys) {
    var nonEnumIdx = nonEnumerableProps.length;
    var constructor = obj.constructor;
    var proto = (_.isFunction(constructor) && constructor.prototype) || ObjProto;

    // Constructor is a special case.
    var prop = 'constructor';
    if (_.has(obj, prop) && !_.contains(keys, prop)) keys.push(prop);

    while (nonEnumIdx--) {
      prop = nonEnumerableProps[nonEnumIdx];
      if (prop in obj && obj[prop] !== proto[prop] && !_.contains(keys, prop)) {
        keys.push(prop);
      }
    }
  }

  // Retrieve the names of an object's own properties.
  // Delegates to **ECMAScript 5**'s native `Object.keys`
  _.keys = function(obj) {
    if (!_.isObject(obj)) return [];
    if (nativeKeys) return nativeKeys(obj);
    var keys = [];
    for (var key in obj) if (_.has(obj, key)) keys.push(key);
    // Ahem, IE < 9.
    if (hasEnumBug) collectNonEnumProps(obj, keys);
    return keys;
  };

  // Retrieve all the property names of an object.
  _.allKeys = function(obj) {
    if (!_.isObject(obj)) return [];
    var keys = [];
    for (var key in obj) keys.push(key);
    // Ahem, IE < 9.
    if (hasEnumBug) collectNonEnumProps(obj, keys);
    return keys;
  };

  // Retrieve the values of an object's properties.
  _.values = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var values = Array(length);
    for (var i = 0; i < length; i++) {
      values[i] = obj[keys[i]];
    }
    return values;
  };

  // Returns the results of applying the iteratee to each element of the object
  // In contrast to _.map it returns an object
  _.mapObject = function(obj, iteratee, context) {
    iteratee = cb(iteratee, context);
    var keys =  _.keys(obj),
          length = keys.length,
          results = {},
          currentKey;
      for (var index = 0; index < length; index++) {
        currentKey = keys[index];
        results[currentKey] = iteratee(obj[currentKey], currentKey, obj);
      }
      return results;
  };

  // Convert an object into a list of `[key, value]` pairs.
  _.pairs = function(obj) {
    var keys = _.keys(obj);
    var length = keys.length;
    var pairs = Array(length);
    for (var i = 0; i < length; i++) {
      pairs[i] = [keys[i], obj[keys[i]]];
    }
    return pairs;
  };

  // Invert the keys and values of an object. The values must be serializable.
  _.invert = function(obj) {
    var result = {};
    var keys = _.keys(obj);
    for (var i = 0, length = keys.length; i < length; i++) {
      result[obj[keys[i]]] = keys[i];
    }
    return result;
  };

  // Return a sorted list of the function names available on the object.
  // Aliased as `methods`
  _.functions = _.methods = function(obj) {
    var names = [];
    for (var key in obj) {
      if (_.isFunction(obj[key])) names.push(key);
    }
    return names.sort();
  };

  // Extend a given object with all the properties in passed-in object(s).
  _.extend = createAssigner(_.allKeys);

  // Assigns a given object with all the own properties in the passed-in object(s)
  // (https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object/assign)
  _.extendOwn = _.assign = createAssigner(_.keys);

  // Returns the first key on an object that passes a predicate test
  _.findKey = function(obj, predicate, context) {
    predicate = cb(predicate, context);
    var keys = _.keys(obj), key;
    for (var i = 0, length = keys.length; i < length; i++) {
      key = keys[i];
      if (predicate(obj[key], key, obj)) return key;
    }
  };

  // Return a copy of the object only containing the whitelisted properties.
  _.pick = function(object, oiteratee, context) {
    var result = {}, obj = object, iteratee, keys;
    if (obj == null) return result;
    if (_.isFunction(oiteratee)) {
      keys = _.allKeys(obj);
      iteratee = optimizeCb(oiteratee, context);
    } else {
      keys = flatten(arguments, false, false, 1);
      iteratee = function(value, key, obj) { return key in obj; };
      obj = Object(obj);
    }
    for (var i = 0, length = keys.length; i < length; i++) {
      var key = keys[i];
      var value = obj[key];
      if (iteratee(value, key, obj)) result[key] = value;
    }
    return result;
  };

   // Return a copy of the object without the blacklisted properties.
  _.omit = function(obj, iteratee, context) {
    if (_.isFunction(iteratee)) {
      iteratee = _.negate(iteratee);
    } else {
      var keys = _.map(flatten(arguments, false, false, 1), String);
      iteratee = function(value, key) {
        return !_.contains(keys, key);
      };
    }
    return _.pick(obj, iteratee, context);
  };

  // Fill in a given object with default properties.
  _.defaults = createAssigner(_.allKeys, true);

  // Creates an object that inherits from the given prototype object.
  // If additional properties are provided then they will be added to the
  // created object.
  _.create = function(prototype, props) {
    var result = baseCreate(prototype);
    if (props) _.extendOwn(result, props);
    return result;
  };

  // Create a (shallow-cloned) duplicate of an object.
  _.clone = function(obj) {
    if (!_.isObject(obj)) return obj;
    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
  };

  // Invokes interceptor with the obj, and then returns obj.
  // The primary purpose of this method is to "tap into" a method chain, in
  // order to perform operations on intermediate results within the chain.
  _.tap = function(obj, interceptor) {
    interceptor(obj);
    return obj;
  };

  // Returns whether an object has a given set of `key:value` pairs.
  _.isMatch = function(object, attrs) {
    var keys = _.keys(attrs), length = keys.length;
    if (object == null) return !length;
    var obj = Object(object);
    for (var i = 0; i < length; i++) {
      var key = keys[i];
      if (attrs[key] !== obj[key] || !(key in obj)) return false;
    }
    return true;
  };


  // Internal recursive comparison function for `isEqual`.
  var eq = function(a, b, aStack, bStack) {
    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the [Harmony `egal` proposal](http://wiki.ecmascript.org/doku.php?id=harmony:egal).
    if (a === b) return a !== 0 || 1 / a === 1 / b;
    // A strict comparison is necessary because `null == undefined`.
    if (a == null || b == null) return a === b;
    // Unwrap any wrapped objects.
    if (a instanceof _) a = a._wrapped;
    if (b instanceof _) b = b._wrapped;
    // Compare `[[Class]]` names.
    var className = toString.call(a);
    if (className !== toString.call(b)) return false;
    switch (className) {
      // Strings, numbers, regular expressions, dates, and booleans are compared by value.
      case '[object RegExp]':
      // RegExps are coerced to strings for comparison (Note: '' + /a/i === '/a/i')
      case '[object String]':
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
        // equivalent to `new String("5")`.
        return '' + a === '' + b;
      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive.
        // Object(NaN) is equivalent to NaN
        if (+a !== +a) return +b !== +b;
        // An `egal` comparison is performed for other numeric values.
        return +a === 0 ? 1 / +a === 1 / b : +a === +b;
      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their
        // millisecond representations. Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        return +a === +b;
    }

    var areArrays = className === '[object Array]';
    if (!areArrays) {
      if (typeof a != 'object' || typeof b != 'object') return false;

      // Objects with different constructors are not equivalent, but `Object`s or `Array`s
      // from different frames are.
      var aCtor = a.constructor, bCtor = b.constructor;
      if (aCtor !== bCtor && !(_.isFunction(aCtor) && aCtor instanceof aCtor &&
                               _.isFunction(bCtor) && bCtor instanceof bCtor)
                          && ('constructor' in a && 'constructor' in b)) {
        return false;
      }
    }
    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.

    // Initializing stack of traversed objects.
    // It's done here since we only need them for objects and arrays comparison.
    aStack = aStack || [];
    bStack = bStack || [];
    var length = aStack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (aStack[length] === a) return bStack[length] === b;
    }

    // Add the first object to the stack of traversed objects.
    aStack.push(a);
    bStack.push(b);

    // Recursively compare objects and arrays.
    if (areArrays) {
      // Compare array lengths to determine if a deep comparison is necessary.
      length = a.length;
      if (length !== b.length) return false;
      // Deep compare the contents, ignoring non-numeric properties.
      while (length--) {
        if (!eq(a[length], b[length], aStack, bStack)) return false;
      }
    } else {
      // Deep compare objects.
      var keys = _.keys(a), key;
      length = keys.length;
      // Ensure that both objects contain the same number of properties before comparing deep equality.
      if (_.keys(b).length !== length) return false;
      while (length--) {
        // Deep compare each member
        key = keys[length];
        if (!(_.has(b, key) && eq(a[key], b[key], aStack, bStack))) return false;
      }
    }
    // Remove the first object from the stack of traversed objects.
    aStack.pop();
    bStack.pop();
    return true;
  };

  // Perform a deep comparison to check if two objects are equal.
  _.isEqual = function(a, b) {
    return eq(a, b);
  };

  // Is a given array, string, or object empty?
  // An "empty" object has no enumerable own-properties.
  _.isEmpty = function(obj) {
    if (obj == null) return true;
    if (isArrayLike(obj) && (_.isArray(obj) || _.isString(obj) || _.isArguments(obj))) return obj.length === 0;
    return _.keys(obj).length === 0;
  };

  // Is a given value a DOM element?
  _.isElement = function(obj) {
    return !!(obj && obj.nodeType === 1);
  };

  // Is a given value an array?
  // Delegates to ECMA5's native Array.isArray
  _.isArray = nativeIsArray || function(obj) {
    return toString.call(obj) === '[object Array]';
  };

  // Is a given variable an object?
  _.isObject = function(obj) {
    var type = typeof obj;
    return type === 'function' || type === 'object' && !!obj;
  };

  // Add some isType methods: isArguments, isFunction, isString, isNumber, isDate, isRegExp, isError.
  _.each(['Arguments', 'Function', 'String', 'Number', 'Date', 'RegExp', 'Error'], function(name) {
    _['is' + name] = function(obj) {
      return toString.call(obj) === '[object ' + name + ']';
    };
  });

  // Define a fallback version of the method in browsers (ahem, IE < 9), where
  // there isn't any inspectable "Arguments" type.
  if (!_.isArguments(arguments)) {
    _.isArguments = function(obj) {
      return _.has(obj, 'callee');
    };
  }

  // Optimize `isFunction` if appropriate. Work around some typeof bugs in old v8,
  // IE 11 (#1621), and in Safari 8 (#1929).
  if ( true && typeof Int8Array != 'object') {
    _.isFunction = function(obj) {
      return typeof obj == 'function' || false;
    };
  }

  // Is a given object a finite number?
  _.isFinite = function(obj) {
    return isFinite(obj) && !isNaN(parseFloat(obj));
  };

  // Is the given value `NaN`? (NaN is the only number which does not equal itself).
  _.isNaN = function(obj) {
    return _.isNumber(obj) && obj !== +obj;
  };

  // Is a given value a boolean?
  _.isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) === '[object Boolean]';
  };

  // Is a given value equal to null?
  _.isNull = function(obj) {
    return obj === null;
  };

  // Is a given variable undefined?
  _.isUndefined = function(obj) {
    return obj === void 0;
  };

  // Shortcut function for checking if an object has a given property directly
  // on itself (in other words, not on a prototype).
  _.has = function(obj, key) {
    return obj != null && hasOwnProperty.call(obj, key);
  };

  // Utility Functions
  // -----------------

  // Run Underscore.js in *noConflict* mode, returning the `_` variable to its
  // previous owner. Returns a reference to the Underscore object.
  _.noConflict = function() {
    root._ = previousUnderscore;
    return this;
  };

  // Keep the identity function around for default iteratees.
  _.identity = function(value) {
    return value;
  };

  // Predicate-generating functions. Often useful outside of Underscore.
  _.constant = function(value) {
    return function() {
      return value;
    };
  };

  _.noop = function(){};

  _.property = property;

  // Generates a function for a given object that returns a given property.
  _.propertyOf = function(obj) {
    return obj == null ? function(){} : function(key) {
      return obj[key];
    };
  };

  // Returns a predicate for checking whether an object has a given set of
  // `key:value` pairs.
  _.matcher = _.matches = function(attrs) {
    attrs = _.extendOwn({}, attrs);
    return function(obj) {
      return _.isMatch(obj, attrs);
    };
  };

  // Run a function **n** times.
  _.times = function(n, iteratee, context) {
    var accum = Array(Math.max(0, n));
    iteratee = optimizeCb(iteratee, context, 1);
    for (var i = 0; i < n; i++) accum[i] = iteratee(i);
    return accum;
  };

  // Return a random integer between min and max (inclusive).
  _.random = function(min, max) {
    if (max == null) {
      max = min;
      min = 0;
    }
    return min + Math.floor(Math.random() * (max - min + 1));
  };

  // A (possibly faster) way to get the current timestamp as an integer.
  _.now = Date.now || function() {
    return new Date().getTime();
  };

   // List of HTML entities for escaping.
  var escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '`': '&#x60;'
  };
  var unescapeMap = _.invert(escapeMap);

  // Functions for escaping and unescaping strings to/from HTML interpolation.
  var createEscaper = function(map) {
    var escaper = function(match) {
      return map[match];
    };
    // Regexes for identifying a key that needs to be escaped
    var source = '(?:' + _.keys(map).join('|') + ')';
    var testRegexp = RegExp(source);
    var replaceRegexp = RegExp(source, 'g');
    return function(string) {
      string = string == null ? '' : '' + string;
      return testRegexp.test(string) ? string.replace(replaceRegexp, escaper) : string;
    };
  };
  _.escape = createEscaper(escapeMap);
  _.unescape = createEscaper(unescapeMap);

  // If the value of the named `property` is a function then invoke it with the
  // `object` as context; otherwise, return it.
  _.result = function(object, property, fallback) {
    var value = object == null ? void 0 : object[property];
    if (value === void 0) {
      value = fallback;
    }
    return _.isFunction(value) ? value.call(object) : value;
  };

  // Generate a unique integer id (unique within the entire client session).
  // Useful for temporary DOM ids.
  var idCounter = 0;
  _.uniqueId = function(prefix) {
    var id = ++idCounter + '';
    return prefix ? prefix + id : id;
  };

  // By default, Underscore uses ERB-style template delimiters, change the
  // following template settings to use alternative delimiters.
  _.templateSettings = {
    evaluate    : /<%([\s\S]+?)%>/g,
    interpolate : /<%=([\s\S]+?)%>/g,
    escape      : /<%-([\s\S]+?)%>/g
  };

  // When customizing `templateSettings`, if you don't want to define an
  // interpolation, evaluation or escaping regex, we need one that is
  // guaranteed not to match.
  var noMatch = /(.)^/;

  // Certain characters need to be escaped so that they can be put into a
  // string literal.
  var escapes = {
    "'":      "'",
    '\\':     '\\',
    '\r':     'r',
    '\n':     'n',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
  };

  var escaper = /\\|'|\r|\n|\u2028|\u2029/g;

  var escapeChar = function(match) {
    return '\\' + escapes[match];
  };

  // JavaScript micro-templating, similar to John Resig's implementation.
  // Underscore templating handles arbitrary delimiters, preserves whitespace,
  // and correctly escapes quotes within interpolated code.
  // NB: `oldSettings` only exists for backwards compatibility.
  _.template = function(text, settings, oldSettings) {
    if (!settings && oldSettings) settings = oldSettings;
    settings = _.defaults({}, settings, _.templateSettings);

    // Combine delimiters into one regular expression via alternation.
    var matcher = RegExp([
      (settings.escape || noMatch).source,
      (settings.interpolate || noMatch).source,
      (settings.evaluate || noMatch).source
    ].join('|') + '|$', 'g');

    // Compile the template source, escaping string literals appropriately.
    var index = 0;
    var source = "__p+='";
    text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
      source += text.slice(index, offset).replace(escaper, escapeChar);
      index = offset + match.length;

      if (escape) {
        source += "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'";
      } else if (interpolate) {
        source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";
      } else if (evaluate) {
        source += "';\n" + evaluate + "\n__p+='";
      }

      // Adobe VMs need the match returned to produce the correct offest.
      return match;
    });
    source += "';\n";

    // If a variable is not specified, place data values in local scope.
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

    source = "var __t,__p='',__j=Array.prototype.join," +
      "print=function(){__p+=__j.call(arguments,'');};\n" +
      source + 'return __p;\n';

    try {
      var render = new Function(settings.variable || 'obj', '_', source);
    } catch (e) {
      e.source = source;
      throw e;
    }

    var template = function(data) {
      return render.call(this, data, _);
    };

    // Provide the compiled source as a convenience for precompilation.
    var argument = settings.variable || 'obj';
    template.source = 'function(' + argument + '){\n' + source + '}';

    return template;
  };

  // Add a "chain" function. Start chaining a wrapped Underscore object.
  _.chain = function(obj) {
    var instance = _(obj);
    instance._chain = true;
    return instance;
  };

  // OOP
  // ---------------
  // If Underscore is called as a function, it returns a wrapped object that
  // can be used OO-style. This wrapper holds altered versions of all the
  // underscore functions. Wrapped objects may be chained.

  // Helper function to continue chaining intermediate results.
  var result = function(instance, obj) {
    return instance._chain ? _(obj).chain() : obj;
  };

  // Add your own custom functions to the Underscore object.
  _.mixin = function(obj) {
    _.each(_.functions(obj), function(name) {
      var func = _[name] = obj[name];
      _.prototype[name] = function() {
        var args = [this._wrapped];
        push.apply(args, arguments);
        return result(this, func.apply(_, args));
      };
    });
  };

  // Add all of the Underscore functions to the wrapper object.
  _.mixin(_);

  // Add all mutator Array functions to the wrapper.
  _.each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      var obj = this._wrapped;
      method.apply(obj, arguments);
      if ((name === 'shift' || name === 'splice') && obj.length === 0) delete obj[0];
      return result(this, obj);
    };
  });

  // Add all accessor Array functions to the wrapper.
  _.each(['concat', 'join', 'slice'], function(name) {
    var method = ArrayProto[name];
    _.prototype[name] = function() {
      return result(this, method.apply(this._wrapped, arguments));
    };
  });

  // Extracts the result from a wrapped and chained object.
  _.prototype.value = function() {
    return this._wrapped;
  };

  // Provide unwrapping proxy for some methods used in engine operations
  // such as arithmetic and JSON stringification.
  _.prototype.valueOf = _.prototype.toJSON = _.prototype.value;

  _.prototype.toString = function() {
    return '' + this._wrapped;
  };

  // AMD registration happens at the end for compatibility with AMD loaders
  // that may not enforce next-turn semantics on modules. Even though general
  // practice for AMD registration is to be anonymous, underscore registers
  // as a named module because, like jQuery, it is a base library that is
  // popular enough to be bundled in a third party lib, but not be part of
  // an AMD load request. Those cases could generate an error when an
  // anonymous define() is called outside of a loader request.
  if (true) {
    !(__WEBPACK_AMD_DEFINE_ARRAY__ = [], __WEBPACK_AMD_DEFINE_RESULT__ = (function() {
      return _;
    }).apply(exports, __WEBPACK_AMD_DEFINE_ARRAY__),
				__WEBPACK_AMD_DEFINE_RESULT__ !== undefined && (module.exports = __WEBPACK_AMD_DEFINE_RESULT__));
  }
}.call(this));


/***/ }),

/***/ "./public/js/classes/AbstractWidget.ts":
/*!*********************************************!*\
  !*** ./public/js/classes/AbstractWidget.ts ***!
  \*********************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
class AbstractWidget {
    /*
    protected t: TranslationFunction = (key: string) => {
        console.warn("No translation function provided in %s", this.className);
        return key; // dummy
    };
    */
    constructor( /*t?: TranslationFunction*/) {
        this.className = this.constructor.name;
        //if (t)
        //this.t = t;
    }
    getClassName() {
        return this.className;
    }
    addListeners() {
        // overwrite this to add listeners
        // removing is not required for jquery, it has it's internal cleanData() function to remove listeners when removing from DOM
        // however if we use another library for DOM manipulation & listeners we might need removeListeners() in here
        // in browsers DOM listeners are only removed via garbage collection if no JS references exist anymore
    }
}
exports.AbstractWidget = AbstractWidget;


/***/ }),

/***/ "./public/js/classes/HistoryRouter.ts":
/*!********************************************!*\
  !*** ./public/js/classes/HistoryRouter.ts ***!
  \********************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const eventemitter2_1 = __webpack_require__(/*! eventemitter2 */ "eventemitter2");
/**
 * A simple router that listens to changes of the window.history object.
 * @events: stateChange (state, location, stateChangeType)
 */
class HistoryRouter extends eventemitter2_1.EventEmitter2 {
    constructor(window) {
        super();
        this.window = window;
        this.history = window.history;
        // the old way is to implement: window.onhashchange (only detects # changes)
        this.window.onpopstate = (event) => {
            //console.log("location: " + document.location + ", state: " + JSON.stringify(event.state));
            this.emitStateChange(event.state, "pop");
        };
    }
    getState() {
        return this.history.state;
    }
    getLocation() {
        return this.window.document.location;
    }
    back() {
        this.history.back();
    }
    forward() {
        this.history.forward();
    }
    go(delta) {
        this.history.go(delta);
    }
    pushState(data, title, url) {
        if (!url)
            url = pageData.path[data.page];
        this.history.pushState(data, title, url);
        this.emitStateChange(data, "push");
    }
    replaceState(data, title, url) {
        this.history.replaceState(data, title, url);
        this.emitStateChange(data, "replace");
    }
    fireCurrentState() {
        //let urlParams = AppF.getUrlParameters(this.window.document.location.href, true);
        let path = this.window.document.location.pathname.split("/")[1]; // 0 = empty string, 1 = the first part is the name of the view
        if (path === "index.html")
            path = "";
        for (let name in pageData.path) {
            if (pageData.path[name] === "/" + path) {
                let data = { page: name };
                this.emitStateChange(data, "current");
                return;
            }
        }
        AppF.log("App in unknown state with path:", path);
        let data = { page: "home" };
        this.emitStateChange(data, "current");
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    emitStateChange(state, type) {
        this.emit("stateChange", state, this.window.document.location, type);
    }
}
exports.HistoryRouter = HistoryRouter;


/***/ }),

/***/ "./public/js/classes/WebSocket/ClientSocket.ts":
/*!*****************************************************!*\
  !*** ./public/js/classes/WebSocket/ClientSocket.ts ***!
  \*****************************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
//import * as WebSocket from "ws"; // only works on server Side, Browsers have a native WebSocket object
const opcodes_1 = __webpack_require__(/*! ../../../../src/WebSocket/opcodes */ "./src/WebSocket/opcodes.ts");
const AbstractWidget_1 = __webpack_require__(/*! ../AbstractWidget */ "./public/js/classes/AbstractWidget.ts");
const eventemitter2_1 = __webpack_require__(/*! eventemitter2 */ "eventemitter2");
const browserutils_1 = __webpack_require__(/*! @ekliptor/browserutils */ "../../../NodeJS/Packets/browserutils/build/utils.js");
class ClientSocketReceiver extends AbstractWidget_1.AbstractWidget {
    constructor(socket) {
        super();
        this.persistent = false; // don't unsubscribe if we navigate to another page
        this.socket = socket;
    }
    setPersistent(persistent) {
        this.persistent = persistent;
    }
    isPersistent() {
        return this.persistent;
    }
    send(data) {
        this.socket.send(ClientSocket.stringify(this.opcode, data));
    }
    /**
     * Send a request via HTTP instead of WebSocket
     * @param {string} url The url to send it to. Can be a
     * @param data any JavaScript object to be sent as json in the "data" parameter
     * @param {ClientSocketCallback} callback (optional). If not supplied the this.onData() will be called
     *          In case of HTTP errors no callback will be called (just like we get nothing when our websocket connection aborts).
     */
    sendHTTP(url, data, callback = null) {
        if (!url)
            return AppF.log("ERROR: url parameter for sendHTTP() must be a string");
        let http = new XMLHttpRequest();
        if (/^https?:\/\//i.test(url) === false) {
            if (url[0] !== "/")
                url = "/" + url;
            url = this.getOrigin() + url;
            if (url[url.length - 1] !== "/")
                url += "/";
        }
        let params = new FormData();
        params.append("data", JSON.stringify(data));
        http.onreadystatechange = (ev) => {
            if (http.readyState === 4) {
                if (http.status === 200) {
                    let jsonRes = JSON.parse(http.responseText);
                    if (typeof callback === "function")
                        callback(jsonRes);
                    else
                        this.onData(jsonRes);
                }
                else
                    AppF.log("ERROR: Invalid HTTP response in sendHTTP() with code: " + http.status);
            }
        };
        http.open("POST", url, true);
        http.send(params);
    }
    getOrigin() {
        if (typeof window.origin === "string")
            return window.origin;
        else if (document.location.origin === "string")
            return document.location.origin;
        return document.origin; // legacy
    }
}
exports.ClientSocketReceiver = ClientSocketReceiver;
/**
 * A WebSocket implementation for HTML5 browsers.
 * Don't extend the native WebSocket object: https://stackoverflow.com/questions/35282843/how-should-i-extend-the-websocket-type-in-typescript
 * @events connect, disconnect
 */
class ClientSocket extends eventemitter2_1.EventEmitter2 {
    constructor(url, protocols) {
        super();
        /*
        protected t: TranslationFunction = (key: string) => {
            console.warn("No translation function provided in %s", this.className);
            return key; // dummy
        };
        */
        this.receivers = new Map();
        this.disconnectSent = false;
        this.className = this.constructor.name;
        this.socket = new WebSocket(url, protocols);
        this.socket.onerror = (error) => {
            AppF.log("WebSocket error", error);
            Hlp.showMsg(AppF.tr('connectionError'), 'danger');
        };
        this.socket.onopen = (event) => {
            //setTimeout(function() { // delay needed since new websocket module
            //}, HelpersClass.cfg.websocketConnectDelayMs);
            //this.socket.send(JSON.stringify({a: 1}));
            //that.startedInspector = new Date();
            this.emit("connect");
        };
        this.socket.onmessage = (event) => {
            if (typeof event.data !== "string")
                return AppF.log("Received WebSocket data with unexpected type", typeof event.data);
            const message = opcodes_1.AppJSONFormat === "JSON" ? JSON.parse(event.data) : browserutils_1.EJSON.parse(event.data);
            if (message[0] === 1 /* FATAL_ERROR */) {
                this.emitDisconnect(message[1].err);
                return AppF.log("Received WebSocket fatal error message:", message[1]);
            }
            if (message[0] === 4 /* CLOSE */) {
                this.emitDisconnect(message[1].txt);
                return AppF.log("Received WebSocket close message:", message[1]);
            }
            if (message[0] === 2 /* ERROR */ || message[0] === 3 /* WARNING */) {
                let type = message[0] === 2 /* ERROR */ ? "error" : "warning";
                return AppF.log("Received WebSocket %s message:", type, message[1]);
            }
            if (message[0] === 5 /* PING */)
                return;
            let receiver = this.receivers.get(message[0]);
            if (receiver !== undefined)
                receiver.onData(message[1]);
            else
                AppF.log("Received WebSocket data without corresponding receiver. Opcode ", message[0]);
        };
        this.socket.onclose = () => {
            this.socket = null;
            this.emitDisconnect();
        };
    }
    static stringify(opcode, data) {
        if (opcodes_1.AppJSONFormat === "JSON")
            return JSON.stringify([opcode, data]);
        return browserutils_1.EJSON.stringify([opcode, data]);
    }
    subscribe(receiver, persistent = false) {
        receiver.setPersistent(persistent);
        if (this.receivers.has(receiver.opcode) === true)
            return;
        this.send(ClientSocket.stringify(receiver.opcode, { action: "sub" }));
        this.receivers.set(receiver.opcode, receiver);
    }
    unsubscribe(receiver) {
        if (receiver.isPersistent() === true)
            return;
        this.send(ClientSocket.stringify(receiver.opcode, { action: "unsub" }));
        this.receivers.delete(receiver.opcode);
    }
    setAllowReSubscribe(receiver) {
        receiver.setPersistent(false); // allow subscribing again to load the view
        this.receivers.delete(receiver.opcode);
    }
    send(data) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
            return AppF.log("No WebSocket connection available to send data");
        this.socket.send(data);
    }
    close() {
        let tryClose = () => {
            if (this.socket.bufferedAmount === 0)
                this.socket.close();
            else
                setTimeout(tryClose.bind(this), 1000);
        };
        tryClose();
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    emitDisconnect(reason) {
        if (this.disconnectSent === true)
            return;
        this.emit("disconnect", reason);
        this.disconnectSent = true;
    }
}
exports.ClientSocket = ClientSocket;


/***/ }),

/***/ "./public/js/classes/WebSocket/LogReceiver.ts":
/*!****************************************************!*\
  !*** ./public/js/classes/WebSocket/LogReceiver.ts ***!
  \****************************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const ClientSocket_1 = __webpack_require__(/*! ./ClientSocket */ "./public/js/classes/WebSocket/ClientSocket.ts");
class LogReceiver extends ClientSocket_1.ClientSocketReceiver {
    constructor(socket) {
        super(socket);
        this.opcode = 11 /* LOG */;
        this.firstOpen = new Map(); // (type, first open)
        this.firstOpen.set("a", true);
        this.firstOpen.set("t", true);
    }
    onData(data) {
        if (data.a)
            this.printLog("a", data.a);
        else if (data.t)
            this.printLog("t", data.t);
        else if (data.state) {
            if (data.state.trader.paused) {
                $("#pauseTradingTxt").text(AppF.tr("resumeTrading"));
                $("#pauseTrading").addClass("paused");
            }
            if (data.state.trader.pausedOpeningPositions) {
                $("#pauseOpeningPositionsTxt").text(AppF.tr("resumeOpeningPositions"));
                $("#pauseOpeningPositions").addClass("paused");
            }
            if (data.state.mode === "ai") {
                $(".tabAI").removeClass("hidden");
                $(".tabTrading, .tabLending, .tabSocial, .tabCoinMarket, .tabBacktesting, .tabHistory").addClass("hidden");
                $("#pauseOpeningPositions").addClass("hidden");
            }
            else if (data.state.mode === "trading" || data.state.mode === "arbitrage") {
                $(".tabAI, .tabLending, .tabSocial, .tabCoinMarket").addClass("hidden");
            }
            else if (data.state.mode === "lending") {
                $(".tabLending").removeClass("hidden");
                $(".tabAI").addClass("hidden"); // trading tab shows our lending strategies
                $("#pauseOpeningPositions, .tabSocial, .tabCoinMarket, .tabBacktesting, .tabHistory").addClass("hidden");
            }
            else if (data.state.mode === "social") {
                $(".tabSocial, .tabCoinMarket").removeClass("hidden");
                $(".tabTrading, .tabLending, .tabAI, .tabBacktesting, .tabHistory").addClass("hidden");
                $("#pauseTrading, #pauseOpeningPositions").addClass("hidden");
            }
            //if (data.state.devMode === false) //> scrips tab removed, use local IDE
            $(".tabScripts").addClass("hidden");
            if (data.state.error === true)
                Hlp.showMsg(AppF.tr('errorState'), 'danger');
            if (data.state.exchangesIdle === true)
                Hlp.showMsg(AppF.tr('enterExConfFirst'), 'warning');
        }
        //this.send({x: "client res"})
    }
    addListeners() {
        /*
        $("#logs").animate({
            height: "100px",
            duration: 600
        });
        */
        $("#toggleLogs").click(() => {
            $("#logs").toggle("slow", () => {
                if ($("#toggleLogs").hasClass("showLogs")) {
                    $("#toggleLogs").attr("title", AppF.tr("hideLogs"));
                    $("#toggleLogs i").removeClass("fa-arrow-up").addClass("fa-arrow-down");
                }
                else {
                    $("#toggleLogs").attr("title", AppF.tr("showLogs"));
                    $("#toggleLogs i").removeClass("fa-arrow-down").addClass("fa-arrow-up");
                }
                $("#toggleLogs").toggleClass("showLogs");
                setTimeout(() => {
                    this.firstOpen.set("a", false); // app log is always the first on opening
                    $("#logs pre").each(function (i, element) {
                        let el = $(element);
                        el.scrollTop((el).prop("scrollHeight"));
                    });
                }, 500); // be safe and make sure we scroll
            });
        });
        $(".logTabs a").click((event) => {
            let target = $(event.target);
            $(".logTabs li").removeClass("active");
            target.parent().addClass("active");
            $(".logtext").css("display", "none");
            $("#" + target.attr("data-log")).css("display", "inherit");
            let type = target.attr("data-type");
            if (type === "a" || type === "t")
                this.firstOpen.set(type, false);
        });
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    printLog(type, lines) {
        // TODO remove old lines from browser
        const logID = type === "a" ? "#appLog" : "#tradeLog";
        let autoScroll = this.firstOpen.get(type); // scroll down on first load
        if ($(logID).text().length !== 0) {
            if (!autoScroll)
                autoScroll = $(logID).prop("scrollTop") + $(logID).height() * 2 >= $(logID).prop("scrollHeight");
            $(logID).append("\r\n");
        }
        else
            autoScroll = true;
        $(logID).append(AppF.escapeOutput(lines.join("\r\n"), false));
        if (autoScroll)
            $(logID).scrollTop($(logID).prop("scrollHeight"));
    }
}
exports.LogReceiver = LogReceiver;


/***/ }),

/***/ "./public/js/classes/WebSocket/LoginManager.ts":
/*!*****************************************************!*\
  !*** ./public/js/classes/WebSocket/LoginManager.ts ***!
  \*****************************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = __webpack_require__(/*! ../../index */ "./public/js/index.ts");
const $ = __webpack_require__(/*! jquery */ "jquery");
const i18next = __webpack_require__(/*! i18next */ "i18next");
const AbstractController_1 = __webpack_require__(/*! ../../controllers/base/AbstractController */ "./public/js/controllers/base/AbstractController.ts");
class LoginManager extends AbstractController_1.AbstractController {
    constructor(socket) {
        super(socket);
        this.opcode = 23 /* LOGIN */;
    }
    onData(data) {
        if (data.error)
            return this.showLoginError(data);
        if (data.enterLogin)
            this.showLoginDialog(data.enterLogin);
        else if (data.loginRes) {
            $(index_1.AppClass.cfg.appSel).remove("#modal-login-dialog"); // errors are caught above
            AppF.setCookie("apiKey", data.loginRes.apiKey, pageData.cookieLifeDays);
            this.reloadPage();
        }
        else if (data.expirationMsg)
            this.showExpirationMsg(data);
    }
    render() {
        return new Promise((resolve, reject) => {
            resolve(""); // never called in here
        });
    }
    showLoginDialog(loginData = null) {
        let vars = {
            username: loginData ? loginData.username : "",
            password: loginData ? loginData.password : "",
            siteUrl: appData.siteUrl,
            siteName: i18next.t("siteName")
        };
        let loginDialog = AppF.translate(pageData.html.login.loginDialog, vars);
        $(index_1.AppClass.cfg.appSel).append(loginDialog);
        $("#loginForm").submit((event) => {
            event.preventDefault();
            this.send({
                login: {
                    username: $("#username").val(),
                    password: $("#password").val()
                }
            });
        });
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    showLoginError(data) {
        $("#loginError").text(i18next.t(data.errorCode ? data.errorCode : "unknownError"));
    }
    showExpirationMsg(data) {
        const subs = data.expirationMsg.subscription;
        let msgVars = {
            date: subs.expiration.toLocaleDateString() + " " + subs.expiration.toLocaleTimeString(),
            percent: subs.discount,
            code: subs.coupon
        };
        Hlp.showMsg(i18next.t(data.expirationMsg.label, msgVars), data.expirationMsg.level);
        if (!subs.discount || !subs.coupon)
            return;
        Hlp.showMsg(i18next.t("beforeDiscount", msgVars), "success");
    }
    send(data) {
        //return super.send(data); // we use HTTP for now to keep the WS area secured
        return this.sendHTTP("login", data);
    }
}
exports.LoginManager = LoginManager;


/***/ }),

/***/ "./public/js/classes/WebSocket/TradingViewDatafeed.ts":
/*!************************************************************!*\
  !*** ./public/js/classes/WebSocket/TradingViewDatafeed.ts ***!
  \************************************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const ClientSocket_1 = __webpack_require__(/*! ./ClientSocket */ "./public/js/classes/WebSocket/ClientSocket.ts");
class CallbackMap extends Map {
    constructor() {
        super();
    }
}
class TradingViewDatafeed extends ClientSocket_1.ClientSocketReceiver {
    constructor(socket) {
        super(socket);
        this.opcode = 18 /* TRADINGVIEW */;
        this.callbacks = new CallbackMap();
        this.realtimeCallbacks = new Map(); // (subscription ID, callback function)
        this.configNr = 0;
        this.currencyPair = "";
        this.baseCurrency = "";
        this.strategyName = "";
        this.hasData = false;
        this.candleSize = 0; // of the strategy
        this.serverTimeSec = 0;
    }
    onData(data) {
        // data from the server
        //console.log(data)
        if (data.resolution)
            return this.respondWithCallback("onReady", data.resolution);
        else if (data.symbol)
            return this.respondWithCallback("resolveSymbol", data.symbol);
        else if (data.barArr)
            return this.respondWithCallback("getBars-" + data.reqMs, data.barArr);
        else if (data.realtime)
            return this.updateRealtimeCandle(data.realtime);
        else if (data.timeSec)
            return this.respondWithCallback("getServerTime", data.timeSec);
    }
    onReady(callback) {
        let dataReady = (resolution) => {
            callback({
                exchanges: [],
                symbols_types: [],
                //supported_resolutions: ["1", "15", "240", "D", "6M"],
                supported_resolutions: [resolution.toString()],
                supports_marks: false,
                supports_timescale_marks: false,
                supports_time: true
                //futures_regex: null // not yet present in types + not used by us
            });
        };
        this.callbacks.set("onReady", { onSuccess: dataReady });
        this.send({ initPair: this.currencyPair, configNr: this.configNr, strategy: this.strategyName });
    }
    searchSymbols(userInput, exchange, symbolType, onResultReadyCallback) {
        setTimeout(() => {
            onResultReadyCallback([]); // our symbol search is currently hidden
        }, 0);
    }
    resolveSymbol(symbolName, onSymbolResolvedCallback, onResolveErrorCallback) {
        let dataReady = (symbol) => {
            this.candleSize = symbol.resolution;
            onSymbolResolvedCallback({
                name: symbol.name,
                full_name: symbol.name,
                description: symbol.name,
                type: "bitcoin",
                //session: "0000-2400",
                session: "24x7",
                exchange: symbol.exchange,
                listed_exchange: symbol.exchange,
                timezone: symbol.timezone,
                pricescale: 100000000,
                minmov: 1,
                has_intraday: true,
                supported_resolutions: [symbol.resolution.toString()],
                has_seconds: true,
                has_empty_bars: false,
                volume_precision: 4,
                data_status: "streaming",
                currency_code: symbol.baseCurrency
            });
        };
        this.callbacks.set("resolveSymbol", { onSuccess: dataReady, onError: onResolveErrorCallback });
        this.send({ resolve: this.currencyPair, configNr: this.configNr, strategy: this.strategyName });
    }
    getBars(symbolInfo, resolution, from, to, onHistoryCallback, onErrorCallback, firstDataRequest) {
        const now = Date.now();
        let dataReady = (barArr) => {
            if (this.hasData === false && barArr.length !== 0)
                this.hasData = true;
            let bars = this.fromBarArray(barArr);
            let meta = { noData: false };
            if ( /*this.hasData === false*/barArr.length === 0) { // should always be set when there is no new data, else it will start the same request again
                meta.noData = true;
                //meta.nextTime = this.serverTimeSec + this.candleSize*60; // closest time to requested period where we have data
                //meta.nextTime = Math.floor(Date.now() / 1000) + this.candleSize*60; // should be identical
            }
            //onHistoryCallback(bars, {noData: this.hasData === false})
            onHistoryCallback(bars, meta);
        };
        this.callbacks.set("getBars-" + now, { onSuccess: dataReady, onError: onErrorCallback });
        this.send({ bars: {
                configNr: this.configNr,
                currencyPair: this.currencyPair,
                from: from,
                to: to,
                first: firstDataRequest
            },
            strategy: this.strategyName,
            reqMs: now
        });
    }
    subscribeBars(symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) {
        let reqData = { realtime: {
                configNr: this.configNr,
                currencyPair: this.currencyPair,
                //id: this.configNr + "-" + this.currencyPair + "-" + this.strategyName
                strategy: this.strategyName,
                candleSize: this.candleSize,
                id: subscriberUID.toString()
            },
            strategy: this.strategyName
        };
        this.realtimeCallbacks.set(reqData.realtime.id, onRealtimeCallback);
        this.send(reqData);
    }
    unsubscribeBars(subscriberUID) {
        this.realtimeCallbacks.delete(subscriberUID);
        this.send({ unsubscribeID: subscriberUID });
    }
    calculateHistoryDepth(resolution, resolutionBack, intervalBack) {
        // optionally change the history depth we request from server
        return undefined;
    }
    getMarks(symbolInfo, startDate, endDate, onDataCallback, resolution) {
        // optional, currently disabled
    }
    getTimescaleMarks(symbolInfo, startDate, endDate, onDataCallback, resolution) {
        // optional, currently disabled
    }
    getServerTime(callback) {
        let dataReady = (serverTimeSec) => {
            this.serverTimeSec = serverTimeSec;
            callback(serverTimeSec);
        };
        this.callbacks.set("getServerTime", { onSuccess: dataReady });
        this.send({ time: true });
    }
    // TODO add trading terminal API functions
    setCurrencyPair(configNr, currencyPairStr, strategyName) {
        this.configNr = configNr;
        this.currencyPair = currencyPairStr;
        this.baseCurrency = currencyPairStr.split("_")[0];
        this.strategyName = strategyName;
        this.hasData = false;
        for (let cb of this.realtimeCallbacks)
            this.unsubscribeBars(cb[0]);
    }
    resetCurrencyPair() {
        this.configNr = 0;
        this.currencyPair = "";
        this.baseCurrency = "";
        this.strategyName = "";
        this.hasData = false;
        for (let cb of this.realtimeCallbacks)
            this.unsubscribeBars(cb[0]);
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    respondWithCallback(reqFunctionName, ...params) {
        let callbacks = this.callbacks.get(reqFunctionName);
        if (callbacks) {
            // TODO could there be a situation where we want to queue multiple events with the same name? events should use request ms as key then
            this.callbacks.delete(reqFunctionName);
            callbacks.onSuccess(...params);
        }
        else
            AppF.log("Error: TradingView callback not found: " + reqFunctionName);
    }
    respondWithError(reqFunctionName, error) {
        let callbacks = this.callbacks.get(reqFunctionName);
        if (callbacks) {
            this.callbacks.delete(reqFunctionName);
            if (typeof callbacks.onError === "function")
                callbacks.onError(error);
            else
                AppF.log("Error: TradingView error callback not set: " + reqFunctionName);
        }
        else
            AppF.log("Error: TradingView error callback not found: " + reqFunctionName);
    }
    updateRealtimeCandle(update) {
        let bars = this.fromBarArray(update.candles);
        let callback = this.realtimeCallbacks.get(update.id);
        if (callback)
            callback(bars[0]);
        else
            AppF.log("Error: TradingView error realtime callback not found: " + update.id);
    }
    /*
    protected getCurrencyPair(symbolInfo: TradingView.LibrarySymbolInfo) {
        let pair = symbolInfo.name.split(" ");
        return pair[0];
    }

    protected getStrategyName(symbolInfo: TradingView.LibrarySymbolInfo) {
        let pair = symbolInfo.name.split(" ");
        return pair[1];
    }
    */
    fromBarArray(barArr) {
        let bars = [];
        for (let i = 0; i < barArr.length; i++) {
            bars.push({
                time: barArr[i][0],
                open: barArr[i][1],
                high: barArr[i][2],
                low: barArr[i][3],
                close: barArr[i][4],
                volume: barArr[i][5]
            });
        }
        return bars;
    }
    send(data) {
        return super.send(data);
    }
}
exports.TradingViewDatafeed = TradingViewDatafeed;


/***/ }),

/***/ "./public/js/controllers/Backtesting.ts":
/*!**********************************************!*\
  !*** ./public/js/controllers/Backtesting.ts ***!
  \**********************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const JsonEditor_1 = __webpack_require__(/*! ./base/JsonEditor */ "./public/js/controllers/base/JsonEditor.ts");
const $ = __webpack_require__(/*! jquery */ "jquery");
const i18next = __webpack_require__(/*! i18next */ "i18next");
const index_1 = __webpack_require__(/*! ../index */ "./public/js/index.ts");
class Backtesting extends JsonEditor_1.JsonEditor {
    constructor(socket) {
        super(socket);
        this.opcode = 20 /* BACKTESTING */;
        this.backtestRunning = false;
    }
    onData(data) {
        if (data.error === true) {
            if (this.backtestRunning === true)
                this.enableBacktesting();
            return Hlp.showMsg(data.errorTxt ? data.errorTxt : AppF.tr(data.errorCode ? data.errorCode : 'unknownError'), 'danger');
        }
        else if (data.success === true)
            return Hlp.showMsg(data.errorTxt ? data.errorTxt : AppF.tr(data.errorCode ? data.errorCode : 'unknownError'), 'success');
        if (data.init)
            return this.initControls(data.init);
        else if (data.result)
            return this.showResult(data.result);
        else if (data.progress)
            return this.updateProgress(data.progress.percent);
        else if (data.importProgress)
            return this.updateImportProgress(data.importProgress.percent);
    }
    render() {
        return new Promise((resolve, reject) => {
            let html = AppF.translate(pageData.html.backtesting.main);
            resolve(html);
        });
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    initControls(init) {
        init.configFiles.forEach((conf) => {
            let title = conf.substr(1).replace(/\.json$/, "");
            this.$("#configs").append(this.getSelectOption(conf, title, "/" + init.selectedConfig + ".json" === conf));
        });
        index_1.App.initMultiSelect((optionEl, checked) => {
        });
        this.loadDatePickerLib(() => {
            const now = Date.now();
            const useLast = init.lastFromMs !== 0 && init.lastToMs !== 0;
            let options = {
                defaultDate: new Date(useLast ? init.lastFromMs : now - init.fromDays * 24 * 60 * 60 * 1000)
            };
            if (useLast === false)
                this.resetHours(options.defaultDate);
            if (appData.lang !== "en")
                options.locale = appData.lang;
            let from = this.$('#from');
            let to = this.$('#to');
            from.find(':input').attr("data-value", options.defaultDate.getTime());
            from.datetimepicker(options).data("DateTimePicker").date(options.defaultDate);
            options.defaultDate = new Date(useLast ? init.lastToMs : now - init.toDays * 24 * 60 * 60 * 1000);
            if (useLast === false)
                this.resetHours(options.defaultDate);
            to.find(':input').attr("data-value", options.defaultDate.getTime());
            to.datetimepicker(options).data("DateTimePicker").date(options.defaultDate);
            this.setDateTimeValue(from);
            this.setDateTimeValue(to);
            this.addClickHandlers();
        });
        let currencyHtml = "";
        for (let exchange in init.currencyImportMap) {
            currencyHtml += AppF.translate(pageData.html.backtesting.exchangePairs, {
                exchange: exchange,
                currencyPairs: init.currencyImportMap[exchange].join(", ")
            });
        }
        this.$("#importedCurrencyList").html(currencyHtml);
    }
    showResult(result) {
        this.enableBacktesting();
        let resultHtml = AppF.translate(pageData.html.backtesting.result, {
            startBalanceCoins: i18next.t("startBalanceCoins", { currency: result.quoteCurrency }),
            startCoinEquivalent: result.stats.startCoinEquivalent.toFixed(8),
            currentBalanceCoins: i18next.t("currentBalanceCoins", { currency: result.quoteCurrency }),
            currentCoinEquivalent: result.stats.currentCoinEquivalent.toFixed(8),
            startBalanceBase: i18next.t("startBalanceBase", { currency: result.baseCurrency }),
            startBaseEquivalent: result.stats.startBaseEquivalent.toFixed(8),
            currentBalanceBase: i18next.t("currentBalanceBase", { currency: result.baseCurrency }),
            currentBaseEquivalent: result.stats.currentBaseEquivalent.toFixed(8),
            totalBuy: result.stats.trades.totalBuy,
            winningBuy: result.stats.trades.winningBuy,
            losingBuy: result.stats.trades.losingBuy,
            totalSell: result.stats.trades.totalSell,
            winningSell: result.stats.trades.winningSell,
            losingSell: result.stats.trades.losingSell,
            hoursExp: result.stats.marketExposureTime.hours,
            daysExp: result.stats.marketExposureTime.days,
            percentExp: result.stats.marketExposureTime.percent,
            efficiencyPercent: result.stats.efficiencyPercent.toFixed(3),
            marketEfficiencyPercent: result.stats.marketEfficiencyPercent.toFixed(3),
            botEfficiencyPercent: result.stats.botEfficiencyPercent.toFixed(3),
            botVsMarketPercent: result.stats.botVsMarketPercent.toFixed(3)
        });
        this.$("#backtestResult").html(resultHtml);
        this.$("#showResult").attr("data-href", result.file);
        this.$("#showResult").click((event) => {
            window.open(this.getBacktestResultUrl(event, false), "", "");
        });
        this.$("#downloadResult").click((event) => {
            window.open(this.getBacktestResultUrl(event, true), "", "");
        });
    }
    getBacktestResultUrl(event, download = false) {
        let key = AppF.getCookie("apiKey");
        let resultUrl = document.location.origin + "/dl/?bt=" + encodeURIComponent($(event.target).attr("data-href"));
        if (key)
            resultUrl += "&apiKey=" + key;
        if (download === true)
            resultUrl += "&dl=1";
        return resultUrl;
    }
    updateProgress(percent) {
        this.$("#startBacktesting").attr("disabled", "");
        let progressHtml = AppF.translate(pageData.html.backtesting.progressAnimated, {
            percent: percent
        });
        this.$("#backtestProgress").html(progressHtml);
    }
    updateImportProgress(percent) {
        if (percent === 100.0)
            this.$("#backtestImport").empty();
        else {
            /**
             * or to consider whitespaces as empty:
             * function isEmpty( el ){
                  return !$.trim(el.html())
              }
             */
            if (this.$("#backtestImport").is(':empty') === true) {
                let progressHtml = AppF.translate(pageData.html.backtesting.importProgress);
                this.$("#backtestImport").html(progressHtml);
            }
        }
    }
    enableBacktesting() {
        this.backtestRunning = false;
        this.$("#startBacktesting").removeAttr("disabled");
        this.$("#backtestProgress").empty();
    }
    addClickHandlers() {
        this.$("#backtestingForm").submit((event) => {
            event.preventDefault();
            //let values = $(event.target).serializeArray();
            let from = this.$("#from").data("DateTimePicker").date().toDate();
            let to = this.$("#to").data("DateTimePicker").date().toDate();
            if (from.getTime() > to.getTime())
                return Hlp.showMsg(i18next.t('backtestRangeErr'), 'danger');
            //values.push({name: "taskStart", value: from.getTime()});
            this.$("#startBacktesting").attr("disabled", "");
            this.$("#backtestResult").empty();
            this.updateProgress(0.0);
            this.backtestRunning = true;
            this.send({
                start: {
                    config: this.$("#configs").val(),
                    from: from.getTime(),
                    to: to.getTime(),
                    startBalance: this.$("#startBalance").val(),
                    slippage: this.$("#slippage").val(),
                    tradingFee: this.$("#tradingFee").val()
                }
            });
        });
        this.$("#showFullImports").click((event) => {
            this.$("#importedCurrencies").fadeToggle("slow");
        });
    }
    resetHours(date) {
        date.setUTCHours(0, 0, 0, 0);
    }
    send(data) {
        super.send(data);
    }
}
exports.Backtesting = Backtesting;


/***/ }),

/***/ "./public/js/controllers/CoinMarket.ts":
/*!*********************************************!*\
  !*** ./public/js/controllers/CoinMarket.ts ***!
  \*********************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const ChartController_1 = __webpack_require__(/*! ./base/ChartController */ "./public/js/controllers/base/ChartController.ts");
class CoinMarket extends ChartController_1.ChartController {
    constructor(socket) {
        super(socket);
        this.opcode = 17 /* COINMARKET */;
        this.chartLibsLoaded = true; // currently always included globally
        this.maxAge = null;
        this.chartLegendDays = 0;
        this.chartLegendTickHours = 0;
        this.serverDate = null;
        this.crawlTickerHours = 0;
        this.chartLegend = [];
        this.chartLegendHourly = [];
        this.nextData = null;
    }
    onData(data) {
        if (data.maxAge) {
            this.maxAge = new Date(data.maxAge); // if we use JSON (instead of EJSON)
            this.chartLegendDays = data.days;
            this.chartLegendTickHours = data.tickHours;
            this.serverDate = new Date(data.serverDate);
            this.crawlTickerHours = data.crawlTickerHours;
            this.createChartLegend();
            this.createHourlyChartLegend(data.maxTickDate);
            return;
        }
        if (data.full) {
            this.$().empty(); // shouldn't be needed (if we do incremental updates, which we don't currently on this view)
            let html = AppF.translate(pageData.html.coinMarketStats.coinRates, {}) + AppF.translate(pageData.html.coinMarketStats.tickIndicator, {});
            this.$().append(html);
            this.nextData = data.full;
            this.addChartHtml("coinRateComparison");
            this.addChartHtml("tickIndicator");
            if (!this.chartLibsLoaded) {
                AppF.loadResource(this.getChartLibs(), this.displayChartData.bind(this), null, true);
            }
            else
                this.displayChartData();
            this.showVolumeSpikes();
            Hlp.updateTimestampsRepeating(); // used for spikes
            this.nextData = null;
            return;
        }
    }
    render() {
        return new Promise((resolve, reject) => {
            let status = AppF.translate(pageData.html.coinMarketStats.main);
            resolve(status);
        });
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    addChartHtml(type) {
        let statsHtml = AppF.translate(pageData.html.coinMarketStats.chart, {
            chartHeadline: AppF.tr(type),
            type: type
        });
        this.$("#" + type).append(statsHtml);
    }
    displayChartData() {
        this.chartLibsLoaded = true;
        // coin rate comparison
        let coinPlotData = [];
        for (let currencyStr in this.nextData.coinStats) {
            coinPlotData.push({
                label: currencyStr,
                dataPoints: this.nextData.coinStats[currencyStr]
            });
        }
        let coinOpts = new ChartController_1.PlotChartOptions(this.chartLegend);
        this.plotLineChart("#chart-coinRateComparison", coinPlotData, coinOpts);
        // TICK indicator
        this.displayTickChartData(this.nextData.tick, ["usd", "btc"]);
    }
    displayTickChartData(values, tickBaseCurrencies) {
        let coinOpts = new ChartController_1.PlotChartOptions(this.chartLegendHourly);
        let coinPlotData = [];
        tickBaseCurrencies.forEach((tickCurrency) => {
            coinPlotData.push({
                label: "TICK-" + tickCurrency.toUpperCase(),
                dataPoints: values[tickCurrency]
            });
        });
        this.plotLineChart("#chart-tickIndicator", coinPlotData, coinOpts);
    }
    showVolumeSpikes() {
        let html = AppF.translate(pageData.html.coinMarketStats.volumeSpikes, {
            coinVolumeSpikes: AppF.format(AppF.tr("coinVolumeSpikes"), this.crawlTickerHours)
        });
        this.$().append(html);
        for (let exchange in this.nextData.volumeSpikes) {
            let spikeArr = this.nextData.volumeSpikes[exchange];
            let spikes = "";
            for (let i = 0; i < spikeArr.length; i++) {
                spikes += i + ". " + spikeArr[i].currencyPair + " " + spikeArr[i].spikeFactor.toFixed(2) + "x";
                spikes += ", from " + Math.round(spikeArr[i].lastTicker.quoteVolume) + ", to " + Math.round(spikeArr[i].currentTicker.quoteVolume);
                spikes += ", price change " + spikeArr[i].priceChange.toFixed(2) + "%";
                let timeHtml = AppF.translate(pageData.html.misc.time, {
                    timestamp: Math.floor(spikeArr[i].date.getTime() / 1000),
                    time: spikeArr[i].date.getTime()
                });
                spikes += ", " + timeHtml + "<br>";
            }
            html = AppF.translate(pageData.html.coinMarketStats.exchangeVolumeSpike, {
                exchange: exchange,
                spikesEx: spikes
            }, true);
            this.$("#volumeSpikes").append(html);
        }
    }
    createChartLegend() {
        let legend = [];
        let currentDate = new Date(this.maxAge); // copy it
        for (let i = 0; i < this.chartLegendDays * 24; i++) // we have hourly ticks on our x axis
         {
            legend.push(currentDate.toLocaleDateString(appData.locale, { timeZone: "UTC" }) + " " + currentDate.getUTCHours() + ":00");
            currentDate.setTime(currentDate.getTime() + 1 * 3600000); // hourly values, legend step is > 1
        }
        this.chartLegend = legend;
    }
    createHourlyChartLegend(maxTickDate) {
        let legend = [];
        let currentDate = new Date(maxTickDate); // copy it
        for (let i = 0; i < this.chartLegendTickHours; i++) // we have hourly ticks on our x axis
         {
            legend.unshift(currentDate.toLocaleDateString(appData.locale, { timeZone: "UTC" }) + " " + currentDate.getUTCHours() + ":00");
            currentDate.setTime(currentDate.getTime() - 1 * 3600000); // go back 1h from the latest data
        }
        this.chartLegendHourly = legend;
    }
}
exports.CoinMarket = CoinMarket;


/***/ }),

/***/ "./public/js/controllers/Config.ts":
/*!*****************************************!*\
  !*** ./public/js/controllers/Config.ts ***!
  \*****************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = __webpack_require__(/*! ../index */ "./public/js/index.ts");
const $ = __webpack_require__(/*! jquery */ "jquery");
const i18next = __webpack_require__(/*! i18next */ "i18next");
const TableController_1 = __webpack_require__(/*! ./base/TableController */ "./public/js/controllers/base/TableController.ts");
class Config extends TableController_1.TableController {
    constructor(socket) {
        super(socket);
        this.opcode = 13 /* CONFIG */;
        this.selectedTab = null;
        this.fullData = null;
        this.currentConfigFile = null;
        this.jsonEditor = null;
        this.createJsonViewTimerID = 0;
        this.canEdit = false;
        this.currencyTable = null;
        this.exchangeLinks = {};
        this.persistent = true;
    }
    onData(data) {
        if (data.error)
            return Hlp.showMsg(data.errorTxt ? data.errorTxt : AppF.tr(data.errorCode ? data.errorCode : 'unknownError'), 'danger');
        else if (data.saved) {
            this.$("#saveConfig, #saveKey, #saveNotification, #copyConfigPanel").fadeOut("slow");
            Hlp.showMsg(AppF.tr('savedConfig'), 'success', index_1.AppClass.cfg.successMsgRemoveSec);
            if (data.restart)
                this.showRestartMsg();
            if (data.configFiles)
                this.rebuildConfigDropdown(data.configFiles);
            return;
        }
        if (data.configWasReset === true)
            Hlp.showMsg(data.errorTxt ? data.errorTxt : AppF.tr(data.errorCode ? data.errorCode : 'configWasReset'), 'danger');
        if (!this.isVisible())
            return;
        if (data.configFiles) {
            this.setPersistent(true);
            this.setupInitialPage(data);
        }
        else if (data.configFileData) {
            if (this.editor) // undefined if this is not the current view
                this.editor.setValue(data.configFileData, -1);
            this.canEdit = true;
        }
        else if (data.currencies)
            this.showCurrencyTable(data.currencies);
    }
    render() {
        return new Promise((resolve, reject) => {
            this.canEdit = false; // when we re-open the page
            resolve(pageData.html.config.main);
        });
    }
    restartBot() {
        Hlp.confirm(AppF.tr('restartConfirm'), (answer) => {
            if (answer !== true)
                return;
            let vars = {
                title: AppF.tr('restarting'),
                text: AppF.tr('restartingTxt')
            };
            let disconnected = AppF.translate(pageData.html.misc.restartDialog, vars);
            $(index_1.AppClass.cfg.appSel).append(disconnected);
            this.send({ restart: true });
            $("#reloadPage").click((event) => {
                window.location.reload(true);
            });
            let checkRestartDone = (responseCount) => {
                setTimeout(() => {
                    let data = new FormData(); // multipart POST data
                    data.append("data", JSON.stringify({
                        apiKey: AppF.getCookie("apiKey") // if the key changed we won't be able to open the app either way
                    }));
                    $.ajax({
                        url: pageData.pathRoot + "state/",
                        method: "POST",
                        timeout: 5000,
                        cache: false,
                        contentType: false,
                        processData: false,
                        data: data
                    }).done((data) => {
                        if (data.data && data.data.ready === true) {
                            responseCount++;
                            if (responseCount > 2) { // wait for 3 responses to ensure it's not the update process
                                // check for content to see if the app is really ready (and not just the http server running + updater restarting again)
                                setTimeout(() => {
                                    document.location.reload(true);
                                }, 1500);
                            }
                            else
                                checkRestartDone(responseCount);
                        }
                        else {
                            if (responseCount > 0)
                                responseCount--;
                            checkRestartDone(responseCount);
                        }
                    }).fail((err) => {
                        if (responseCount > 0)
                            responseCount--;
                        checkRestartDone(responseCount);
                    });
                }, 1200);
            };
            checkRestartDone(0);
        });
    }
    pauseTrading() {
        this.send({ setPaused: $("#pauseTrading").hasClass("paused") ? false : true });
        if ($("#pauseTrading").hasClass("paused"))
            $("#pauseTradingTxt").text(AppF.tr("pauseTrading"));
        else
            $("#pauseTradingTxt").text(AppF.tr("resumeTrading"));
        $("#pauseTrading").toggleClass("paused");
    }
    pauseOpeningPositions() {
        this.send({ setPausedOpening: $("#pauseOpeningPositions").hasClass("paused") ? false : true });
        if ($("#pauseOpeningPositions").hasClass("paused"))
            $("#pauseOpeningPositionsTxt").text(AppF.tr("pauseOpeningPositions"));
        else
            $("#pauseOpeningPositionsTxt").text(AppF.tr("resumeOpeningPositions"));
        $("#pauseOpeningPositions").toggleClass("paused");
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    setupInitialPage(data) {
        this.selectedTab = data.selectedTab;
        this.fullData = data;
        this.currentConfigFile = data.selectedConfig;
        let tabsHtml = AppF.translate(pageData.html.config.tabs, {
            active: ""
        });
        this.$().html(tabsHtml);
        data.tabs.forEach((tabID) => {
            if (tabID === data.selectedTab)
                this.$("#" + tabID).addClass("active");
            this.$("#" + tabID).click((event) => {
                const tab = $(event.target).parent();
                this.$(".configTab").removeClass("active");
                tab.addClass("active");
                const curTabID = tab.attr("id");
                this.displayTab(curTabID);
                this.send({ selectedTab: curTabID });
            });
        });
        this.displayTab(this.selectedTab);
        if (data.devMode !== true) {
            setTimeout(() => {
                $(".tabScripts, #tabTradingDev").addClass("hidden");
            }, 100);
        }
    }
    displayTab(tab) {
        this.$("#tabContent").empty();
        clearTimeout(this.createJsonViewTimerID);
        switch (tab) {
            case "tabGeneral":
                this.setupGeneralTab(this.fullData);
                break;
            case "tabTrading":
                // gets show twice otherwise because we load config twice on page open
                // because JSONView creates the element async?
                this.createJsonViewTimerID = setTimeout(() => {
                    this.$("#tabContent").empty();
                    this.setupTradingTab(this.fullData);
                }, 100);
                break;
            case "tabTradingDev":
                this.setupTradingDevTab(this.fullData);
                break;
        }
    }
    setupGeneralTab(data) {
        let html = AppF.translate(pageData.html.config.general);
        this.$("#tabContent").append(html);
        data.tradingModes.forEach((mode) => {
            this.$("#tradingMode").append(this.getSelectOption(mode, AppF.tr(mode), mode === data.selectedTradingMode));
        });
        data.configFiles.forEach((conf) => {
            let title = this.getPlainConfigName(conf);
            this.$("#configs").append(this.getSelectOption(conf, title, "/" + data.selectedConfig + ".json" === conf));
        });
        this.$("#copyConfig").click((event) => {
            this.$("#copyConfigPanel").fadeIn("slow");
        });
        this.$("#copyConfigName").keydown((event) => {
            this.onCopyConfigNameChange();
        });
        this.$("#copyConfigName").change((event) => {
            this.onCopyConfigNameChange();
        });
        this.$("#copyConfigForm").submit((event) => {
            event.preventDefault();
            this.send({ copyConfig: this.$("#copyConfigName").val() });
        });
        this.$("#cancelNewConfigFile").click((event) => {
            this.$("#copyConfigPanel").fadeOut("slow");
        });
        this.$("#deleteConfig").click((event) => {
            const valueToRemove = this.$("#configs").val();
            const valueToRemovePlain = this.getPlainConfigName(valueToRemove);
            if (data.activeConfig === valueToRemovePlain) {
                Hlp.alert(AppF.tr('deleteConfigDenied'));
                return;
            }
            Hlp.confirm(i18next.t("deleteConfigConfirm", { name: valueToRemovePlain }), (answer) => {
                if (answer !== true)
                    return;
                this.send({ deleteConfig: valueToRemove });
                this.$("#configs option[value='" + valueToRemove + "']").remove();
                this.$("#configs").val("/" + data.activeConfig + ".json").multiselect("rebuild"); // refresh works for changing the value only
            });
        });
        data.traders.forEach((trader) => {
            this.$("#traders").append(this.getSelectOption(trader, AppF.tr(trader), data.selectedTrader === trader));
        });
        let firstEx = true;
        data.exchanges.forEach((exchangeName) => {
            this.$("#exchanges").append(this.getSelectOption(exchangeName, exchangeName, firstEx));
            firstEx = false;
        });
        this.exchangeLinks = data.exchangeLinks;
        this.$("#exchangeLink").attr("href", this.exchangeLinks[data.exchanges[0]]);
        let notificationMethods = Object.keys(data.notifications);
        let firstNotification = true;
        notificationMethods.forEach((method) => {
            this.$("#notificationMethod").append(this.getSelectOption(method, method, firstNotification));
            firstNotification = false;
        });
        index_1.App.initMultiSelect((optionEl, checked) => {
            const id = optionEl.attr("id");
            if (id !== "exchanges")
                this.showRestartMsg();
            if (id === "configs") {
                this.canEdit = false;
                this.currentConfigFile = this.getPlainConfigName(optionEl.val());
                this.$("#saveConfig").fadeOut("slow");
                this.send({ configChange: optionEl.val() });
            }
            else if (id === "traders")
                this.send({ traderChange: optionEl.val() });
            else if (id === "tradingMode")
                this.send({ tradingModeChange: optionEl.val() });
            else if (id === "exchanges")
                this.showEditExchangeApiKeys(optionEl.val());
            else if (id === "notificationMethod")
                this.showNotificationKeyInput(optionEl.val());
        });
        if (data.lending === true)
            this.$("#traders").multiselect('disable'); // TODO wait for typings
        else if (data.social === true)
            this.$(".traderCtrl").addClass("hidden");
        this.$("#debug").prop("checked", data.debugMode);
        this.$("#debug").change((event) => {
            this.send({ debugMode: $(event.target).is(":checked") });
        });
        if (data.premium === true)
            this.$("#debugCtrls").addClass("hidden");
        this.$("#devMode").prop("checked", data.devMode);
        this.$("#devMode").change((event) => {
            const checked = $(event.target).is(":checked");
            //> scrips tab removed, use local IDE: .tabScripts
            if (checked === true)
                $("#tabTradingDev").removeClass("hidden");
            else
                $("#tabTradingDev").addClass("hidden");
            this.send({ devMode: checked });
        });
        this.$("#restoreCfg").prop("checked", data.restoreCfg);
        this.$("#restoreCfg").change((event) => {
            const checked = $(event.target).is(":checked");
            if (checked === true) {
                Hlp.confirm(AppF.tr('restoreCfgMsg'), (answer) => {
                    if (answer !== true) {
                        this.$("#restoreCfg").prop("checked", false);
                        return;
                    }
                    this.send({ restoreCfg: checked });
                });
            }
            else
                this.send({ restoreCfg: checked });
        });
        // Exchange API Keys
        this.$("#configExchangeForm input[type=text]").change((event) => {
            this.$("#saveKey").fadeIn("slow");
            if (this.canDeleteApiKey() === true)
                this.$("#deleteApiKey").fadeIn("slow");
        });
        setTimeout(() => {
            if (this.canDeleteApiKey() === true)
                this.$("#deleteApiKey").fadeIn("slow");
        }, 0);
        this.showEditExchangeApiKeys(this.$("#exchanges").val());
        this.showNotificationKeyInput(this.$("#notificationMethod").val());
        //this.$("#saveKey").click((event) => { // we want to use the browser to validate the form
        this.$("#configExchangeForm").submit((event) => {
            event.preventDefault();
            let saveReq = {};
            const exchangeName = this.$("#exchanges").val();
            saveReq[exchangeName] = {
                key: this.$("#apiKey").val(),
                secret: this.$("#apiSecret").val(),
                key2: "",
                secret2: ""
            };
            if (this.$("#key2Panel").is(":visible") === true) {
                saveReq[exchangeName].key2 = this.$("#apiKey2").val();
                saveReq[exchangeName].secret2 = this.$("#apiSecret2").val();
            }
            this.send({
                saveKey: saveReq
            });
        });
        this.$("#deleteApiKey").click((event) => {
            Hlp.confirm(AppF.tr('deleteApiKeyConfirm'), (answer) => {
                if (answer !== true)
                    return;
                const exchangeName = this.$("#exchanges").val();
                this.send({ removeApiKey: exchangeName });
            });
        });
        // Notification method
        this.$("#notificationsForm input[type=text]").change((event) => {
            this.$("#saveNotification").fadeIn("slow");
        });
        this.$("#notificationsForm").submit((event) => {
            event.preventDefault();
            let saveReq = {};
            const method = this.$("#notificationMethod").val();
            saveReq[method] = {
                receiver: this.$("#notificationKey").val()
            };
            this.send({
                saveNotification: saveReq,
                notificationMeta: {
                    title: i18next.t("notifySetupTitle"),
                    text: i18next.t("notifySetupTxt")
                }
            });
        });
    }
    setupTradingTab(data) {
        let html = AppF.translate(pageData.html.config.jsonView);
        this.$("#tabContent").append(html);
        this.showAsyncLoadingIcon();
        this.loadJsonView(() => {
            //$('.asyncWait').remove();
            JSONEditor.defaults.languages[i18next.language] = AppF.getTranslation("editor");
            JSONEditor.defaults.language = i18next.language;
            let element = document.getElementById('tradeSettingsEditor');
            let options = {
                theme: "bootstrap3",
                iconlib: "fontawesome4",
                schema: this.translateSchema(data.jsonEditorData.schema),
                disable_collapse: true,
                disable_edit_json: true,
                disable_properties: true,
                //no_additional_properties: true,
                disable_array_delete_all_rows: true,
                disable_array_delete_last_row: true,
                disable_array_reorder: true
            };
            this.jsonEditor = new JSONEditor(element, options);
            // Set the value
            this.jsonEditor.setValue(data.jsonEditorData.data);
            //this.jsonEditor.getEditor('root.username').disable();
            this.jsonEditor.on("change", () => {
                if (!this.canEdit)
                    return;
                this.$("#saveConfig").fadeIn("slow");
            });
            this.setCanEdit();
            this.$("#saveConfig").click((event) => {
                let errors = this.jsonEditor.validate();
                if (errors.length !== 0) {
                    for (let i = 0; i < errors.length; i++) {
                        let locals = {
                            path: errors[i].path,
                            property: errors[i].property,
                            message: errors[i].message
                        };
                        Hlp.showMsg(i18next.t('editor:errorValidate', locals), 'danger');
                    }
                    return;
                }
                this.send({
                    saveConfig: this.jsonEditor.getValue(),
                    configName: /*this.$("#configs").val()*/ this.currentConfigFile
                });
            });
            setTimeout(() => {
                // hide the button to delete the first (only config)
                this.$(".json-editor-btn-delete").eq(0).addClass("hidden");
                // hide the first delete button in all strategy-property arrays (such as PlanRunner.order)
                let lastParentStrategy = null;
                this.$(".json-editor-btn-delete").each((index, elem) => {
                    const el = $(elem);
                    if (el.hasClass("hidden") === true || el.is(":visible") === false)
                        return;
                    const obj = el.parent().parent().parent();
                    if (obj.attr("data-schematype") !== "object")
                        return; // only hide it on object arrays
                    const schemaPath = obj.attr("data-schemapath");
                    if (schemaPath.indexOf(".strategies.") === -1)
                        return; // only hide it within strategies (don't hide the delete button for 2nd main config)
                    const parentStrategy = obj.parent().parent().parent().attr("data-schemapath");
                    if (parentStrategy === lastParentStrategy)
                        return; // hide only the 1st delete array element button, show from 2nd onwards...
                    lastParentStrategy = parentStrategy;
                    el.addClass("hidden");
                });
                this.$("#tradeSettingsEditor option[value=undefined]").remove();
                // remove exchange delete + add buttons (in arbitrage mode)
                for (let i = 0; i < data.jsonEditorData.data.length; i++) {
                    let selector = "#tradeSettingsEditor div[data-schemapath='root." + i + ".exchanges']";
                    this.$(selector + " .json-editor-btn-add").remove();
                    this.$(selector + " .json-editor-btn-delete").remove();
                }
                this.removeAsyncLoadingIcon();
            }, 0);
        });
        this.$("#showCurrencies").click((event) => {
            let vars = {};
            let currencyDialog = AppF.translate(pageData.html.supportedCurrencies.currencyDialog, vars);
            $(index_1.AppClass.cfg.appSel).append(currencyDialog);
            $("#closeCurrencyDialog").click((event) => {
                $("#modal-currency-dialog").remove();
            });
            this.send({ getCurrencies: true });
            this.showAsyncLoadingIcon();
        });
    }
    setupTradingDevTab(data) {
        let html = AppF.translate(pageData.html.config.editor);
        this.$("#tabContent").append(html);
        this.editor = ace.edit("editor");
        this.editor.$blockScrolling = Number.POSITIVE_INFINITY;
        this.editor.setTheme("ace/theme/xcode");
        this.editor.getSession().setMode("ace/mode/json");
        this.editor.on("change", (e) => {
            if (!this.canEdit)
                return;
            this.$("#saveConfig").fadeIn("slow");
        });
        this.editor.setValue(data.configFileData, -1);
        this.setCanEdit();
        this.$("#saveConfig").click((event) => {
            this.send({
                saveConfig: this.editor.getValue(),
                configName: /*this.$("#configs").val()*/ this.currentConfigFile
            });
        });
    }
    showEditExchangeApiKeys(exchangeName) {
        let exchangeKey = this.fullData.exchangeKeys[exchangeName];
        if (!exchangeKey)
            return AppF.log("Error getting exchange key " + exchangeName);
        this.$("#exchangeLink").attr("href", this.exchangeLinks[exchangeName]);
        this.$("#apiKey").val(exchangeKey.key);
        this.$("#apiSecret").val(exchangeKey.secret);
        this.$("#apiKey2").val(exchangeKey.key2 || "");
        this.$("#apiSecret2").val(exchangeKey.secret2 || "");
        if (exchangeKey.key2 === undefined) {
            this.$("#key2Panel").fadeOut("slow");
            this.$("#apiKey2, #apiSecret2").removeAttr("required");
        }
        else {
            this.$("#key2Panel").fadeIn("slow");
            this.$("#apiKey2, #apiSecret2").attr("required", "required");
        }
    }
    showNotificationKeyInput(notifytMethod) {
        let notifyKeys = this.fullData.notifications[notifytMethod];
        if (!notifyKeys)
            return AppF.log("Error getting notification method data " + notifytMethod);
        let firstValue = /*notifyKeys.key || */ notifyKeys.receiver;
        this.$("#notificationKey").val(firstValue);
    }
    setCanEdit() {
        setTimeout(() => {
            this.canEdit = true;
        }, 1200);
    }
    translateSchema(schema) {
        // TODO add jquery code to collapse all descriptions. only show the first few words (via Regex) and then "..." and let the user click to expand
        for (let prop in schema) {
            //console.log(prop, schema[prop])
            if (prop === "title") {
                if (i18next.exists(schema[prop]))
                    schema[prop] = i18next.t(schema[prop]);
                //continue;
            }
            else if (prop === "strategies") {
                schema[prop].properties = this.translateStrategyProperties(schema[prop].properties);
            }
            //else if (prop !== "type")
            //continue;
            else if (schema[prop].title === undefined) {
                const key = "confTitle." + prop;
                if (i18next.exists(key))
                    schema[prop].title = i18next.t(key);
            }
            if (schema[prop].description === undefined) {
                const key = "confDesc." + prop;
                if (i18next.exists(key))
                    schema[prop].description = i18next.t(key);
            }
            const type = schema["type"];
            if (type === "array") {
                //for (let subProp in  schema.items)
                //schema.items[subProp] = this.translateSchema(schema.items[subProp]);
                schema.items = this.translateSchema(schema.items);
            }
            else if (type === "object") {
                //for (let subProp in schema.properties)
                //schema.properties[subProp] = this.translateSchema(schema.properties[subProp]);
                schema.properties = this.translateSchema(schema.properties);
            }
            const subType = schema[prop]["type"];
            if (subType === "array") {
                schema[prop].items = this.translateSchema(schema[prop].items);
            }
            else if (subType === "object") {
                schema[prop].properties = this.translateSchema(schema[prop].properties);
            }
        }
        return schema;
    }
    translateStrategyProperties(strategySchema) {
        const strategyNames = Object.keys(strategySchema);
        strategyNames.forEach((strategyName) => {
            const lookupName = strategyName.replace(/Leverage$/, ""); // leverage strategies have the same config as their parent class
            const key = this.getStrategyLocaleKey() + lookupName + ".desc";
            if (i18next.exists(key))
                strategySchema[strategyName].description = i18next.t(key);
            if (typeof strategySchema[strategyName].properties !== "object") {
                AppF.log("ERROR: strategy doesn't have properties object - ", strategyName);
                return;
            }
            for (let prop in strategySchema[strategyName].properties) {
                if (strategySchema[strategyName].properties[prop].type === "array")
                    strategySchema[strategyName].properties[prop] = this.translateStrategyChildArrayProperties(strategySchema[strategyName].properties[prop], strategyName, prop);
                else if (strategySchema[strategyName].properties[prop].type === "object")
                    strategySchema[strategyName].properties[prop] = this.translateStrategyChildObjectProperties(strategySchema[strategyName].properties[prop], strategyName, prop);
                else {
                    let stratKey = this.getStrategyLocaleKey() + lookupName + "." + prop; // try the strategy first
                    if (i18next.exists(stratKey)) {
                        strategySchema[strategyName].properties[prop].description = i18next.t(stratKey);
                        continue;
                    }
                    stratKey = this.getStrategyLocaleKey() + "all." + prop; // check if this property is part of all strategies second
                    if (i18next.exists(stratKey))
                        strategySchema[strategyName].properties[prop].description = i18next.t(stratKey);
                }
            }
        });
        return strategySchema;
    }
    translateStrategyChildArrayProperties(strategySchema, strategyName, prop) {
        const key = this.getStrategyLocaleKey() + strategyName + "." + prop + ".desc";
        if (i18next.exists(key))
            strategySchema.description = i18next.t(key);
        for (let childProp in strategySchema.items.properties) {
            const childKey = this.getStrategyLocaleKey() + strategyName + "." + prop + "." + childProp;
            if (i18next.exists(childKey))
                strategySchema.items.properties[childProp].description = i18next.t(childKey);
        }
        return strategySchema;
    }
    translateStrategyChildObjectProperties(strategySchema, strategyName, prop) {
        for (let childProp in strategySchema.properties) {
            const childKey = this.getStrategyLocaleKey() + strategyName + "." + prop + "." + childProp;
            if (i18next.exists(childKey))
                strategySchema.properties[childProp].description = i18next.t(childKey);
        }
        return strategySchema;
    }
    getStrategyLocaleKey() {
        if (this.fullData == null)
            return "stratDesc.";
        if (this.fullData.arbitrage === true)
            return "arbitrageStratDesc.";
        if (this.fullData.lending === true)
            return "lendingStratDesc.";
        return "stratDesc.";
    }
    showRestartMsg() {
        let msg = i18next.t('restartRequiredConf');
        let vars = {
            title: AppF.tr('restartNow'),
            href: "javascript:;",
            id: "restartLnk"
        };
        msg += " " + AppF.translate(pageData.html.misc.link, vars) + "<br>" + i18next.t('backtestNoRestart');
        Hlp.showMsg(msg, 'warning');
        setTimeout(() => {
            $("#restartLnk").click((event) => {
                this.restartBot();
            });
        }, 100);
    }
    onCopyConfigNameChange() {
        if (this.$("#saveConfigFile").is(":visible") === false)
            this.$("#saveConfigFile").fadeIn("slow");
    }
    rebuildConfigDropdown(configFiles) {
        this.$("#configs option").remove();
        configFiles.forEach((conf) => {
            let title = this.getPlainConfigName(conf);
            this.$("#configs").append(this.getSelectOption(conf, title, "/" + this.currentConfigFile + ".json" === conf));
        });
        this.$("#configs").multiselect("rebuild");
    }
    showCurrencyTable(currencies) {
        this.removeAsyncLoadingIcon();
        let tableOptions = this.getTableOpts();
        tableOptions["pageLength"] = Number.MAX_VALUE; // show all
        tableOptions["paging"] = false;
        tableOptions = this.prepareTable(tableOptions, "#currencyTable", false);
        this.currencyTable = $("#currencyTable").DataTable(tableOptions);
        for (let tickerSymbol in currencies) {
            this.currencyTable.row.add([
                tickerSymbol,
                AppF.escapeOutput(currencies[tickerSymbol])
            ]);
        }
        this.currencyTable.draw(false);
    }
    getPlainConfigName(filename) {
        return filename.substr(1).replace(/\.json$/, "");
    }
    canDeleteApiKey() {
        return this.$("#apiKey").val() !== "" || this.$("#apiKey2").val() !== "";
    }
    send(data) {
        super.send(data);
    }
}
exports.Config = Config;


/***/ }),

/***/ "./public/js/controllers/Home.ts":
/*!***************************************!*\
  !*** ./public/js/controllers/Home.ts ***!
  \***************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const AbstractController_1 = __webpack_require__(/*! ./base/AbstractController */ "./public/js/controllers/base/AbstractController.ts");
class Home extends AbstractController_1.AbstractController {
    constructor(socket) {
        super(socket);
        this.opcode = 22 /* HOME */;
    }
    onData(data) {
        if (data.error)
            return Hlp.showMsg(data.errorTxt ? data.errorTxt : AppF.tr(data.errorCode ? data.errorCode : 'unknownError'), 'danger');
    }
    render() {
        return new Promise((resolve, reject) => {
            let status = AppF.translate(pageData.html.home.main);
            setTimeout(() => {
                this.addClickListeners();
            }, 0);
            resolve(status);
        });
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    addClickListeners() {
        this.$("#startWizard .panel-heading").click((event) => {
            const panelBody = $(event.target).parent().find(".panel-body");
            panelBody.fadeToggle("slow");
        });
    }
}
exports.Home = Home;


/***/ }),

/***/ "./public/js/controllers/Lending.ts":
/*!******************************************!*\
  !*** ./public/js/controllers/Lending.ts ***!
  \******************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const AbstractController_1 = __webpack_require__(/*! ./base/AbstractController */ "./public/js/controllers/base/AbstractController.ts");
class Lending extends AbstractController_1.AbstractController {
    constructor(socket) {
        super(socket);
        this.opcode = 15 /* LENDING */;
    }
    onData(data) {
        if (data.full) {
            this.$().empty(); // shouldn't be needed
            data.full.forEach((config) => {
                this.currencies = config.currencies;
                this.configCurrencies = config.configCurrencies;
                let html = AppF.translate(pageData.html.lending.lendingExchange, {
                    nr: config.nr,
                    exchange: config.exchange
                });
                this.$().append(html);
                let globalHtml = this.getGlobalHtml(config);
                this.$("#exchange-" + config.exchange).append(globalHtml);
                $.each(config.balances, (i, value) => {
                    // TODO option to sort coins by lent amount
                    let exchangeHtml = this.getCurrencyHtml(config, parseInt(i));
                    if (exchangeHtml)
                        this.$("#exchange-" + config.exchange).append(exchangeHtml);
                });
            });
            Hlp.updateTimestampsRepeating(); // currently not used
            return;
        }
        else if (!data.balances)
            return;
        let config = data; // update for 1 exchange
        let globalHtml = this.getGlobalHtml(config);
        let nodes = this.$("#exchange-" + config.exchange + " .globalStats");
        for (let i = 1; i < nodes.length; i++) // remove all global stat nodes and replace the first one with the new html
            nodes[i].remove();
        nodes.eq(0).replaceWith(globalHtml);
        $.each(data.balances, (i, value) => {
            const currencyStr = this.currencies[i];
            if (!currencyStr)
                return;
            let exchangeHtml = this.getCurrencyHtml(config, parseInt(i));
            if (this.$("#exchange-" + config.exchange + " ." + currencyStr).length === 0)
                this.$("#exchange-" + config.exchange).append(exchangeHtml); // loan for a new currency
            else
                this.$("#exchange-" + config.exchange + " ." + currencyStr).replaceWith(exchangeHtml); // replace the existing data
        });
        Hlp.updateTimestampsRepeating();
    }
    render() {
        return new Promise((resolve, reject) => {
            let status = AppF.translate(pageData.html.lending.main);
            resolve(status);
        });
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    getGlobalHtml(config) {
        let html = "";
        const digits = config.interest.currencyStr === "USD" ? 2 : 8;
        let equityAttr = {
            nr: config.nr,
            //currency: currencyStr,
            equity_val: AppF.format(AppF.tr("equity_val"), config.totalEquity.toFixed(digits), config.interest.currencyStr)
        };
        html += AppF.translate(pageData.html.lending.totalEquity, equityAttr);
        let perHourAmount = config.interest.perHour;
        let perHourUnit = config.interest.currencyStr;
        if (config.interest.currencyStr === "BTC") {
            perHourAmount *= 100000000;
            perHourUnit = AppF.tr("satoshi");
        }
        let attributes = {
            nr: config.nr,
            //currency: currencyStr,
            btc_year: AppF.format(AppF.tr("btc_year"), config.interest.perYear.toFixed(8), config.interest.currencyStr),
            btc_month: AppF.format(AppF.tr("btc_month"), config.interest.perMonth.toFixed(8), config.interest.currencyStr),
            btc_week: AppF.format(AppF.tr("btc_week"), config.interest.perWeek.toFixed(8), config.interest.currencyStr),
            btc_day: AppF.format(AppF.tr("btc_day"), config.interest.perDay.toFixed(8), config.interest.currencyStr),
            satoshi_hour: AppF.format(AppF.tr("satoshi_hour"), perHourAmount.toFixed(8), perHourUnit)
        };
        html += AppF.translate(pageData.html.lending.globalLendingData, attributes);
        return html;
    }
    getCurrencyHtml(config, currencyIndex) {
        // Average loan rate, simple average calculation of active loans rates.
        // Effective loan rate, considering lent precentage and poloniex 15% fee.
        // Effective loan rate, considering poloniex 15% fee. // other mode
        // Compound rate, the result of reinvesting the interest.
        const currencyStr = this.currencies[currencyIndex];
        const lendingData = config.lendingRates[currencyStr];
        if (!lendingData)
            return ""; // undefined for currencies without lending/margin support
        if (this.configCurrencies[currencyStr] === undefined)
            return; // bot not enabled for this currency
        const balanceLent = config.balancesTaken[currencyIndex];
        //if (balanceLent == 0.0)
        //return ""; // hide coins we don't have any active loans
        const rateDay = lendingData.rate;
        const rateDayEff = rateDay * (1 - lendingData.lendingFee) * (config.balancesTakenPercent[currencyIndex] / 100.0);
        const rateYear = rateDayEff * 365; // no reinvestment, use effective rate to be more accurate
        const rateYearComp = (Math.pow(rateDayEff + 1, 365) - 1); // with daily reinvestment, accurate if our bot already runs longer than max loan days of the exchange
        const minLendingRate = config.minLendingRates[currencyStr] ? config.minLendingRates[currencyStr] : 0;
        const isLimited = config.coinStatus[currencyStr] ? config.coinStatus[currencyStr].limited : false; // if no offers are placed = not limited
        let attributes = {
            nr: config.nr,
            currency: currencyStr,
            lent_txt: AppF.format(AppF.tr("lent_txt"), balanceLent.toFixed(8), config.balances[currencyIndex].toFixed(8), config.balancesTakenPercent[currencyIndex]),
            current_rate: AppF.format(AppF.tr("current_rate"), minLendingRate.toFixed(8)),
            min_rate: AppF.format(AppF.tr("min_rate"), this.configCurrencies[currencyStr].minDailyRate.toFixed(8)),
            is_limited: AppF.tr("is_limited") + AppF.tr("colon") + AppF.tr(isLimited ? "yes" : "no"),
            lent_day: AppF.format(AppF.tr("lent_day"), (rateDay * 100).toFixed(8)),
            lent_day_eff: AppF.format(AppF.tr("lent_day_eff"), (rateDayEff * 100).toFixed(8)),
            lent_year: AppF.format(AppF.tr("lent_year"), (rateYear * 100).toFixed(8)),
            lent_year_comp: AppF.format(AppF.tr("lent_year_comp"), (rateYearComp * 100).toFixed(8))
        };
        return AppF.translate(pageData.html.lending.lendingData, attributes);
    }
}
exports.Lending = Lending;


/***/ }),

/***/ "./public/js/controllers/Oracle.ts":
/*!*****************************************!*\
  !*** ./public/js/controllers/Oracle.ts ***!
  \*****************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const AbstractController_1 = __webpack_require__(/*! ./base/AbstractController */ "./public/js/controllers/base/AbstractController.ts");
const helper = __webpack_require__(/*! ../utils/helper */ "./public/js/utils/helper.ts");
class Oracle extends AbstractController_1.AbstractController {
    constructor(socket) {
        super(socket);
        this.opcode = 14 /* ORACLE */;
    }
    onData(data) {
        if (data.predictions && data.predictions.predictions.length !== 0) {
            this.$("#waitingOracle").fadeOut("slow");
            this.$("#predictions").empty();
            for (let i = 0; i < data.predictions.predictions.length; i++) {
                if (i === 0)
                    this.createPredictionTables(data.predictions.predictions[i], data.predictions.current);
                let lastRealData = i > 0 ? data.predictions.realData[i - 1] : null;
                this.appendPredictionRows(data.predictions.predictions[i], data.predictions.realData[i], lastRealData);
            }
            this.showTrendArrows(data.predictions.predictions[0], data.predictions.current);
        }
    }
    render() {
        return new Promise((resolve, reject) => {
            let status = AppF.translate(pageData.html.oracle.main);
            resolve(status);
        });
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    createPredictionTables(predictions, current) {
        for (let currencyPair in predictions) {
            // create the table for each currency pair
            let vars = {
                currencyPair: AppF.escapeOutput(currencyPair),
                currentRate: current[currencyPair].toFixed(8)
            };
            let html = AppF.translate(pageData.html.oracle.predictionTable, vars, true);
            this.$("#predictions").append(html);
        }
    }
    appendPredictionRows(predictions, realData, lastRealData) {
        for (let currencyPair in predictions) {
            let real = realData && realData[currencyPair] ? realData[currencyPair] : 0;
            const diffPercent = helper.getDiffPercent(real, predictions[currencyPair]);
            let predictionCorrect = Math.abs(diffPercent) <= pageData.data.maxPredictionOffPercent;
            if (predictionCorrect && lastRealData) { // check if the direction of the prediction was correct
                if ( /*diffPercent > 0 && */realData[currencyPair] < lastRealData[currencyPair] && predictions[currencyPair] > lastRealData[currencyPair])
                    predictionCorrect = false; // the price went down, but our prediction was up
                else if (realData[currencyPair] > lastRealData[currencyPair] && predictions[currencyPair] < lastRealData[currencyPair])
                    predictionCorrect = false; // the price went up, but our prediction was down
            }
            let vars = {
                prediction: predictions[currencyPair].toFixed(8),
                realValue: real ? real.toFixed(8) : AppF.tr("minus"),
                predictionClass: real === 0 ? "" : (predictionCorrect ? "blue" : "orange")
            };
            let html = AppF.translate(pageData.html.oracle.predictionRow, vars, false);
            this.$("#predictionTable" + currencyPair + " tbody").append(html);
        }
    }
    showTrendArrows(predictions, current) {
        for (let currencyPair in predictions) {
            const hideArrow = predictions[currencyPair] >= current[currencyPair] ? ".fa-arrow-down" : ".fa-arrow-up";
            this.$("#prediction" + currencyPair + " " + hideArrow).addClass("hidden");
        }
    }
}
exports.Oracle = Oracle;


/***/ }),

/***/ "./public/js/controllers/Scripts.ts":
/*!******************************************!*\
  !*** ./public/js/controllers/Scripts.ts ***!
  \******************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const AbstractController_1 = __webpack_require__(/*! ./base/AbstractController */ "./public/js/controllers/base/AbstractController.ts");
class Scripts extends AbstractController_1.AbstractController {
    constructor(socket) {
        super(socket);
        this.opcode = 21 /* SCRIPTS */;
    }
    onData(data) {
        if (data.error)
            return Hlp.showMsg(data.errorTxt ? data.errorTxt : AppF.tr(data.errorCode ? data.errorCode : 'unknownError'), 'danger');
    }
    render() {
        return new Promise((resolve, reject) => {
            let status = AppF.translate(pageData.html.scripts.main);
            resolve(status);
        });
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    send(data) {
        super.send(data);
    }
}
exports.Scripts = Scripts;


/***/ }),

/***/ "./public/js/controllers/Social.ts":
/*!*****************************************!*\
  !*** ./public/js/controllers/Social.ts ***!
  \*****************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const ChartController_1 = __webpack_require__(/*! ./base/ChartController */ "./public/js/controllers/base/ChartController.ts");
class Social extends ChartController_1.ChartController {
    constructor(socket) {
        super(socket);
        this.opcode = 16 /* SOCIAL */;
        this.chartLibsLoaded = true; // currently always included globally
        this.maxAge = null;
        this.listTopSocialCurrencies = 0;
        this.maxLinePlotCurrencies = 0;
        this.chartLegendDays = 0;
        this.serverDate = null;
        this.chartLegend = [];
        this.nextData = null;
    }
    onData(data) {
        if (data.maxAge) {
            this.maxAge = new Date(data.maxAge); // if we use JSON (instead of EJSON)
            this.chartLegendDays = data.days;
            this.listTopSocialCurrencies = data.listTopSocialCurrencies;
            this.maxLinePlotCurrencies = data.maxLinePlotCurrencies;
            this.serverDate = new Date(data.serverDate);
            this.createChartLegend();
            return;
        }
        if (data.full) {
            this.$().empty(); // shouldn't be needed
            let html = AppF.translate(pageData.html.social.global, {
                utcTime: this.getUtcTimeStr()
            });
            this.$().append(html);
            this.nextData = data.full;
            let networks = Object.keys(this.nextData);
            networks.forEach((network) => {
                let html = AppF.translate(pageData.html.social.socialNetwork, {
                    network: network,
                    networkHeadline: network === "MULTIPLE" ? AppF.tr("news") : network
                });
                this.$().append(html);
                this.addChartHtml(network, "activity");
                this.addChartHtml(network, "activityChange");
                this.addChartHtml(network, "sentiment");
            });
            Hlp.updateTimestampsRepeating(); // currently not used
            if (!this.chartLibsLoaded) {
                // TODO find a way to load it delayed. currently it must be loaded in index.html because otherwise webpack internals say
                // "Chart is not defined". defining it as an empty object casuses Chart.js to load incorrectly
                AppF.loadResource(this.getChartLibs(), this.displayChartData.bind(this), null, true);
            }
            else
                this.displayChartData();
            return;
        }
    }
    render() {
        return new Promise((resolve, reject) => {
            let status = AppF.translate(pageData.html.social.main);
            resolve(status);
        });
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    addChartHtml(network, type) {
        let statsHtml = AppF.translate(pageData.html.social.chart, {
            chartHeadline: AppF.tr(type),
            network: network,
            type: type
        });
        this.$("#network-" + network).append(statsHtml);
    }
    displayChartData() {
        this.chartLibsLoaded = true;
        for (let network in this.nextData) {
            let activityPlotData = [];
            let activitySortable = [];
            let data = this.nextData[network];
            for (let currencyStr in data.postStats) {
                let currencyData = data.postStats[currencyStr];
                let yesterdayIndex = currencyData.length - 2; // -1 causes problems around midnight when we don't have all points yet // TODO improve crawler
                if (yesterdayIndex < 0)
                    yesterdayIndex = 0;
                activityPlotData.push({
                    label: currencyStr,
                    dataPoints: currencyData.map(d => d.postCount + d.commentCount),
                    dataPointsChange: currencyData.map(d => d.activityChange),
                    dataPointsSentiment: currencyData.map((d) => {
                        if (network === "MULTIPLE")
                            return Math.round(d.sentimentHeadline.compAvg * 10000.0) / 10000.0;
                        return Math.round(d.sentiment.compAvg * 10000.0) / 10000.0;
                    })
                });
                activitySortable.push({
                    label: currencyStr,
                    views: currencyData[yesterdayIndex].postCount + currencyData[yesterdayIndex].commentCount // only keep the value of yesterday to sort by it
                });
            }
            // sort activity data by todays activity
            activitySortable.sort((a, b) => {
                return b.views - a.views; // sort descending
            });
            let activityPlotDataSorted = [];
            activitySortable.forEach((activity) => {
                let value = activityPlotData.find(d => d.label === activity.label);
                activityPlotDataSorted.push(value);
            });
            let activityOpts = new ChartController_1.PlotChartOptions(this.chartLegend);
            activityOpts.maxLines = this.maxLinePlotCurrencies;
            this.plotLineChart("#chart-" + network + "-activity", activityPlotDataSorted, activityOpts);
            this.listTopCurrencies("#chart-" + network + "-activity", network, activityPlotDataSorted);
            let activityChangeOpts = new ChartController_1.PlotChartOptions(this.chartLegend);
            activityChangeOpts.dataPointsKey = "dataPointsChange";
            activityChangeOpts.maxLines = this.maxLinePlotCurrencies;
            this.plotLineChart("#chart-" + network + "-activityChange", activityPlotDataSorted, activityChangeOpts);
            let sentimentOpts = new ChartController_1.PlotChartOptions(this.chartLegend);
            sentimentOpts.dataPointsKey = "dataPointsSentiment";
            sentimentOpts.maxLines = this.maxLinePlotCurrencies;
            this.plotLineChart("#chart-" + network + "-sentiment", activityPlotDataSorted, sentimentOpts);
        }
        this.nextData = null;
    }
    listTopCurrencies(domID, network, plotData) {
        let toplist = "";
        for (let i = 0; i < this.listTopSocialCurrencies && i < plotData.length; i++) {
            let prevPoint = plotData[i].dataPoints.length - 1; // array indices start at 0
            if (prevPoint >= 1)
                prevPoint -= 1;
            else
                prevPoint = 0;
            toplist += (i + 1) + ". " + plotData[i].label + ": " + plotData[i].dataPoints[prevPoint] + "<br>";
        }
        let html = AppF.translate(pageData.html.social.topCurrencies, {
            network: network,
            topCurrencies: AppF.format(AppF.tr("topCurrencies"), network),
            toplist: toplist
        }, true);
        $(html).insertAfter(domID);
    }
    createChartLegend() {
        let legend = [];
        let currentDate = new Date(this.maxAge); // copy it
        for (let i = 0; i < this.chartLegendDays; i++) {
            legend.push(currentDate.toLocaleDateString(appData.locale, { timeZone: "UTC" }));
            currentDate.setDate(currentDate.getDate() + 1);
        }
        this.chartLegend = legend;
    }
    getUtcTimeStr() {
        if (!this.serverDate)
            return "";
        return this.serverDate.toLocaleDateString(appData.locale, { timeZone: "UTC" }) + " " + this.serverDate.toLocaleTimeString(appData.locale, { timeZone: "UTC" });
    }
}
exports.Social = Social;


/***/ }),

/***/ "./public/js/controllers/Status.ts":
/*!*****************************************!*\
  !*** ./public/js/controllers/Status.ts ***!
  \*****************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const AbstractController_1 = __webpack_require__(/*! ./base/AbstractController */ "./public/js/controllers/base/AbstractController.ts");
class Status extends AbstractController_1.AbstractController {
    constructor(socket) {
        super(socket);
        this.opcode = 10 /* STATUS */;
    }
    onData(data) {
        if (data.error)
            return Hlp.showMsg(data.errorTxt ? data.errorTxt : AppF.tr(data.errorCode ? data.errorCode : 'unknownError'), 'danger');
        //console.log("RECEIVER", data)
        //this.send({x: "client res"})
        if (data.config) { // initial data
            this.updateDataByClass(data);
            this.$(".started").attr("data-time", Math.floor(new Date(data.started).getTime() / 1000)); // copy of Date wouldn't be necessary with EJSON
            this.$(".installed").attr("data-time", Math.floor(new Date(data.installed).getTime() / 1000));
            if (data.premium === true)
                this.$("#botEvaluation, #stateForm").addClass("hidden");
            else {
                this.$("#botEvaluation").html(JSON.stringify(data.evaluation, null, 4));
                this.$("#usernameRow, #tokenRow, #statusRow").addClass("hidden");
            }
            this.removeAsyncLoadingIcon();
            Hlp.updateTimestampsRepeating();
            this.$("#restoreState").click(() => {
                let jsonTxt = this.$("#strategyState").val().trim();
                if (jsonTxt)
                    this.send({ restoreState: jsonTxt });
            });
        }
        else if (data.restoredState) {
            Hlp.showMsg(AppF.tr('restoredStrategyState'), 'success');
            this.$("#strategyState").val("");
        }
    }
    render() {
        return new Promise((resolve, reject) => {
            let status = AppF.translate(pageData.html.status.main);
            resolve(status);
        });
    }
}
exports.Status = Status;


/***/ }),

/***/ "./public/js/controllers/Strategies.ts":
/*!*********************************************!*\
  !*** ./public/js/controllers/Strategies.ts ***!
  \*********************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const AbstractController_1 = __webpack_require__(/*! ./base/AbstractController */ "./public/js/controllers/base/AbstractController.ts");
const $ = __webpack_require__(/*! jquery */ "jquery");
const TradingView = __webpack_require__(/*! ../libs/tv/charting_library.min */ "./public/js/libs/tv/charting_library.min.js");
const i18next = __webpack_require__(/*! i18next */ "i18next");
class Strategies extends AbstractController_1.AbstractController {
    constructor(socket, feed) {
        super(socket);
        this.opcode = 12 /* STRATEGIES */;
        this.showingChart = null;
        this.configCache = []; // TradeConfig[]
        this.showingImportState = "";
        this.feed = feed;
    }
    onData(data) {
        // TODO ensure data is parsed with plain JSON or EJSON. add a flag or query
        if (data.meta && data.meta.importLabel)
            setTimeout(this.showImportState.bind(this, data.meta), 100);
        if (data.full) {
            // full data only contains strategy data for the active tab
            this.$().empty().append(AppF.translate(pageData.html.strategies.main));
            this.configCache = [];
            let currentConfNr = 1;
            data.full.forEach((config /*: StrategyUpdate | LendingStrategyUpdate*/) => {
                this.configCache.push(config);
                let html = "";
                let tabsHtml = "";
                if ( /*config instanceof StrategyUpdate*/config.hasOwnProperty("marginTrading")) {
                    html = AppF.translate(pageData.html.strategies.strategyData, {
                        nr: config.nr,
                        exchanges: Strategies.getExchangeNames(config.exchanges),
                        marginTrading: config.marginTrading ? AppF.tr("yes") : AppF.tr("no"),
                        tradeTotalBtc: config.tradeTotalBtc,
                        //baseCurrency: this.getBaseCurrency(config.strategies),
                        baseCurrency: config.baseCurrency,
                        quoteCurrency: config.quoteCurrency,
                        position: config.position,
                        amount: config.positionAmount.toFixed(8),
                        pl: config.pl.toFixed(8),
                        plPercent: config.plPercent.toFixed(2),
                        style: config.activeNr === currentConfNr ? "" : "display: none"
                    });
                }
                else {
                    html = AppF.translate(pageData.html.strategies.lendingStrategyData, {
                        nr: config.nr,
                        exchange: config.exchange,
                        baseCurrency: config.baseCurrency,
                        style: config.activeNr === currentConfNr ? "" : "display: none"
                    });
                }
                tabsHtml = AppF.translate(pageData.html.strategies.tab, {
                    nr: config.nr,
                    tabTitle: Strategies.getExchangeNames(config.exchanges) + AppF.tr("colon") + config.currencyPairStr,
                    active: config.activeNr === currentConfNr ? "active " : ""
                });
                this.$("#strategyTabs").append(tabsHtml);
                if (config.activeNr === currentConfNr) {
                    this.$().append(html);
                    let count = 0; // i = key = name of the strategy
                    $.each(config.strategies, (i, value) => {
                        let strategyHtml = this.getStrategyHtml(config.nr, value);
                        this.placeStrategyHtml(count, config, strategyHtml);
                        this.addStrategyProperties(config.nr, value);
                        count++;
                    });
                    this.addButtonEvents(config);
                    this.updateButtonStates(config.nr, config.position);
                    setTimeout(() => {
                        this.showActiveChart(config.activeNr, config.mainStrategyName);
                    }, 100);
                }
                currentConfNr++;
            });
            this.addTabClickHandlers(data.full);
            Hlp.updateTimestampsRepeating();
            return;
        }
        else if (!data.config)
            return;
        // TODO PriceUpDown class that just watches DOM elements with certain IDs and flashes red/green on movements and shows text in green/red if + or -
        // how to store values? we replace html? x-path as unique keys?
        let configNr = parseInt(data.config.split("-")[0]);
        $.each(data.strategies, (i, value) => {
            let strategyHtml = this.getStrategyHtml(configNr, value);
            this.$("#strategy-" + configNr + " ." + value.name).replaceWith(strategyHtml);
            this.addStrategyProperties(configNr, value);
        });
        if (data.position) { // TODO sometimes not updating until we reopen the tab. move this up?
            this.$("#position-" + configNr).text(data.position); // replace only the inner data
            this.$("#amount-" + configNr).text(data.positionAmount.toFixed(8));
            this.$("#pl-" + configNr).text(data.pl.toFixed(8));
            this.$("#plPercent-" + configNr).text(data.plPercent.toFixed(2));
        }
        this.updateButtonStates(configNr, data.position);
        Hlp.updateTimestampsRepeating();
    }
    render() {
        return new Promise((resolve, reject) => {
            let status = AppF.translate(pageData.html.strategies.main);
            resolve(status);
        });
    }
    onClose() {
        this.showingChart = null;
        this.feed.resetCurrencyPair();
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    getStrategyHtml(configNr, strategyData) {
        let attributes = {
            nr: configNr,
            name: strategyData.name,
            headline: strategyData.name + " " + strategyData.pair
        };
        return AppF.translate(pageData.html.strategies.singleStrategy, attributes);
    }
    placeStrategyHtml(strategyIndex, config, strategyHtml) {
        if (strategyIndex % 2 === 0)
            this.$("#strategy-" + config.nr).append(pageData.html.strategies.strategyRow);
        this.$("#strategy-" + config.nr + " .strategyRow").last().append(strategyHtml);
    }
    addStrategyProperties(configNr, strategyData) {
        $.each(strategyData, (i, value) => {
            if (i === "name" || i === "pair")
                return;
            let html = "";
            const type = typeof value;
            if (type === "boolean")
                value = AppF.tr(value === true ? "yes" : "no");
            else if (type === "number") {
                if (Math.floor(value * 8) !== value * 8)
                    value = value.toFixed(8); // show at most 8 decimals
                //else
                //value = value;
            }
            else if (!value)
                value = ""; // null Dates
            //if (type === "string" && value.match(AbstractController.DATE_REGEX) !== null) {
            //value = new Date(value);
            if (value instanceof Date) {
                html = AppF.translate(pageData.html.strategies.stratTimeProp, {
                    name: i,
                    timestamp: Math.floor(new Date(value).getTime() / 1000),
                    value: value
                });
            }
            else {
                // TODO check if translation exists and translate names?
                html = AppF.translate(pageData.html.strategies.stratProp, {
                    name: i,
                    value: value instanceof Object ? value.toString() : value
                });
            }
            this.$("#strat-" + configNr + "-" + strategyData.name).append(html);
        });
        const i = configNr - 1;
        if (i >= this.configCache.length)
            return AppF.log("Error: Config cache has missing data. Can not create chart.");
        let config = this.configCache[i];
        this.addStrategyButtonEvents(config, strategyData.name);
    }
    addButtonEvents(config) {
        if ( /*config instanceof StrategyUpdate*/config.hasOwnProperty("marginTrading")) {
            this.$("#closePos-" + config.nr).click((event) => {
                this.send({ closePos: config.nr, pair: config.currencyPairStr });
            });
        }
        else {
            // Lending
            this.$("#closePos-" + config.nr).addClass("hidden");
        }
    }
    updateButtonStates(configNr, position) {
        if (position === "none")
            this.$("#closePos-" + configNr).attr("disabled", "disabled");
        else
            this.$("#closePos-" + configNr).removeAttr("disabled");
    }
    addStrategyButtonEvents(config, strategyName) {
        this.$("#showChartBtn-" + config.nr + "-" + strategyName).unbind("click").click((event) => {
            const durationMs = 360;
            $('html, body').animate({ scrollTop: 0 }, durationMs);
            const button = $(event.target);
            const strategyName = button.attr("data-strategy");
            this.renderChart(config, strategyName);
        });
    }
    showActiveChart(configNr, strategyName) {
        const i = configNr - 1;
        if (i >= this.configCache.length)
            return AppF.log("Error: Config cache has missing data. Can not show chart.");
        let config = this.configCache[i];
        this.renderChart(config, strategyName);
    }
    renderChart(config, strategyName) {
        const nextChart = config.nr + "-" + strategyName;
        if (this.showingChart === nextChart)
            return;
        this.showingChart = nextChart;
        if (appData.tvReady === true)
            this.addTradingViewChart(config, strategyName);
        else {
            TradingView.onready(() => {
                appData.tvReady = true;
                setTimeout(() => {
                    this.addTradingViewChart(config, strategyName);
                }, 300);
            });
        }
    }
    addTabClickHandlers(configs) {
        configs.forEach((config) => {
            this.$("#tab-" + config.nr).click((event) => {
                const configNr = parseInt($(event.target).parent().attr("data-nr"));
                this.send({ tabNr: configNr });
                this.$(".strategyTab").removeClass("active");
                this.$(".strategiesRow").fadeOut("slow");
                setTimeout(() => {
                    $(event.target).addClass("active");
                    this.$("#strategies-" + configNr).fadeIn("slow");
                }, 200);
            });
        });
        this.$("#closeChart").unbind("click").click((event) => {
            this.$("#tvChart").empty();
            this.$(".chartButtons").fadeOut("slow");
        });
    }
    addTradingViewChart(config, activeStrategy) {
        if (!config.strategies[activeStrategy] || !config.strategies[activeStrategy].candleSize)
            return AppF.log("Error: Can not show chart for strategy without candle size: " + activeStrategy);
        // workarounds: https://github.com/tradingview/charting_library/issues/2442
        // no workaround found. solution: move the container outside of the bootstrap tabs (which have "display: none" property)
        //this.$("#tvChart").empty().css("display", "block").css("visibility", "visible");
        this.$("#tvChart").empty() /*.replaceWith('<div id="tvChart" class="bottom20"></div>')*/;
        /*
        let parents = $("#tvChart").parents();
        $.each(parents, (i, element) => { // all strategies should have the same currency pairs
            $(element).attr("display", "block");
        })*/
        this.$(".chartButtons").fadeIn("slow");
        this.feed.setCurrencyPair(config.nr, config.currencyPairStr, activeStrategy);
        let widget = new TradingView.widget({
            debug: false,
            fullscreen: true,
            symbol: config.currencyPairStr,
            interval: config.strategies[activeStrategy].candleSize.toString(),
            container_id: "tvChart",
            datafeed: this.feed,
            library_path: "/js/libs/tv/",
            locale: appData.lang,
            //	Regression Trend-related functionality is not implemented yet, so it's hidden for a while
            drawings_access: { type: 'black', tools: [{ name: "Regression Trend" }] },
            disabled_features: ["header_symbol_search", "compare_symbol", "header_compare" /*, "use_localstorage_for_settings"*/],
            enabled_features: ["study_templates", "left_toolbar", "keep_left_toolbar_visible_on_small_screens"],
            // TODO implement backend to store JSON https://github.com/tradingview/charting_library/wiki/Saving-and-Loading-Charts#developing-your-own-backend
            charts_storage_url: 'https://saveload.tradingview.com',
            charts_storage_api_version: "1.1",
            client_id: 'wolfbot.org',
            user_id: config.userToken // this ID is used by the server to store + load the user charts
            //charts_storage_url: "http://null.com"
        });
    }
    showImportState(meta) {
        if (this.showingImportState === meta.importLabel)
            return;
        this.showingImportState = meta.importLabel;
        const stateType = meta.importLabel.toLowerCase().indexOf("failed") !== -1 ? "warning" : "success";
        Hlp.showMsg(i18next.t(meta.importLabel), stateType);
    }
    /*
    protected getBaseCurrency(strategies: any) {
        let strategyData;
        $.each(strategies, (i, value) => { // all strategies should have the same currency pairs
            strategyData = value;
            return false; // stop
        })
        return strategyData.pair.split("_")[0];
    }
    */
    static getExchangeNames(exchanges) {
        return exchanges.toString().replace(/,/g, ", ");
    }
}
exports.Strategies = Strategies;


/***/ }),

/***/ "./public/js/controllers/TradeHistory.ts":
/*!***********************************************!*\
  !*** ./public/js/controllers/TradeHistory.ts ***!
  \***********************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const TableController_1 = __webpack_require__(/*! ./base/TableController */ "./public/js/controllers/base/TableController.ts");
const $ = __webpack_require__(/*! jquery */ "jquery");
const i18next = __webpack_require__(/*! i18next */ "i18next");
const index_1 = __webpack_require__(/*! ../index */ "./public/js/index.ts");
class TradeHistory extends TableController_1.TableController {
    constructor(socket) {
        super(socket);
        this.opcode = 19 /* TRADE_HISTORY */;
        this.configName = "";
        this.tradingModes = [];
    }
    onData(data) {
        if (data.init) {
            this.$().empty();
            this.configName = data.init.configName;
            this.tradingModes = data.init.tradingModes;
            this.addControls(data.init.lending);
            return;
        }
        if (data.trades) {
            this.$("#historyTableRow").empty();
            this.creteTradesTable(data.trades, data.tradesMeta, false);
            return;
        }
        else if (data.lendingTrades) {
            this.$("#historyTableRow").empty();
            this.creteTradesTable(data.lendingTrades, data.tradesMeta, true);
            return;
        }
    }
    render() {
        return new Promise((resolve, reject) => {
            let status = AppF.translate(pageData.html.tradeHistory.main);
            resolve(status);
        });
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    creteTradesTable(trades, meta, lending) {
        this.addTradeStats(meta, lending);
        let tableHtml = AppF.translate(pageData.html.tradeHistory[lending ? "lendingTable" : "tradeTable"]);
        this.$("#historyTableRow").append(tableHtml);
        let tableOptions = this.getTableOpts(); // TODO doesn't really help much since it was written to create options from already created html?
        /*
        tableOptions["aoColumns"] = [];
        for (let i = 0; i < 12; i++)
        {
            if (tableOptions["aoColumns"][i] === undefined)
                tableOptions["aoColumns"][i] = [];
            if (i === 7)
                tableOptions["aoColumns"][i].push({"sType": "dynamic-number", "sClass": "dateTime"});
           else
                tableOptions["aoColumns"][i].push(null);
        }
        */
        const timestampCols = lending === true ? [8] : [7];
        tableOptions["columnDefs"] = [
            { className: "dateTime", "targets": timestampCols }
            //{className: "number", "targets": [3, 4]} // header
        ];
        let numberCols;
        if (lending === true)
            numberCols = [2, 3, 4, 5, 6, 7];
        else
            numberCols = [3, 4, 5, 6];
        tableOptions["columnDefs"].push({ className: "num decimalNumber", "targets": numberCols });
        tableOptions = this.prepareTable(tableOptions, /*".jsTable"*/ "#currencyTable", false);
        let table = this.$("#historyTable").DataTable(tableOptions);
        for (let i = 0; i < trades.length; i++) {
            if (lending === true) {
                const trade = trades[i];
                const totalBase = trade.rate * trade.amount;
                const timeHtml = AppF.translate(pageData.html.misc.sortSpan, {
                    time: trade.time,
                    timestamp: Math.floor(trade.time.getTime() / 1000)
                });
                table.row.add([
                    trade.currencyStr,
                    trade.typeStr,
                    trade.rate.toFixed(8),
                    trade.amount.toFixed(8),
                    i18next.t("tradingFee", {
                        fee: (trade.amount * trade.rate * trade.lendingFees).toFixed(8),
                        percent: (trade.lendingFees * 100).toFixed(2)
                    }),
                    totalBase.toFixed(8),
                    trade.interestAmount.toFixed(8),
                    trade.days,
                    timeHtml,
                    trade.exchangeStr,
                    trade.configName,
                    this.formatStrategies(trade.strategies),
                    trade.reason
                ]);
            }
            else {
                const trade = trades[i];
                const totalBase = trade.rate * trade.amount;
                const typeHtml = AppF.translate(pageData.html.misc.classSpan, {
                    className: trade.typeStr === "BUY" || trade.typeStr === "CLOSE_SHORT" ? "green" : "red",
                    text: trade.typeStr
                });
                const timeHtml = AppF.translate(pageData.html.misc.sortSpan, {
                    time: trade.time,
                    timestamp: Math.floor(trade.time.getTime() / 1000)
                });
                table.row.add([
                    trade.currencyPairStr,
                    typeHtml,
                    trade.marketStr,
                    trade.rate.toFixed(8),
                    trade.amount.toFixed(8),
                    i18next.t("tradingFee", {
                        fee: (trade.amount * trade.rate * trade.fees).toFixed(8),
                        percent: (trade.fees * 100).toFixed(2)
                    }),
                    totalBase.toFixed(8),
                    timeHtml,
                    trade.exchangeStr,
                    //trade.arbitrage ? "yes" : "no", // better show icon. removed from table and shown in selection above
                    trade.configName,
                    this.formatStrategies(trade.strategies),
                    trade.reason
                ]);
            }
        }
        table.draw(false);
        this.replaceClasses("#historyTable", numberCols, "num decimalNumber", "number");
        this.moveTimestampsToParent("#historyTable", timestampCols);
        Hlp.updateTimestampsRepeating(); // or use updateAbsoluteDates()?
    }
    addControls(/*trades: (UIBotTrade | UIBotLendingTrade)[], */ lending) {
        // TODO add datepicker library and allow selecting data range
        // TODO store recent configs and currency pairs on server and show them in a dropdown
        let html = AppF.translate(pageData.html.tradeHistory.tableCtrls, {
            currencySel: i18next.t(lending === true ? "currency" : "currencyPair"),
            currencyPlace: i18next.t(lending === true ? "currencyPlaceLend" : "currencyPlace"),
            configNamePlace: i18next.t("configNamePlace", { name: this.configName })
        });
        this.$().append(html);
        let first = true;
        this.tradingModes.forEach((mode) => {
            this.$("#tradingMode").append(this.getSelectOption(mode, AppF.tr(mode), first === true));
            first = false;
        });
        index_1.App.initMultiSelect((optionEl, checked) => {
            //if (optionEl.attr("id") === "traders")
            //this.send({traderChange: optionEl.val()})
            if (optionEl.attr("id") === "tradingMode")
                this.updateControls(optionEl.val());
        });
        this.addControlHandlers();
    }
    updateControls(selectedTradingMode) {
        const lending = selectedTradingMode === "lending";
        this.$("#currencyLbl").text(i18next.t(lending === true ? "currency" : "currencyPair") + i18next.t("colon"));
        this.$("#currency").attr("placeholder", i18next.t(lending === true ? "currencyPlaceLend" : "currencyPlace"));
    }
    addControlHandlers() {
        this.$(".historyInfo").unbind("click").click((event) => {
            const el = $(event.target);
            this.$("#" + el.attr("data-idtoggle")).fadeToggle("slow");
        });
        this.$("#historyForm").unbind("submit").submit((event) => {
            event.preventDefault();
            let values = $(event.target).serializeArray();
            let mode = this.getFormValue(values, "tradingMode");
            let currency = this.getFormValue(values, "currency");
            if (!currency || currency.length < 3 || (mode !== "lending" && (currency.length < 7 || currency.indexOf("_") === -1)))
                return Hlp.showMsg(AppF.tr('invalidCurrency'), 'danger');
            this.send({
                getTrades: {
                    mode: mode,
                    currencyStr: currency,
                    configName: this.getFormValue(values, "configName"),
                    endDate: 0 // get all
                }
            });
        });
    }
    addTradeStats(meta, lending) {
        if (lending === true) {
            this.$("#avgBuyPrice, #totalBuys, #totalSells, #breakEvenPrice").text("-");
            this.$("#avgSellPrice").text(meta.avgSellPrice.toFixed(8));
            this.$("#profitLoss").text(meta.profitLoss.toFixed(8));
            // TODO totalSells after we extended our exchange API with "loan taken" calls
            return;
        }
        this.$("#avgBuyPrice").text(meta.avgBuyPrice.toFixed(8));
        this.$("#avgSellPrice").text(meta.avgSellPrice.toFixed(8));
        this.$("#totalBuys").text(meta.totalBuys.toFixed(8));
        this.$("#totalSells").text(meta.totalSells.toFixed(8));
        if (meta.breakEvenPrice !== 0.0)
            this.$("#breakEvenPrice").text(meta.breakEvenPrice.toFixed(8));
        else
            this.$("#breakEvenPrice").text("-");
        this.$("#profitLoss").text(meta.profitLoss.toFixed(8));
    }
    formatStrategies(strategies) {
        return strategies.toString().replace(/,/g, ", ");
    }
    send(data) {
        super.send(data);
    }
}
exports.TradeHistory = TradeHistory;


/***/ }),

/***/ "./public/js/controllers/base/AbstractController.ts":
/*!**********************************************************!*\
  !*** ./public/js/controllers/base/AbstractController.ts ***!
  \**********************************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
//import {AbstractWidget} from "../classes/AbstractWidget";
const ClientSocket_1 = __webpack_require__(/*! ../../classes/WebSocket/ClientSocket */ "./public/js/classes/WebSocket/ClientSocket.ts");
const $ = __webpack_require__(/*! jquery */ "jquery");
class AbstractController extends ClientSocket_1.ClientSocketReceiver {
    //protected static readonly DATE_REGEX = "^2.+T.+Z$"; // bad idea because timezone is lost in this format. use EJSON for Dates
    constructor(socket) {
        super(socket);
    }
    static restoreJson(obj, dateFields = []) {
        // json doesn't have a Date type. so we have to specify fields and restore it here
        for (let prop of dateFields) {
            if (obj[prop])
                obj[prop] = new Date(obj[prop]);
        }
        return obj;
    }
    onClose() {
        // overwrite it to perform cleanup if required
    }
    isVisible() {
        return this.$().length !== 0;
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    updateDataByClass(data, safeHtml = false) {
        for (let prop in data) {
            let el = $("#" + this.className + " ." + prop);
            if (el.length === 0)
                continue;
            if (safeHtml === true)
                el.html(data[prop]);
            else
                el.text(data[prop]);
        }
    }
    /**
     * Get $ with the the DOM id of the current view prefixed.
     * @param selector
     * @param context
     * @returns {JQuery}
     */
    $(selector, context) {
        if (selector)
            return $("#" + this.className + " " + selector, context);
        return $("#" + this.className, context);
    }
    // TODO 2 way databinding functions (event listeners) that send data back from the client to the server
    getSelectOption(value, title, selected = false) {
        let attributes = {
            value: value,
            title: title,
            selected: selected ? " selected" : ""
        };
        return AppF.translate(pageData.html.misc.selectOpt, attributes);
    }
    getFormValue(values, name) {
        for (let i = 0; i < values.length; i++) {
            if (values[i].name === name)
                return values[i].value;
        }
        return null;
    }
    getDatepickerLibs() {
        let resources = [
            document.location.origin + "/js/libs/moment/moment.min.js",
            document.location.origin + "/js/libs/bootstrap-datetimepicker.min.js"
        ];
        if (appData.lang !== "en") { // en-US is already included
            resources.push(document.location.origin + "/js/libs/moment/locales/" + appData.lang + ".min.js");
        }
        return resources;
    }
    loadDatePickerLib(callback) {
        if (typeof $("body").datetimepicker === "function")
            return setTimeout(callback.bind(this), 0); // already loaded
        AppF.loadResource(document.location.origin + "/css/libs/bootstrap-datetimepicker.min.css");
        // see https://github.com/moment/moment/tree/master/locale for more locales
        let resources = this.getDatepickerLibs();
        //if (AppF.isOldIE())
        //resources.push(document.location.origin + "/js/libs/es5-shim.min.js"); // for parsley & IE8
        //resources.push(document.location.origin + "/js/libs/parsley/parsley.min.js");
        if (appData.lang !== "en") { // en-US is already included
            //resources.push(document.location.origin + "/js/libs/parsley/i18n/" + appData.lang + ".min.js");
        }
        AppF.loadResource(resources, callback.bind(this), null, true);
    }
    loadJsonView(callback) {
        if (typeof window.JSONEditor === "function")
            return setTimeout(callback.bind(this), 0); // already loaded
        let resources = [document.location.origin + "/js/libs/jsoneditor.min.js"];
        AppF.loadResource(resources, callback.bind(this), null, true);
    }
    setDateTimeValue(element) {
        let val = element ? element.find(':input').attr('data-value') : null; // data-value of the first input child element
        if (!val)
            return false;
        let valNr = Math.floor(parseInt(val));
        if (!valNr)
            return false;
        element.data("DateTimePicker").date(new Date(valNr));
        return true;
    }
    reloadPage(escapeAppFrame = false) {
        if (escapeAppFrame === true)
            AppF.setLocationTop("reload");
        else
            window.location.reload(false); // reload from cache is ok
    }
    showAsyncLoadingIcon() {
        if ($('.asyncData').length === 0)
            this.$().append(pageData.html.misc.asyncWait); // just add it inside the current widget
        else
            $('.asyncData').prepend(pageData.html.misc.asyncWait);
    }
    removeAsyncLoadingIcon() {
        $('.asyncWait').remove();
    }
}
exports.AbstractController = AbstractController;


/***/ }),

/***/ "./public/js/controllers/base/ChartController.ts":
/*!*******************************************************!*\
  !*** ./public/js/controllers/base/ChartController.ts ***!
  \*******************************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const chart_js_1 = __webpack_require__(/*! chart.js */ "chart.js");
const AbstractController_1 = __webpack_require__(/*! ./AbstractController */ "./public/js/controllers/base/AbstractController.ts");
class PlotChartOptions {
    constructor(legend) {
        this.dataPointsKey = "dataPoints";
        this.maxLines = Number.MAX_VALUE;
        this.legend = legend;
    }
}
exports.PlotChartOptions = PlotChartOptions;
class ChartController extends AbstractController_1.AbstractController {
    constructor(socket) {
        super(socket);
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    plotLineChart(/*currencyStr: string, currencyData: SocialPost.SocialPostAggregate[]*/ domID, plotData, plotOptions) {
        let data = {
            labels: plotOptions.legend,
            datasets: []
        };
        const colors = [
            "#ff6f74",
            "#51a423",
            "#c01bff",
            "#FFCE56",
            "#b7b9eb",
            "#fbbff2",
            "#3690d8",
            "#57e232",
            "#FF6384",
            "#a4ff38",
            "#000000",
            "#ff583d",
            "#53ffd3",
            "#ff1e1a",
            "#25cdf2",
            "#ff2af0",
            "#7cf18d",
            "#ffe847",
            "#1d3fff",
            "#daded7"
        ];
        for (let i = 0; i < plotData.length; i++) {
            if (i >= plotOptions.maxLines) // limit the number of lines to show graphs more clearly
                break;
            let curPlotData = plotData[i];
            const nextColor = colors[i % colors.length];
            data.datasets.push({
                label: curPlotData.label,
                fill: false,
                lineTension: 0.1,
                //backgroundColor: "rgba(75,192,192,0.4)",
                backgroundColor: nextColor,
                borderColor: nextColor,
                borderCapStyle: 'butt',
                borderDash: [],
                borderDashOffset: 0.0,
                borderJoinStyle: 'miter',
                //pointBorderColor: "rgba(75,192,192,1)",
                pointBorderColor: nextColor,
                pointBackgroundColor: "#fff",
                pointBorderWidth: 1,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: nextColor,
                pointHoverBorderColor: "rgba(220,220,220,1)",
                pointHoverBorderWidth: 2,
                pointRadius: 1,
                pointHitRadius: 10,
                data: curPlotData[plotOptions.dataPointsKey],
                spanGaps: false
            });
        }
        let options = {
            scales: {
                yAxes: [{
                        ticks: {
                            beginAtZero: true // TODO improve. bad y adjustment for activity change. true/false doesn't help
                        }
                    }]
            },
            legend: this.getChartLegendConfig()
        };
        let ctx = this.$(domID);
        let deletionChart = new chart_js_1.Chart(ctx, {
            type: 'line',
            data: data,
            options: options
        });
        return deletionChart;
    }
    getChartLibs() {
        /*
        if (!pageData.debug)
            return document.location.origin + "/js/libs/Charts.min.js";
        return [document.location.origin + "/js/libs/Chart.min.js",
            document.location.origin + "/js/libs/Chart.PieceLabel.min.js"];
        */
        return document.location.origin + "/js/libs/Chart.bundle.js";
    }
    getChartLegendConfig() {
        return {
            labels: {
                fontSize: 18,
                fontColor: '#000'
            }
        };
    }
}
exports.ChartController = ChartController;


/***/ }),

/***/ "./public/js/controllers/base/JsonEditor.ts":
/*!**************************************************!*\
  !*** ./public/js/controllers/base/JsonEditor.ts ***!
  \**************************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const AbstractController_1 = __webpack_require__(/*! ./AbstractController */ "./public/js/controllers/base/AbstractController.ts");
class JsonEditor extends AbstractController_1.AbstractController {
    constructor(socket) {
        super(socket);
    }
}
exports.JsonEditor = JsonEditor;


/***/ }),

/***/ "./public/js/controllers/base/TableController.ts":
/*!*******************************************************!*\
  !*** ./public/js/controllers/base/TableController.ts ***!
  \*******************************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const $ = __webpack_require__(/*! jquery */ "jquery");
const i18next = __webpack_require__(/*! i18next */ "i18next");
const AbstractController_1 = __webpack_require__(/*! ./AbstractController */ "./public/js/controllers/base/AbstractController.ts");
class TableController extends AbstractController_1.AbstractController {
    constructor(socket) {
        super(socket);
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    getTableOpts() {
        return {
            "pageLength": 50,
            "lengthMenu": [[50, 100, 250, -1], [50, 100, 250, i18next.t("all")]],
            //"searching": false, // removes the input box too
            "language": {
                "aria": {
                    "sortAscending": ": " + i18next.t("sortAscending"),
                    "sortDescending": ": " + i18next.t("sortDescending")
                },
                "paginate": {
                    "first": i18next.t("first"),
                    "last": i18next.t("last"),
                    "next": i18next.t("next"),
                    "previous": i18next.t("previous")
                },
                "emptyTable": i18next.t("noDataAvailable"),
                //"infoPostFix": " " + i18next.t("bracket_l") + i18next.t("realTimeData") + i18next.t("bracket_r"),
                "infoPostFix": "",
                "loadingRecords": i18next.t("loadingWait"),
                "processing": i18next.t("processingWait"),
                "search": i18next.t("filter") + i18next.t("colon"),
                //"search": "Apply filter _INPUT_ to table"
                //"url": "lang.json", // keys starting with s (sInfo) http://cdn.datatables.net/plug-ins/9dcbecd42ad/i18n/German.json
                "decimal": i18next.t("decimalSeparator"),
                "thousands": i18next.t("thousandSeparator"),
                "lengthMenu": i18next.t("lengthTableMenu"),
                "zeroRecords": i18next.t("nothingFound"),
                //"info": i18next.t("pageOf"),
                "info": i18next.t("entriesOf"),
                "infoEmpty": i18next.t("noRecords"),
                "infoFiltered": i18next.t("bracket_l") + i18next.t("filteredRecords") + i18next.t("bracket_r")
            },
            "createdRow": function (row, data, index) {
                // row: html string of the row
                // data: array with all the colums and their data as string
                // index: number of the row
                //if ($('#worksTable').length !== 0)
            }
        };
    }
    prepareTable(tableOptions, tableSel, header) {
        let checkRow = header ? 'th' : 'td';
        let firstRow = $(tableSel + ' tr').eq(header ? 0 : 2); // 0 = thead, 1 = tfoot
        let numberCols = $(tableSel + ' tr:first th').length;
        if ($(tableSel + ' ' + checkRow + '.dateTime, ' + tableSel + ' ' + checkRow + '.decimalNumber').length !== 0) {
            // setup type options for sorting of columns
            tableOptions["aoColumns"] = [];
            let dateIndex = [];
            let numberIndices = [];
            // recognize advanced sorting based on css classes of the table
            $(checkRow, firstRow).each((function (i, element) {
                let el = $(element);
                if (el.hasClass('dateTime'))
                    dateIndex.push(i);
                else if (el.hasClass('decimalNumber'))
                    numberIndices.push(i);
            }));
            for (let i = 0; i < numberCols; i++) {
                if (dateIndex.indexOf(i) !== -1) // add date colums with unix timestamps for sorting
                    tableOptions["aoColumns"].push({ "sType": "dynamic-number" });
                else if (numberIndices.indexOf(i) !== -1) // add other decimal numbers
                    tableOptions["aoColumns"].push({ "sType": "dynamic-number" });
                else
                    tableOptions["aoColumns"].push(null);
            }
        }
        // set default sorting on page load
        if ($(tableSel).length !== 0) {
            // new way: .sortAsc and .sortDesc classes on table header
            let headerCols = $(tableSel + ' tr').eq(0).find('th');
            let tableOrder = [];
            headerCols.each((function (i, element) {
                let el = $(element);
                if (el.hasClass("sortAsc"))
                    tableOrder.push([i, "asc"]);
                else if (el.hasClass("sortDesc"))
                    tableOrder.push([i, "desc"]);
            }));
            if (tableOrder.length !== 0)
                tableOptions["order"] = tableOrder;
        }
        if ($(tableSel + ' ' + checkRow + '.num').length !== 0) {
            if (!tableOptions["aoColumns"])
                tableOptions["aoColumns"] = [];
            let simpleNumberIndices = [];
            $(checkRow, firstRow).each(function (i, element) {
                let el = $(element);
                if (el.hasClass('num'))
                    simpleNumberIndices.push(i);
            });
            // recognize default sorting for numeric values
            for (let i = 0; i < numberCols; i++) {
                if (tableOptions["aoColumns"][i])
                    continue;
                if (simpleNumberIndices.indexOf(i) !== -1)
                    tableOptions["aoColumns"][i] = { "sType": "static-number" };
                else //if (!tableOptions["aoColumns"][i])
                    tableOptions["aoColumns"][i] = null;
            }
        }
        // add export buttons
        // too many dependencies
        // https://datatables.net/extensions/buttons/examples/initialisation/export.html
        /*
        if ($(tableSel + '.export').length !== 0) {
            tableOptions["dom"] = 'Blfrtip'; // order of control elements
            tableOptions.buttons = [
                'copy', 'csv', 'excel', 'pdf', 'print'
            ];
        }
        */
        if ($(tableSel).hasClass('noPagination')) // TODO add support for multiple .jsTables with different options on a single page
            tableOptions["bPaginate"] = false;
        return tableOptions;
    }
    moveTimestampsToParent(tableSel, columIndices) {
        $(tableSel + " tr").each((index, elem) => {
            let cols = $(elem).find("td");
            cols.each((colI, colElem) => {
                if (columIndices.indexOf(colI) !== -1) {
                    let el = $(colElem);
                    let sortVal = el.find("span").attr("data-sort");
                    if (sortVal) // header won't have this value (should't have dateTime class neither)
                        el.attr("data-time", sortVal);
                }
            });
        });
    }
    replaceClasses(tableSel, columIndices, removeClass, addClass) {
        let replace = (index, elem) => {
            let el = $(elem);
            if (!removeClass || el.hasClass(removeClass) === true) {
                if (removeClass)
                    el.removeClass(removeClass);
                if (addClass)
                    el.addClass(addClass);
            }
        };
        let replaceOps = [" thead th", " tfoot th"];
        replaceOps.forEach((op) => {
            $(tableSel + op).each((index, elem) => {
                if (columIndices.indexOf(index) !== -1)
                    replace(index, elem);
            });
        });
    }
}
exports.TableController = TableController;


/***/ }),

/***/ "./public/js/index.ts":
/*!****************************!*\
  !*** ./public/js/index.ts ***!
  \****************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
const $ = __webpack_require__(/*! jquery */ "jquery");
const i18next = __webpack_require__(/*! i18next */ "i18next");
const ClientSocket_1 = __webpack_require__(/*! ./classes/WebSocket/ClientSocket */ "./public/js/classes/WebSocket/ClientSocket.ts");
const HistoryRouter_1 = __webpack_require__(/*! ./classes/HistoryRouter */ "./public/js/classes/HistoryRouter.ts");
const LogReceiver_1 = __webpack_require__(/*! ./classes/WebSocket/LogReceiver */ "./public/js/classes/WebSocket/LogReceiver.ts");
const LoginManager_1 = __webpack_require__(/*! ./classes/WebSocket/LoginManager */ "./public/js/classes/WebSocket/LoginManager.ts");
const Home_1 = __webpack_require__(/*! ./controllers/Home */ "./public/js/controllers/Home.ts");
const Status_1 = __webpack_require__(/*! ./controllers/Status */ "./public/js/controllers/Status.ts");
const Strategies_1 = __webpack_require__(/*! ./controllers/Strategies */ "./public/js/controllers/Strategies.ts");
const Lending_1 = __webpack_require__(/*! ./controllers/Lending */ "./public/js/controllers/Lending.ts");
const Social_1 = __webpack_require__(/*! ./controllers/Social */ "./public/js/controllers/Social.ts");
const CoinMarket_1 = __webpack_require__(/*! ./controllers/CoinMarket */ "./public/js/controllers/CoinMarket.ts");
const TradeHistory_1 = __webpack_require__(/*! ./controllers/TradeHistory */ "./public/js/controllers/TradeHistory.ts");
const Oracle_1 = __webpack_require__(/*! ./controllers/Oracle */ "./public/js/controllers/Oracle.ts");
const Config_1 = __webpack_require__(/*! ./controllers/Config */ "./public/js/controllers/Config.ts");
const Scripts_1 = __webpack_require__(/*! ./controllers/Scripts */ "./public/js/controllers/Scripts.ts");
const Backtesting_1 = __webpack_require__(/*! ./controllers/Backtesting */ "./public/js/controllers/Backtesting.ts");
const TradingViewDatafeed_1 = __webpack_require__(/*! ./classes/WebSocket/TradingViewDatafeed */ "./public/js/classes/WebSocket/TradingViewDatafeed.ts");
// static members are accessible via the import (only if they are declared in TS, not JS)
// we import and load our helpers as a separate TS bundle
//declare var AppF: AppFunc, AppFunc: AppFunc, Hlp: any, HelpersClass: any;
//export {pageData, appData, AppF, AppFunc, Hlp, HelpersClass}; // exports are undefined when importing
$(document).ready(function () {
    // load language
    i18next.use(i18nextXHRBackend);
    i18next.init({
        'debug': pageData.debug,
        'lng': appData.lang,
        'fallbackLng': pageData.defaultLang,
        //'returnObjects': true,
        backend: {
            //loadPath: pageData.domain + 'locales/{{lng}}.json'
            loadPath: document.location.origin + pageData.pathRoot + 'locales/{{lng}}.json?v=' + pageData.version
            //allowMultiLoading: true
        }
    }, () => {
        //jqueryI18next.init(i18next, $);
        //$('body').localize();
        //console.log("client lang ready: " + i18next.t("siteName"));
        exports.App = App = new AppClass(); // load the app after translation is ready
        if (pageData.debug) // export it for easier debugging
            window["App"] = App;
        Hlp.initHelpers();
    });
});
class AppClass {
    constructor() {
        this.webSocket = null;
        this.router = new HistoryRouter_1.HistoryRouter(window);
        this.controllers = new Map(); // (controller name, instance)
        this.activeController = null;
        if (("WebSocket" in window) === false)
            return Hlp.showMsg(i18next.t('browserOutdated'), 'danger');
        let url = (document.location.protocol === "https:" ? "wss" : "ws") + "://" + document.location.host + pageData.pathRoot;
        let params = AppF.getUrlParameters(document.location.href, true);
        if (params.apiKey) {
            url += "?apiKey=" + params.apiKey;
            AppF.setCookie("apiKey", params.apiKey, pageData.cookieLifeDays); // store the last key to easier access the app again
        }
        else {
            let key = AppF.getCookie("apiKey");
            if (key)
                url += "?apiKey=" + key;
        }
        this.webSocket = new ClientSocket_1.ClientSocket(url);
        this.webSocket.on("disconnect", (reason) => {
            if ($("#modal-background").length !== 0)
                return; // another controller is showing a message (restart...)
            let vars = {
                title: i18next.t('disconnected'),
                text: i18next.t('disconnectedTxt')
            };
            switch (reason) // see WebSocketError in opcodes.ts
             {
                case "Unauthorized":
                    vars = {
                        title: i18next.t('unauthorized'),
                        text: i18next.t('unauthorizedTxt')
                    };
                    break;
                case "UnauthorizedPremium":
                    vars = null;
                    this.loginManager.showLoginDialog();
                    break;
            }
            if (vars !== null) {
                let disconnected = AppF.translate(pageData.html.misc.disablePage, vars);
                $(AppClass.cfg.appSel).append(disconnected);
            }
        });
        this.logReceiver = new LogReceiver_1.LogReceiver(this.webSocket);
        this.loginManager = new LoginManager_1.LoginManager(this.webSocket);
        this.tradingViewDatafeed = new TradingViewDatafeed_1.TradingViewDatafeed(this.webSocket);
        this.webSocket.on("connect", () => {
            // setup websocket receivers, wait until we are connected
            this.webSocket.subscribe(this.logReceiver);
            this.webSocket.subscribe(this.loginManager);
            this.webSocket.subscribe(this.tradingViewDatafeed); // always subscribe. will only send data when chart is visible
            this.loadControllers();
            App.initSite();
        });
    }
    initSite() {
        this.initLayout();
        // add screen-reader class
        $('li.active').append('<span class="sr-only"> ' + i18next.t("bracket_l") + i18next.t("selected") + i18next.t("bracket_r") + '</span>');
        // global inits for all pages
        //$('.dateTime').html(function() {
        //return new Date(parseInt($(this).attr('data-time')))
        //})
        Hlp.updateTimestampsRepeating();
        Hlp.updateAbsoluteDates();
        // add DOM event listeners
        /*
         $('#langSelect a').click(function(element) {
         var clicked = $(element.target);
         var lang = clicked.parent().attr('data-lang') || clicked.attr('data-lang'); // target = a if we click on span
         AppF.setCookie('lng', lang);
         document.location.reload();
         });
         */
        this.logReceiver.addListeners();
        // setup routing
        $(".navButtons a[data-target]").click((event) => {
            let target = $(event.target);
            this.router.pushState({ page: target.attr("data-target") });
        });
        this.router.on("stateChange", (state, location, stateChangeType) => {
            //console.log(state, location, stateChangeType);
            if (this.activeController && !this.activeController.isPersistent()) {
                this.activeController.onClose();
                this.webSocket.unsubscribe(this.activeController);
            }
            let pageName = state.page ? state.page : "home"; // default view for empty url path
            $(".navButtons li").removeClass("active");
            $('.navButtons a[data-target="' + pageName + '"]').parent("li").addClass("active");
            this.setTitle(AppF.tr(pageName));
            this.renderView(pageName).then((view) => {
                $(AppClass.cfg.contentWidget).html(view.html);
                $('.asyncData').prepend(pageData.html.misc.asyncWait);
                if (view.controller)
                    view.controller.addListeners();
                Hlp.updateTimestampsRepeating(); // immediate update and restart the timer
            }).catch((err) => {
                AppF.log("Error loading view " + pageName, err);
                let errorHtml = AppF.translate(pageData.html.misc.error, {
                    error: i18next.t("errorRendering"),
                    msg: err && err.txt ? err.txt : "",
                    stack: pageData.debug === true && err.stack ? err.stack : ""
                });
                $(AppClass.cfg.contentWidget).html(errorHtml);
            });
        });
        this.router.fireCurrentState();
    }
    setTitle(title) {
        document.title = title + " - " + AppF.tr("siteName");
    }
    initMultiSelect(onChangeCallback) {
        // has be be called from controller AFTER multi sel is added to page
        $('.multiSel').each((i, el) => {
            let selOpts = {
                nonSelectedText: i18next.t("nothingSelected"),
                nSelectedText: i18next.t("selected"),
                allSelectedText: i18next.t("allSelected"),
                //disabledText: '', // show nSelectedText
                //delimiterText: ', ',
                //selectAllText: '', // only with includeSelectAllOption: true
                numberDisplayed: pageData.multiselect.maxSelect
            };
            if ($(el).hasClass('htmlOptions')) {
                selOpts.enableHTML = true;
                selOpts.optionLabel = (element) => {
                    let image = $(element).attr('data-img');
                    if (!image)
                        return $(element).text();
                    return '<i class="' + image + '"></i> ' + $(element).text();
                };
            }
            if (typeof onChangeCallback === "function") {
                selOpts.onChange = function (option, checked, select) {
                    //if ($('#worksTable').length === 0)
                    //return; // we are in all overview table, change disabled there
                    // the old select element in the DOM of select doesn't reflect those updates? why wtf? search for a better plugin
                    let optionEl = $(option).parent();
                    let curOpt = $(option);
                    let domOpt = $('option[value="' + curOpt.val() + '"]', optionEl);
                    if (checked === true)
                        domOpt.attr('selected', 'selected');
                    else
                        domOpt.removeAttr('selected');
                    onChangeCallback(optionEl, checked);
                };
            }
            let jqEl = $(el); // disable warning cause of missing types
            jqEl.multiselect(selOpts);
        });
    }
    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
    initLayout() {
        let bar = AppF.translate(pageData.html.layout.navbarHead);
        $(AppClass.cfg.appSel).html(bar);
        $(AppClass.cfg.appSel).append(pageData.html.layout.contentWidget);
        let logs = AppF.translate(pageData.html.layout.logs);
        $(AppClass.cfg.appSel).append(logs);
        // TODO sometimes dropdown menu doesn't show. but showing is pure HTML, delaying this shouldn't have any effect. add navbar and delay content widget?
        let config = this.controllers.get("Config");
        $("#restartBot").click(() => {
            config.restartBot();
        });
        $("#pauseTrading").click(() => {
            config.pauseTrading();
        });
        $("#pauseOpeningPositions").click(() => {
            config.pauseOpeningPositions();
        });
    }
    /**
     * Renders a view. It looks if a controller class with the same name exists (view abc.html -> controller Abc.ts).
     * Otherwise it just renders the "main" section of the view.
     * @param {string} name
     * @returns {Promise<RenderViewResponse>}
     */
    renderView(name) {
        return new Promise((resolve, reject) => {
            $("body").removeClass().addClass(name);
            let controller = this.controllers.get(name[0].toUpperCase() + name.substr(1));
            if (controller) {
                this.activeController = controller;
                if (controller instanceof Config_1.Config)
                    this.webSocket.setAllowReSubscribe(controller);
                this.webSocket.subscribe(controller);
                controller.render().then((html) => {
                    if (!html) // add loading icon instead of empty page. will get replaced when jQuery adds html in onData() of the controller
                        html = pageData.html.misc.asyncWait;
                    let wrappedHtml = AppF.translate(pageData.html.misc.controllerWrap, {
                        controllerName: controller.getClassName(),
                        html: html
                    }, true);
                    resolve({ html: wrappedHtml, controller: controller });
                }).catch((err) => {
                    reject(err);
                });
                return;
            }
            resolve({ html: AppF.translate(pageData.html[name].main), controller: null });
        });
    }
    loadControllers() {
        // TODO is there a way to dynamically detect and load them in webpack? similar to our loadModule() in NodeJS
        // https://github.com/webpack/webpack/issues/118
        // TODO load them after LogReceiver is ready and only instantiate classes we need
        this.controllers.set("Home", new Home_1.Home(this.webSocket));
        this.controllers.set("Status", new Status_1.Status(this.webSocket));
        this.controllers.set("Strategies", new Strategies_1.Strategies(this.webSocket, this.tradingViewDatafeed));
        this.controllers.set("Lending", new Lending_1.Lending(this.webSocket));
        this.controllers.set("Social", new Social_1.Social(this.webSocket));
        this.controllers.set("CoinMarket", new CoinMarket_1.CoinMarket(this.webSocket));
        this.controllers.set("TradeHistory", new TradeHistory_1.TradeHistory(this.webSocket));
        this.controllers.set("Oracle", new Oracle_1.Oracle(this.webSocket));
        this.controllers.set("Config", new Config_1.Config(this.webSocket));
        this.controllers.set("Scripts", new Scripts_1.Scripts(this.webSocket));
        this.controllers.set("Backtesting", new Backtesting_1.Backtesting(this.webSocket));
        // always listen to config changes because we use it to send restart/pause commands
        this.webSocket.subscribe(this.controllers.get("Config"), true);
    }
}
AppClass.cfg = {
    tpl: '',
    appSel: '#app',
    contentWidget: '#content',
    successMsgRemoveSec: pageData.successMsgRemoveSec
};
exports.AppClass = AppClass;
// TODO settings ?
var App = null; // delay until page load to inherit before (not needed anymore with TS)
exports.App = App;


/***/ }),

/***/ "./public/js/libs/tv/charting_library.min.js":
/*!***************************************************!*\
  !*** ./public/js/libs/tv/charting_library.min.js ***!
  \***************************************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

!function(t,e){ true?e(exports):undefined}(this,function(t){"use strict";function e(t,o){var i=n({},t);for(var s in o)"object"!=typeof t[s]||null===t[s]||Array.isArray(t[s])?void 0!==o[s]&&(i[s]=o[s]):i[s]=e(t[s],o[s]);return i}function o(){return"1.12 (internal id 630b704a @ 2018-06-06 02:16:11.305509)"}function i(t){window.addEventListener("DOMContentLoaded",t,!1)}var n=Object.assign||function(t){for(var e,o=arguments,i=1,n=arguments.length;i<n;i++){e=o[i];for(var s in e)Object.prototype.hasOwnProperty.call(e,s)&&(t[s]=e[s])}return t},s={mobile:{disabled_features:["left_toolbar","header_widget","timeframes_toolbar","edit_buttons_in_legend","context_menus","control_bar","border_around_the_chart"],enabled_features:[]}},r={width:800,height:500,symbol:"AA",interval:"D",timezone:"UTC",container_id:"",library_path:"",locale:"en",widgetbar:{details:!1,watchlist:!1,watchlist_settings:{default_symbols:[]}},overrides:{"mainSeriesProperties.showCountdown":!1},studies_overrides:{},brokerConfig:{configFlags:{}},fullscreen:!1,autosize:!1,disabled_features:[],enabled_features:[],debug:!1,logo:{},time_frames:[{text:"5y",resolution:"W"},{text:"1y",resolution:"W"},{text:"6m",resolution:"120"},{text:"3m",resolution:"60"},{text:"1m",resolution:"30"},{text:"5d",resolution:"5"},{text:"1d",resolution:"1"}],client_id:"0",user_id:"0",charts_storage_api_version:"1.0",favorites:{intervals:[],chartTypes:[]}},a=function(){function t(t){if(this._id="tradingview_"+(1048576*(1+Math.random())|0).toString(16).substring(1),this._ready=!1,this._readyHandlers=[],this._onWindowResize=this._autoResizeChart.bind(this),!t.datafeed)throw new Error("Datafeed is not defined");if(this._options=e(r,t),t.preset){var o=s[t.preset];o?(void 0!==this._options.disabled_features?this._options.disabled_features=this._options.disabled_features.concat(o.disabled_features):this._options.disabled_features=o.disabled_features,void 0!==this._options.enabled_features?this._options.enabled_features=this._options.enabled_features.concat(o.enabled_features):this._options.enabled_features=o.enabled_features):console.warn("Unknown preset: `"+t.preset+"`")}this._create()}return t.prototype.onChartReady=function(t){this._ready?t.call(this):this._readyHandlers.push(t)},t.prototype.onGrayedObjectClicked=function(t){this._innerAPI().onGrayedObjectClicked(t)},t.prototype.onShortcut=function(t,e){this._innerWindow().createShortcutAction(t,e)},t.prototype.subscribe=function(t,e){this._innerAPI().subscribe(t,e)},t.prototype.unsubscribe=function(t,e){this._innerAPI().unsubscribe(t,e)},t.prototype.chart=function(t){return this._innerAPI().chart(t)},t.prototype.setLanguage=function(t){this.remove(),this._options.locale=t,this._create()},t.prototype.setSymbol=function(t,e,o){this._innerAPI().changeSymbol(t,e+"",o)},t.prototype.remove=function(){window.removeEventListener("resize",this._onWindowResize),this._readyHandlers.splice(0,this._readyHandlers.length),delete window[this._id];var t=this._getIFrameElement();t.contentWindow.destroyChart(),t.parentNode&&t.parentNode.removeChild(t)},t.prototype.closePopupsAndDialogs=function(){this._innerAPI().closePopupsAndDialogs()},t.prototype.selectLineTool=function(t){this._innerAPI().selectLineTool(t)},t.prototype.selectedLineTool=function(){return this._innerAPI().selectedLineTool()},t.prototype.save=function(t){this._innerAPI().saveChart(t)},t.prototype.load=function(t,e){this._innerAPI().loadChart({json:t,extendedData:e})},t.prototype.getSavedCharts=function(t){this._innerAPI().getSavedCharts(t)},t.prototype.loadChartFromServer=function(t){this._innerAPI().loadChartFromServer(t)},t.prototype.saveChartToServer=function(t,e,o,i){this._innerAPI().saveChartToServer(t,e,o,i)},t.prototype.removeChartFromServer=function(t,e){this._innerAPI().removeChartFromServer(t,e)},t.prototype.onContextMenu=function(t){this._innerAPI().onContextMenu(t)},t.prototype.createButton=function(t){return this._innerWindow().createButton(t)},t.prototype.showNoticeDialog=function(t){this._innerAPI().showNoticeDialog(t)},t.prototype.showConfirmDialog=function(t){this._innerAPI().showConfirmDialog(t)},t.prototype.showLoadChartDialog=function(){this._innerAPI().showLoadChartDialog()},t.prototype.showSaveAsChartDialog=function(){this._innerAPI().showSaveAsChartDialog()},t.prototype.symbolInterval=function(){return this._innerAPI().getSymbolInterval()},t.prototype.mainSeriesPriceFormatter=function(){return this._innerAPI().mainSeriesPriceFormatter()},t.prototype.getIntervals=function(){return this._innerAPI().getIntervals()},t.prototype.getStudiesList=function(){return this._innerAPI().getStudiesList()},t.prototype.addCustomCSSFile=function(t){this._innerWindow().addCustomCSSFile(t)},t.prototype.applyOverrides=function(t){this._options=e(this._options,{overrides:t}),this._innerWindow().applyOverrides(t)},t.prototype.applyStudiesOverrides=function(t){this._innerWindow().applyStudiesOverrides(t)},t.prototype.watchList=function(){return this._innerAPI().watchlist()},t.prototype.activeChart=function(){return this._innerAPI().activeChart()},t.prototype.chartsCount=function(){return this._innerAPI().chartsCount()},t.prototype.layout=function(){return this._innerAPI().layout()},t.prototype.setLayout=function(t){this._innerAPI().setLayout(t)},t.prototype._getIFrameElement=function(){var t=document.getElementById(this._id);if(null===t)throw new Error("There is no such iframe");return t},t.prototype._innerAPI=function(){return this._getIFrameElement().contentWindow.tradingViewApi},t.prototype._innerWindow=function(){return this._getIFrameElement().contentWindow},t.prototype._autoResizeChart=function(){this._options.fullscreen&&(this._getIFrameElement().style.height=window.innerHeight+"px")},t.prototype._create=function(){var t=this,e=this._render(),o=document.getElementById(this._options.container_id);if(null===o)throw new Error("There is no such element - #"+this._options.container_id);o.innerHTML=e;var i=this._getIFrameElement();(this._options.autosize||this._options.fullscreen)&&(i.style.width="100%",this._options.fullscreen||(i.style.height="100%")),window.addEventListener("resize",this._onWindowResize),this._onWindowResize();var n=function(){i.removeEventListener("load",n,!1),i.contentWindow.widgetReady(function(){t._ready=!0;for(var e=0,o=t._readyHandlers;e<o.length;e++){o[e].call(t)}i.contentWindow.initializationFinished()})};i.addEventListener("load",n,!1)},t.prototype._render=function(){var t=window;t[this._id]={datafeed:this._options.datafeed,customFormatters:this._options.customFormatters,brokerFactory:this._options.brokerFactory,overrides:this._options.overrides,studiesOverrides:this._options.studies_overrides,disabledFeatures:this._options.disabled_features,enabledFeatures:this._options.enabled_features,brokerConfig:this._options.brokerConfig,restConfig:this._options.restConfig,favorites:this._options.favorites,logo:this._options.logo,numeric_formatting:this._options.numeric_formatting,rss_news_feed:this._options.rss_news_feed,newsProvider:this._options.news_provider,loadLastChart:this._options.load_last_chart,saveLoadAdapter:this._options.save_load_adapter,loading_screen:this._options.loading_screen,settingsAdapter:this._options.settings_adapter},this._options.saved_data&&(t[this._id].chartContent={json:this._options.saved_data});var e=(this._options.library_path||"")+"static/tv-chart.630b704a2b9d0eaf1593.html#localserver=1&symbol="+encodeURIComponent(this._options.symbol)+"&interval="+encodeURIComponent(this._options.interval)+(this._options.timeframe?"&timeframe="+encodeURIComponent(this._options.timeframe):"")+(this._options.toolbar_bg?"&toolbarbg="+this._options.toolbar_bg.replace("#",""):"")+(this._options.studies_access?"&studiesAccess="+encodeURIComponent(JSON.stringify(this._options.studies_access)):"")+"&widgetbar="+encodeURIComponent(JSON.stringify(this._options.widgetbar))+(this._options.drawings_access?"&drawingsAccess="+encodeURIComponent(JSON.stringify(this._options.drawings_access)):"")+"&timeFrames="+encodeURIComponent(JSON.stringify(this._options.time_frames))+"&locale="+encodeURIComponent(this._options.locale)+"&uid="+encodeURIComponent(this._id)+"&clientId="+encodeURIComponent(String(this._options.client_id))+"&userId="+encodeURIComponent(String(this._options.user_id))+(this._options.charts_storage_url?"&chartsStorageUrl="+encodeURIComponent(this._options.charts_storage_url):"")+(this._options.charts_storage_api_version?"&chartsStorageVer="+encodeURIComponent(this._options.charts_storage_api_version):"")+(this._options.indicators_file_name?"&indicatorsFile="+encodeURIComponent(this._options.indicators_file_name):"")+(this._options.custom_css_url?"&customCSS="+encodeURIComponent(this._options.custom_css_url):"")+(this._options.auto_save_delay?"&autoSaveDelay="+encodeURIComponent(String(this._options.auto_save_delay)):"")+"&debug="+this._options.debug+(this._options.snapshot_url?"&snapshotUrl="+encodeURIComponent(this._options.snapshot_url):"")+(this._options.timezone?"&timezone="+encodeURIComponent(this._options.timezone):"")+(this._options.study_count_limit?"&studyCountLimit="+encodeURIComponent(String(this._options.study_count_limit)):"")+(this._options.symbol_search_request_delay?"&ssreqdelay="+encodeURIComponent(String(this._options.symbol_search_request_delay)):"");return'<iframe id="'+this._id+'" name="'+this._id+'"  src="'+e+'"'+(this._options.autosize||this._options.fullscreen?"":' width="'+this._options.width+'" height="'+this._options.height+'"')+' frameborder="0" allowTransparency="true" scrolling="no" allowfullscreen style="display:block;"></iframe>'},t}(),d=a;window.TradingView=window.TradingView||{},window.TradingView.version=o,t.version=o,t.onready=i,t.widget=d,Object.defineProperty(t,"__esModule",{value:!0})});


/***/ }),

/***/ "./public/js/utils/helper.ts":
/*!***********************************!*\
  !*** ./public/js/utils/helper.ts ***!
  \***********************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Returns the % difference between value1 and value2
 * @param value1
 * @param value2
 * @returns {number} the % difference > 0 if value1 > value2, < 0 otherwise
 */
function getDiffPercent(value1, value2) {
    return ((value1 - value2) / value2) * 100; // ((y2 - y1) / y1)*100 - positive % if value1 > value2
}
exports.getDiffPercent = getDiffPercent;


/***/ }),

/***/ "./src/WebSocket/opcodes.ts":
/*!**********************************!*\
  !*** ./src/WebSocket/opcodes.ts ***!
  \**********************************/
/*! no static exports found */
/***/ (function(module, exports, __webpack_require__) {

"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.AppJSONFormat = "EJSON";


/***/ }),

/***/ "chart.js":
/*!************************!*\
  !*** external "Chart" ***!
  \************************/
/*! no static exports found */
/***/ (function(module, exports) {

module.exports = Chart;

/***/ }),

/***/ "eventemitter2":
/*!********************************!*\
  !*** external "EventEmitter2" ***!
  \********************************/
/*! no static exports found */
/***/ (function(module, exports) {

module.exports = EventEmitter2;

/***/ }),

/***/ "i18next":
/*!**************************!*\
  !*** external "i18next" ***!
  \**************************/
/*! no static exports found */
/***/ (function(module, exports) {

module.exports = i18next;

/***/ }),

/***/ "jquery":
/*!*************************!*\
  !*** external "jQuery" ***!
  \*************************/
/*! no static exports found */
/***/ (function(module, exports) {

module.exports = jQuery;

/***/ })

/******/ });
//# sourceMappingURL=bundle.js.map