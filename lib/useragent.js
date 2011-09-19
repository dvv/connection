'use strict';

/*!
 *
 * Copyright(c) 2011 Vladimir Dronnikov <dronnikov@gmail.com>
 * MIT Licensed
 *
 */

/**
 * Set req.ua hash to parser userAgent
 */

module.exports = function setup() {

  var parse = require('useragent').parser;

  return function handler(req, res, next) {
    var header = req.headers['user-agent'];
    req.ua = parse(header);
    // latest draft WebSocket supported?
    req.ua.hybi8 = 
      (req.ua.family === 'Chrome' && +req.ua.V1 >= 14) ||
      (req.ua.family === 'Firefox' && +req.ua.V1 >= 7);
    next();
  };

};
