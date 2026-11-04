import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location("feeder", Path(__file__).parents[1] / "mt5_feeder.py")
feeder_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(feeder_module)


def tick(stamp, price=1.2):
    return dict(time_msc=stamp, bid=price - .01, ask=price + .01, last=price, volume=1, volume_real=1, flags=32)


class FeederTests(unittest.TestCase):
    def make_feeder(self):
        feeder = feeder_module.MT5DirectFeeder(symbol="TEST")
        feeder.send_line = Mock()
        return feeder

    def test_same_millisecond_records_are_retained_once(self):
        f = self.make_feeder()
        f.emit_ticks([tick(1000), tick(1000)], replay=True)
        f.send_line.reset_mock()
        f.emit_ticks([tick(999), tick(1000), tick(1000), tick(1000), tick(1001), tick(1001)])
        lines = f.send_line.call_args[0][0].splitlines()
        self.assertEqual([int(line.split(";")[2]) for line in lines], [1000, 1001, 1001])
        f.send_line.reset_mock()
        f.emit_ticks([tick(1000), tick(1001), tick(1001)])
        f.send_line.assert_not_called()

    def test_socket_failure_closes_and_reconnects(self):
        f = feeder_module.MT5DirectFeeder()
        sock = Mock()
        sock.sendall.side_effect = ConnectionResetError()
        f.sock = sock
        with self.assertRaises(OSError):
            f.send_line("READY\n")
        self.assertIsNone(f.sock)
        sock.close.assert_called_once()

    def test_commands_survive_tcp_fragmentation(self):
        f = self.make_feeder()
        f.sock = Mock()
        f.sock.recv.side_effect = [b"SWI", b"TCH;EURUSD.r\n"]
        f.connect_mt5 = Mock(return_value=True)
        f.init_symbol = Mock()
        with unittest.mock.patch.object(feeder_module.select, "select", return_value=([f.sock], [], [])):
            f.check_engine_commands()
            f.init_symbol.assert_not_called()
            f.check_engine_commands()
        f.init_symbol.assert_called_once_with("EURUSD.r")

    def test_empty_history_still_sends_ready(self):
        f = self.make_feeder()
        api = Mock()
        info = Mock(name="info")
        info.name = "TEST"; info.digits = 5; info.point = .00001; info.trade_tick_size = .00001
        api.symbol_info.return_value = info
        api.copy_ticks_range.return_value = []
        api.market_book_add.return_value = False
        with unittest.mock.patch.object(feeder_module, "mt5", api):
            self.assertTrue(f.init_symbol("TEST"))
        self.assertTrue(any(call.args == ("READY\n",) for call in f.send_line.call_args_list))
        self.assertTrue(f.initialized)


if __name__ == "__main__":
    unittest.main()
