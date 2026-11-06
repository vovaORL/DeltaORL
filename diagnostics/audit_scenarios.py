"""Real MT5 feeder on isolated ports; no changes to the running application."""
import json
from pathlib import Path
import subprocess
import sys
import time

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parent))
from audit_candles import ROOT, OUT, wire_module, compare, save


def main():
    reference = json.loads((OUT / 'reference.json').read_text(encoding='utf-8'))['rates']
    wire = wire_module()
    summaries = []
    for scenario in ('fresh_m15', 'restarted_m15'):
        engine = feeder = ws = None
        with (OUT / (scenario + '.log')).open('w', encoding='utf-8') as log:
            try:
                source_port, ws_port = wire.free_port(), wire.free_port()
                engine = subprocess.Popen([str(ROOT / 'engine/delta_engine.exe'), '--no-feeder', '--no-demo',
                                           '--mt5-port', str(source_port), '--ws-port', str(ws_port)],
                                          cwd=ROOT / 'engine', stdout=log, stderr=log, creationflags=0x08000000)
                for _ in range(100):
                    try:
                        ws = wire.WS(ws_port)
                        break
                    except OSError:
                        time.sleep(.05)
                if ws is None:
                    raise RuntimeError('Isolated engine unavailable')
                ws.until(lambda d: d.get('type') == 'snapshot')
                ws.send({'action': 'set_timeframe', 'timeframe': 900})
                ws.until(lambda d: d.get('type') == 'snapshot' and d['timeframe'] == 900)
                feeder = subprocess.Popen([sys.executable, '-B', '-u', str(ROOT / 'engine/mt5_feeder.py'),
                                           '--port', str(source_port), '--symbol', 'EURUSD', '--path',
                                           r'C:\Program Files\MetaTrader 5\terminal64.exe'],
                                          cwd=ROOT, stdout=log, stderr=log, creationflags=0x08000000)
                snapshot = ws.until(lambda d: d.get('type') == 'snapshot' and bool(d.get('candles')), seconds=60)
                summaries.append(compare(scenario, reference['900'], snapshot))
                print(json.dumps(summaries[-1]), flush=True)
                if scenario == 'fresh_m15':
                    for label, seconds in [('fresh_m15_to_m1', 60), ('fresh_m1_to_m15', 900)]:
                        ws.send({'action': 'set_timeframe', 'timeframe': seconds})
                        snapshot = ws.until(lambda d: d.get('type') == 'snapshot' and d['timeframe'] == seconds)
                        summaries.append(compare(label, reference[str(seconds)], snapshot))
                        print(json.dumps(summaries[-1]), flush=True)
            finally:
                if ws:
                    ws.close()
                for process in (feeder, engine):
                    if process is not None and process.poll() is None:
                        process.terminate()
                        process.wait(timeout=10)
    save('scenario_summary.json', summaries)


if __name__ == '__main__':
    main()
