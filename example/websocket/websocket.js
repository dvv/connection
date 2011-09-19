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
  // determine client user agent
  Stack.userAgent(),
  // serve client script
  function(req, res, next) {
    if (req.url === '/conn.js' && req.method === 'GET') {
      if (req.ua.hybi8) {
        res.writeHead(301, {'Location': 'connection.js'});
        res.end();
      } else {
        res.writeHead(301, {'Location': 'connection-flash.js'});
        res.end();
      }
    } else next();
  }
];
}

var WebSocketServer = require('websocket').server;
var Connection = require('connection/websocket');

function Node(port) {
  // web server
  this.http = Stack.listen(stack(), {}, port);
  // upgrade to flash policy server
  require('./lib/flash-policy')(this.http);
  // WebSocket server on top of web server
  this.ws = new WebSocketServer({
    httpServer: this.http,
    fragmentOutgoingMessages: false,
    keepalive: true // N.B. polyfill doesn't support ping/pong so far
  });
  // WebSocket connection handler
  this.ws.on('request', function(req) {
    //req.reject(403); return;
    var conn = req.accept(null, req.origin);
    // examine c in REPL
    repl.c = conn;
    // install default handlers
    Connection.call(conn);
    conn.on('you typed', function(val, aid) {
      conn.ack(aid, val);
    });
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
