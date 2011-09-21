'use strict';

/*!
 *
 * Connection
 *
 * Copyright(c) 2011 Vladimir Dronnikov <dronnikov@gmail.com>
 * MIT Licensed
 *
 */

/**
 * Well-known useful shortcuts and shims
 *
 * @api private
 */

var slice = Array.prototype.slice;
var isArray = Array.isArray;

/**
 * Connection constructor
 *
 * @api public
 */

module.exports = Connection;

function Connection() {
}

Connection.prototype.connect = function(server) {
  this.server = server;
  this.on('close', handleSocketClose.bind(this));
  this.on('message', handleSocketMessage.bind(this));
};

/**
 * Prefix reserved for ack events
 *
 * @api private
 */

Connection.SERVICE_CHANNEL = '/_svc_/';

/**
 * Provide a nonce
 *
 * @api private
 */

Connection.nonce = function() {
  // FIXME: make less guessable
  return Math.random().toString().substring(2);
};

/**
 * Transport: handle incoming messages
 *
 * @api private
 */

function handleSocketMessage(message) {
//console.log('INMESSAGE', message);
  if (!message) return;
  message = message.data;
  if (!message) return;
  var args;
  // event?
  if (isArray(args = message)) {
    this.emit.apply(this, args);
    this.server.emit.apply(this.server, ['wsevent', this].concat(args));
  // data?
  } else {
    // emit 'data' event
    this.emit('data', args);
    this.server.emit('wsdata', this, args);
  }
}

/**
 * Transport: handle close event
 *
 * @api private
 */

function handleSocketClose() {
  this.server.emit('wsclose', this);
}

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
 * Send a message to remote side
 *
 * N.B. we rely on Transport's internal outgoing queue, if any
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
  this.sendUTF(args);
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

/**
 * Augment and export Transport
 */

var Transport = require('sockjs/lib/transport').Session;
Transport.prototype.sendUTF = Transport.prototype.send;
// mixin Connection methods
for (var i in Connection.prototype) {
  Transport.prototype[i] = Connection.prototype[i];
}

module.exports = Transport;
