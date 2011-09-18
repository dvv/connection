'use strict';

/*!
 *
 * Copyright(c) 2011 Vladimir Dronnikov <dronnikov@gmail.com>
 * MIT Licensed
 *
 */

//
// serve static content from `root`
//
// options.cacheThreshold:
//   null/undefined - don't cache
//   0 - cache file stat
//   N>0 - cache both file stat and file contents for files of length <= N
//
// `index` is substituted for '/', if specified
//
module.exports = function setup(root, index, options) {

  var Path = require('path');
  var parseUrl = require('url').parse;
  var Fs = require('fs');
  var getMime = require('simple-mime')('application/octet-stream');

  // setup
  if (!options) options = {};
  var ENOENT = require('constants').ENOENT;

  var maxAge = options.maxAge || 0;

  // N.B. we aggressively cache since we rely on watch/reload
  var statCache = {};
  var fileCache = {};

  // handler
  return function handler(req, res, next) {

    // we only support GET
    if (req.method !== 'GET') return next();

    // defaults
    if (!req.uri) req.uri = parseUrl(req.url);
    // check if we are in business
    // handle index
    var path = req.uri.pathname;
    if (path === '/' && index) path = Path.join(path, index);
    path = Path.normalize(Path.join(root, path));
    //if (path[path.length - 1] === '/') path = path.substr(0, path.length - 1);

    // check if file stats is cached
    if (options.cacheThreshold != null && statCache.hasOwnProperty(path)) {
      onStat(null, statCache[path]);
    // get file stats
    } else {
      Fs.stat(path, function(err, stat) {
        //console.log('STAT!', path, err, stat);
        // do not cache failed stat
        if (options.cacheThreshold != null && !err) {
          statCache[path] = stat;
        }
        onStat(err, stat);
      });
    }

    // file statistics obtained
    function onStat(err, stat) {

      // file not found -> bail out
      if (err) return next(err.errno === ENOENT ? null : err);

      // file isn't a vanilla file -> bail out
      if (!stat.isFile()) return next(err);

      // setup response headers
      var headers = {
        'Date': (new Date()).toUTCString(),
        'Last-Modified': stat.mtime.toUTCString(),
        'Cache-Control': 'public, max-age=' + (maxAge / 1000),
        'Etag': '"' + stat.size + '-' + Number(stat.mtime) + '"'
      };
      // no need to serve if browser has the file in its cache
      if (headers['Last-Modified'] === req.headers['if-modified-since']) {
        res.writeHead(304, headers);
        res.end();
        return;
      }

      // handle the Range:, if any
      var start = 0;
      var end = stat.size - 1;
      var code = 200;
      if (req.headers.range) {
        var p = req.headers.range.indexOf('=');
        var parts = req.headers.range.substr(p + 1).split('-');
        if (parts[0].length) {
          start = +parts[0];
          if (parts[1].length) end = +parts[1];
        } else {
          if (parts[1].length) start = end + 1 - +parts[1];
        }
        // range is invalid -> bail out
        if (end < start || start < 0 || end >= stat.size) {
          res.writeHead(416, headers);
          res.end();
          return;
        }
        code = 206;
        headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + stat.size;
      }
      headers['Content-Length'] = end - start + 1;

      // report mime
      headers['Content-Type'] = getMime(path);

      // file is empty -> send empty response
      if (stat.size === 0) {
        res.writeHead(code, headers);
        res.end();
        return;
      }

      // stream the file contents to the response
      if (!options.cacheThreshold || options.cacheThreshold < stat.size) {
        var stream = Fs.createReadStream(path, {
          start: start,
          end: end
        });
        stream.once('data', function(chunk) {
          res.writeHead(code, headers);
        });
        stream.pipe(res);
        stream.on('error', next);
      // serve cached contents
      } else {
        // cached?
        if (fileCache.hasOwnProperty(path)) {
          var cached = fileCache[path];
          res.end((start > 0 || end != stat.size-1) ? cached.slice(start, end+1) : cached);
        // read and cache
        } else {
          Fs.readFile(path, function(err, data) {
            if (err) return next(err);
            fileCache[path] = data;
            onStat(null, stat);
          });
        }
      }

    }
  };

};
