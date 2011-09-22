'use strict';

var db = require('redis').createClient();
//var codec = {encode: JSON.stringify, decode: JSON.parse}; // should provide .encode/.decode
var codec = require('bison'); // should provide .encode/.decode

var slice = Array.prototype.slice;

/**
 * 
 * Connection -- a peer-to-peer connection
 * 
 */

var Connection = require('sockjs/lib/transport').Session;

Connection.prototype.join = function(groups, cb) {
  this.manager.join(this, [].concat(groups), cb);
  return this;
};

Connection.prototype.leave = function(groups, cb) {
  this.manager.leave(this, [].concat(groups), cb);
  return this;
};

Connection.prototype.groups = function(cb) {
  this.manager.member(this, cb);
  return this;
};

/**
 * 
 * Group -- an identified set of connections
 * 
 */

function Group(id, manager) {
  this.id = id;
  this.manager = manager;
  // connections
  this.conns = {};
}

// inherit from EventEmitter
Group.prototype.__proto__ = process.EventEmitter.prototype;

/*Group.prototype.join = function(sockets, cb) {
  this.manager.add(this, sockets, cb);
  return this;
};

Group.prototype.leave = function(sockets, cb) {
  this.manager.remove(this, sockets, cb);
  return this;
};*/

Group.prototype.members = function(cb) {
  cb(null, this.conns);
  return this;
};

Group.prototype.handleMessage = function(/* args..., cb */) {
  var args = slice.call(arguments);
  var cb = args[args.length-1];
  if (typeof cb === 'function') {
    args.pop();
  } else {
    cb = null;
  }
  var self = this;
  var conns = this.conns;
  process.nextTick(function() {
    for (var cid in conns) {
      conns[cid].emit.apply(conns[cid], args);
    }
    self.emit.apply(self, args);
    cb && cb();
  });
  return this;
};

/**
 * 
 * Manager -- groups director
 * 
 */

module.exports = Manager;

function Manager(id) {
  this.id = id;
  var self = this;
  // subscribe to pubsub messages
  var sub = require('redis').createClient();
  sub.psubscribe('*');
  sub.on('pmessage', this.handleMessage.bind(this));
  // managed connections
  this.conns = {};
  // managed groups
  this.groups = {};
  // named filtering functions
  this.filters = {};
  // handle connection registration
  this.on('open', function(conn) {
    // install default handlers
    conn.connect(this);
    // FIXME: this is redundant, .server already exists
    conn.manager = this;
    // negotiate connection id
    // challenge. wait for reply no more than 1000 ms
    conn.expire(1000).send('auth', conn.id, function(err, id) {
      // ...response
      if (err) {
        conn.close();
        return;
      }
      // id is negotiated. register connection
      conn.id = id;
      if (!self.conns[id]) {
        self.register(conn, function(err, groups) {
          // TODO: handle errors
          self.emit('registered', conn, groups);
        });
      }
    });
    // TODO: consider moving out
    conn.on('close', function() {
      self.unregister(conn, function(err, groups) {
        // TODO: handle errors
        self.emit('unregistered', conn, groups);
      });
    });
  });
}

Manager.prototype.group = function(id) {
  if (!this.groups[id]) {
    this.groups[id] = new Group(id, this);
  }
  return this.groups[id];
};

Manager.prototype.handleMessage = function(pattern, channel, message) {
  var self = this;
  // deserialize message
  message = codec.decode(message);
  // get list of relevant groups
  this.select(message.f).get(function(err, gids) {
    if (err) return;
    // distribute payload
    var payload = message.d;
    process.nextTick(function() {
      for (var i = 0, l = gids.length; i < l; ++i) {
        var group = self.groups[gids[i]];
        if (group) group.handleMessage(channel, payload);
      }
    });
  }, this.filters);
};

Manager.prototype.join = function(conn, groups, cb) {
///console.log('MJOIN', arguments);
  var self = this;
  var cid = conn.id;
  var commands = groups.map(function(group) {
    self.group(group).conns[cid] = conn;
    return ['sadd', group, cid];
  });
  groups.length && commands.push(['sadd', cid + ':g'].concat(groups));
  // TODO: publish '//join' for each joined group
  db.multi(commands).exec(cb);
  return this;
};

Manager.prototype.leave = function(conn, groups, cb) {
///console.log('MLEAVE', arguments);
  var self = this;
  var cid = conn.id;
  var commands = groups.map(function(group) {
    var g = self.groups[group];
    g && delete g.conns[cid];
    return ['srem', group, cid];
  });
  groups.length && commands.push(['srem', cid + ':g'].concat(groups));
  // TODO: publish '//leave' for each left group
  db.multi(commands).exec(cb);
  return this;
};

Manager.prototype.member = function(conn, cb) {
  var cid = conn.id;
  db.smembers(cid + ':g', cb);
  return this;
};

Manager.prototype.register = function(conn, cb) {
  var cid = conn.id;
  var self = this;
  this.member(conn, function(err, groups) {
    groups.forEach(function(group) {
      self.group(group).conns[cid] = conn;
    });
    self.conns[cid] = conn;
    typeof cb === 'function' && cb(err, groups);
  });
  return this;
};

Manager.prototype.unregister = function(conn, cb) {
  var cid = conn.id;
  var self = this;
  this.member(conn, function(err, groups) {
    delete self.conns[cid];
    groups.forEach(function(group) {
      self.group(group).conns[cid] = conn;
    });
    typeof cb === 'function' && cb(err, groups);
  });
  return this;
};

/**
 * 
 * Select plugin
 * 
 */

function Select(to, only, not, flt) {
  if (to === Object(to) && !Array.isArray(to)) {
    this.rules = to;
  } else {
    this.rules = {};
    this.to(to);
    this.only(only);
    this.not(not);
    this.filter(flt);
  }
  return this;
}

Select.prototype.to = function(to) {
  // list of groups to union
  if (to) {
    if (!this.rules.or) this.rules.or = [];
    this.rules.or = this.rules.or.concat(Array.isArray(to) ?
      to :
      slice.call(arguments));
  }
  return this;
};

Select.prototype.only = function(and) {
  // list of groups to intersect
  if (and) {
    if (!this.rules.and) this.rules.and = [];
    this.rules.and = this.rules.and.concat(Array.isArray(and) ?
      and :
      slice.call(arguments));
  }
  return this;
};

Select.prototype.not = function(not) {
  // list of groups to exclude
  if (not) {
    if (!this.rules.not) this.rules.not = [];
    this.rules.not = this.rules.not.concat(Array.isArray(not) ?
      not :
      slice.call(arguments));
  }
  return this;
};

Select.prototype.filter = function(flt) {
  // optional name of final filtering function
  // N.B. define these functions in `this.manager.filters` hash
  if (flt) this.rules.flt = flt;
  return this;
};

Select.prototype.get = function(fn, filters) {
  var self = this;
  var commands = [];
  // short-circuit simple cases
  if (!this.rules.or) {
    commands.push(['smembers', 'g:all']);
  } else {
    var tempSetName = 'TODO:unique-and-nonce,but,maybe,a,join,of,message.or';
    commands.push(['sunionstore', tempSetName].concat(this.rules.or));
    if (this.rules.and) {
      commands.push(['sinterstore', tempSetName, tempSetName].concat(this.rules.and));
    }
    if (this.rules.not) {
      commands.push(['sdiffstore', tempSetName, tempSetName].concat(this.rules.not));
    }
    // TODO: once we find a way to encode and/or/not in reasonable short string
    // we can use it as resulting set name and set expire on resulting set and reuse it.
    //db.expire(tempSetName, 1); // valid for 1 second
    commands.push(['smembers', tempSetName]);
  }
///console.log('COMMANDS', commands);
  db.multi(commands).exec(function(err, results) {
    // FIXME: until we don't use expiry, we free resulting set immediately
    if (tempSetName) db.del(tempSetName);
    // error means we are done, no need to bubble
    if (err) {
      fn(err);
      return;
    }
    // get resulting set members
    // N.B. redis set operations guarantee we have no duplicates on group level
    var gids = results[results.length - 1];
///console.log('GIDS', gids, self.rules);
    // apply custom named filter, if any
    // N.B. this is very expensive option since we have to dereference groups data given group id
    // FIXME: can this data ever be obtained async?
    var flt;
    if (self.rules.flt && filters && (flt = filters[self.rules.flt])) {
      gids = gids.filter(flt);
    }
    //
    fn(null, gids);
  });
  return this;
};

Select.prototype.send = function(event, data) {
  // vanilla broadcast fields
  var message = {
    d: data
  };
  // apply filter rules, if any
  if (this.rules) {
    message.f = this.rules;
    // reset used rules
    delete this.rules;
  }
  // publish event to corresponding channel
  var s = codec.encode(message);
//console.log('SEND', event, message.rules);
  // FIXME: consider returning publish return value
  // to support kinda "source quench" to not flood the channel
  db.publish(event, s);
  return this;
};

Manager.prototype.select = function(or, and, not, flt) {
  var selector = new Select(or, and, not, flt);
  selector.manager = this;
  return selector;
};

Connection.prototype.select = function() {
  return this.manager.select.apply(this.manager, arguments);
};

Group.prototype.select = function() {
  return this.manager.select.apply(this.manager, arguments);
};
