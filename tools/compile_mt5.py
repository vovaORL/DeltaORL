#!/usr/bin/env python3
"""Compile candidates in build/mt5; never copy an EA into an installed terminal."""
import argparse
import hashlib
import json
from pathlib import Path
import os
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', type=Path, default=Path.home() / '.local/share/wineprefixes/mt5')
    args = parser.parse_args()
    installed = args.prefix / 'drive_c/Program Files/MetaTrader 5'
    output = ROOT / 'build/mt5'
    output.mkdir(parents=True, exist_ok=True)
    compiler = ROOT / 'build/mt5-compiler/MetaEditor64.exe'
    compiler.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(installed / 'MetaEditor64.exe', compiler)
    protected = list((installed / 'MQL5/Experts').glob('DeltaBridge.*'))
    before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
    results = []
    for source in (ROOT / 'mql5').glob('DeltaBridge*'):
        if source.suffix in ('.mq5', '.mqh'):
            shutil.copy2(source, output / source.name)
    for source in sorted(output.glob('DeltaBridge*.mq5')):
        log = source.with_suffix('.log')
        artifact = source.with_suffix('.ex5')
        log.unlink(missing_ok=True)
        artifact.unlink(missing_ok=True)
        def wine_path(path):
            return 'Z:' + str(path).replace('/', '\\')
        command = ['wine', str(compiler), '/portable', '/compile:' + wine_path(source), '/log:' + wine_path(log)]
        run = subprocess.run(command, env={**os.environ, 'WINEPREFIX': str(args.prefix)},
                             capture_output=True, timeout=120)
        # Some MetaEditor versions return before flushing their compilation log.
        for _ in range(50):
            if log.exists() and b'Result' in log.read_bytes().replace(b'\x00', b''):
                break
            time.sleep(.1)
        data = log.read_bytes() if log.exists() else b''
        text = data.decode('utf-16' if data.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig', errors='replace')
        passed = artifact.exists() and '0 errors, 0 warnings' in text
        results.append({'source': source.name, 'passed': passed, 'exit_code': run.returncode,
                        'sha256_source': hashlib.sha256(source.read_bytes()).hexdigest(),
                        'sha256_ex5': hashlib.sha256(artifact.read_bytes()).hexdigest() if artifact.exists() else None,
                        'log': text, 'stderr': run.stderr.decode(errors='replace')[-3000:]})
        print(source.name, 'PASS' if passed else 'FAIL')
        print(text)
    after = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
    report = {'installed_ea_unchanged': before == after, 'compilations': results}
    (output / 'compile-report.json').write_text(json.dumps(report, indent=2))
    return 0 if before == after and results and all(r['passed'] for r in results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
