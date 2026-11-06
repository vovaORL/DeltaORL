"""Read-only MT5/DeltaORL capture. No orders, symbol switches or timeframe changes."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import socket
import sys
import time

sys.dont_write_bytecode = True
import MetaTrader5 as mt5

ROOT = Path(__file__).resolve().parents[1]


def rows(values):
    if values is None:
        raise RuntimeError(f"MT5 data request failed: {mt5.last_error()}")
    return [{key: row[key].item() for key in values.dtype.names} for row in values]


def moment(ms):
    # Encode the raw API epoch for requests; do not apply a guessed broker offset.
    return datetime.fromtimestamp(ms / 1000, timezone.utc)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--terminal', required=True)
    parser.add_argument('--server', required=True)
    parser.add_argument('--symbol', required=True)
    parser.add_argument('--seconds', type=int, default=300, choices=range(300, 601))
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    output = args.output or ROOT / 'build' / 'live-audit' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    output.mkdir(parents=True, exist_ok=True)

    def save(name, value):
        (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

    if not mt5.initialize(path=args.terminal, timeout=10000):
        raise RuntimeError(f"MT5 initialize failed: {mt5.last_error()}")
    ws = None
    report = {'symbol': args.symbol, 'checked_at_utc': datetime.now(timezone.utc).isoformat()}
    try:
        terminal, account = mt5.terminal_info(), mt5.account_info()
        if not terminal or not terminal.connected or not account or account.server != args.server:
            raise RuntimeError('Connected terminal/server does not match the requested source')
        info, latest = mt5.symbol_info(args.symbol), mt5.symbol_info_tick(args.symbol)
        if info is None or latest is None:
            raise RuntimeError('Exact symbol or its latest tick is unavailable')
        report.update(server=account.server, company=account.company, terminal_path=terminal.path,
                      terminal_build=terminal.build, chart_mode=info.chart_mode, digits=info.digits,
                      point=info.point, trade_tick_size=info.trade_tick_size, latest_tick=latest._asdict())
        now_ms = int(time.time() * 1000)
        report['tick_clock_minus_utc_seconds'] = (latest.time_msc - now_ms) / 1000
        for name, end_ms in [('system_window', now_ms), ('tick_window', latest.time_msc)]:
            ticks = rows(mt5.copy_ticks_range(args.symbol, moment(end_ms - 600000), moment(end_ms), mt5.COPY_TICKS_ALL))
            rates = rows(mt5.copy_rates_range(args.symbol, mt5.TIMEFRAME_M1, moment(end_ms - 600000), moment(end_ms)))
            closed = [r for r in rates if (r['time'] + 60) * 1000 <= end_ms]
            save(name + '.json', {'requested_start_msc': end_ms - 600000, 'requested_end_msc': end_ms,
                                 'ticks': ticks, 'closed_m1': closed})
            counts = Counter(t['time_msc'] for t in ticks)
            report[name] = {'tick_count': len(ticks), 'first_tick': ticks[0] if ticks else None,
                            'last_tick': ticks[-1] if ticks else None, 'closed_m1': closed,
                            'milliseconds_with_multiple_ticks': sum(n > 1 for n in counts.values())}

        # Reuse only the existing wire reader; importing this module runs no tests or engine.
        spec = importlib.util.spec_from_file_location('audit_ws', ROOT / 'engine/tests/test_integration.py')
        wire = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(wire)
        try:
            ws = wire.WS(9191)
        except OSError as error:
            report['delta_status'] = f'WebSocket unavailable: {type(error).__name__}: {error}'
            save('report.json', report)
            print(json.dumps({'output': str(output), **report}, ensure_ascii=False, indent=2))
            return 2

        live_ticks, candles = [], {}
        snapshot = None
        broker_seen = False
        deadline = time.monotonic() + args.seconds
        with (output / 'delta_messages.jsonl').open('w', encoding='utf-8') as stream:
            while time.monotonic() < deadline:
                ws.sock.settimeout(min(2, max(.01, deadline - time.monotonic())))
                try:
                    opcode, payload = ws.read()
                except socket.timeout:
                    continue
                if opcode != 1:
                    if opcode == 8:
                        raise ConnectionError('DeltaORL closed the WebSocket')
                    continue
                message = json.loads(payload)
                stream.write(json.dumps({'received_at_utc': datetime.now(timezone.utc).isoformat(),
                                         'message': message}, ensure_ascii=False) + '\n')
                kind = message.get('type')
                if kind == 'snapshot':
                    if message['symbol'] != args.symbol:
                        raise RuntimeError('DeltaORL symbol differs; capture stopped without switching it')
                    snapshot = message
                    candles = {c['time']: c for c in message['candles']}
                elif kind == 'candle_update' and message.get('symbol') == args.symbol:
                    for candle in message.get('candles', [message.get('candle')]):
                        if candle:
                            candles[candle['time']] = candle
                elif kind == 'tick' and message.get('sym') == args.symbol:
                    live_ticks.append(message)
                elif kind == 'stats':
                    if message.get('mt5_connected'):
                        broker_seen = True
                    elif broker_seen:
                        raise RuntimeError('DeltaORL lost broker data during capture')

        report['delta_status'] = 'captured'
        report['delta_live_tick_count'] = len(live_ticks)
        if live_ticks:
            first_ms, last_ms = min(t['t'] for t in live_ticks), max(t['t'] for t in live_ticks)
            ticks = rows(mt5.copy_ticks_range(args.symbol, moment(first_ms - 1000), moment(last_ms + 1000), mt5.COPY_TICKS_ALL))
            save('matched_interval_mt5_ticks.json', ticks)
            # Compare complete seconds inside the capture to avoid partial timestamp groups at its ends.
            lower, upper = (first_ms // 1000 + 1) * 1000, last_ms // 1000 * 1000
            expected = Counter((t['time_msc'], format(t['last'] if info.chart_mode == 1 else t['bid'], '.12g'))
                               for t in ticks if lower <= t['time_msc'] < upper)
            actual = Counter((t['t'], format(t['p'], '.12g')) for t in live_ticks if lower <= t['t'] < upper)
            report['tick_comparison'] = {'start_msc': lower, 'end_msc_exclusive': upper,
                                         'missing': sum((expected - actual).values()),
                                         'extra': sum((actual - expected).values()),
                                         'note': 'Multiplicity retained; raw Bid/Ask/Last/flags are in the MT5 file. Delta wire exposes only selected price.'}
            rates = rows(mt5.copy_rates_range(args.symbol, mt5.TIMEFRAME_M1, moment(lower), moment(upper)))
            comparisons = []
            if snapshot and snapshot['timeframe'] == 60:
                for rate in rates:
                    if rate['time'] * 1000 < lower or (rate['time'] + 60) * 1000 > upper:
                        continue
                    candle = candles.get(rate['time'])
                    differences = None if candle is None else {key: candle[short] - rate[key] for key, short in
                                                               [('open', 'o'), ('high', 'h'), ('low', 'l'), ('close', 'c')]}
                    comparisons.append({'time': rate['time'], 'mt5': rate, 'delta': candle, 'differences': differences})
            report['m1_comparison'] = comparisons
            report['delta_timeframe'] = snapshot['timeframe'] if snapshot else None
        save('report.json', report)
        print(json.dumps({'output': str(output), 'delta_status': report['delta_status'],
                          'tick_comparison': report.get('tick_comparison'),
                          'm1_comparison': report.get('m1_comparison')}, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        report['capture_error'] = f'{type(error).__name__}: {error}'
        save('report.json', report)
        raise
    finally:
        if ws is not None:
            ws.close()
        mt5.shutdown()


if __name__ == '__main__':
    raise SystemExit(main())
