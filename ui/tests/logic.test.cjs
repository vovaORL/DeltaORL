const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, extra = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const code = ts.transpileModule(source, { fileName: relative, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require, console, ...extra });
  return exports;
}
const { mergeCandles } = load('src/services/candles.ts');
const { computeIndicators } = load('src/chart/indicators.ts');
const { applySharedVolumeColors, getDeltaCellColor, getProfileColors } = load('src/chart/deltaCell.ts');

test('profile colors remain visible on dark backgrounds without changing cluster palettes', () => {
  const { defaultChartTheme } = load('src/types/index.ts');
  const luminance = color => {
    const channels = color.slice(1).match(/../g).map(value => parseInt(value, 16));
    return channels[0] * 0.299 + channels[1] * 0.587 + channels[2] * 0.114;
  };
  for (const palette of ['MONOCHROME', 'STEEL_BLUE']) {
    const theme = applySharedVolumeColors({ ...defaultChartTheme, volumeHistogramPalette: palette });
    const before = JSON.stringify(theme);
    const colors = getProfileColors(theme);
    if (palette === 'MONOCHROME') {
      assert.equal(colors.buyer, theme.clusterBuyerColor);
      assert.equal(colors.seller, theme.clusterSellerColor);
    } else {
      assert.ok(luminance(colors.seller) > 60);
      assert.ok(luminance(colors.buyer) < 160);
      assert.ok(luminance(colors.buyer) - luminance(colors.seller) > 45);
    }
    assert.equal(JSON.stringify(theme), before);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(getProfileColors({ ...defaultChartTheme, volumeHistogramPalette: 'DELTA' }))), { buyer: '#228B68', seller: '#A62639' });
});

test('custom buyer and seller colors apply to every volume and cluster mode', () => {
  const { defaultChartTheme } = load('src/types/index.ts');
  const theme = applySharedVolumeColors({ ...defaultChartTheme, volumeHistogramPalette: 'DELTA' }, '#FFFFFF', '#181C26');
  for (const key of ['volumeDeltaBuyerColor', 'clusterBuyerColor', 'buyImbalanceColor', 'horizontalBuyerColor', 'verticalBuyerColor']) {
    assert.equal(theme[key], '#FFFFFF');
  }
  for (const key of ['volumeDeltaSellerColor', 'clusterSellerColor', 'sellImbalanceColor', 'horizontalSellerColor', 'verticalSellerColor']) {
    assert.equal(theme[key], '#181C26');
  }
  assert.equal(theme.bullishCandleColor, defaultChartTheme.bullishCandleColor);
  assert.equal(theme.bearishCandleColor, defaultChartTheme.bearishCandleColor);
});

test('switching palette restores monochrome everywhere and retains custom colors', () => {
  const { defaultChartTheme } = load('src/types/index.ts');
  const custom = applySharedVolumeColors({ ...defaultChartTheme, volumeHistogramPalette: 'DELTA' }, '#abcdef', '#123456');
  const gray = applySharedVolumeColors({ ...custom, volumeHistogramPalette: 'MONOCHROME' });
  for (const key of ['clusterBuyerColor', 'buyImbalanceColor', 'horizontalBuyerColor', 'verticalBuyerColor']) assert.equal(gray[key], '#FFFFFF');
  for (const key of ['clusterSellerColor', 'sellImbalanceColor', 'horizontalSellerColor', 'verticalSellerColor']) assert.equal(gray[key], '#181C26');
  assert.equal(gray.bullishCandleColor, defaultChartTheme.bullishCandleColor);
  assert.equal(gray.bearishCandleColor, defaultChartTheme.bearishCandleColor);
  const restored = applySharedVolumeColors({ ...gray, volumeHistogramPalette: 'DELTA' });
  assert.equal(restored.clusterBuyerColor, '#abcdef');
  assert.equal(restored.clusterSellerColor, '#123456');
});

test('delta cell colors depend only on sign and preserve the configured palette', () => {
  const theme = { volumeDeltaBuyerColor: '#228B68', volumeDeltaSellerColor: '#A62639' };
  for (const delta of [0.01, 1, 2, 5, 100]) {
    assert.equal(getDeltaCellColor(delta, theme), theme.volumeDeltaBuyerColor);
    assert.equal(getDeltaCellColor(-delta, theme), theme.volumeDeltaSellerColor);
  }
  assert.equal(getDeltaCellColor(0, theme), null);
  assert.equal(getDeltaCellColor(-0, theme), null);
  assert.equal(getDeltaCellColor(1, { ...theme, volumeDeltaBuyerColor: '#abcdef' }), '#abcdef');
  assert.equal(getDeltaCellColor(-1, { ...theme, volumeDeltaSellerColor: '#123456' }), '#123456');
  assert.equal(getDeltaCellColor(1, {}), '#228B68');
  assert.equal(getDeltaCellColor(-1, {}), '#A62639');
});

for (const palette of ['DELTA', 'MONOCHROME', 'STEEL_BLUE', 'BLACK'])
for (const mode of ['BID_ASK', 'DELTA', 'VOLUME', 'VOLUME_SMALL', 'PROFILES', 'BORDER', 'BORDER_THICK']) test(`${mode} renderer uses ${palette} palette and keeps cells aligned`, () => {
  const { defaultChartTheme, defaultIndicatorHeights } = load('src/types/index.ts');
  const fills = [], texts = [], outlines = [], callbacks = [], contextStack = [];
  const ctx = new Proxy({
    globalAlpha: 1,
    save() { contextStack.push({ globalAlpha: this.globalAlpha }); },
    restore() { Object.assign(this, contextStack.pop()); },
    fillRect(...args) { fills.push({ color: this.fillStyle, alpha: this.globalAlpha, args }); },
    fillText(text, ...args) { texts.push({ text, color: this.fillStyle, alpha: this.globalAlpha, args }); },
    strokeRect(...args) { outlines.push(Object.assign(args, { color: this.strokeStyle, lineWidth: this.lineWidth, alpha: this.globalAlpha })); },
    measureText(text) { return { width: text.length * 6 }; }
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const rect = { width: 1200, height: 650 };
  const container = { getBoundingClientRect: () => rect };
  const canvas = { width: 1200, height: 650, style: {}, getContext: () => ctx };
  let refIndex = 0;
  const react = {
    useRef(value) { return { current: refIndex++ === 0 ? container : refIndex === 2 ? canvas : value }; },
    useState: value => [value, () => {}],
    useEffect() {},
    useCallback(fn) { callbacks.push(fn); return fn; },
    createElement() { return null; }
  };
  const { FootprintChart } = load('src/chart/FootprintChart.tsx', {
    window: { devicePixelRatio: 1 },
    require(id) {
      if (id === 'react') return { ...react, default: react };
      if (id === './indicators') return { computeIndicators };
      if (id === './deltaCell') return { applySharedVolumeColors, getDeltaCellColor, getProfileColors };
      if (id === '../types') return { defaultIndicatorHeights };
      return require(id);
    }
  });
  const deltas = [1, 2, 5, 100, -1, -2, -5, -100, 0];
  const candle = {
    time: 1700000000, o: 0, c: 0, h: 0.001, l: -0.001,
    v: 100000, d: 0, cvd: 0, poc: 0.0008, val: 0, vah: 0,
    clusters: deltas.map((delta, index) => [index * 0.0001, 10000, 10000 + delta, 0, 0, 0, 0])
  };
  if (mode === 'VOLUME_SMALL') {
    candle.clusters[0][1] = 0;
    candle.clusters[0][2] = 1;
    candle.clusters[4][1] = 1;
    candle.clusters[4][2] = 0;
  }
  const before = JSON.stringify(candle);
  FootprintChart({
    candles: [candle], tickSize: 0.0001, symbol: 'TEST', timeframe: 60,
    displayMode: ['VOLUME_SMALL', 'PROFILES', 'BORDER', 'BORDER_THICK'].includes(mode) ? 'VOLUME' : mode, showCVD: false, showRSI: false, showStochastic: false,
    showValueArea: false, showHorizontalProfile: mode === 'PROFILES', showVerticalVolume: mode === 'PROFILES',
    chartTheme: { ...defaultChartTheme, volumeHistogramPalette: palette, clusterBarOpacity: 0.3, showClusterValueArea: false,
      showClusterBorders: mode.startsWith('BORDER'), clusterBorderColor: '#abcdef', clusterBorderWidth: mode === 'BORDER_THICK' ? 3 : 1 }
  });
  // The third callback renders the canvas, including auto-scroll positioning.
  for (let frame = 0; frame < 15; frame++) callbacks[2]();
  fills.length = texts.length = outlines.length = 0;
  callbacks[2]();
  const customBorders = outlines.filter(outline => outline.color === '#abcdef');
  if (mode.startsWith('BORDER')) {
    assert.equal(customBorders.length, 8);
    assert.ok(customBorders.every(outline => outline.lineWidth === (mode === 'BORDER_THICK' ? 3 : 1) && outline.alpha === 1));
    assert.ok(customBorders.every(outline => outline[2] > 0 && outline[3] > 0));
    assert.equal(JSON.stringify(candle), before);
    return;
  }
  assert.equal(customBorders.length, 0);
  if (mode === 'PROFILES') {
    const colors = getProfileColors({ ...defaultChartTheme, volumeHistogramPalette: palette });
    for (const color of [colors.buyer, colors.seller]) {
      assert.ok(fills.some(fill => fill.color === color && fill.args[0] < 100 && fill.args[2] > 0));
      assert.ok(fills.some(fill => fill.color === color && fill.args[1] >= 562 && fill.args[3] > 0));
    }
    assert.ok(!fills.some(fill => ['#7F1D1D', '#065F46'].includes(fill.color)));
    assert.equal(JSON.stringify(candle), before);
    return;
  }
  const cells = fills.filter(fill => ['#228B68', '#A62639'].includes(fill.color));
  const activeTheme = applySharedVolumeColors({ ...defaultChartTheme, volumeHistogramPalette: palette });
  if (mode === 'BID_ASK') {
    const bids = fills.filter(fill => fill.color === activeTheme.clusterSellerColor && fill.args[3] === 12);
    const asks = fills.filter(fill => fill.color === activeTheme.clusterBuyerColor && fill.args[3] === 12);
    assert.equal(bids.length, 9);
    assert.equal(asks.length, 9);
    const body = fills.find(fill => fill.args[2] === 8 && fill.args[3] === 2);
    assert.ok(body);
    assert.ok(bids.every(fill => fill.args[0] + fill.args[2] <= body.args[0] - 5));
    assert.ok(asks.every(fill => fill.args[0] >= body.args[0] + body.args[2] + 5));
    assert.ok(texts.some(entry => entry.text === '10001'));
    assert.equal(JSON.stringify(candle), before);
    return;
  }
  if (mode === 'DELTA') {
    assert.equal(cells.length, palette === 'DELTA' ? 9 : 0);
    const deltaBars = fills.filter(fill => fill.args[0] > 1000 && fill.args[2] === 2);
    assert.equal(deltaBars.length, 9); // Original narrow bars, including zero at POC.
    assert.equal(deltaBars.filter(fill => fill.color === activeTheme.clusterBuyerColor).length, 5);
    assert.equal(deltaBars.filter(fill => fill.color === activeTheme.clusterSellerColor).length, 4);
    assert.ok(texts.some(entry => entry.text === '+1'));
    assert.ok(texts.some(entry => entry.text === '-100'));
    assert.ok(texts.some(entry => entry.text === '0'));
    assert.ok(outlines.some(args => args[2] === 68));
    assert.equal(JSON.stringify(candle), before);
    return;
  }
  if (palette !== 'DELTA') {
    assert.equal(cells.length, 0);
    assert.ok(texts.some(entry => entry.text === '20100' && entry.alpha === 1));
    assert.equal(JSON.stringify(candle), before);
    return;
  }
  assert.equal(cells.length, 8);
  assert.equal(cells.filter(fill => fill.color === '#228B68').length, 4);
  assert.equal(cells.filter(fill => fill.color === '#A62639').length, 4);
  assert.ok(cells.every((fill, index) => fill.args[2] === Math.max(2, Math.round((candle.clusters[index][1] + candle.clusters[index][2]) / 20100 * 64))));
  assert.ok(cells.every(fill => fill.alpha !== 0));
  for (const level of candle.clusters.slice(0, 8)) {
    const text = String(level[1] + level[2]);
    assert.ok(texts.some(entry => entry.text === text && entry.alpha === 1 && entry.color === '#FFFFFF' && entry.args[2] === 56));
  }
  assert.ok(!texts.some(entry => entry.text === '0'));
  assert.ok(!outlines.some(args => args[2] === 68)); // No cell-wide zero-delta POC outline.
  assert.equal(JSON.stringify(candle), before);
});

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
