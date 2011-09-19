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

var Connection = require('./websocket');

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

Group.prototype.handleMessage = function(event, payload, cb) {
  for (var sid in this.conns) {
    this.conns[sid].emit(event, payload);
  }
  this.emit(event, payload);
  typeof cb === 'function' && cb();
  return this;
};

/**
 * 
 * Manager -- groups director
 * 
 */

function Manager(id) {
  this.id = id;
  var sub = require('redis').createClient();
  sub.psubscribe('*'); sub.on('pmessage', this.handleMessage.bind(this));
  // managed sockets
  this.conns = {};
  // managed groups
  this.groups = {};
  // named filtering functions
  this.filters = {};
  //
  this.on('connection', function(rawsock) {
    var socket = this.socket(this.nonce());
  });
  this.on('close', function(sock, forced) {
    if (forced) {
      // remove from groups etc.
    } else {
      // wait a bit in case it reconnnects?
    }
    delete this.conns[sock.id];
  });
}

// inherit from EventEmitter
Manager.prototype.__proto__ = process.EventEmitter.prototype;

Manager.prototype.nonce = function() {
  return Math.random().toString().substring(2);
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

Manager.prototype.join = function(socket, groups, cb) {
///console.log('MJOIN', arguments);
  var self = this;
  var sid = socket.id;
  var commands = groups.map(function(group) {
    self.group(group).conns[sid] = socket;
    return ['sadd', group, sid];
  });
  groups.length && commands.push(['sadd', sid + ':g'].concat(groups));
  // TODO: publish '//join' for each joined group
  db.multi(commands).exec(cb);
  return this;
};

Manager.prototype.leave = function(socket, groups, cb) {
///console.log('MLEAVE', arguments);
  var self = this;
  var sid = socket.id;
  var commands = groups.map(function(group) {
    var g = self.groups[group];
    g && delete g.conns[sid];
    return ['srem', group, sid];
  });
  groups.length && commands.push(['srem', sid + ':g'].concat(groups));
  // TODO: publish '//leave' for each left group
  db.multi(commands).exec(cb);
  return this;
};

Manager.prototype.member = function(socket, cb) {
  var sid = socket.id;
  db.smembers(sid + ':g', cb);
  return this;
};

Manager.prototype.socket = function(id) {
  if (!this.conns[id]) {
    this.conns[id] = new Socket(id, this);
  }
  return this.conns[id];
};

Manager.prototype.auth = function(socket, cb) {
  var sid = socket.id;
  var self = this;
  this.member(socket, function(err, groups) {
    groups.forEach(function(group) {
      self.group(group).conns[sid] = socket;
    });
    typeof cb === 'function' && cb(err, groups);
  });
  return this;
};

Manager.prototype.group = function(id) {
  if (!this.groups[id]) {
    this.groups[id] = new Group(id, this);
  }
  return this.groups[id];
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

Socket.prototype.select = function() {
  return this.manager.select.apply(this.manager, arguments);
};

Group.prototype.select = function() {
  return this.manager.select.apply(this.manager, arguments);
};

/**
 * 
 * POC code
 * 
 */

//
// dumb independent workers
//
var m1 = new Manager(1000);
var m2 = new Manager(2000);
var m3 = new Manager(3000);
var m4 = new Manager(4000);

//
// testing broadcasts
//
var payload = '0'; for (var i = 0; i < 2; ++i) payload += payload;
db.multi([
  ['flushall'],
  // test groups
  /*['sadd', 'c:1', 'c:1'],
  ['sadd', 'c:2', 'c:2'],
  ['sadd', 'c:3', 'c:3'],
  ['sadd', 'c:4', 'c:4'],*/
  // TODO: g:all should be handled automatically
  ['sadd', 'g:all', 'c:1', 'c:2', 'c:3', 'c:4'],
  ['sadd', 'g:1allies', 'c:2', 'c:3', 'c:4'],
  ['sadd', 'g:jslovers', 'c:1', 'c:3'],
  ['sadd', 'g:banned', 'c:3']
]).exec(function() {

  function cc(mgr, id) {
    //var socket = mgr.socket(id);
    mgr.socket.emit(id);
    socket.join(id);
    socket.on('//tick', function() {
      console.log('TICK for socket', this.manager.id + ':' + this.id);
    });
    return socket;
  }

  var c1 = cc(m1, 'c:1');
  var c2 = cc(m2, 'c:2'); cc(m2, 'c:1');
  var c3 = cc(m3, 'c:3');
  var c4 = cc(m4, 'c:4'); cc(m4, 'c:1');
console.error('MS', m1, m2, m3, m4);
/*  setInterval(function() {
    // this should result in pushing to group 1 only
    // as ([1] + [2, 3, 4]) * [1, 3] - [3] === [1]
    c1.broadcast(['c:1', 'g:1allies'], ['g:jslovers'], ['g:banned']).send('//tick', {foo: payload});
  }, 1000);*/
/*  setInterval(function() {
    // this should result in pushing to groups 1, 2
    // as [1] + [2, 3, 4] - [3, 4] === [1, 2]
    //c2.select().to(['c:1', 'g:1allies']).not('g:banned', 'c:4').send('//tick', {foo: payload});
    c2.select().to(['c:1']).to('g:1allies').not('g:banned', 'c:4').send('//tick', {foo: payload});
  }, 1000);*/
/*  setInterval(function() {
    // this should result in pushing to groups 1, 2, 4
    // as [1] + [2, 3, 4] - [3] === [1, 2, 4]
    c2.select().to(['c:1', 'g:1allies']).not(['g:banned']).send('//tick', {foo: payload});
  }, 1100);*/
  setInterval(function() {
    // this should result in pushing to all groups 1, 2, 3, 4
    m4.select('c:1').send('//tick', {foo: payload});
  }, 1200);
});
