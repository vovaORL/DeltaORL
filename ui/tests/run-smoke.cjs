const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
function port() {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => { const number = server.address().port; server.close(() => resolve(number)); });
  });
}
(async () => {
  const ws = await port(), mt5 = await port();
  const engine = spawn(path.join(root, 'build', process.platform === 'win32' ? 'delta_engine.exe' : 'delta_engine'), ['--no-feeder', '--ws-port', String(ws), '--mt5-port', String(mt5)], { cwd: root, windowsHide: true, stdio: 'ignore' });
  engine.on('error', error => { console.error(error); process.exitCode = 1; });
  try {
    const renderer = spawn(require('electron'), [path.join(__dirname, 'smoke-electron.cjs')], {
      cwd: root, windowsHide: true, stdio: 'inherit', env: { ...env, DELTAORL_TEST_WS: String(ws) }
    });
    const code = await new Promise((resolve, reject) => { renderer.once('exit', resolve); renderer.once('error', reject); });
    process.exitCode = code === 0 ? 0 : 1;
  } finally { engine.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
