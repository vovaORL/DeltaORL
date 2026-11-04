#!/usr/bin/env python3
"""MT5 transport. One canonical feeder is shared by all launchers."""
import argparse
import ctypes
import logging
import math
import os
from pathlib import Path
import select
import socket
import sys
import time
from datetime import datetime, timedelta, timezone

logger = logging.getLogger("MT5Feeder")
mt5 = None  # Loaded by main; transport/cursor logic can be tested without MT5.
_single_instance_mutex = None


def ensure_single_instance(port=9190):
    global _single_instance_mutex
    if os.name != "nt":
        return True
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    kernel.CreateMutexW.restype = ctypes.c_void_p
    name = "Global\\DeltaORL_MT5_Feeder_SingleInstance_Mutex" + (f"_{port}" if port != 9190 else "")
    _single_instance_mutex = kernel.CreateMutexW(None, True, name)
    if not _single_instance_mutex:
        raise ctypes.WinError(ctypes.get_last_error())
    return ctypes.get_last_error() != 183


def read_origin(path):
    data = Path(path).read_bytes()
    encoding = "utf-16" if data.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
    return data.decode(encoding).strip().rstrip("\x00")


def resolve_terminal_path(input_path=""):
    if input_path:
        p = os.path.normpath(input_path.strip('"\' '))
        if os.path.isfile(p) and p.lower().endswith(".exe"):
            return p
        if os.path.isdir(p):
            t = os.path.join(p, "terminal64.exe")
            if os.path.isfile(t):
                return t
            orig = os.path.join(p, "origin.txt")
            if os.path.isfile(orig):
                try:
                    t2 = os.path.join(read_origin(orig), "terminal64.exe")
                    if os.path.isfile(t2):
                        return t2
                except Exception:
                    pass
        return None

    candidates = [
        r"C:\Program Files\MetaTrader 5\terminal64.exe",
        r"C:\Program Files (x86)\MetaTrader 5\terminal64.exe",
        r"C:\Program Files\RoboForex MT5 Terminal\terminal64.exe",
        r"C:\Program Files\MetaTrader 5 IC Markets\terminal64.exe"
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c

    appdata = os.environ.get("APPDATA", "")
    if appdata:
        term_dir = os.path.join(appdata, "MetaQuotes", "Terminal")
        if os.path.isdir(term_dir):
            for entry in os.listdir(term_dir):
                orig = os.path.join(term_dir, entry, "origin.txt")
                if os.path.isfile(orig):
                    try:
                        t2 = os.path.join(read_origin(orig), "terminal64.exe")
                        if os.path.isfile(t2):
                            return t2
                    except Exception:
                        pass
    return None

class MT5DirectFeeder:
    def __init__(self, engine_host="127.0.0.1", engine_port=9190, mt5_path=None, symbol="EURUSD"):
        self.engine_host = engine_host
        self.engine_port = engine_port
        self.input_path = mt5_path or ""
        self.mt5_path = None
        self.current_symbol = symbol
        self.sock = None
        self.running = False
        self.initialized = False
        self.command_buffer = b""
        self.last_tick_time_msc = 0
        self.ticks_at_cursor = 0
        self.last_price = 0.0
        self.chart_mode = 0  # SYMBOL_CHART_MODE_BID; refreshed for each symbol.
        self.last_side = 1
        self.book_symbol = None
        self.last_book = 0.0
        self.last_retry = 0.0
        self.last_error = None

    def disconnect_engine(self):
        if self.sock:
            self.sock.close()
        self.sock = None
        self.command_buffer = b""

    def connect_engine(self):
        self.disconnect_engine()
        try:
            self.sock = socket.create_connection((self.engine_host, self.engine_port), timeout=2)
            self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            self.sock.settimeout(5)
            logger.info("Engine connected")
            return True
        except OSError:
            self.disconnect_engine()
            return False

    def send_line(self, text):
        if not self.sock:
            raise ConnectionError("Engine is disconnected")
        try:
            self.sock.sendall(text.encode("utf-8"))
        except OSError:
            self.disconnect_engine()
            raise

    def report_error(self, message):
        message = str(message).replace("\n", " ").replace("\r", " ").replace(";", ",")
        if message != self.last_error:
            logger.error(message)
            self.send_line(f"ERROR;{self.current_symbol};{message}\n")
            self.last_error = message

    def release_book(self):
        if self.book_symbol:
            mt5.market_book_release(self.book_symbol)
            self.book_symbol = None

    def connect_mt5(self):
        self.mt5_path = resolve_terminal_path(self.input_path)
        if self.input_path and not self.mt5_path:
            self.report_error("Не знайдено terminal64.exe за вказаним шляхом.")
            return False
        ok = mt5.initialize(path=self.mt5_path, timeout=10000) if self.mt5_path else mt5.initialize(timeout=10000)
        if not ok:
            self.report_error(f"MT5 initialize: {mt5.last_error()}")
        elif not mt5.terminal_info() or not mt5.terminal_info().connected:
            self.report_error("MT5 не підключено до брокера. Перевірте вхід у торговий рахунок у терміналі.")
            return False
        return ok

    def get_cluster_tick_size(self, symbol, info):
        digits = info.digits
        point = info.point
        trade_tick_size = info.trade_tick_size

        sym_upper = symbol.upper()
        # 1. JPY currency pairs check FIRST (tick size 0.01)
        if "JPY" in sym_upper:
            return 0.01, digits
        elif "XAU" in sym_upper or "GOLD" in sym_upper:
            return 0.10, digits
        elif "XAG" in sym_upper or "SILVER" in sym_upper:
            return 0.01, digits
        elif "BTC" in sym_upper:
            return 1.0, digits
        elif "ETH" in sym_upper:
            return 0.10, digits
        elif "SOL" in sym_upper or "BNB" in sym_upper:
            return 0.05, digits
        elif "US30" in sym_upper or "DJI" in sym_upper or "DJ30" in sym_upper or "DOW" in sym_upper or "WALLSTREET" in sym_upper:
            return 1.0, digits
        elif "NAS100" in sym_upper or "US100" in sym_upper or "USTEC" in sym_upper or "NDX" in sym_upper or "TECH" in sym_upper:
            return 0.25, digits
        elif "US500" in sym_upper or "SPX" in sym_upper or "SP500" in sym_upper:
            return 0.10, digits
        elif "GER40" in sym_upper or "DAX" in sym_upper:
            return 0.50, digits
        elif "OIL" in sym_upper or "WTI" in sym_upper or "BRENT" in sym_upper:
            return 0.01, digits
        elif "GAS" in sym_upper or "NGAS" in sym_upper:
            return 0.005, digits
        elif digits == 5 or digits == 4:
            # Forex standard 1-pip cluster grid (0.0001)
            return 0.0001, digits
        elif digits == 3 or digits == 2:
            return 0.01, digits
        else:
            return trade_tick_size if trade_tick_size > 0 else (point if point > 0 else 0.0001), digits

    def emit_ticks(self, ticks, replay=False):
        # The cursor includes the number of records at its timestamp. Distinct
        # trades sharing one millisecond must all survive inclusive MT5 queries.
        boundary = self.last_tick_time_msc
        skip = self.ticks_at_cursor if not replay else 0
        lines = []
        for t in ticks:
            stamp = int(t["time_msc"])
            if not replay:
                if stamp < boundary:
                    continue
                if stamp == boundary and skip:
                    skip -= 1
                    continue
            if stamp > self.last_tick_time_msc:
                self.last_tick_time_msc = stamp
                self.ticks_at_cursor = 0
            self.ticks_at_cursor += 1
            flags = int(t["flags"])
            bid, ask, last = float(t["bid"]), float(t["ask"]), float(t["last"])
            volume = float(t["volume_real"]) if t["volume_real"] > 0 else float(t["volume"] if t["volume"] > 0 else 1)
            # Match the symbol's MT5 chart, including symbols with a nonzero
            # Last quote whose chart is nevertheless configured to use Bid.
            price = last if self.chart_mode == 1 else bid
            if not all(math.isfinite(v) for v in (price, volume, bid, ask)) or price <= 0 or volume <= 0:
                continue
            if flags & 32:
                side = 1
            elif flags & 64:
                side = -1
            elif last > 0 and ask > 0 and last >= ask:
                side = 1
            elif last > 0 and bid > 0 and last <= bid:
                side = -1
            elif price == self.last_price:
                side = self.last_side
            else:
                side = 1 if price > self.last_price else -1
            self.last_price, self.last_side = price, side
            lines.append(f"TICK;{self.current_symbol};{stamp};{price:.12g};{volume:.12g};{side};{bid:.12g};{ask:.12g}\n")
            if len(lines) >= 2000:
                self.send_line("".join(lines))
                lines.clear()
        if lines:
            self.send_line("".join(lines))

    def tick_range_end(self):
        latest = mt5.symbol_info_tick(self.current_symbol)
        if latest is None or latest.time_msc <= 0:
            return None
        # Use the source clock, not the PC clock. Include the entire latest
        # second because some MT5 builds truncate datetime arguments to seconds.
        # Re-querying that second also retains additional ticks at the cursor.
        return datetime.fromtimestamp(int(latest.time_msc) // 1000 + 1, timezone.utc)

    def init_symbol(self, symbol):
        self.release_book()
        self.initialized = False
        self.current_symbol = symbol.strip()
        info = mt5.symbol_info(self.current_symbol)
        if info is None:
            symbols = mt5.symbols_get() or []
            upper = self.current_symbol.upper()
            candidates = sorted(symbols, key=lambda item: (
                0 if item.name.upper() == upper else 1 if item.name.upper().startswith(upper) else 2,
                len(item.name), item.name))
            info = next((item for item in candidates if upper in item.name.upper()), None)
        if info is None or not mt5.symbol_select(info.name, True):
            self.report_error(f"Символ {symbol} не знайдено або недоступний у MT5.")
            return False
        self.current_symbol = info.name
        self.chart_mode = int(info.chart_mode)
        self.last_tick_time_msc = 0
        self.ticks_at_cursor = 0
        self.last_price = 0
        self.last_side = 1
        self.last_error = None
        terminal, account = mt5.terminal_info(), mt5.account_info()
        broker = account.company if account else (terminal.company if terminal else "MT5")
        broker = broker.replace("\n", " ").replace("\r", " ")
        self.send_line(f"INFO;{broker}\n")
        step, digits = self.get_cluster_tick_size(info.name, info)
        self.send_line(f"HELLO;{info.name};{step:.12g};{digits}\n")
        end = self.tick_range_end()
        ticks = None
        if end is not None:
            start = (end - timedelta(days=5)).replace(hour=0, minute=0, second=0, microsecond=0)
            ticks = mt5.copy_ticks_range(info.name, start, end, mt5.COPY_TICKS_ALL)
            if ticks is None or len(ticks) < 1000:
                start = (end - timedelta(days=10)).replace(hour=0, minute=0, second=0, microsecond=0)
                ticks = mt5.copy_ticks_range(info.name, start, end, mt5.COPY_TICKS_ALL)
        if ticks is not None and len(ticks):
            # Extend the nominal tick limit back to midnight. Cutting by count
            # creates a partial first candle on every timeframe up to D1.
            index = max(0, len(ticks) - 200000)
            day_start = int(ticks[index]["time_msc"]) // 86400000 * 86400000
            while index > 0 and int(ticks[index - 1]["time_msc"]) >= day_start:
                index -= 1
            self.emit_ticks(ticks[index:], replay=True)
        else:
            logger.info("No tick history; waiting for live quotes")
        self.send_line("READY\n")
        self.initialized = True
        if mt5.market_book_add(info.name):
            self.book_symbol = info.name
        logger.info("Streaming %s", info.name)
        return True

    def check_engine_commands(self):
        if not self.sock:
            return
        readable, _, _ = select.select([self.sock], [], [], 0)
        if not readable:
            return
        data = self.sock.recv(16384)
        if not data:
            raise ConnectionError("Engine closed connection")
        self.command_buffer += data
        if len(self.command_buffer) > 65536:
            raise ConnectionError("Command buffer exceeded limit")
        reinitialize = False
        path_changed = False
        target = self.current_symbol
        while b"\n" in self.command_buffer:
            line, self.command_buffer = self.command_buffer.split(b"\n", 1)
            command, _, value = line.decode("utf-8").strip().partition(";")
            if command == "SWITCH" and value:
                target = value
                reinitialize = True
            elif command == "RELOAD":
                reinitialize = True
            elif command == "PATH":
                self.input_path = value
                path_changed = reinitialize = True
        if reinitialize:
            self.last_error = None
            self.current_symbol = target
            if path_changed:
                self.release_book()
                mt5.shutdown()
                self.initialized = False
            if self.connect_mt5():
                self.init_symbol(target)
            else:
                self.initialized = False

    def poll(self):
        terminal = mt5.terminal_info()
        if terminal is None or not terminal.connected:
            self.initialized = False
            self.report_error("MT5 не підключено до брокера. Очікування відновлення з'єднання.")
            return
        end = self.tick_range_end()
        if end is None:
            return  # No source timestamp yet; retry without inventing a clock.
        if int(end.timestamp()) * 1000 <= self.last_tick_time_msc:
            # A source clock rollback makes the old cursor invalid. Reuse the
            # existing HELLO/history reload so the engine replaces that stream.
            logger.warning("MT5 tick clock moved behind cursor; reloading history")
            self.initialized = False
            return
        start_ms = self.last_tick_time_msc or int(end.timestamp() * 1000) - 5000
        # Start at the whole second to retain all records at the cursor even
        # with MT5 builds that round datetime parameters to seconds.
        start = datetime.fromtimestamp(start_ms // 1000, timezone.utc)
        ticks = mt5.copy_ticks_range(self.current_symbol, start, end, mt5.COPY_TICKS_ALL)
        if ticks is None:
            logger.warning("copy_ticks_range: %s", mt5.last_error())
        elif len(ticks):
            self.emit_ticks(ticks)
        if self.book_symbol and time.monotonic() - self.last_book >= 0.5:
            self.last_book = time.monotonic()
            book = mt5.market_book_get(self.book_symbol)
            rows = []
            for entry in (() if book is None else book):
                if entry.type not in (mt5.BOOK_TYPE_BUY, mt5.BOOK_TYPE_SELL):
                    continue
                volume = entry.volume_dbl if entry.volume_dbl > 0 else entry.volume
                kind = 1 if entry.type == mt5.BOOK_TYPE_BUY else 2
                if entry.price > 0 and volume >= 0:
                    rows.append(f"{entry.price:.12g},{volume:.12g},{kind}")
                if len(rows) == 200:
                    break
            self.send_line(f"DOM;{self.current_symbol};{len(rows)}" + (";" + ";".join(rows) if rows else "") + "\n")

    def run(self):
        self.running = True
        try:
            while self.running:
                try:
                    if not self.sock:
                        if not self.connect_engine():
                            time.sleep(1)
                            continue
                        self.initialized = False
                        self.last_error = None
                        self.last_retry = 0
                    self.check_engine_commands()
                    if not self.initialized:
                        if time.monotonic() - self.last_retry >= 3:
                            self.last_retry = time.monotonic()
                            if self.connect_mt5():
                                self.init_symbol(self.current_symbol)
                    else:
                        self.poll()
                    time.sleep(0.02)
                except (OSError, ConnectionError):
                    self.disconnect_engine()
                    self.initialized = False
                    time.sleep(0.5)
                except Exception:
                    logger.exception("Feeder error")
                    self.initialized = False
                    time.sleep(0.5)
        except KeyboardInterrupt:
            pass
        finally:
            self.close()

    def close(self):
        self.running = False
        self.disconnect_engine()
        self.release_book()
        mt5.shutdown()


def main():
    global mt5
    parser = argparse.ArgumentParser(description="DeltaORL MT5 feeder")
    parser.add_argument("--path", default="")
    parser.add_argument("--symbol", default="EURUSD")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9190)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s",
                        handlers=[logging.FileHandler(Path(__file__).with_suffix(".log"), encoding="utf-8"), logging.StreamHandler()])
    if not ensure_single_instance(args.port):
        logger.info("Feeder is already running")
        return 0
    try:
        import MetaTrader5 as api
        mt5 = api
    except ImportError:
        logger.error("Install dependencies: python -m pip install -r engine/requirements.txt")
        try:
            with socket.create_connection((args.host, args.port), timeout=3) as sock:
                sock.sendall(f"ERROR;{args.symbol};Python: встановіть пакет MetaTrader5 (engine/requirements.txt).\n".encode("utf-8"))
        except OSError:
            pass
        return 1
    feeder = MT5DirectFeeder(args.host, args.port, args.path, args.symbol)
    feeder.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
