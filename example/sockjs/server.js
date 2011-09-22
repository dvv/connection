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

var WebSocketServer = require('sockjs').Server;
var Connection = require('connection/sockjs');
WebSocketServer.prototype.ids = function() {
  return Object.keys(this.conns);
};

var Manager = require('connection/queue');
for (var i in Manager.prototype) {
  WebSocketServer.prototype[i] = Manager.prototype[i];
}

function Node(port) {
  // web server
  this.http = Stack.listen(stack(), {}, port);
  // WebSocket server on top of web server
  this.ws = new WebSocketServer({
    sockjs_url: 'sockjs.js',
    jsessionid: false,
    // test
    //disabled_transports: ['websocket']
  });
  // WebSocket connection handler
  this.ws.installHandlers(this.http, {
    prefix:'[/]ws'
  });
  // upgrade server to manager
  Manager.call(this.ws);
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
  this.ws.on('wsevent', function(conn, event /*, args... */) {
    if (event === 'you typed') {
      conn.ack(arguments[3], arguments[2]);
    }
  });
  this.ws.on('registered', function(conn, groups) {
    console.error('REGISTERED', conn.id, groups);
  });
  this.ws.on('unregistered', function(conn, groups) {
    console.error('UNREGISTERED', conn.id, groups);
  });
  // notify
  console.log('Listening to http://*:' + port + '. Use Ctrl+C to stop.');
}

// spawn workers
var s1 = new Node(3001);
/*var s2 = new Node(3002);
var s3 = new Node(3003);
var s4 = new Node(3004);*/

// REPL for introspection
var repl = require('repl').start('node> ').context;
process.stdin.on('close', process.exit);
repl.s1 = s1;
