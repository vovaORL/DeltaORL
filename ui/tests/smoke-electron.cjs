const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const profile = path.join(root, 'build/electron-test-profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
let timeout;
app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, width: 1520, height: 940, webPreferences: {
    preload: path.join(__dirname, 'smoke-preload.cjs'), contextIsolation: false, nodeIntegration: false, sandbox: false
  } });
  timeout = setTimeout(() => { console.error('FAIL: UI smoke timed out'); app.exit(1); }, 20000);
  win.webContents.on('console-message', (_event, level, message) => {
    if (level === 3 && !message.includes('fonts.googleapis') && !message.includes('fonts.gstatic')) errors.push(message);
  });
  win.webContents.on('render-process-gone', (_event, details) => { console.error(details); app.exit(1); });
  try {
    await win.loadFile(path.join(root, 'ui/dist/index.html'));
    let state;
    for (let i = 0; i < 100; i++) {
      state = await win.webContents.executeJavaScript(`({ text: document.body.innerText, canvas: !!document.querySelector('canvas'), width: document.querySelector('canvas')?.width })`);
      if (state.text.includes('ONLINE') && /[1-9][0-9]*$/.test(state.text.match(/СВІЧОК:\s*(\d+)/)?.[1] || '')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!state.canvas || state.width < 100 || !state.text.includes('ONLINE')) throw new Error('Canvas/connection missing');
    if (!/[1-9]/.test(state.text.match(/СВІЧОК:\s*(\d+)/)?.[1] || '')) throw new Error('History did not reach the UI');
    await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('RSI'))?.click()`);
    await new Promise(resolve => setTimeout(resolve, 200));
    await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('НАЛАШТУВАННЯ'))?.click()`);
    const modal = await win.webContents.executeJavaScript(`!!document.querySelector('.modal-content')`);
    if (!modal) throw new Error('Settings did not open');
    if (errors.length) throw new Error(errors.join('\n'));
    fs.writeFileSync(path.join(root, 'build/ui-smoke.png'), (await win.webContents.capturePage()).toPNG());
    console.log('PASS: Electron renderer, Canvas, history, WebSocket, RSI toggle, settings');
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
});
