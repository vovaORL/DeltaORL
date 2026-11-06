const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'build/candle-audit');
app.setPath('userData', path.join(out, 'renderer-profile'));
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

const inspect = `(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return null;
  const root = document.getElementById('root');
  const containerFiber = root[Object.keys(root).find(k => k.startsWith('__reactContainer$'))];
  const find = f => {
    if (!f) return null;
    if (Array.isArray(f.memoizedProps?.candles)) return f;
    return find(f.child) || find(f.sibling);
  };
  let fiber = find(containerFiber?.stateNode?.current);
  if (!fiber) return { error: 'Chart fiber not found' };
  const p = fiber.memoizedProps;
  let hook = fiber.memoizedState, viewport;
  while (hook) {
    const value = hook.memoizedState?.current;
    if (value && 'candleWidth' in value && 'centerPrice' in value) viewport = { ...value };
    hook = hook.next;
  }
  const rect = element => { const r = element.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; };
  return { symbol:p.symbol,timeframe:p.timeframe,tickSize:p.tickSize,candles:p.candles,
    theme:p.chartTheme,viewport,indicatorHeights:p.indicatorHeights,
    showVerticalVolume:p.showVerticalVolume,showCVD:p.showCVD,showRSI:p.showRSI,showStochastic:p.showStochastic,
    showHorizontalProfile:p.showHorizontalProfile,canvas:rect(canvas),container:rect(canvas.parentElement),
    innerWidth,innerHeight,devicePixelRatio,bodyText:document.body.innerText,calls:window.__auditCalls };
})()`;

app.whenReady().then(async () => {
  setTimeout(()=>app.exit(2),45000);
  const win = new BrowserWindow({ show:false,width:1550,height:950,webPreferences:{
    preload:path.join(__dirname,'audit_ui_preload.cjs'),contextIsolation:false,nodeIntegration:false,sandbox:false,backgroundThrottling:false
  }});
  try {
    await win.loadFile(path.join(root,'ui/dist/index.html'));
    for (const [label, seconds] of [['ui_m15',900],['ui_m1',60],['ui_m15_again',900]]) {
      // Same public transport command as the UI, without changing saved preferences.
      await win.webContents.executeJavaScript(`new Promise((resolve,reject) => {
        const timer=setTimeout(()=>reject(new Error('Snapshot timeout')),10000);
        const ws = new WebSocket('ws://127.0.0.1:9191');
        ws.onopen = () => ws.send(JSON.stringify({action:'set_timeframe',timeframe:${seconds}}));
        ws.onmessage = e => { const m=JSON.parse(e.data);if(m.type==='snapshot'&&m.timeframe===${seconds}){clearTimeout(timer);ws.close();resolve(true);} };
      })`);
      let state;
      for (let i=0;i<100;i++) {
        await new Promise(resolve=>setTimeout(resolve,100));
        state = await win.webContents.executeJavaScript(inspect);
        if (state?.timeframe===seconds && state?.candles?.length) break;
      }
      if (!state?.candles?.length) throw new Error('No renderer candle data');
      await new Promise(resolve=>setTimeout(resolve,1200));
      state = await win.webContents.executeJavaScript(inspect);
      fs.writeFileSync(path.join(out,label+'.json'),JSON.stringify(state,null,2));
      fs.writeFileSync(path.join(out,label+'.png'),(await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({label,timeframe:state.timeframe,candles:state.candles.length,canvas:state.canvas,
        innerWidth:state.innerWidth,innerHeight:state.innerHeight,theme:state.theme.candleColorMode,calls:state.calls.length}));
    }
    app.exit(0);
  } catch(error) { console.error(error); app.exit(1); }
});
