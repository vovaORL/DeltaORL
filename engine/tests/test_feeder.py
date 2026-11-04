import importlib.util
from datetime import datetime, timedelta, timezone
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

    def make_api(self, stamp):
        api = Mock()
        info = Mock()
        info.name = "TEST"
        info.digits = 5
        info.point = info.trade_tick_size = .00001
        info.chart_mode = 0
        api.symbol_info.return_value = info
        api.symbol_info_tick.return_value = Mock(time_msc=stamp)
        api.copy_ticks_range.return_value = []
        api.market_book_add.return_value = False
        return api

    def test_history_and_poll_use_source_clock_with_any_offset(self):
        host_time = 1793804400000
        for offset in (-18000, 0, 7200, 19800):
            for millisecond in (0, 1, 999):
                with self.subTest(offset=offset, millisecond=millisecond):
                    stamp = host_time + offset * 1000 + millisecond
                    api = self.make_api(stamp)
                    records = [tick(stamp), tick(stamp)]
                    original = [dict(t) for t in records]
                    # Model an API which truncates the request bounds to seconds.
                    def copy_range(symbol, start, end, flags):
                        self.assertEqual(symbol, "TEST")
                        self.assertEqual(flags, api.COPY_TICKS_ALL)
                        return [t for t in records if int(start.timestamp()) * 1000 <= t['time_msc'] <= int(end.timestamp()) * 1000]
                    api.copy_ticks_range.side_effect = copy_range
                    f = self.make_feeder()
                    expected_end = datetime.fromtimestamp(stamp // 1000 + 1, timezone.utc)
                    with unittest.mock.patch.object(feeder_module, "mt5", api):
                        self.assertTrue(f.init_symbol("TEST"))
                        calls = api.copy_ticks_range.call_args_list
                        self.assertEqual(calls[0].args[1:3], ((expected_end - timedelta(days=5)).replace(hour=0, minute=0, second=0, microsecond=0), expected_end))
                        self.assertEqual(calls[1].args[1:3], ((expected_end - timedelta(days=10)).replace(hour=0, minute=0, second=0, microsecond=0), expected_end))
                        self.assertEqual(f.last_tick_time_msc, stamp)
                        self.assertEqual(f.ticks_at_cursor, 2)
                        f.send_line.reset_mock()
                        f.poll()  # No new ticks must not replay the last records.
                        f.send_line.assert_not_called()
                        self.assertEqual(api.copy_ticks_range.call_args.args[2], expected_end)
                        records.append(tick(stamp, 1.21))
                        f.poll()  # A new record at the same millisecond survives.
                        lines = f.send_line.call_args.args[0].splitlines()
                        self.assertEqual(len(lines), 1)
                        self.assertEqual(int(lines[0].split(';')[2]), stamp)
                        self.assertEqual(f.ticks_at_cursor, 3)
                        f.send_line.reset_mock()
                        next_stamp = stamp + 3600001
                        records.append(tick(next_stamp, 1.22))
                        api.symbol_info_tick.return_value = Mock(time_msc=next_stamp)
                        f.poll()  # Follow a changed source clock without a fixed offset.
                        self.assertEqual(f.last_tick_time_msc, next_stamp)
                        self.assertEqual(len(f.send_line.call_args.args[0].splitlines()), 1)
                        f.send_line.reset_mock()
                        f.poll()
                        f.send_line.assert_not_called()
                    self.assertEqual(records[:2], original)

    def test_missing_source_time_waits_and_recovers(self):
        for missing in (None, Mock(time_msc=0)):
            with self.subTest(missing=missing):
                api = self.make_api(1000999)
                api.symbol_info_tick.return_value = missing
                f = self.make_feeder()
                with unittest.mock.patch.object(feeder_module, "mt5", api):
                    self.assertTrue(f.init_symbol("TEST"))
                    f.poll()
                    api.copy_ticks_range.assert_not_called()
                    api.symbol_info_tick.return_value = Mock(time_msc=1000999)
                    api.copy_ticks_range.return_value = [tick(1000999)]
                    f.poll()
                self.assertEqual(f.last_tick_time_msc, 1000999)

    def test_backward_source_clock_requests_existing_history_reload(self):
        api = self.make_api(1000999)
        f = self.make_feeder()
        f.initialized = True
        f.last_tick_time_msc = 8200999
        with unittest.mock.patch.object(feeder_module, "mt5", api):
            f.poll()
            self.assertFalse(f.initialized)
            api.copy_ticks_range.assert_not_called()
            api.copy_ticks_range.return_value = [tick(1000999)]
            self.assertTrue(f.init_symbol("TEST"))
        self.assertEqual(f.last_tick_time_msc, 1000999)

    def test_history_limit_preserves_first_complete_day(self):
        day = 86400000
        records = [tick(day - 1), tick(day + 1000, 1.1)]
        records.extend(tick(day + 2000 + i, 1.2) for i in range(200001))
        api = self.make_api(records[-1]['time_msc'])
        api.copy_ticks_range.return_value = records
        f = self.make_feeder()
        with unittest.mock.patch.object(feeder_module, "mt5", api):
            self.assertTrue(f.init_symbol("TEST"))
        lines = ''.join(call.args[0] for call in f.send_line.call_args_list).splitlines()
        sent = [line.split(';') for line in lines if line.startswith('TICK;')]
        self.assertEqual(len(sent), 200002)
        self.assertEqual(int(sent[0][2]), day + 1000)

    def test_stale_snapshot_within_cursor_second_does_not_reload(self):
        api = self.make_api(1000100)
        f = self.make_feeder()
        f.initialized = True
        f.emit_ticks([tick(1000900)], replay=True)
        f.send_line.reset_mock()
        api.copy_ticks_range.return_value = [tick(1000900), tick(1000900, 1.21)]
        with unittest.mock.patch.object(feeder_module, "mt5", api):
            f.poll()
        self.assertTrue(f.initialized)
        self.assertEqual(f.ticks_at_cursor, 2)
        self.assertEqual(len(f.send_line.call_args.args[0].splitlines()), 1)

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

    def test_chart_price_matches_symbol_mode_for_history_and_live(self):
        for mode, expected in ((0, 1.19), (1, 1.2)):
            for replay in (False, True):
                with self.subTest(mode=mode, replay=replay):
                    f = self.make_feeder()
                    f.chart_mode = mode
                    f.emit_ticks([tick(1000)], replay=replay)
                    price = float(f.send_line.call_args.args[0].split(";")[3])
                    self.assertAlmostEqual(price, expected)

    def test_forex_uses_bid_without_last(self):
        f = self.make_feeder()
        quote = tick(1000)
        quote["last"] = 0
        f.emit_ticks([quote])
        self.assertAlmostEqual(float(f.send_line.call_args.args[0].split(";")[3]), quote["bid"])

    def test_missing_chart_price_does_not_fall_back_to_another_quote(self):
        for mode, field in ((0, "bid"), (1, "last")):
            with self.subTest(mode=mode):
                f = self.make_feeder()
                f.chart_mode = mode
                quote = tick(1000)
                quote[field] = 0
                f.emit_ticks([quote])
                f.send_line.assert_not_called()

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
        info.chart_mode = 1
        api.symbol_info_tick.return_value = Mock(time_msc=1000999)
        api.symbol_info.return_value = info
        api.copy_ticks_range.return_value = []
        api.market_book_add.return_value = False
        with unittest.mock.patch.object(feeder_module, "mt5", api):
            self.assertTrue(f.init_symbol("TEST"))
        self.assertTrue(any(call.args == ("READY\n",) for call in f.send_line.call_args_list))
        self.assertTrue(f.initialized)
        self.assertEqual(f.chart_mode, 1)


if __name__ == "__main__":
    unittest.main()
