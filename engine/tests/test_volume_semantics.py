"""Flagged quote aggregation over the real TCP and WebSocket protocols."""
import os
from pathlib import Path
import socket
import subprocess
import time
import unittest
from test_integration import WS, free_port

ROOT = Path(__file__).resolve().parents[2]

class VolumeSemanticsTests(unittest.TestCase):
    def test_history_live_rebuild_and_reconnect(self):
        engine = os.environ.get('DELTAORL_TEST_ENGINE', str(ROOT / 'build/delta_engine'))
        mt, ws = free_port(), free_port()
        proc = subprocess.Popen([engine, '--bridge', '--mt5-port', str(mt), '--ws-port', str(ws)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        client = None
        try:
            for _ in range(100):
                try:
                    client = WS(ws)
                    break
                except OSError:
                    time.sleep(.05)
            self.assertIsNotNone(client)
            for _ in range(2):
                with socket.create_connection(('127.0.0.1', mt), timeout=5) as source:
                    source.sendall(b'HELLO;TEST;0.01;2\nTICK;TEST;60000;10;50;1;10;10.01;2\n'
                                   b'TICK;TEST;61000;10.01;50;-1;10.01;10.02;4\n'
                                   b'TICK;TEST;62000;10.02;50;-1;10.02;10.03;6\nREADY\n')
                    snapshot = client.until(lambda x: x.get('type') == 'snapshot' and x.get('symbol') == 'TEST' and len(x['candles']) == 1 and x['candles'][0].get('quote_updates') == 3)
                    bar = snapshot['candles'][0]
                    self.assertEqual((bar['v'], bar['bv'], bar['av'], bar['d']), (2, 1, 1, 0))
                    self.assertEqual((bar['o'], bar['h'], bar['c'], bar['unclassified_updates']), (10, 10.02, 10.02, 0))
                    source.sendall(b'TICK;TEST;63000;10.03;50;1;10.03;10.04;4\n')
                    update = client.until(lambda x: x.get('type') == 'candle_update' and x['candle'].get('quote_updates') == 4)
                    self.assertEqual(update['candle']['v'], 2)
                    self.assertEqual(update['candle']['c'], 10.03)
                    client.send({'action': 'set_timeframe', 'timeframe': 120})
                    bar = client.until(lambda x: x.get('type') == 'snapshot' and x.get('timeframe') == 120)['candles'][0]
                    self.assertEqual((bar['v'], bar['quote_updates']), (2, 4))
                    client.send({'action': 'set_timeframe', 'timeframe': 60})
                    client.until(lambda x: x.get('type') == 'snapshot' and x.get('timeframe') == 60)
                client.until(lambda x: x.get('type') == 'stats' and x.get('mt5_status') == 'Disconnected')
        finally:
            if client:
                client.close()
            proc.terminate()
            proc.communicate(timeout=10)
