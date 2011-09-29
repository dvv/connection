'use strict';

/**
 * Codec for broadcasting messages
 *
 * Should provide .encode/.decode functions
 *
 * @api private
 */

try {
  // N.B. BiSON is proven to be faster
  var codec = require('bison');
} catch(err) {
  // fallback to JSON codec
  codec = {
    encode: JSON.stringify,
    decode: JSON.parse
  };
}

/**
 * Well-known useful shortcuts and shims
 *
 * @api private
 */

var slice = Array.prototype.slice;
var isArray = Array.isArray;

/**
 * Manager
 *
 * @api public
 */

var Manager = require('sockjs').Server;

/**
 * Upgrade this manager to handle broadcasting
 *
 * @api private
 */

Manager.prototype.handleBroadcast = function(options) {
  if (!this.conns) throw 'Connection plugin must be applied first';
  if (!options) options = {};
  // subscribe to broadcast messages
  var ZMQ = require('zeromq');
  var sub = ZMQ.createSocket('sub');
  sub.connect(options.broker || 'tcp://127.0.0.1:65455');
  sub.subscribe('');
  sub.on('message', handleBroadcastMessage.bind(this));
  // provide publisher
  var pub = ZMQ.createSocket('pub');
  pub.connect(options.broker || 'tcp://127.0.0.1:65454');
  this.publish = pub.send.bind(pub);
}

function handleBroadcastMessage(message) {
  var self = this;
  // deserialize message
  // TODO: fork BiSON to decode Buffers
  var args = codec.decode(message.toString('utf8'));
  // distribute
  var conns = this.conns;
  // broadcast to all connections?
  if (isArray(args)) {
    process.nextTick(function() {
      for (var cid in conns) {
        var arr = conns[cid];
        for (var i = 0, l = arr.length; i < l; ++i) {
          var conn = arr[i];
          conn.emit.apply(conn, args);
          conn.emitter.apply(null, ['event', conn].concat(args));
        }
      }
    });
  // broadcast to selected connections
  } else {
    // FIXME: reconsider?
    var rules = args.r;
    args = args.d;
    // rules are array of cids? use them directly
    if (isArray(rules)) {
      process.nextTick(function() {
        for (var c = 0, n = rules.length; c < n; ++c) {
          var arr = conns[rules[c]];
          if (!arr) continue;
          for (var i = 0, l = arr.length; i < l; ++i) {
            var conn = arr[i];
            conn.emit.apply(conn, args);
            conn.emitter.apply(null, ['event', conn].concat(args));
          }
        }
      });
    // rules are selection criteria
    } else {
      this.getIds(rules, function(err, cids) {
        if (err) return;
        // N.B. cids === null to broadcast to all
        if (!cids) cids = Object.keys(conns);
        for (var c = 0, n = cids.length; c < n; ++c) {
          var arr = conns[cids[c]];
          if (!arr) continue;
          for (var i = 0, l = arr.length; i < l; ++i) {
            var conn = arr[i];
            conn.emit.apply(conn, args);
            conn.emitter.apply(null, ['event', conn].concat(args));
          }
        }
      });
    }
  }
}

/**
 * Given selection criteria, return list of ids of matching connections
 *
 * N.B. Here this is a stub to return all connections.
 * Other plugins may override this to provide richer selecting
 * capabilities.
 *
 * @api public
 */

Manager.prototype.getIds = function(rules, cb) {
  cb(null, null);
};

/**
 * Broadcast arguments to all connections managed by the cluster
 *
 * @api public
 */

Manager.prototype.send = function(/* args... */) {
  var obj = slice.call(arguments);
  if (this._forall) {
    obj = {
      r: this._forall,
      d: obj
    };
    delete this._forall;
  }
  var s = codec.encode(obj);
  return this.publish(s);
};

/**
 * Broadcast arguments to all connections of specified `id`
 *
 * @api public
 */

Manager.prototype.forall = function(id) {
  this._forall = slice.call(arguments);
  return this;
};

/**
 * Return select object for specified selection criteria
 *
 * @api public
 */

Manager.prototype.select = function(to, only, not) {
  var selector = new Select(to, only, not);
  selector.manager = this;
  return selector;
};

/**
 * Select helper
 *
 * @api public
 */

function Select(to, only, not) {
  if (to === Object(to) && !isArray(to)) {
    this.rules = to;
  } else {
    this.rules = {};
    this.to(to);
    this.only(only);
    this.not(not);
  }
  return this;
}

Select.prototype.to = function(to) {
  // list of union criteria
  if (to) {
    if (!this.rules.or) this.rules.or = [];
    this.rules.or = this.rules.or.concat(isArray(to) ?
      to :
      slice.call(arguments));
  }
  return this;
};

Select.prototype.only = function(and) {
  // list of intersection criteria
  if (and) {
    if (!this.rules.and) this.rules.and = [];
    this.rules.and = this.rules.and.concat(isArray(and) ?
      and :
      slice.call(arguments));
  }
  return this;
};

Select.prototype.not = function(not) {
  // list of exclusion criteria
  if (not) {
    if (!this.rules.not) this.rules.not = [];
    this.rules.not = this.rules.not.concat(isArray(not) ?
      not :
      slice.call(arguments));
  }
  return this;
};

Select.prototype.send = function(/* args... */) {
  var obj = {
    r: this.rules,
    d: slice.call(arguments)
  };
  var s = codec.encode(obj);
  delete this.rules;
  return this.manager.publish(s);
};

module.exports = Manager;
