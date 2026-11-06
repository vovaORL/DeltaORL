// Ensure Electron runs as desktop GUI even if ELECTRON_RUN_AS_NODE was inherited
delete process.env.ELECTRON_RUN_AS_NODE;

const electron = require('electron');
if (typeof electron === 'string' || !electron || !electron.app) {
  const { spawn } = require('child_process');
  const path = require('path');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electronExe = typeof electron === 'string' ? electron : path.join(__dirname, '../node_modules/electron/dist/electron.exe');
  const appRoot = path.join(__dirname, '..');
  const child = spawn(electronExe, [appRoot, '--disable-gpu-shader-disk-cache', '--disable-features=DawnGraphite,PersistentCache,SkiaGraphite', '--log-level=3'], {
    detached: true,
    stdio: 'ignore',
    env
  });
  child.unref();
  process.exit(0);
}

const { app, BrowserWindow, dialog } = electron;
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Disable shader disk cache conflicts to eliminate cache move access denied errors
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-features', 'DawnGraphite,PersistentCache,SkiaGraphite');
app.commandLine.appendSwitch('log-level', '3');

let mainWindow = null;
let engineProcess = null;

function portReady() {
  return new Promise(resolve => {
    const tester = new (require('net').Socket)();
    let finished = false;
    const finish = value => { if (finished) return; finished = true; tester.destroy(); resolve(value); };
    tester.setTimeout(400);
    tester.once('connect', () => finish(true));
    tester.once('error', () => finish(false));
    tester.once('timeout', () => finish(false));
    tester.connect(9191, '127.0.0.1');
  });
}

function newerSources(directory, artifact) {
  if (!fs.existsSync(artifact)) return true;
  const built = fs.statSync(artifact).mtimeMs;
  const scan = dir => fs.readdirSync(dir, { withFileTypes: true }).some(entry => {
    const item = path.join(dir, entry.name);
    return entry.isDirectory() ? scan(item) : fs.statSync(item).mtimeMs > built;
  });
  return scan(directory);
}

async function ensureBuild() {
  const root = path.resolve(__dirname, '../..');
  const engine = path.join(root, 'engine/delta_engine.exe');
  const html = path.join(root, 'ui/dist/index.html');
  let buildEngine = newerSources(path.join(root, 'engine/src'), engine) || newerSources(path.join(root, 'engine/include'), engine);
  const buildUI = newerSources(path.join(root, 'ui/src'), html) || !fs.existsSync(html);
  if (!buildEngine && !buildUI) return;
  if (buildEngine && await portReady()) throw new Error('Close the running DeltaORL engine before rebuilding the updated sources.');
  const staged = path.join(root, 'build/delta_engine.exe');
  if (buildEngine && fs.existsSync(staged) && !newerSources(path.join(root, 'engine/src'), staged) && !newerSources(path.join(root, 'engine/include'), staged)) {
    fs.copyFileSync(staged, engine);
    buildEngine = false;
  }
  if (!buildEngine && !buildUI) return;
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'build.ps1')];
  if (!buildEngine) args.push('-UiOnly');
  if (!buildUI) args.push('-EngineOnly');
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output = (output + data).slice(-12000); });
    child.stderr.on('data', data => { output = (output + data).slice(-12000); });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(output || 'Build failed.')));
  });
}

async function ensureEngineRunning() {
  if (await portReady()) return;
  const engineExe = path.join(__dirname, '../../engine/delta_engine.exe');
  if (!fs.existsSync(engineExe)) throw new Error('Missing engine/delta_engine.exe. Run build.ps1.');
  engineProcess = spawn(engineExe, [], { cwd: path.dirname(engineExe), stdio: 'ignore', windowsHide: true });
  let launchError = null;
  engineProcess.once('error', error => { launchError = error; });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (launchError) throw launchError;
    if (engineProcess.exitCode !== null) throw new Error(`Engine exited with code ${engineProcess.exitCode}. Check ports 9190 and 9191.`);
    if (await portReady()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Engine startup timed out.');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#08090C',
    darkTheme: true,
    title: 'DeltaORL — High-Speed Volume & Cluster Terminal',
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Remove the native menu entirely so Alt cannot reveal it.
  win.setMenu(null);
  mainWindow = win;
  win.maximize();

  const distPath = path.join(__dirname, '../dist/index.html');
  const devUrl = 'http://127.0.0.1:3000';

  if (process.env.NODE_ENV === 'development') {
    win.loadURL(devUrl).catch(() => {
      if (fs.existsSync(distPath)) win.loadFile(distPath);
    });
  } else if (fs.existsSync(distPath)) {
    win.loadFile(distPath);
  } else {
    win.loadURL(devUrl);
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    try { await ensureBuild(); await ensureEngineRunning(); createWindow(); }
    catch (error) { dialog.showErrorBox('DeltaORL', error.message); app.quit(); }
  });
}

app.on('before-quit', () => {
  // Only stop the engine created by this window; leave external engines alone.
  if (engineProcess && engineProcess.exitCode === null) engineProcess.kill();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

process.on('uncaughtException', (err) => {
  console.error('[Electron] Uncaught exception:', err);
});

