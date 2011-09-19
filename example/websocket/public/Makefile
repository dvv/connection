all: connection.js connection-flash.js

connection.js: ../../../connection.js
	cat $^ >$@

connection-flash.js: ../../../connection.js
	cat json2.js es5-shim.js flash/swfobject.js flash/shim.js flash/web_socket.js $^ >$@

.PHONY: all
