"""Execute the actual EA control flow with deterministic MQL API stubs.
MetaEditor compilation remains the authority for MQL language compatibility.
"""
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).parent / 'fixtures'


@unittest.skipUnless(shutil.which('c++'), 'Requires a native C++ compiler')
class MQLBridgeTests(unittest.TestCase):
    def test_production_ea_against_legacy_reference_and_api_faults(self):
        with tempfile.TemporaryDirectory(prefix='deltaorl-mql-') as directory:
            directory = Path(directory)
            text = (ROOT / 'mql5/DeltaBridge.mq5').read_text()
            text = re.sub(r'^#property.*$', '', text, flags=re.M)
            text = re.sub(r'const MqlTick &([A-Za-z_]+)\[\]', r'const Array<MqlTick> &\1', text)
            text = re.sub(r'\b(MqlTick|int|uchar|MqlBookInfo) ([A-Za-z_]+)\[\]', r'Array<\1> \2', text)
            (directory / 'candidate.cpp').write_text('#include "mql5_shim.hpp"\n' + text)
            shutil.copy2(ROOT / 'mql5/DeltaBridgeCore.mqh', directory)
            for name in ['mql5_shim.hpp', 'bridge_contract.cpp']:
                shutil.copy2(FIXTURES / name, directory)
            old = (FIXTURES / 'DeltaBridge-1.00.mq5').read_text(encoding='utf-8-sig')
            start = old.index('         int side = 0;')
            end = old.index('         double vol', start)
            hist = old[start:end]
            start = old.index('   // Determine Trade Side:')
            end = old.index('   double vol', start)
            live = old[start:end]
            reference = ('Array<int> ReferenceHistory(const Array<MqlTick>& ticks) {\n'
                         'Array<int> result; int prevHistSide=1;\n'
                         'for(int i=0;i<int(ticks.size());i++){\n' + hist +
                         '\nresult.push_back(side); } return result; }\n'
                         'int ReferenceLive(const MqlTick& tick,double& g_prevBid,double& g_prevAsk,int& g_prevSide){\n'
                         + live + '\nreturn side;}\n')
            (directory / 'legacy_reference.hpp').write_text(reference)
            binary = directory / 'contract'
            compilation = subprocess.run(['c++', '-std=c++20', '-O2', '-Wall', '-Wextra',
                                          str(directory / 'bridge_contract.cpp'), '-o', str(binary)],
                                         capture_output=True, text=True)
            self.assertEqual(compilation.returncode, 0, compilation.stderr)
            wire_path = directory / "fixture-wire.txt"
            result = subprocess.run([str(binary), str(wire_path)], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            print(result.stdout.strip())
            # Feed the actual EA's generated 200k fixture into the unmodified native engine.
            from test_integration import WS, free_port
            ws_port, mt5_port = free_port(), free_port()
            engine = subprocess.Popen([str(ROOT / 'build/delta_engine'), '--bridge',
                                       '--ws-port', str(ws_port), '--mt5-port', str(mt5_port)],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            ws = None
            try:
                for _ in range(100):
                    try:
                        ws = WS(ws_port)
                        break
                    except OSError:
                        time.sleep(.02)
                self.assertIsNotNone(ws, 'Engine did not start')
                import socket
                payload = wire_path.read_bytes()
                for session in range(2):
                    with socket.create_connection(('127.0.0.1', mt5_port), timeout=10) as client:
                        client.sendall(payload)
                        data = ws.until(lambda d: d['type'] == 'snapshot' and d['symbol'] == 'EURUSD'
                                        and sum(c['v'] for c in d['candles']) == 200000, seconds=30)
                        for timeframe in (60, 900, 60):
                            ws.send({'action': 'set_timeframe', 'timeframe': timeframe})
                            data = ws.until(lambda d: d['type'] == 'snapshot' and d['timeframe'] == timeframe)
                            self.assertEqual(sum(c['v'] for c in data['candles']), 200000)
                            for bar in data['candles']:
                                for field in ('o', 'h', 'l', 'c'):
                                    self.assertAlmostEqual(bar[field], 1.10001, places=12)
                    ws.until(lambda d: d['type'] == 'stats' and not d['mt5_connected'])
                print('PASS: EA fixture -> native engine, 200k Bid ticks, M1/M15/M1, full replay without mixing')
            finally:
                if ws is not None:
                    ws.close()
                engine.terminate()
                engine.communicate(timeout=5)



if __name__ == '__main__':
    unittest.main()

