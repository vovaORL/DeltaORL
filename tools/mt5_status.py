#!/usr/bin/env python3
"""Read-only DeltaORL WebSocket diagnostics; never occupies the MT5 TCP port."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import time


def observe(port, seconds, snapshot_path=None):
    with socket.create_connection(('127.0.0.1', port), timeout=3) as sock:
        key = base64.b64encode(os.urandom(16)).decode()
        sock.sendall((f'GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\n'
                      f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        buffer = bytearray()

        def read(size):
            while len(buffer) < size:
                chunk = sock.recv(65536)
                if not chunk:
                    raise ConnectionError('Engine closed the connection')
                buffer.extend(chunk)
            data = bytes(buffer[:size])
            del buffer[:size]
            return data

        while b'\r\n\r\n' not in buffer:
            chunk = sock.recv(4096)
            if not chunk:
                raise ConnectionError('No WebSocket handshake')
            buffer.extend(chunk)
            if len(buffer) > 65536:
                raise ValueError('Oversized handshake')
        headers, remaining = bytes(buffer).split(b'\r\n\r\n', 1)
        buffer[:] = remaining
        expected = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
        if not headers.startswith(b'HTTP/1.1 101 ') or expected not in headers:
            raise ValueError('Invalid WebSocket handshake')
        deadline = time.monotonic() + seconds
        live_ticks = 0
        stats = None
        snapshot = None
        while time.monotonic() < deadline:
            sock.settimeout(max(.01, deadline - time.monotonic()))
            try:
                first, second = read(2)
                length = second & 127
                if length == 126:
                    length = struct.unpack('!H', read(2))[0]
                elif length == 127:
                    length = struct.unpack('!Q', read(8))[0]
                if length > 32 * 1024 * 1024:
                    raise ValueError('Oversized WebSocket frame')
                payload = read(length)
            except TimeoutError:
                break
            if first & 15 == 8:
                break
            if first & 15 != 1:
                continue
            data = json.loads(payload)
            if data.get('type') == 'snapshot':
                snapshot = {**data, 'verification_closed_before': max((bar['time'] for bar in data['candles']), default=0)}
            if data.get('type') == 'stats' and data != stats:
                stats = data
                print(json.dumps(data, ensure_ascii=False), flush=True)
            elif data.get('type') == 'tick':
                live_ticks += 1
        if snapshot_path and snapshot is not None:
            Path(snapshot_path).write_text(json.dumps(snapshot, ensure_ascii=False) + '\n')
        print(json.dumps({'live_tick_messages_observed': live_ticks,
                          'warning': 'TCP/Connected alone does not prove a live broker stream; verify broker and current ticks.'}))
        return 0 if stats and stats.get('mt5_connected') and live_ticks > 0 else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=9191)
    parser.add_argument('--seconds', type=float, default=10)
    parser.add_argument('--snapshot', type=Path, help='Save the latest received snapshot without changing timeframe')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or not 0 < args.seconds <= 300:
        parser.error('port must be 1..65535 and seconds must be >0 and <=300')
    try:
        return observe(args.port, args.seconds, args.snapshot)
    except (OSError, ValueError) as error:
        print(f'Disconnected: {error}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
