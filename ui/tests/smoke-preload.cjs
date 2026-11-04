// Test-only transport redirect; production preload and UI remain unchanged.
const OriginalWebSocket = window.WebSocket;
window.WebSocket = class extends OriginalWebSocket {
  constructor(url, protocols) {
    super(String(url).replace('127.0.0.1:9191', `127.0.0.1:${process.env.DELTAORL_TEST_WS}`), protocols);
  }
};
