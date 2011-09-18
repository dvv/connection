/**!
 *
 * Connection
 *
 * Copyright(c) 2011 Vladimir Dronnikov <dronnikov@gmail.com>
 * MIT Licensed
 *
 */

(function(exports, undefined) {
'use strict';

/**
 * Base messaging transport
 *
 * @api private
 */

var Transport = typeof SockJS !== 'undefined' ? SockJS : (window.WebSocket || window.MozWebSocket);

/**
 * Well-known useful shortcuts and shims
 *
 * @api private
 */

var slice = Array.prototype.slice;
var toString = Object.prototype.toString;

var isArray = Array.isArray || function(obj) {
  return toString.call(obj) === '[object Array]';
};

// Opera has no Function#bind?!
var nativeBind = Function.prototype.bind;
function bind(func, obj) {
	if (func.bind === nativeBind && nativeBind) {
		return nativeBind.apply(func, slice.call(arguments, 1));
	}
	var args = slice.call(arguments, 2);
	return function() {
		return func.apply(obj, args.concat(slice.call(arguments)));
	};
}

// debugging lambda helper
exports.dump = function() {
  console.log('DUMP', arguments);
};

/**
 * Connection constructor
 *
 * @param {String} [url] URL to connect to.
 * @api public
 */

exports.Connection = Connection;

function Connection(url) {
  // use provided URL, or guess one
  this.url = url || window.location.href;//.replace(/^http/, 'ws');
  // outgoing messages queue
  // TODO: implement outgoing async filters?
  this._queue = [];
  this._queue.limit = 1024;
}

/**
 * Prefix reserved for ack events
 *
 * @api private
 */

Connection.SERVICE_CHANNEL = '/_svc_/';

/**
 * Initial timeout in ms for reconnection attempts. Each failed
 * reconnect attempt doubles the current value.
 *
 * @api private
 */

Connection.RECONNECT_TIMEOUT = 125;

/**
 * EventEmitter simplified interface
 *
 * N.B. we support tagging handlers with current timestamp so that
 * we can garbage-collect stale handlers.
 *
 * @api public
 */

Connection.prototype.on = function(name, fn) {
  if (!this._events) this._events = {};
  this._events[name] = (this._events[name] || []).concat(fn);
  return this;
};
Connection.prototype.addListener = Connection.prototype.on;

Connection.prototype.once = function(name, fn) {
  var self = this;
  function on() {
    self.removeListener(name, on);
    fn.apply(this, arguments);
  }
  on.listener = fn;
  return this.on(name, on);
};

Connection.prototype.removeListener = function(name, fn) {
  var list;
  if (this._events && (list = this._events[name])) {
    for (var i = 0, l = list.length; i < l; i++) {
      if (list[i] === fn ||
         (list[i].listener && list[i].listener === fn)) {
        list.splice(i, 1);
        if (!list.length) delete this._events[name];
        break;
      }
    }
  }
  return this;
};

Connection.prototype.removeAllListeners = function(name) {
  if (this._events && this._events[name]) {
    this._events[name] = null;
    delete this._events[name];
  }
  return this;
};

Connection.prototype.emit = function(name) {
  var handlers;
  if (!this._events || !(handlers = this._events[name])) return false;
  var args = slice.call(arguments, 1);
  handlers = handlers.slice();
///console.log('EVENT', arguments, handlers, args);
  for (var i = 0, l = handlers.length; i < l; ++i) {
    handlers[i].apply(this, args);
  }
  return true;
};

/**
 * Provide a nonce
 *
 * @api private
 */

Connection.nonce = function() {
  // FIXME: make it less guessable
  return Math.random().toString().substring(2);
};

/**
 * Define codec for messages
 *
 * @api private
 */

// TODO: shim for older browsers
Connection.encode = JSON.stringify;
Connection.decode = JSON.parse;

/**
 * Socket: handle incoming messages
 *
 * @api private
 */

function handleSocketMessage(event) {
  var message = event.data;
  if (!message) return;
  var args;
console.log('INMESSAGE', message);
  // FIXME: Connection.decode may throw, that's why try/catch.
  // OTOH, it slows things down. Solution?
  try {
    // event?
    if (isArray(args = Connection.decode(message))) {
      // handle orderly disconnect from remote side
      if (args[0] === Connection.SERVICE_CHANNEL + 'close') {
        this.close();
      // ordinary event
      } else {
        this.emit.apply(this, args);
      }
    // data?
    } else {
      // emit 'data' event
      this.emit('data', args);
    }
  } catch(e) {
    console.error('ONMESSAGEERR', e, message);
  }
}

/**
 * Socket: handle errors
 *
 * @api private
 */

function handleSocketError(error) {
console.error('SOCKETERROR', error, this);
  this.emit('error', error);
};

/**
 * Socket: handle open event
 *
 * @api private
 */

function handleSocketOpen() {
  // set initial reconnect timeout
  this.reconnectTimeout = Connection.RECONNECT_TIMEOUT;
  this.emit('connect');
  // socket is not fully connected?
  if (!this.live) {
    // notify connection is open
    this.live === undefined && this.emit('open');
    this.live = true;
    // flush pending messages
    this.flush();
  }
};

/**
 * Socket: handle close event
 *
 * @api private
 */

function handleSocketClose() {
  // socket is connected?
  if (this.live) {
    // mark disconnected
    this.live = false;
    this.emit('disconnect');
  }
  // reconnect is not disabled?
  if (this.reconnectTimeout) {
    // shedule reconnect
    var self = this;
    setTimeout(function() {
      self.open();
    }, this.reconnectTimeout *= 2);
  // reconnect is disabled!
  } else {
    // mark closed
    delete this.live;
    this.emit('close');
  }
};

/**
 * Establish connection
 *
 * @api public
 */

Connection.prototype.open = function() {
  // prohibit open() if already open/connecting
  if (this.socket &&
    (this.socket.readyState === Transport.OPEN ||
    this.socket.readyState === Transport.CONNECTING)
  ) return this;
  // create new Transport
  this.socket = new Transport(this.url);
  this.emit('connecting');
  // delegate Socket handlers
  this.socket.onopen = bind(handleSocketOpen, this);
  this.socket.onclose = bind(handleSocketClose, this);
  this.socket.onerror = bind(handleSocketError, this);
  this.socket.onmessage = bind(handleSocketMessage, this);
  return this;
};

/**
 * Orderly close the connection
 *
 * @api public
 */

Connection.prototype.close = function() {
  if (this.live) {
    // disable reconnection
    delete this.reconnectTimeout;
    // send orderly disconnect event
    this.socket.close();
  }
  return this;
};

/**
 * Close and reopen the connection
 *
 * @param {Number} delay
 *    If specified, delay reopening for specified amount of ms.
 *
 * @api public
 */

Connection.prototype.reopen = function(delay) {
  if (this.socket) {
    this.reconnectTimeout = delay || 100;
    this.socket.close();
  }
  return this;
};

/**
 * Flag to enqueue quality (high priority) message
 *
 * @api public
 */

Connection.prototype.quality = function() {
  this._queue.quality = true;
  return this;
};

/**
 * Flag to apply expiry timeout to following adjacent #send()
 *
 * @api public
 */

Connection.prototype.expire = function(msecs) {
  this._expire = msecs;
  return this;
};

/**
 * Enqueue the arguments to be sent as a message to remote side
 *
 * N.B. we always enqueue, then shedule flushing
 *
 * @api public
 */

Connection.prototype.send = function(/* args... */) {
  var self = this;
  var args = slice.call(arguments);
  var ack = args[args.length - 1];
  // reserve an event for acknowledgement and
  // substitute ack id for ack handler, if any
  if (typeof ack === 'function') {
    var aid = Connection.SERVICE_CHANNEL + Connection.nonce();
    this.once(aid, ack);
    // we let `this.expire` control expiry on this ack.
    if (this._expire) {
      setTimeout(function() {
        self.emit(aid, new Error('expired'));
      }, this._expire);
      delete this._expire;
    }
    args[args.length - 1] = aid;
  }
  // do not allow dumb overflow.
  // better to loose messages than dump the browser...
  // FIXME: more elegant way of quality handling?
  if (this._queue[this._queue.quality ? 'unshift' : 'push'](args)
      >= this._queue.limit) {
    this._queue.slice(-this._queue.limit);
  }
  delete this._queue.quality;
  // shedule flushing
  setTimeout(function() { self.flush(); }, 0);
  return this;
};

/**
 * Try to send all pending messages
 *
 * @api private
 */

Connection.prototype.flush = function() {
  // while there is something to flush...
  while (this._queue.length) {
    // peek the first message from queue
    var args = this._queue[0];
    // try to send the message.
    // break the loop if failed to send (e.g. transport is closed)...
    if (!this.socket || this.socket.readyState !== Transport.OPEN) {
      break;
    }
    // N.B. WebSocket guarantees that once `#send()` returns, the
    // message is put on wire
    // TODO: try/catch?
    this.socket.send(Connection.encode(args));
    // message is sent ok. prune it from queue
    this._queue.shift();
  }
  return this;
};

/**
 * Safely ack event execution
 *
 * @api public
 */

Connection.prototype.ack = function(aid /*, args... */) {
  // check if `aid` looks like an id for ack function,
  // and send ack event if it does
  if (aid &&
      String(aid).substring(0, Connection.SERVICE_CHANNEL.length)
      === Connection.SERVICE_CHANNEL) {
    this.send.apply(this, arguments);
  }
  return this;
};

})(this);
