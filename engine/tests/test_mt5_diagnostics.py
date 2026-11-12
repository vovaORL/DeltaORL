"""Verifier negative cases and opt-in relay contract; all input is synthetic fixture data."""
from copy import deepcopy
from decimal import Decimal
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('verify_mt5', ROOT / 'tools/verify_mt5.py')
verify_mt5 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_mt5)


def fixture():
    reference, audit, wire, rates = [], [], [], []
    for minute in range(31):
        price = str(Decimal('1.10001') + Decimal(minute % 3) * Decimal('.00001'))
        row = dict(time_msc=str(900000 + minute * 60000), bid=price, ask='1.10010', last='0',
                   raw_volume='0', volume_real='0', flags='2')
        reference.append(row)
        if minute == 0:
            reference.extend([dict(row), {**row, 'ask': '1.10011'}])
    for i, row in enumerate(reference, 1):
        row['source_sequence'] = str(i)
        audit.append({**row, 'session': 'fixture', 'sequence': str(i), 'phase': 'history' if i <= 10 else 'live',
                      'chart_price': row['bid'], 'volume': '1', 'side': '1', 'side_source': 'heuristic', 'disposition': 'sent'})
    wire.extend({'direction': 'mt5_to_engine', 'line': line} for line in
                ['INFO;Fixture (session=fixture)', 'HELLO;EURUSD;0.00001;5'])
    for i, row in enumerate(audit):
        if i == 10:
            wire.append({'direction': 'mt5_to_engine', 'line': 'READY'})
        wire.append({'direction': 'mt5_to_engine', 'line': f"TICK;EURUSD;{row['time_msc']};{row['bid']};1;1;{row['bid']};{row['ask']}"})
    for tf in [60, 900]:
        for stamp in range(900, 2701, tf):
            prices = [Decimal(row['bid']) for row in reference if stamp * 1000 <= int(row['time_msc']) < (stamp + tf) * 1000]
            rates.append(dict(timeframe=str(tf), time=str(stamp), open=str(prices[0]), high=str(max(prices)),
                              low=str(min(prices)), close=str(prices[-1]), tick_volume='1', real_volume='0'))
    snapshots = [dict(timeframe=tf, candles=[dict(time=int(row['time']), o=row['open'], h=row['high'],
                                                 l=row['low'], c=row['close']) for row in rates if int(row['timeframe']) == tf]) for tf in [60, 900]]
    events = [dict(session='fixture', event='history', detail='requested_from=900000;dropped=0;retained=10;source_count=10;coverage=unverified')]
    requests = [dict(kind='ticks', from_msc='900000', to_msc='2700999', count=str(len(reference)), error='0')]
    for kind, tf in [('rates_M1', 60), ('rates_M15', 900)]:
        requests.append(dict(kind=kind, from_msc='900000', to_msc='2700999', count=str(sum(int(row['timeframe']) == tf for row in rates)), error='0'))
    metadata = dict(symbol='EURUSD', digits='5', chart_mode='0', tick_size='.00001', from_msc='900000', to_msc='2700999')
    return [audit, events, reference, rates, requests, metadata], wire, snapshots


class VerificationTests(unittest.TestCase):
    def test_full_fixture_preserves_duplicate_multiplicity_and_compares_both_frames(self):
        args, wire, snapshots = fixture()
        report = verify_mt5.verify(*args, wire=wire, snapshots=snapshots)
        self.assertEqual(report['problems'], [])
        self.assertEqual(report['pending'], [])
        self.assertTrue(report['wire_verified'])
        self.assertEqual(report['same_millisecond_adjacent_records'], 2)
        self.assertEqual(report['broker_ohlc_compared'][900], 2)
        self.assertFalse(report['history_complete'])
        self.assertTrue(report['excluded_bars'])

    def test_missing_evidence_is_pending(self):
        args, _, _ = fixture()
        report = verify_mt5.verify(*args)
        self.assertEqual(report['problems'], [])
        self.assertEqual(len(report['pending']), 3)

    def test_additional_reference_tail_is_not_claimed_as_matching_count(self):
        args, wire, snapshots = fixture()
        row = dict(args[2][-1])
        row['source_sequence'] = str(len(args[2]) + 1)
        args[2].append(row)
        args[4][0]['count'] = str(len(args[2]))
        report = verify_mt5.verify(*args, wire=wire, snapshots=snapshots)
        self.assertEqual(report['reference_unobserved_tail'], 1)
        self.assertTrue(any('trailing records' in item for item in report['pending']))

    def test_ask_only_corruption_is_detected(self):
        args, wire, snapshots = fixture()
        args[0][2]['ask'] = '1.20000'
        report = verify_mt5.verify(*args, wire=wire, snapshots=snapshots)
        self.assertTrue(any('Raw MT5' in item for item in report['problems']))
        self.assertTrue(any('Wire fields' in item for item in report['problems']))

    def test_deleted_identical_tick_is_detected(self):
        args, wire, snapshots = fixture()
        del wire[3]
        report = verify_mt5.verify(*args, wire=wire, snapshots=snapshots)
        self.assertTrue(any('Wire count' in item for item in report['problems']))

    def test_reordered_records_are_detected(self):
        args, wire, snapshots = fixture()
        args[0][5], args[0][6] = args[0][6], args[0][5]
        report = verify_mt5.verify(*args, wire=wire, snapshots=snapshots)
        self.assertTrue(any('sequence/order' in item for item in report['problems']))

    def test_partial_reference_sync_is_not_accepted(self):
        args, wire, snapshots = fixture()
        args[4][0]['error'] = '4403'
        report = verify_mt5.verify(*args, wire=wire, snapshots=snapshots)
        self.assertTrue(any('errors' in item for item in report['problems']))
        self.assertFalse(report['wire_verified'])

    def test_wrong_history_live_boundary_is_detected(self):
        args, wire, snapshots = fixture()
        args[0][0]['phase'] = 'live'
        report = verify_mt5.verify(*args, wire=wire, snapshots=snapshots)
        self.assertTrue(any('phase mismatch' in item for item in report['problems']))

    def test_engine_forming_bar_is_not_reported_as_completed_ohlc_mismatch(self):
        args, wire, snapshots = fixture()
        snapshots[0]['verification_closed_before'] = 2640
        snapshots[0]['candles'][-2]['h'] = '1.20000'
        report = verify_mt5.verify(*args, wire=wire, snapshots=snapshots)
        self.assertEqual(report['ohlc_differences'], [])
        self.assertEqual(report['problems'], [])
        self.assertTrue(any(row['timeframe'] == 60 and row['time'] == 2640 for row in report['missing_engine_bars']))
        self.assertTrue(report['pending'])

    def test_engine_one_tick_ohlc_error_is_not_hidden_by_rounding(self):
        args, wire, snapshots = fixture()
        snapshots[0]['candles'][0]['h'] = '1.10002'
        report = verify_mt5.verify(*args, wire=wire, snapshots=snapshots)
        self.assertTrue(any(item['source'] == 'engine' and Decimal(item['difference_in_broker_ticks']) == 1
                            for item in report['ohlc_differences']))

    def test_leading_partial_and_invalid_bars_are_explicit(self):
        args, wire, snapshots = fixture()
        args[0][10]['disposition'] = 'invalid'
        report = verify_mt5.verify(*args)
        self.assertTrue(any(row['reason'] == 'invalid_source_records' for row in report['excluded_bars']))
        self.assertTrue(report['problems'])


class RelayTests(unittest.TestCase):
    def test_fragmented_lines_and_engine_commands_are_forwarded_once(self):
        with socket.socket() as upstream, tempfile.TemporaryDirectory() as directory:
            upstream.bind(('127.0.0.1', 0)); upstream.listen()
            with socket.socket() as reserve:
                reserve.bind(('127.0.0.1', 0)); port = reserve.getsockname()[1]
            received = []
            errors = []
            def engine():
                try:
                    upstream.settimeout(5)
                    with upstream.accept()[0] as client:
                        data = b''
                        while not data.endswith(b'READY\n'):
                            data += client.recv(4096)
                        received.append(data)
                        client.sendall(b'SWITCH;EURUSD\n')
                        while client.recv(4096):
                            pass
                except Exception as error:
                    errors.append(error)
            worker = threading.Thread(target=engine); worker.start()
            output = Path(directory) / 'wire.jsonl'
            process = subprocess.Popen([sys.executable, str(ROOT / 'tools/mt5_capture.py'), '--listen-port', str(port),
                                        '--engine-port', str(upstream.getsockname()[1]), '--output', str(output)],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            try:
                for _ in range(100):
                    try:
                        client = socket.create_connection(('127.0.0.1', port), timeout=2)
                        break
                    except OSError:
                        time.sleep(.02)
                else:
                    self.fail('Relay did not start')
                payload = b'INFO;Fixture\nHELLO;EURUSD;0.00001;5\nTICK;EURUSD;1000;1.1;1;1;1.1;1.2\nREADY\n'
                with client:
                    for fragment in [payload[:3], payload[3:22], payload[22:]]:
                        client.sendall(fragment)
                    command = b''
                    while not command.endswith(b'\n'):
                        command += client.recv(4096)
                    self.assertEqual(command, b'SWITCH;EURUSD\n')
                worker.join(timeout=5)
                self.assertFalse(worker.is_alive())
                self.assertEqual(errors, [])
                self.assertEqual(received, [payload])
                lines = [json.loads(row) for row in output.read_text().splitlines()]
                forwarded = [row['line'] for row in lines if row.get('direction') == 'mt5_to_engine']
                self.assertEqual(forwarded, payload.decode().splitlines())
            finally:
                process.terminate(); process.communicate(timeout=5)


if __name__ == '__main__':
    unittest.main()
