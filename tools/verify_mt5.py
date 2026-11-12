#!/usr/bin/env python3
"""Offline verification of MT5 audit, independent reference exports, wire and engine snapshots."""
import argparse
import csv
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import re

RAW_FIELDS = ('time_msc', 'bid', 'ask', 'last', 'raw_volume', 'volume_real', 'flags')


def read_csv(path):
    with Path(path).open(encoding='utf-8-sig', newline='') as stream:
        return list(csv.DictReader(stream))


def number(value):
    result = Decimal(str(value))
    if not result.is_finite():
        raise ValueError('Non-finite numeric field: ' + str(value))
    return result


def same_number(left, right):
    # Invalid records must also be checked without treating NaN as a new boundary record.
    a, b = Decimal(str(left)), Decimal(str(right))
    return a == b if not (a.is_nan() or b.is_nan()) else a.is_nan() and b.is_nan()


def parameters(detail):
    return dict(part.split('=', 1) for part in detail.split(';') if '=' in part)


def verify(audit, events, reference, rates, requests, metadata, wire=None, snapshots=()):
    problems, excluded, differences = [], [], []
    sessions = {row['session'] for row in audit}
    if len(sessions) != 1 or not audit:
        raise ValueError('Use one nonempty audit session per verification')
    session = next(iter(sessions))
    if any(row['session'] == session and row['event'] == 'session_failed' for row in events):
        problems.append('Selected session failed; incomplete delivery/coverage must be investigated')
    history = [parameters(row['detail']) for row in events
               if row['session'] == session and row['event'] == 'history']
    if len(history) != 1:
        raise ValueError('Exactly one history summary is required')
    history = history[0]
    if any(int(row['error']) or int(row['count']) < 0 for row in requests):
        problems.append('Reference export contains CopyTicksRange/CopyRates errors')
    tick_requests = [row for row in requests if row['kind'] == 'ticks']
    if not tick_requests:
        problems.append('Missing reference tick requests')
    else:
        expected_start = int(metadata['from_msc'])
        for row in tick_requests:
            if int(row['from_msc']) != expected_start:
                problems.append('Gap/overlap in reference tick request coverage')
            expected_start = int(row['to_msc']) + 1
        if expected_start != int(metadata['to_msc']) + 1:
            problems.append('Reference tick requests did not finish the declared interval')
        if sum(max(0, int(row['count'])) for row in tick_requests) != len(reference):
            problems.append('Reference tick count does not match request totals')
    for kind, tf in [('rates_M1', 60), ('rates_M15', 900)]:
        entries = [row for row in requests if row['kind'] == kind]
        if len(entries) != 1 or int(entries[0]['count']) != sum(int(row['timeframe']) == tf for row in rates):
            problems.append(f'Missing/incomplete {kind} reference export')
    if int(history['requested_from']) != int(metadata['from_msc']):
        raise ValueError('Reference InpFromMsc must equal history requested_from (source ordinals must share an origin)')
    if any(int(row['source_sequence']) != i + 1 for i, row in enumerate(reference)):
        problems.append('Reference source_sequence is not contiguous')
    sent = []
    previous_time = 0
    previous_source = int(audit[0]['source_sequence']) - 1
    for index, row in enumerate(audit, 1):
        ordinal = int(row['source_sequence'])
        stamp = int(row['time_msc'])
        if int(row['sequence']) != index or ordinal != previous_source + 1 or stamp < previous_time:
            problems.append(f'Audit sequence/order error at row {index}')
        previous_source, previous_time = ordinal, stamp
        if not 1 <= ordinal <= len(reference):
            problems.append(f'Reference missing source record {ordinal}')
            continue
        ref = reference[ordinal - 1]
        if any(not same_number(row[field], ref[field]) for field in RAW_FIELDS):
            problems.append(f'Raw MT5 fields/order differ at source record {ordinal}')
        if row['disposition'] == 'sent':
            if number(row['chart_price']) != number(row['bid']):
                problems.append(f'Chart price is not Bid at row {index}')
            if int(row['side']) not in (-1, 0, 1):
                problems.append(f'Invalid side at row {index}')
            flags = int(row['flags'])
            expected_source = 'trade_flag' if flags & (32 | 64) else ('unknown' if int(row['side']) == 0 else 'heuristic')
            if row['side_source'] != expected_source:
                problems.append(f'Incorrect side provenance at row {index}')
            sent.append(row)
        elif row['disposition'] != 'invalid':
            problems.append(f'Unknown audit disposition at row {index}')
    if not sent:
        raise ValueError('No sent ticks to verify')
    if int(audit[0]['source_sequence']) != int(history['dropped']) + 1:
        problems.append('Retained history origin does not match dropped count')
    history_rows = [row for row in audit if row['phase'] == 'history']
    if not history_rows or int(history_rows[-1]['source_sequence']) != int(history['source_count']):
        problems.append('History source count does not match its audit tail')
    if len(history_rows) != int(history['retained']):
        problems.append('Incomplete historical audit file')
    wire_verified = False
    if wire is not None:
        captured, kinds = [], []
        active_session = None
        ready = False
        for item in wire:
            if item.get('event') == 'incomplete_line':
                problems.append('Incomplete line in TCP capture')
            if item.get('direction') != 'mt5_to_engine' or 'line' not in item:
                continue
            line = item['line']
            if line.startswith('INFO;'):
                match = re.search(r'session=([^;)]+)', line)
                active_session = match.group(1) if match else None
                ready = False
            if active_session != session:
                continue
            fields = line.split(';')
            if fields[0] in ('INFO', 'HELLO', 'READY'):
                kinds.append(fields[0])
            if fields[0] == 'HELLO':
                if len(fields) != 4 or fields[1] != metadata['symbol'] or number(fields[2]) != number(metadata['tick_size']):
                    problems.append('HELLO symbol/tick size mismatch')
            if fields[0] == 'TICK':
                captured.append((fields, 'live' if ready else 'history'))
            if fields[0] == 'READY':
                ready = True
        if kinds != ['INFO', 'HELLO', 'READY']:
            problems.append('Expected one INFO/HELLO/READY sequence in the selected session')
        if len(captured) != len(sent):
            problems.append(f'Wire count {len(captured)} differs from committed audit count {len(sent)}')
        for index, ((fields, phase), row) in enumerate(zip(captured, sent), 1):
            if phase != row['phase']:
                problems.append(f'History/live phase mismatch at transmitted tick {index}')
            expected = [row['time_msc'], row['chart_price'], row['volume'], row['side'], row['bid'], row['ask']]
            if len(fields) != 8 or fields[1] != metadata['symbol'] or any(not same_number(a, b) for a, b in zip(fields[2:], expected)):
                problems.append(f'Wire fields/order mismatch at transmitted tick {index}')
        wire_verified = not problems
    start, end = int(sent[0]['time_msc']), int(audit[-1]['time_msc'])
    expected_bars = {}
    invalid_bars = set()
    for timeframe in (60, 900):
        for row in audit:
            key = (timeframe, int(row['time_msc']) // (timeframe * 1000) * timeframe)
            if row['disposition'] != 'sent':
                invalid_bars.add(key)
                continue
            bid = number(row['bid'])
            if key not in expected_bars:
                expected_bars[key] = [bid, bid, bid, bid]
            else:
                bar = expected_bars[key]
                bar[1], bar[2], bar[3] = max(bar[1], bid), min(bar[2], bid), bid
    engine_bars = {}
    for snapshot in snapshots:
        timeframe = int(snapshot['timeframe'])
        closed_before = int(snapshot.get('verification_closed_before',
                            max((bar['time'] for bar in snapshot['candles']), default=0)))
        for bar in snapshot['candles']:
            if int(bar['time']) >= closed_before:
                continue
            engine_bars[(timeframe, int(bar['time']))] = [number(bar[field]) for field in ('o', 'h', 'l', 'c')]
    compared = {60: 0, 900: 0}
    engine_compared = {60: 0, 900: 0}
    missing_engine_bars = []
    step = number(metadata['tick_size'])
    if step <= 0 or int(metadata['chart_mode']) != 0:
        raise ValueError('Requires Bid reference and positive broker tick size')
    for row in rates:
        tf, stamp = int(row['timeframe']), int(row['time'])
        key = tf, stamp
        reason = None
        if stamp * 1000 < start:
            reason = 'leading_history_not_covered'
        elif (stamp + tf) * 1000 > end:
            reason = 'trailing_or_unfinished_bar'
        elif key in invalid_bars:
            reason = 'invalid_source_records'
        elif key not in expected_bars:
            reason = 'missing_ticks_or_history'
        if reason:
            excluded.append({'timeframe': tf, 'time': stamp, 'reason': reason})
            continue
        broker = [number(row[field]) for field in ('open', 'high', 'low', 'close')]
        compared[tf] += 1
        for label, values in [('audit_bid', expected_bars[key]), ('engine', engine_bars.get(key))]:
            if values is None:
                if label == 'engine' and snapshots:
                    missing_engine_bars.append({'timeframe': tf, 'time': stamp})
                continue
            if label == 'engine':
                engine_compared[tf] += 1
            for field, actual, expected in zip(('open', 'high', 'low', 'close'), values, broker):
                if abs(actual - expected) > Decimal('0.000000000001'):
                    differences.append({'source': label, 'timeframe': tf, 'time': stamp, 'field': field,
                                        'actual': str(actual), 'broker': str(expected),
                                        'difference_in_broker_ticks': str((actual - expected) / step)})
    if differences:
        problems.append('OHLC differs from CopyRates')
    if any(item['reason'] in ('missing_ticks_or_history', 'invalid_source_records') for item in excluded):
        problems.append('History gaps or invalid records affect completed bars')
    pending = []
    unobserved_tail = len(reference) - int(audit[-1]['source_sequence'])
    if unobserved_tail > 0:
        pending.append(f'Reference has {unobserved_tail} trailing records outside the committed audit')
    if missing_engine_bars:
        pending.append(f'{len(missing_engine_bars)} eligible broker bars are absent from supplied engine snapshots')
    if wire is None:
        pending.append('TCP wire capture not supplied')
    for tf in (60, 900):
        if not compared[tf]:
            pending.append(f'No fully covered completed M{tf // 60} bars')
        if not engine_compared[tf]:
            pending.append(f'No matching engine M{tf // 60} snapshots')
    report = {'session': session, 'source_records_checked': len(audit),
              'source_ordinal_range': [int(audit[0]['source_sequence']), int(audit[-1]['source_sequence'])],
              'reference_records': len(reference), 'reference_unobserved_tail': max(0, unobserved_tail), 'transmitted_ticks': len(sent),
              'invalid_records': len(audit) - len(sent),
              'heuristic_ticks': sum(row['side_source'] == 'heuristic' for row in sent),
              'same_millisecond_adjacent_records': sum(a['time_msc'] == b['time_msc'] for a, b in zip(audit, audit[1:])),
              'wire_verified': wire_verified, 'broker_ohlc_compared': compared, 'engine_ohlc_compared': engine_compared,
              'history_complete': False, 'coverage_note': 'Request success does not prove complete broker tick history',
              'excluded_bars': excluded, 'missing_engine_bars': missing_engine_bars, 'ohlc_differences': differences, 'problems': problems, 'pending': pending}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('audit', 'events', 'reference', 'rates', 'requests', 'metadata'):
        parser.add_argument('--' + name, required=True, type=Path)
    parser.add_argument('--wire', type=Path)
    parser.add_argument('--snapshot', type=Path, action='append', default=[])
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        wire = [json.loads(line) for line in args.wire.read_text().splitlines()] if args.wire else None
        snapshots = [json.loads(path.read_text()) for path in args.snapshot]
        metadata = read_csv(args.metadata)
        if len(metadata) != 1:
            raise ValueError('Expected one reference metadata record')
        report = verify(*(read_csv(getattr(args, name)) for name in ('audit', 'events', 'reference', 'rates', 'requests')),
                        metadata[0], wire=wire, snapshots=snapshots)
        output = json.dumps(report, indent=2, ensure_ascii=False)
        print(output)
        if args.output:
            args.output.write_text(output + '\n')
        return 1 if report['problems'] else 2 if report['pending'] else 0
    except (OSError, KeyError, ValueError, InvalidOperation) as error:
        parser.exit(1, f'Verification failed: {error}\n')


if __name__ == '__main__':
    raise SystemExit(main())
