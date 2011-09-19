if (swfobject.getFlashPlayerVersion().major >= 10) {
  WebSocket = false;
  window.WEB_SOCKET_DEBUG = true;
  window.WEB_SOCKET_SWF_LOCATION = 'flash/WebSocketMain.swf';
  WebSocket.loadFlashPolicyFile('xmlsocket://localhost');
}
