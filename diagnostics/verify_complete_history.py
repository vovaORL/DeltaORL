"""Compare every retained closed candle with MT5 on an isolated staged engine."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
from datetime import datetime, timezone

import MetaTrader5 as mt5

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engine' / 'tests'))
from test_integration import WS, free_port


def main():
    spec = importlib.util.spec_from_file_location('bridge', ROOT / 'engine' / 'mt5_feeder.py')
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    bridge.mt5 = mt5
    source_port, ws_port = free_port(), free_port()
    process = subprocess.Popen(
        [str(ROOT / 'build' / 'delta_engine.exe'), '--no-feeder', '--no-demo',
         '--mt5-port', str(source_port), '--ws-port', str(ws_port)],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=0x08000000)
    ws = feeder = None
    try:
        for _ in range(100):
            try:
                ws = WS(ws_port)
                break
            except OSError:
                time.sleep(.05)
        if ws is None:
            raise RuntimeError('Isolated engine did not start')
        ws.until(lambda d: d.get('type') == 'snapshot')
        feeder = bridge.MT5DirectFeeder(engine_port=source_port, symbol='EURUSD',
                                       mt5_path=r'C:\Program Files\MetaTrader 5\terminal64.exe')
        assert feeder.connect_engine() and feeder.connect_mt5()
        assert feeder.init_symbol('EURUSD')
        ws.until(lambda d: d.get('type') == 'snapshot' and bool(d.get('candles')), seconds=60)
        periods = [(60, mt5.TIMEFRAME_M1), (120, mt5.TIMEFRAME_M2),
                   (180, mt5.TIMEFRAME_M3), (300, mt5.TIMEFRAME_M5),
                   (900, mt5.TIMEFRAME_M15), (1800, mt5.TIMEFRAME_M30),
                   (3600, mt5.TIMEFRAME_H1), (14400, mt5.TIMEFRAME_H4),
                   (86400, mt5.TIMEFRAME_D1), (900, mt5.TIMEFRAME_M15),
                   (60, mt5.TIMEFRAME_M1)]
        results = []
        originals = {}
        for seconds, period in periods:
            ws.send({'action': 'set_timeframe', 'timeframe': seconds})
            snapshot = ws.until(lambda d: d.get('type') == 'snapshot' and d['timeframe'] == seconds)
            candles = snapshot['candles']
            start = datetime.fromtimestamp(candles[0]['time'], timezone.utc)
            end = datetime.fromtimestamp(feeder.last_tick_time_msc / 1000, timezone.utc)
            rates = mt5.copy_rates_range('EURUSD', period, start, end)
            if rates is None:
                raise RuntimeError(mt5.last_error())
            expected = {int(row['time']): row for row in rates}
            differences = []
            checked = 0
            for candle in candles:
                if (candle['time'] + seconds) * 1000 > feeder.last_tick_time_msc:
                    continue
                checked += 1
                row = expected.get(candle['time'])
                if row is None or any(abs(candle[key] - float(row[field])) > 1e-10
                                      for key, field in [('o', 'open'), ('h', 'high'), ('l', 'low'), ('c', 'close')]):
                    differences.append(candle)
            stable = seconds not in originals or originals[seconds] == candles
            originals[seconds] = candles
            result = {'timeframe': seconds, 'closed_checked': checked,
                      'ohlc_mismatches': len(differences), 'stable_after_switch': stable,
                      'first_mismatch': differences[0] if differences else None}
            results.append(result)
            print(json.dumps(result), flush=True)
        report = {'broker': mt5.account_info().server, 'symbol': 'EURUSD',
                  'captured_at': datetime.now(timezone.utc).isoformat(), 'results': results}
        (ROOT / 'build' / 'complete-history-verification.json').write_text(
            json.dumps(report, indent=2), encoding='utf-8')
        assert all(r['closed_checked'] and not r['ohlc_mismatches'] and r['stable_after_switch'] for r in results)
    finally:
        if feeder:
            feeder.close()
        if ws:
            ws.close()
        process.terminate()
        process.wait(timeout=10)


if __name__ == '__main__':
    main()
