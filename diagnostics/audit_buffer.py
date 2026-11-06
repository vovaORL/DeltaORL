"""Replay unmodified historical MT5 ticks to inspect the 300000-tick boundary."""
import hashlib
import json
from pathlib import Path
import importlib.util
import socket
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).parent))
from audit_candles import ROOT, OUT, wire_module, save
import MetaTrader5 as mt5
import numpy as np


def main():
    if not mt5.initialize(path=r'C:\Program Files\MetaTrader 5\terminal64.exe'):
        raise RuntimeError(mt5.last_error())
    engine = ws = source = None
    try:
        if mt5.account_info().server != 'FivePercentOnline-Real':
            raise RuntimeError('Unexpected source')
        latest = mt5.symbol_info_tick('EURUSD')
        end = datetime.fromtimestamp(latest.time_msc // 1000 + 1, timezone.utc)
        ticks = mt5.copy_ticks_range('EURUSD', end - timedelta(days=5), end, mt5.COPY_TICKS_ALL)
        if ticks is None or len(ticks) < 300002:
            save('buffer_limit.json', {'status': 'insufficient_real_ticks', 'count': None if ticks is None else len(ticks)})
            return
        # Choose real neighboring prices which make eviction observable in Open.
        start = next(i for i in range(max(0, len(ticks) - 310000), len(ticks) - 300000)
                     if ticks[i]['bid'] != ticks[i+1]['bid'] and
                     ticks[i]['time_msc'] // 900000 == ticks[i+1]['time_msc'] // 900000)
        sample = ticks[start:start+300001].copy()
        np.savez_compressed(OUT / 'buffer_real_ticks.npz', ticks=sample)
        spec = importlib.util.spec_from_file_location('audit_feeder', ROOT / 'engine/mt5_feeder.py')
        bridge = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bridge)
        wire = wire_module()
        source_port, ws_port = wire.free_port(), wire.free_port()
        engine = subprocess.Popen([str(ROOT / 'engine/delta_engine.exe'), '--no-feeder', '--no-demo',
                                   '--mt5-port', str(source_port), '--ws-port', str(ws_port)],
                                  cwd=ROOT / 'engine', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  creationflags=0x08000000)
        for _ in range(100):
            try:
                ws = wire.WS(ws_port)
                break
            except OSError:
                time.sleep(.05)
        ws.until(lambda d: d.get('type') == 'snapshot')
        ws.send({'action': 'set_timeframe', 'timeframe': 900})
        ws.until(lambda d: d.get('type') == 'snapshot' and d['timeframe'] == 900)
        source = socket.create_connection(('127.0.0.1', source_port), timeout=30)
        feeder = bridge.MT5DirectFeeder(symbol='EURUSD')
        feeder.send_line = lambda line: source.sendall(line.encode('utf-8'))
        feeder.send_line('HELLO;EURUSD;0.0001;5\n')
        feeder.emit_ticks(sample[:300000], replay=True)
        feeder.send_line('READY\n')
        before = ws.until(lambda d: d.get('type') == 'snapshot' and bool(d.get('candles')), seconds=60)
        feeder.emit_ticks(sample[300000:])
        # A snapshot request is on another TCP socket. Wait until the last tick arrives.
        last_bucket = int(sample[-1]['time_msc']) // 900000 * 900
        ws.until(lambda d: d.get('type') == 'candle_update' and d['candle']['time'] == last_bucket, seconds=30)
        ws.send({'action': 'set_timeframe', 'timeframe': 60})
        ws.until(lambda d: d.get('type') == 'snapshot' and d['timeframe'] == 60)
        ws.send({'action': 'set_timeframe', 'timeframe': 900})
        after = ws.until(lambda d: d.get('type') == 'snapshot' and d['timeframe'] == 900)
        first_time = before['candles'][0]['time']
        after_first = next((c for c in after['candles'] if c['time'] == first_time), None)
        def compact(c):
            return None if c is None else {k: c[k] for k in ('time', 'o', 'h', 'l', 'c', 'v')}
        result = {'mode': 'historical_real_tick_replay_not_current_live_session',
                  'server': 'FivePercentOnline-Real', 'symbol': 'EURUSD', 'ticks': len(sample),
                  'sha256': hashlib.sha256(sample.tobytes()).hexdigest(),
                  'first_two_source_ticks': [{k: t[k].item() for k in sample.dtype.names} for t in sample[:2]],
                  'before': compact(before['candles'][0]), 'after': compact(after_first)}
        save('buffer_limit.json', result)
        print(json.dumps(result, indent=2))
    finally:
        if source:
            source.close()
        if ws:
            ws.close()
        if engine is not None and engine.poll() is None:
            engine.terminate()
            engine.wait(timeout=10)
        mt5.shutdown()


if __name__ == '__main__':
    main()
