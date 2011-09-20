In browser
====

      <script src="conn.js"></script>

Starting communication
----

      // create new connection
      var conn = new Connection(location.href.replace(/^http/, 'ws'));

      // define handlers
      conn.on('open', function() {
          // opened
      });
      conn.on('close', function() {
          // orderly closed
      });

      // low, transport-level handlers
      conn.on('connecting', function() {
          // transport is (re)connecting
      });
      conn.on('connect', function() {
          // transport connected
      });
      conn.on('disconnect', function() {
          // transport disconnected
      });

      // start communication
      conn.open();

Receive message
----

      // simple challenge-response id negotiation
      conn.on('auth', function(id, aid) {
          // in handlers `this` is current connection
          this.id = this.id || id;
          // `aid` is for acknowledgement id
          // send id back to the caller
          this.ack(aid, null, this.id);
      });

Send message
----

      // no ack required
      conn.send('foo', arg1, arg2);

      // ack is required. if ack is not called by remote side,
      // after 2000 ms call ack function with `err === new Error('Exired')`
      conn.expire(2000).send('bar', arg, function(err, result) {
          if (err) {
            // no reply within 2000 ms
            // ...
          } else {
            // all's well
            // ...
          }
      });

In server
====

    var WebSocketServer = require('websocket').server;
    // upgrade WebSocketConnection prototype
    require('connection/websocket');

    // web server
    var http = ...;
    // WebSocket server on top of web server
    var ws = new WebSocketServer({
        httpServer: http,
        fragmentOutgoingMessages: false,
        keepalive: true
    });

    // WebSocket connection handler
    ws.on('request', function(req) {
        //req.reject(403); return;
        var conn = req.accept(null, req.origin);

        // install default handlers
        conn.connect();

        // install custom handlers
        conn.on('you typed', function(val, aid) {
            conn.ack(aid, val);
        });
    });

    console.log('Listening to http://*:' + port + '. Use Ctrl+C to stop.');

