"""Linux TCP receiver contract: preserve broker quote fields and wire ordering."""
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(sys.platform == 'linux' and shutil.which('c++'), 'Requires Linux C++ compiler')
class BridgeTransportTests(unittest.TestCase):
    def test_bid_ask_milliseconds_and_duplicate_order_are_preserved(self):
        source = r'''
#include "MT5Receiver.hpp"
#include <atomic>
#include <chrono>
#include <iomanip>
#include <iostream>
#include <thread>
int main(int argc, char** argv) {
    if (argc != 2) return 2;
    delta::MT5Receiver receiver(std::stoi(argv[1]));
    std::atomic<bool> ready{false};
    receiver.set_tick_callback([](const delta::Tick& tick) {
        std::cout << std::setprecision(17) << "QUOTE_JSON:[" << tick.time_msc << ","
                  << tick.bid << "," << tick.ask << "," << tick.price << ","
                  << tick.volume << "," << static_cast<int>(tick.side) << "]" << std::endl;
    });
    receiver.set_ready_callback([&] { ready = true; });
    if (!receiver.start()) return 3;
    auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    while (!ready && std::chrono::steady_clock::now() < deadline)
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    receiver.stop();
    return ready ? 0 : 4;
}
'''
        with tempfile.TemporaryDirectory(prefix='deltaorl-receiver-') as directory:
            directory = Path(directory)
            cpp, executable = directory / 'receiver.cpp', directory / 'receiver'
            cpp.write_text(source)
            subprocess.run(['c++', '-std=c++20', '-pthread', '-I', str(ROOT / 'engine/include'),
                            str(cpp), str(ROOT / 'engine/src/MT5Receiver.cpp'), '-o', str(executable)],
                           check=True, capture_output=True)
            with socket.socket() as reserve:
                reserve.bind(('127.0.0.1', 0))
                port = reserve.getsockname()[1]
            process = subprocess.Popen([str(executable), str(port)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                for _ in range(100):
                    try:
                        client = socket.create_connection(('127.0.0.1', port), timeout=1)
                        break
                    except OSError:
                        time.sleep(.02)
                else:
                    self.fail('Receiver did not listen')
                expected = [[1794480000123, 1.08491, 1.08513, 1.08502, 2, 1],
                            [1794480000123, 1.08492, 1.08514, 1.08503, 3, -1],
                            [1794480000122, 1.08490, 1.08512, 1.08501, 4, 1]]
                wire = 'INFO;Fixture only\nHELLO;EURUSD;0.0001;5\n'
                for stamp, bid, ask, price, volume, side in expected:
                    wire += f'TICK;EURUSD;{stamp};{price};{volume};{side};{bid};{ask}\n'
                with client:
                    client.sendall((wire + 'READY\n').encode())
                    output, errors = process.communicate(timeout=8)
                self.assertEqual(process.returncode, 0, errors.decode())
                self.assertEqual([json.loads(line.removeprefix(b"QUOTE_JSON:")) for line in output.splitlines() if line.startswith(b"QUOTE_JSON:")], expected)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()


if __name__ == '__main__':
    unittest.main()
