all: connection-flash.js

connection-flash.js: connection.js
	cat flash/swfobject.js flash/shim.js flash/web_socket.js connection.js >$@

.PHONY: all
