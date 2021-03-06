////////////////////////////////////////////////////////////////////////////
//
// Copyright 2016 Realm Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
////////////////////////////////////////////////////////////////////////////

'use strict';

import * as base64 from './base64';
import * as util from './util';
import { keys, objectTypes } from './constants';

const { id: idKey, realm: _realmKey } = keys;
let registeredCallbacks = [];
const typeConverters = {};

// Callbacks that are registered initially (currently only refreshAccessToken) will
// carry this symbol so they are not wiped in clearTestState.
const persistentCallback = Symbol("persistentCallback");

let XMLHttpRequest = global.originalXMLHttpRequest || global.XMLHttpRequest;
let sessionHost;
let sessionId;

// Check if XMLHttpRequest has been overridden, and get the native one if that's the case.
if (XMLHttpRequest.__proto__ != global.XMLHttpRequestEventTarget) {
    let fakeXMLHttpRequest = XMLHttpRequest;
    delete global.XMLHttpRequest;
    XMLHttpRequest = global.XMLHttpRequest;
    global.XMLHttpRequest = fakeXMLHttpRequest;
}

registerTypeConverter(objectTypes.DATA, (_, { value }) => base64.decode(value));
registerTypeConverter(objectTypes.DATE, (_, { value }) => new Date(value));
registerTypeConverter(objectTypes.DICT, deserializeDict);
registerTypeConverter(objectTypes.FUNCTION, deserializeFunction);

export function registerTypeConverter(type, handler) {
    typeConverters[type] = handler;
}

export function createSession(refreshAccessToken, host) {
    refreshAccessToken[persistentCallback] = true;
    sessionId = sendRequest('create_session', { refreshAccessToken: serialize(undefined, refreshAccessToken) }, host);
    sessionHost = host;
    return sessionId;
}

function beforeNotify(realm) {
    // NOTE: the mere existence of this function is important for read
    // isolation even independent of what it does in its body. By having a
    // beforenotify listener, we ensure that the RPC server can't proceed in
    // notify() to autorefresh until the browser performs a callback poll.
    // Without this, the RPC server could autorefresh in between two subsequent
    // property reads from the browser.

    // Clear the cache for this Realm, and reenable caching if it was disabled
    // by a write transaction.
    util.invalidateCache(realm[keys.realm]);
}

export function createRealm(args) {
    if (args) {
        args = args.map((arg) => serialize(null, arg));
    }

    return sendRequest('create_realm', { arguments: args, beforeNotify: serialize(null, beforeNotify) });
}

export function asyncOpenRealm(id, config, callback) {
    sendRequest('call_method', {
        id,
        name: '_asyncOpen',
        arguments: [
            serialize(null, config),
            serialize(null, (realm, error) => {
                if (realm) {
                    realm.addListener('beforenotify', beforeNotify);
                }
                callback(realm, error);
            })
        ]
    });
}

export function createUser(args) {
    args = args.map((arg) => serialize(null, arg));
    const result = sendRequest('create_user', { arguments: args });
    return deserialize(undefined, result);
}

export function _adminUser(args) {
    args = args.map((arg) => serialize(null, arg));
    const result = sendRequest('_adminUser', { arguments: args });
    return deserialize(undefined, result);
}

export function _getExistingUser(args) {
    args = args.map((arg) => serialize(null, arg));
    const result = sendRequest('_getExistingUser', { arguments: args });
    return deserialize(undefined, result);
}

export function reconnect(args) {
    sendRequest('reconnect', { arguments: []});
}

export function _initializeSyncManager(args) {
    args = args.map((arg) => serialize(null, arg));
    sendRequest('_initializeSyncManager', { arguments: args });
}

export function hasExistingSessions(args) {
    return deserialize(undefined, sendRequest('_hasExistingSessions', { arguments: []}));
}

export function callMethod(realmId, id, name, args) {
    if (args) {
        args = args.map((arg) => serialize(realmId, arg));
    }

    let result = sendRequest('call_method', { realmId, id, name, arguments: args });
    return deserialize(realmId, result);
}

export function getObject(realmId, id, name) {
    let result = sendRequest('get_object', { realmId, id, name });
    if (!result) {
        return result;
    }
    for (let key in result) {
        result[key] = deserialize(realmId, result[key]);
    }
    return result;
}

export function getProperty(realmId, id, name) {
    let result = sendRequest('get_property', { realmId, id, name });
    return deserialize(realmId, result);
}

export function setProperty(realmId, id, name, value) {
    value = serialize(realmId, value);
    sendRequest('set_property', { realmId, id, name, value });
}

export function getAllUsers() {
    let result = sendRequest('get_all_users');
    return deserialize(undefined, result);
}

export function clearTestState() {
    sendRequest('clear_test_state');

    // Clear all registered callbacks that are specific to this session.
    registeredCallbacks = registeredCallbacks.filter(cb => Reflect.has(cb, persistentCallback));
}

function registerCallback(callback) {
    let key = registeredCallbacks.indexOf(callback);
    return key >= 0 ? key : (registeredCallbacks.push(callback) - 1);
}

function serialize(realmId, value) {
    if (typeof value == 'undefined') {
        return { type: objectTypes.UNDEFINED };
    }
    if (typeof value == 'function') {
        return { type: objectTypes.FUNCTION, value: registerCallback(value) };
    }
    if (!value || typeof value != 'object') {
        return { value: value };
    }

    let id = value[idKey];
    if (id) {
        return { id };
    }

    if (value instanceof Date) {
        return { type: objectTypes.DATE, value: value.getTime() };
    }

    if (Array.isArray(value)) {
        let array = value.map((item) => serialize(realmId, item));
        return { value: array };
    }

    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        return { type: objectTypes.DATA, value: base64.encode(value) };
    }

    let keys = Object.keys(value);
    let values = keys.map((key) => serialize(realmId, value[key]));
    return { type: objectTypes.DICT, keys, values };
}

export function deserialize(realmId, info) {
    let type = info.type;
    let handler = type && typeConverters[type];
    if (handler) {
        return handler(realmId, info);
    }

    let value = info.value;
    if (value && Array.isArray(value)) {
        return value.map((item) => deserialize(realmId, item));
    }

    return value;
}

function deserializeDict(realmId, info) {
    let { keys, values } = info;
    let object = {};

    for (let i = 0, len = keys.length; i < len; i++) {
        object[keys[i]] = deserialize(realmId, values[i]);
    }

    return object;
}

function deserializeFunction(realmId, info) {
    return registeredCallbacks[info.value];
}

function makeRequest(url, data) {
    let statusCode;
    let responseText;

    // The global __debug__ object is provided by Visual Studio Code.
    if (global.__debug__) {
        let request = global.__debug__.require('sync-request');
        let response = request('POST', url, {
            body: JSON.stringify(data),
            headers: {
                "Content-Type": "text/plain;charset=UTF-8"
            }
        });

        statusCode = response.statusCode;
        responseText = response.body.toString('utf-8');
    } else {
        let body = JSON.stringify(data);
        let request = new XMLHttpRequest();

        request.open('POST', url, false);
        request.send(body);

        statusCode = request.status;
        responseText = request.responseText;
    }

    if (statusCode != 200) {
        throw new Error(responseText);
    }

    return JSON.parse(responseText);
}

let pollTimeoutId;
let pollTimeout = 10;

//returns an object from rpc serialized json value
function deserialize_json_value(value) {
    let result = {};
    for (let index = 0; index < value.keys.length; index++) {
        var propName = value.keys[index];
        var propValue = value.values[index];
        if (propValue.type && propValue.type == 'dict') {
            result[propName] = deserialize_json_value(propValue);
        }
        else {
            result[propName] = propValue.value;
        }
    }

    return result;
}

function sendRequest(command, data, host = sessionHost) {
    clearTimeout(pollTimeoutId);
    try {
        if (!host) {
            throw new Error('Must first create RPC session with a valid host');
        }

        data = Object.assign({}, data, sessionId ? { sessionId } : null);

        let url = 'http://' + host + '/' + command;
        let response = makeRequest(url, data);
        let callback = response && response.callback;

        // Reset the callback poll interval to 10ms every time we either hit a
        // callback or call any other method, and double it each time we poll
        // for callbacks and get nothing until it's over a second.
        if (callback || command !== 'callbacks_poll') {
            pollTimeout = 10;
        }
        else if (pollTimeout < 1000) {
            pollTimeout *= 2;
        }

        if (!response || response.error) {
            let error = response && response.error;

            // Remove the type prefix from the error message (e.g. "Error: ").
            if (error && error.replace) {
                error = error.replace(/^[a-z]+: /i, '');
            }
            else if (error.type && error.type === 'dict') {
                const responseError = deserialize_json_value(error);
                let responeMessage;
                if (response.message && response.message !== '') {
                    // Remove the type prefix from the error message (e.g. "Error: ").
                    responeMessage = response.message.replace(/^[a-z]+: /i, '');
                }

                const exceptionToReport = new Error(responeMessage);
                Object.assign(exceptionToReport, responseError);
                throw exceptionToReport;
            }

            throw new Error(error || `Invalid response for "${command}"`);
        }
        if (callback != null) {
            let result, error, stack;
            try {
                let realmId = data.realmId;
                let thisObject = deserialize(realmId, response.this);
                let args = deserialize(realmId, response.arguments);
                const fn = registeredCallbacks[callback];
                if (fn) {
                    result = serialize(realmId, fn.apply(thisObject, args));
                }
                else {
                    error = `Unknown callback id: ${callback}`
                }
            } catch (e) {
                error = e.message || ('' + e);
                if (e.stack) {
                    stack = JSON.stringify(e.stack);
                }
            }

            let callbackCommand = "callback_result";
            if (command === 'callbacks_poll' || command === 'callback_poll_result') {
                callbackCommand = "callback_poll_result";
            }

            return sendRequest(callbackCommand, { callback, result, error, stack, "callback_call_counter": response.callback_call_counter });
        }

        return response.result;
    }
    finally {
        pollTimeoutId = setTimeout(() => sendRequest('callbacks_poll'), pollTimeout);
    }
}
