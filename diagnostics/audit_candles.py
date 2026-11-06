"""Compare closed broker bars with the running engine; restore its timeframe."""
import csv
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
import MetaTrader5 as mt5

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'build' / 'candle-audit'


def wire_module():
    spec = importlib.util.spec_from_file_location('audit_wire', ROOT / 'engine/tests/test_integration.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def save(name, value):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def compare(label, expected, snapshot, point=.00001):
    by_time = {c['time']: c for c in snapshot['candles']}
    expected_times = {r['time'] for r in expected}
    rows = []
    for rate in expected:
        candle = by_time.get(rate['time'])
        differences = None if candle is None else {
            key: round((candle[short] - rate[key]) / point, 8)
            for key, short in [('open', 'o'), ('high', 'h'), ('low', 'l'), ('close', 'c')]}
        rows.append({'scenario': label, 'symbol': 'EURUSD', 'time': rate['time'],
                     'raw_time_label': datetime.fromtimestamp(rate['time'], timezone.utc).isoformat(),
                     'mt5': rate, 'delta': None if candle is None else
                     {k: candle[k] for k in ('time', 'o', 'h', 'l', 'c', 'v')},
                     'difference_points': differences,
                     'matches': differences is not None and all(abs(v) < .001 for v in differences.values())})
    lo, hi = expected[0]['time'], expected[-1]['time']
    extra = [c['time'] for c in snapshot['candles'] if lo <= c['time'] <= hi and c['time'] not in expected_times]
    summary = {'scenario': label, 'expected': len(expected), 'matches': sum(r['matches'] for r in rows),
               'missing': sum(r['delta'] is None for r in rows), 'extra': extra,
               'duplicate_times': len(snapshot['candles']) - len(by_time),
               'first_mismatch': next((r for r in rows if not r['matches']), None),
               'engine_candle_count': len(snapshot['candles']),
               'engine_first_time': snapshot['candles'][0]['time'] if snapshot['candles'] else None}
    save(label + '.json', {'summary': summary, 'rows': rows, 'snapshot': snapshot})
    with (OUT / (label + '.csv')).open('w', newline='', encoding='utf-8-sig') as stream:
        fields = ['scenario', 'symbol', 'time', 'raw_time_label', 'matches']
        fields += [prefix + key for prefix in ('mt5_', 'delta_', 'difference_points_') for key in ('open', 'high', 'low', 'close')]
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for r in rows:
            row = {k: r[k] for k in fields[:5]}
            for key, short in [('open', 'o'), ('high', 'h'), ('low', 'l'), ('close', 'c')]:
                row['mt5_' + key] = r['mt5'][key]
                row['delta_' + key] = r['delta'][short] if r['delta'] else None
                row['difference_points_' + key] = r['difference_points'][key] if r['difference_points'] else None
            writer.writerow(row)
    return summary


def main():
    if not mt5.initialize(path=r'C:\Program Files\MetaTrader 5\terminal64.exe'):
        raise RuntimeError(mt5.last_error())
    ws = None
    original_tf = None
    try:
        account = mt5.account_info()
        if not account or account.server != 'FivePercentOnline-Real':
            raise RuntimeError('Unexpected broker source')
        latest = mt5.symbol_info_tick('EURUSD')
        end = datetime.fromtimestamp(latest.time_msc // 1000 + 1, timezone.utc)
        expected = {}
        for seconds, timeframe, count in ((60, mt5.TIMEFRAME_M1, 100), (900, mt5.TIMEFRAME_M15, 50)):
            rates = mt5.copy_rates_range('EURUSD', timeframe, end - timedelta(days=7), end)
            if rates is None:
                raise RuntimeError(mt5.last_error())
            expected[seconds] = [{k: r[k].item() for k in r.dtype.names} for r in rates
                                 if (int(r['time']) + seconds) * 1000 <= latest.time_msc][-count:]
            if len(expected[seconds]) != count:
                raise RuntimeError('Insufficient broker bars')
        save('reference.json', {'captured_at_utc': datetime.now(timezone.utc).isoformat(),
                                'server': account.server, 'symbol': 'EURUSD', 'latest_tick': latest._asdict(),
                                'rates': expected})
        ws = wire_module().WS(9191)
        initial = ws.until(lambda d: d.get('type') == 'snapshot')
        if initial['symbol'] != 'EURUSD':
            raise RuntimeError('Running engine has a different symbol')
        original_tf = initial['timeframe']
        summaries = []
        if original_tf in expected:
            summaries.append(compare('running_initial_' + str(original_tf), expected[original_tf], initial))
        for label, seconds in [('running_m1', 60), ('running_m1_to_m15', 900),
                               ('running_m15_to_m1', 60), ('running_m15_again', 900)]:
            ws.send({'action': 'set_timeframe', 'timeframe': seconds})
            snapshot = ws.until(lambda d: d.get('type') == 'snapshot' and d.get('timeframe') == seconds)
            summaries.append(compare(label, expected[seconds], snapshot))
        save('running_summary.json', summaries)
        print(json.dumps(summaries, ensure_ascii=False, indent=2))
    finally:
        if ws is not None:
            if original_tf is not None:
                ws.send({'action': 'set_timeframe', 'timeframe': original_tf})
            ws.close()
        mt5.shutdown()


if __name__ == '__main__':
    main()
