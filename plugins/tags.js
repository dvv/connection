'use strict';

var db = require('redis').createClient();

var slice = Array.prototype.slice;

/**
 * Connection
 *
 * @api public
 */

var Connection = require('sockjs/lib/transport').Session;

/**
 * Tag this connection
 *
 * @api public
 */

Connection.prototype.tag = function(tags, cb) {
  var cid = this.id;
  var commands = tags.map(function(tag) {
    return ['sadd', tag, cid];
  });
  tags.length && commands.push(['sadd', cid + ':g'].concat(tags));
  db.multi(commands).exec(cb);
  return this;
};

/**
 * Remove tags from this connection
 *
 * @api public
 */

Connection.prototype.untag = function(tags, cb) {
  var cid = this.id;
  var commands = tags.map(function(tag) {
    return ['srem', tag, cid];
  });
  tags.length && commands.push(['srem', cid + ':g'].concat(tags));
  db.multi(commands).exec(cb);
  return this;
};

/**
 * Get array of tags of this connection
 *
 * @api public
 */

Connection.prototype.tags = function(cb) {
  var cid = this.id;
  db.smembers(cid + ':g', cb);
  return this;
};

/**
 * Execute selection criteria specified by `rules`
 *
 * @api private
 */

function select(rules, cb) {
  var commands = [];
  // short-circuit simple cases
  if (!rules || !rules.or) {
    cb(null, null);
    return;
    //commands.push(['smembers', 'g:all']);
  } else {
    var tempSetName = 'TODO:unique-and-nonce,but,maybe,a,join,of,message.or';
    commands.push(['sunionstore', tempSetName].concat(rules.or));
    if (rules.and) {
      commands.push(['sinterstore', tempSetName, tempSetName].concat(rules.and));
    }
    if (rules.not) {
      commands.push(['sdiffstore', tempSetName, tempSetName].concat(rules.not));
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
      cb(err);
      return;
    }
    // get resulting set members
    // N.B. redis set operations guarantee we have no duplicates at set level
    var cids = results[results.length-1];
///console.log('GIDS', cids, rules);
    cb(null, cids);
  });
}

/**
 * Manager
 *
 * @api public
 */

var Manager = require('sockjs').Server;

/**
 * Upgrade this manager to handle connections tagging
 *
 * @api private
 */

Manager.prototype.handleTags = function(options) {
  if (!this.send) throw 'Broadcast plugin must be applied first';
};

/**
 * Override broadcast selection criteria executor
 *
 * @api private
 */

Manager.prototype.getIds = select;
