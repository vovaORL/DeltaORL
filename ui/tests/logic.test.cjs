const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, extra = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require, console, ...extra });
  return exports;
}
const { mergeCandles } = load('src/services/candles.ts');
const { computeIndicators } = load('src/chart/indicators.ts');

test('rollover merges final closed candles and bounds history', () => {
  const merged = mergeCandles([{ time: 60, v: 1 }, { time: 120, v: 2 }], [{ time: 120, v: 7 }, { time: 180, v: 3 }], 2);
  assert.deepEqual(JSON.parse(JSON.stringify(merged)), [{ time: 120, v: 7 }, { time: 180, v: 3 }]);
  assert.equal(mergeCandles([], [{ time: NaN }]).length, 0);
});

test('RSI handles up, down and flat markets without NaN', () => {
  const candles = fn => Array.from({ length: 40 }, (_, i) => ({ c: fn(i), h: fn(i) + 1, l: fn(i) - 1 }));
  assert.equal(computeIndicators(candles(i => i)).rsi[39], 100);
  assert.equal(computeIndicators(candles(i => 100 - i)).rsi[39], 0);
  const flat = computeIndicators(candles(() => 100));
  assert.equal(flat.rsi[39], 50);
  assert.equal(flat.stochK[39], 50);
  for (const values of Object.values(flat)) for (const value of values) assert.ok(value === null || Number.isFinite(value));
});

test('StrictMode remount unsubscribes callbacks and reconnects once', () => {
  const sockets = [];
  const timers = [];
  class Socket {
    static OPEN = 1;
    constructor() { this.readyState = 1; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.onclose?.(); }
  }
  const { wsService: client } = load('src/services/wsClient.ts', {
    WebSocket: Socket,
    window: { setTimeout: callback => { timers.push(callback); return timers.length; } }
  });
  let count = 0;
  const old = client.onCandleUpdate(() => count++);
  old();
  const unsubscribe = client.onCandleUpdate(() => count++);
  sockets[0].onopen();
  sockets[0].onmessage({ data: JSON.stringify({ type: 'candle_update', candle: { time: 1 } }) });
  assert.equal(count, 1);
  unsubscribe();
  sockets[0].onmessage({ data: JSON.stringify({ type: 'candle_update', candle: { time: 2 } }) });
  assert.equal(count, 1);
  sockets[0].onclose(); sockets[0].onclose();
  assert.equal(timers.length, 1);
  timers[0]();
  assert.equal(sockets.length, 2);
  sockets[1].onopen();
  assert.ok(sockets[1].sent.some(data => data.action === 'get_snapshot'));
});
