'use strict';

/*!
 *
 * Copyright(c) 2011 Vladimir Dronnikov <dronnikov@gmail.com>
 * MIT Licensed
 *
 */

/**
 * Insert a listener to 'connection' event for specified server,
 * handle flash policy requests
 */

module.exports = function setup(server, policy) {

  policy = policy || '<cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>';
  server.listeners('connection').unshift(function(socket) {
    socket.once('data', function(data) {
      if (data && data[0] === 60
        && data.toString() === '<policy-file-request/>\0'
        && socket
        && (socket.readyState === 'open' || socket.readyState === 'writeOnly')
      ) {
//console.log('FLASH!');
        // send the policy
        socket.end(policy);
      }
    });
  });

};
