"""End-to-end transport tests; isolated ports, no broker or feeder required."""
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import time
import sys
import tempfile
from unittest.mock import patch
import unittest

ROOT = Path(__file__).resolve().parents[2]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class WS:
    def __init__(self, port):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=5)
        self.buffer = b""
        key = base64.b64encode(b"deltaorl-test-key").decode()
        request = f"GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode()
        self.sock.sendall(request[:40])
        time.sleep(.03)
        self.sock.sendall(request[40:])
        while b"\r\n\r\n" not in self.buffer:
            self.buffer += self.sock.recv(65536)
        headers, self.buffer = self.buffer.split(b"\r\n\r\n", 1)
        assert b"101 Switching Protocols" in headers
        expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
        assert b"Sec-WebSocket-Accept: " + expected + b"\r\n" in headers + b"\r\n"

    def close(self):
        self.sock.close()

    def frame(self, payload, opcode=1, final=True):
        if isinstance(payload, str):
            payload = payload.encode()
        mask = b"\x19\x38\x55\x72"
        header = bytes([(128 if final else 0) | opcode])
        n = len(payload)
        if n < 126:
            header += bytes([128 | n])
        elif n < 65536:
            header += bytes([128 | 126]) + struct.pack("!H", n)
        else:
            header += bytes([128 | 127]) + struct.pack("!Q", n)
        self.sock.sendall(header + mask + bytes(value ^ mask[i % 4] for i, value in enumerate(payload)))

    def send(self, data):
        self.frame(json.dumps(data))

    def read(self):
        def fill(n):
            while len(self.buffer) < n:
                data = self.sock.recv(65536)
                if not data:
                    raise ConnectionError("WebSocket closed")
                self.buffer += data
        fill(2)
        opcode = self.buffer[0] & 15
        length = self.buffer[1] & 127
        header = 2
        if length == 126:
            fill(4); length = struct.unpack("!H", self.buffer[2:4])[0]; header = 4
        elif length == 127:
            fill(10); length = struct.unpack("!Q", self.buffer[2:10])[0]; header = 10
        fill(header + length)
        payload = self.buffer[header:header + length]
        self.buffer = self.buffer[header + length:]
        return opcode, payload

    def until(self, predicate, seconds=6):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.sock.settimeout(max(.1, deadline - time.monotonic()))
            opcode, payload = self.read()
            if opcode == 1:
                data = json.loads(payload)
                if predicate(data):
                    return data
        raise AssertionError("Expected WebSocket message not received")


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.mt5_port, self.ws_port = free_port(), free_port()
        self.args = [str(ROOT / "build" / ("delta_engine.exe" if os.name == "nt" else "delta_engine")), "--no-feeder", "--no-demo", "--mt5-port", str(self.mt5_port), "--ws-port", str(self.ws_port)]
        self.process = subprocess.Popen(self.args, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        self.clients = []
        for _ in range(100):
            if self.process.poll() is not None:
                self.fail(f"Engine exited: {self.process.stderr.read().decode(errors='replace')}")
            try:
                self.ws = WS(self.ws_port)
                self.clients.append(self.ws)
                break
            except OSError:
                time.sleep(.03)
        else:
            self.fail("Engine did not start")
        self.ws.until(lambda d: d["type"] == "snapshot")

    def tearDown(self):
        for client in self.clients:
            client.close()
        self.process.terminate()
        self.process.wait(timeout=5)
        self.process.stderr.close()

    def source(self):
        sock = socket.create_connection(("127.0.0.1", self.mt5_port), timeout=5)
        self.addCleanup(sock.close)
        return sock

    def test_history_rollover_dom_tps_and_recovery(self):
        sock = self.source()
        sock.sendall(b"HELLO;TEST;0.01;2\nINFO;Broker \"quoted\"\\name\nTICK;TEST;60000;10;2;1;9.99;10.01\nREADY\n")
        first = self.ws.until(lambda d: d["type"] == "snapshot" and d["symbol"] == "TEST" and bool(d["candles"]))
        self.assertEqual(first["candles"][0]["v"], 2)
        self.ws.send({"action": "set_timeframe", "timeframe": 1})
        self.ws.until(lambda d: d["type"] == "snapshot" and d["timeframe"] == 1)
        sock.sendall(b"TICK;TEST;60999;10.01;3;1;10;10.02\nTICK;TEST;61000;10.02;4;-1;10.01;10.03\nTICK;TEST;62000;10.03;5;1;10.02;10.04\nDOM;TEST;2;10.02,12,1;10.04,15,2\n")
        update = self.ws.until(lambda d: d["type"] == "candle_update" and any(c["time"] == 62 for c in d["candles"]))
        candles = {c["time"]: c for c in update["candles"]}
        self.assertEqual(candles[60]["v"], 5)
        self.assertEqual(candles[61]["v"], 4)
        dom = self.ws.until(lambda d: d["type"] == "dom" and len(d["levels"]) == 2)
        self.assertFalse(dom["simulated"])
        self.assertEqual(dom["levels"][0], [10.02, 12, 1])
        stats = self.ws.until(lambda d: d["type"] == "stats" and d["ticks_per_sec"] > 0)
        self.assertEqual(stats["broker"], 'Broker "quoted"\\name')
        sock.sendall(b"HELLO;BROKEN;NaN;2\nTICK;TEST;63000;nan;3;1;10;11\nHELLO;OTHER;0.001;3\nREADY\n")
        self.ws.until(lambda d: d["type"] == "snapshot" and d["symbol"] == "OTHER")
        sock.close()
        self.ws.until(lambda d: d["type"] == "stats" and not d["mt5_connected"])
        self.assertIsNone(self.process.poll())

    def test_bridge_status_same_millisecond_and_eurusd_timeframes(self):
        self.process.terminate(); self.process.wait(timeout=5); self.process.stderr.close()
        self.process = subprocess.Popen(self.args + ["--bridge"], cwd=ROOT,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for _ in range(100):
            try:
                self.ws = WS(self.ws_port); self.clients.append(self.ws)
                break
            except OSError:
                time.sleep(.03)
        stats = self.ws.until(lambda d: d["type"] == "stats")
        self.assertEqual(stats["mt5_status"], "Disconnected")
        self.assertFalse(stats["demo"])
        sock = self.source()
        sock.sendall(b"INFO;Fixture DeltaBridge\nHELLO;EURUSD;0.0001;5\n")
        stats = self.ws.until(lambda d: d["type"] == "stats" and d["mt5_status"] == "Connecting")
        self.assertFalse(stats["mt5_connected"])
        sock.sendall(b"TICK;EURUSD;900001;1.085;1;1;1.0849;1.0851\n"
                     b"TICK;EURUSD;900001;1.085;1;1;1.0849;1.0851\n"
                     b"TICK;EURUSD;960002;1.086;2;-1;1.0859;1.0861\nREADY\n")
        stats = self.ws.until(lambda d: d["type"] == "stats" and d["mt5_connected"])
        self.assertEqual(stats["mt5_status"], "Connected")
        for timeframe, count in [(60, 2), (900, 1), (60, 2)]:
            self.ws.send({"action": "set_timeframe", "timeframe": timeframe})
            data = self.ws.until(lambda d: d["type"] == "snapshot" and d["timeframe"] == timeframe)
            self.assertEqual(len(data["candles"]), count)
            self.assertEqual(sum(c["v"] for c in data["candles"]), 4)
        sock.sendall(b"TICK;EURUSD;960003;1.087;3;1;1.0869;1.0871\n")
        tick = self.ws.until(lambda d: d["type"] == "tick")
        self.assertEqual(tick["t"], 960003)
        self.assertEqual(tick["p"], 1.087)
        sock.close()
        stats = self.ws.until(lambda d: d["type"] == "stats" and d["mt5_status"] == "Disconnected")
        self.assertFalse(stats["demo"])
        self.ws.send({"action": "get_snapshot"})
        data = self.ws.until(lambda d: d["type"] == "snapshot")
        self.assertEqual(data["candles"], [])
        self.ws.send({"action": "connect_mt5", "symbol": "EURUSD"})
        result = self.ws.until(lambda d: d["type"] == "mt5_load_result")
        self.assertEqual(result["count"], 0)
        self.assertIn("DeltaBridge", result["msg"])

    def test_fragmented_commands_ping_close_and_invalid_inputs(self):
        self.ws.frame('{"action":', final=False)
        self.ws.frame('"set_timeframe","timeframe":5}', opcode=0)
        self.ws.until(lambda d: d["type"] == "snapshot" and d["timeframe"] == 5)
        self.ws.frame("probe", opcode=9)
        while True:
            opcode, payload = self.ws.read()
            if opcode == 10:
                self.assertEqual(payload, b"probe")
                break
        for bad in ['{"action":"set_timeframe","timeframe":"oops"}', '{"action":"set_timeframe","timeframe":0}', '{"action":"set_imbalance","ratio":-1}', '{"action":', '{"action":"set_timeframe","timeframe":1e999}']:
            self.ws.frame(bad)
            self.ws.until(lambda d: d["type"] == "error")
        self.ws.send({"action": "set_timeframe", "timeframe": 60})
        self.ws.until(lambda d: d["type"] == "snapshot" and d["timeframe"] == 60)
        self.ws.frame(struct.pack("!H", 1000), opcode=8)
        while self.ws.read()[0] != 8:
            pass
        self.assertIsNone(self.process.poll())

    def test_multiple_clients_share_state_and_rebind_fails(self):
        other = WS(self.ws_port); self.clients.append(other)
        other.until(lambda d: d["type"] == "snapshot")
        self.ws.send({"action": "set_timeframe", "timeframe": 300})
        other.until(lambda d: d["type"] == "snapshot" and d["timeframe"] == 300)
        result = subprocess.run(self.args, cwd=ROOT, capture_output=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.ws.send({"action": "get_snapshot"})
        self.ws.until(lambda d: d["type"] == "snapshot" and d["timeframe"] == 300)

    def test_large_snapshot_is_complete(self):
        sock = self.source()
        text = "HELLO;LOAD;0.00001;5\n" + "".join(f"TICK;LOAD;{60000 + i * 1000};{1 + i % 100 * .00001:.5f};1;1;1;2\n" for i in range(20000)) + "READY\n"
        sock.sendall(text.encode())
        snapshot = self.ws.until(lambda d: d["type"] == "snapshot" and d["symbol"] == "LOAD" and len(d["candles"]) > 300, seconds=15)
        self.assertEqual(sum(c["v"] for c in snapshot["candles"]), 20000)
        self.assertGreater(len(json.dumps(snapshot)), 65535)

    def test_slow_client_does_not_block_tick_ingestion(self):
        slow = WS(self.ws_port); self.clients.append(slow)
        slow.sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024)
        sock = self.source()
        sock.sendall(b"HELLO;FAST;0.01;2\nREADY\n")
        self.ws.until(lambda d: d["type"] == "snapshot" and d["symbol"] == "FAST")
        sock.sendall("".join(f"TICK;FAST;{60000+i};10;1;1;9.99;10.01\n" for i in range(12000)).encode())
        update = self.ws.until(lambda d: d["type"] == "candle_update" and d["candle"]["v"] == 12000)
        self.assertEqual(update["candle"]["cvd"], 12000)
        self.ws.send({"action": "set_timeframe", "timeframe": 10})
        self.ws.until(lambda d: d["type"] == "snapshot" and d["timeframe"] == 10)

    def test_connect_result_waits_for_ready_and_reports_errors(self):
        sock = self.source()
        time.sleep(.05)
        self.ws.send({"action": "connect_mt5", "path": "C:\\MT5\\terminal64.exe", "symbol": "EURUSD.r"})
        command = b""
        while b"SWITCH;EURUSD.r\n" not in command:
            command += sock.recv(4096)
        self.assertIn(b"PATH;C:\\MT5\\terminal64.exe\n", command)
        sock.sendall(b"HELLO;EURUSD.r;0.0001;5\nREADY\n")
        result = self.ws.until(lambda d: d["type"] == "mt5_load_result")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["symbol"], "EURUSD.r")
        sock.sendall(b"ERROR;EURUSD.r;Broker unavailable\n")
        result = self.ws.until(lambda d: d["type"] == "mt5_load_result")
        self.assertEqual(result["count"], 0)
        self.assertEqual(result["msg"], "Broker unavailable")

    def test_demo_recovers_without_mixing_real_ticks(self):
        self.process.terminate(); self.process.wait(timeout=5); self.process.stderr.close()
        args = [arg for arg in self.args if arg != "--no-demo"]
        self.process = subprocess.Popen(args, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for _ in range(100):
            try:
                ws = WS(self.ws_port); self.clients.append(ws); self.ws = ws
                break
            except OSError:
                time.sleep(.03)
        self.ws.send({"action": "get_snapshot"})
        data = self.ws.until(lambda d: d["type"] in ("snapshot", "candle_update") and len(d["candles"]) > 100)
        self.assertEqual(data["symbol"], "EURUSD")
        sock = self.source()
        sock.sendall(b"HELLO;REAL;0.01;2\nTICK;REAL;60000;10;500000;1;9.99;10.01\nREADY\n")
        real = self.ws.until(lambda d: d["type"] == "snapshot" and d["symbol"] == "REAL" and bool(d["candles"]))
        self.assertEqual(sum(c["v"] for c in real["candles"]), 500000)
        sock.close()
        self.ws.until(lambda d: d["type"] == "snapshot" and d["symbol"] == "REAL" and not d["candles"])
        demo = self.ws.until(lambda d: d["type"] == "candle_update" and len(d["candles"]) > 100)
        self.assertLess(sum(c["v"] for c in demo["candles"]), 500000)


@unittest.skipUnless(sys.platform == "linux", "Wine bridge paths are Linux-specific")
class LinuxPlatformTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="deltaorl-wine-")
        self.addCleanup(self.directory.cleanup)
        self.prefix = Path(self.directory.name)
        self.record = self.prefix / "arguments.json"
        wine = self.prefix / "wine"
        wine.write_text(f"#!{sys.executable}\nimport json, os, sys\nfrom pathlib import Path\nsockets = [os.readlink(p) for p in Path('/proc/self/fd').iterdir() if p.is_symlink() and os.readlink(p).startswith('socket:')]\nPath({str(self.record)!r}).write_text(json.dumps({{'arguments': sys.argv[1:], 'sockets': sockets}}))\n")
        wine.chmod(0o755)
        self.installation = self.prefix / "drive_c" / "Program Files" / "Термінал"
        self.installation.mkdir(parents=True)
        self.data = self.prefix / "drive_c/users/test/AppData/Roaming/MetaQuotes/Terminal/TEST"
        (self.data / "MQL5/Experts").mkdir(parents=True)
        (self.data / "bases/Broker").mkdir(parents=True)
        (self.data / "origin.txt").write_text("C:\\Program Files\\Термінал", encoding="utf-16")
        (self.prefix / "dosdevices").mkdir()
        (self.prefix / "dosdevices/c:").symlink_to(self.prefix / "drive_c", target_is_directory=True)
        with patch.dict(os.environ, {"WINEPREFIX": str(self.prefix), "DELTAORL_PYTHON": "C:\\Python\\python.exe",
                                    "PATH": str(self.prefix) + os.pathsep + os.environ["PATH"]}):
            IntegrationTests.setUp(self)

    tearDown = IntegrationTests.tearDown

    def test_wine_feeder_arguments_preserve_spaces_and_symbols(self):
        symbol = 'EURUSD "test" $(echo untouched)'
        terminal = str(self.installation / "terminal64.exe")
        self.ws.send({"action": "connect_mt5", "path": terminal, "symbol": symbol})
        deadline = time.monotonic() + 5
        while not self.record.exists() and time.monotonic() < deadline:
            time.sleep(.02)
        record = json.loads(self.record.read_text())
        self.assertEqual(record["sockets"], [], "Wine must not inherit engine sockets")
        arguments = record["arguments"]
        self.assertEqual(arguments[0], "C:\\Python\\python.exe")
        self.assertEqual(arguments[arguments.index("--symbol") + 1], symbol)
        self.assertEqual(arguments[arguments.index("--path") + 1], "Z:" + terminal)
        self.assertTrue(arguments[2].endswith("engine/mt5_feeder.py"))
        self.assertIsNone(self.process.poll())

    def test_detect_and_install_ea_in_wine_with_utf16_origin(self):
        self.ws.send({"action": "get_mt5_terminals"})
        terminals = self.ws.until(lambda d: d["type"] == "mt5_terminals")["terminals"]
        self.assertEqual(terminals[0]["path"], str(self.data))
        self.assertEqual(terminals[0]["servers"], ["Broker"])
        self.ws.send({"action": "install_ea", "path": str(self.installation / "terminal64.exe")})
        result = self.ws.until(lambda d: d["type"] == "install_ea_result")
        self.assertTrue(result["success"])
        self.assertEqual(Path(result["destination"]).read_bytes(), (ROOT / "mql5/DeltaBridge.mq5").read_bytes())


if __name__ == "__main__":
    unittest.main()
