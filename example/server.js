#!/usr/bin/env node
'use strict';

/**
 * HTTP middleware
 */

var Stack = require('./lib');
function stack() {
return [
  // report health status to load balancer
  Stack.health(),
  // serve static content
  Stack.static(__dirname + '/public', 'index.html', {
    maxAge: 0,
  }),
];
}

var Manager = require('sockjs').Server;
// connection plugin
require('connection/sockjs');
// broadcast plugin
require('connection/plugins/broadcast');
// tags plugin
require('connection/plugins/tags');

function Node(port) {
  // web server
  this.http = Stack.listen(stack(), {}, port);
  // WebSocket server on top of web server
  this.ws = new Manager({
    sockjs_url: 'sockjs.js',
    jsessionid: false,
    // test
    //disabled_transports: ['websocket']
  });
  // WebSocket connection handler
  this.ws.installHandlers(this.http, {
    prefix: '[/]ws'
  });
  // upgrade server to manager
  this.ws.handleConnections();
  // handle broadcasting
  this.ws.handleBroadcast();
  // current connections
  this.ws.on('open', function(conn) {
    // `this` is the server
    // examine c in REPL
    repl.c = conn;
    // install custom handlers
    //conn.on('you typed', function(val, aid) {
    //  conn.ack(aid, val);
    //});
  });
  // you can reduce number of closures by listening to catchall event
  this.ws.on('event', function(conn, event /*, args... */) {
    //console.error('EVENT', Array.prototype.slice.call(arguments, 1));
    if (event === 'you typed') {
      //conn.ack(arguments[3], arguments[2]);
      this.forall(conn.id).send('was typed', arguments[2]);
    } else if (event === 'dostress') {
      repl.stress(+arguments[2]);
    } else {
      conn.send.apply(conn, Array.prototype.slice.call(arguments, 1));
    }
  });
  this.ws.id = port;
  this.ws.on('registered', function(conn) {
    console.error('REGISTERED', conn.id);
    this.send('JOINED: ' + conn.id);
  });
  this.ws.on('unregistered', function(conn) {
    console.error('UNREGISTERED', conn.id);
    this.send('LEFT: ' + conn.id);
  });
  // notify
  console.log('Listening to http://*:' + port + '. Use Ctrl+C to stop.');
}

// spawn workers
var s1 = new Node(3001);
var s2 = new Node(3002);
var s3 = new Node(3003);
var s4 = new Node(3004);

// REPL for introspection
var repl = require('repl').start('node> ').context;
process.stdin.on('close', process.exit);
repl.s1 = s1;
repl.foo = function() { s1.ws.send('foo'); };
repl.foo1 = function() { s1.ws.select().send('foo'); };
repl.conns = function() {
  return [
    [Object.keys(s1.ws.conns), 0],
    [Object.keys(s2.ws.conns), 0],
    [Object.keys(s3.ws.conns), 0],
    [Object.keys(s4.ws.conns), 0],
  ];
};
repl.stress = function(n) {
  console.error('STRESS started', n);
  var t = Date.now();
  for (var i = 0; i < n; ++i) {
    s1.ws.select().send('foo' + i);
  }
  console.error('STRESS stopped', (Date.now() - t) / 1000 / n);
};
