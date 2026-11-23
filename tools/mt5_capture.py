#!/usr/bin/env python3
"""Opt-in loopback TCP relay recording lines actually forwarded to a diagnostic engine.
Use only during an explicitly arranged diagnostic run; this process owns its listen port.
"""
import argparse
import asyncio
import json
from pathlib import Path
import time


async def serve(listen_port, engine_port, output):
    async def accept(reader, writer):
        connection = time.monotonic_ns()
        def record(item):
            output.write(json.dumps({'connection': connection, **item}) + '\n')
            output.flush()
        upstream = None
        try:
            upstream_reader, upstream = await asyncio.open_connection('127.0.0.1', engine_port)
            record({'event': 'connected'})
            async def forward(source, destination, direction):
                buffer = b''
                while data := await source.read(65536):
                    destination.write(data)
                    await destination.drain()
                    buffer += data
                    while b'\n' in buffer:
                        line, buffer = buffer.split(b'\n', 1)
                        record({'direction': direction, 'line': line.decode('utf-8').rstrip('\r')})
                    if len(buffer) > 65536:
                        raise ValueError('Oversized protocol line')
                if buffer:
                    record({'event': 'incomplete_line', 'direction': direction, 'bytes': len(buffer)})
            tasks = [asyncio.create_task(forward(reader, upstream, 'mt5_to_engine')),
                     asyncio.create_task(forward(upstream_reader, writer, 'engine_to_mt5'))]
            try:
                done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    task.result()
            finally:
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
        except (OSError, ValueError) as error:
            record({'event': 'error', 'message': str(error)})
        finally:
            for destination in (writer, upstream):
                if destination:
                    destination.close()
                    await destination.wait_closed()
            record({'event': 'closed'})
    server = await asyncio.start_server(accept, '127.0.0.1', listen_port)
    print(f'127.0.0.1:{listen_port} -> 127.0.0.1:{engine_port}; diagnostic relay active', flush=True)
    async with server:
        await server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--listen-port', required=True, type=int)
    parser.add_argument('--engine-port', required=True, type=int)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.listen_port == args.engine_port or any(not 1 <= p <= 65535 for p in (args.listen_port, args.engine_port)):
        parser.error('Use distinct valid listen/engine ports')
    try:
        with args.output.open('x', encoding='utf-8') as output:
            asyncio.run(serve(args.listen_port, args.engine_port, output))
    except KeyboardInterrupt:
        return 0
    except OSError as error:
        parser.exit(1, str(error) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
