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

Array.prototype.remove = function(item) {
  var index = this.indexOf(item);
  if (index >= 0) this.splice(index, 1);
};

/**
 * Connection
 *
 * @api public
 */

var Connection = require('sockjs/lib/transport').Session;
Connection.prototype.sendUTF = Connection.prototype.send;

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
 * Connection: handle incoming messages
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
  // data?
  } else {
    // emit 'data' event
    this.emit('message', args);
  }
}

/**
 * Connection: handle close event
 *
 * @api private
 */

function handleSocketClose() {
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
 * Manager
 *
 * @api public
 */

var Manager = require('sockjs').Server;

/**
 * Upgrade this server to handle `this.conns` hash of connections.
 * Connections are authorized via 'auth' message and make their `id`
 * property to be persistent across reconnections.
 *
 * Introduce 'registered' server event which is emitted when connection
 * is first open, and 'unregistered' event when connection is gone and
 * not reconnected.
 *
 * @api private
 */

Manager.prototype.handleConnections = function(sessionHandler) {
  var manager = this;
  // maintain connections
  this.conns = {};
  this.on('open', function(conn) {
    // install default handlers
    conn.on('message', handleSocketMessage.bind(conn));
    conn.on('auth', function(secret, aid) {
      // TODO: get rid of assumption on cookie-sessions!
      // fake HTTP request with passed cookies
      var req = { headers: { cookie: secret } };
      sessionHandler(req, {}, function() {
        // req.session is as if we used HTTP request
        if (req.session && req.session.uid) {
          var cid = conn.id = req.session.uid;
          conn.ack(aid, null, req.session);
          // register connection
          if (!manager.conns[cid]) {
            manager.conns[cid] = [];
          }
console.error('OPEN', cid, manager.id);
          manager.conns[cid].push(conn);
        } else {
          // ???
        }
      });
    });
    conn.on('close', function(conn) {
      var cid = conn.id;
      if (manager.conns[cid]) {
console.error('CLOSE', cid, manager.id);
        manager.conns[cid].remove(conn);
        if (!manager.conns[cid].length) {
          delete manager.conns[cid];
        }
      }
    });
  });
};

module.exports = Connection;
