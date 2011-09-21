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

function Node(port) {
  // web server
  this.http = Stack.listen(stack(), {}, port);
  // WebSocket server on top of web server
  var ws = this.ws = new WebSocketServer({
    sockjs_url: 'sockjs-latest.min.js',
    // test
    //disabled_transports: ['websocket']
  });
  // WebSocket connection handler
  this.ws.installHandlers(this.http, {
    prefix:'[/]ws'
  });
  this.ws.on('open', function(conn) {
    // `this` is the server
    // examine c in REPL
    repl.c = conn;
    // install default handlers
    conn.connect(this);
    // challenge...
    conn.send('auth', Math.random().toString().substring(2), function(err, id) {
      // ...response
      if (err) {
        this.close();
      } else {
        this.id = id;
      }
    });
    // install custom handlers
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
