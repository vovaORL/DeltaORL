#!/usr/bin/env python3
"""Compatibility entry point; implementation lives in engine/mt5_feeder.py."""
import runpy
from pathlib import Path

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).parent / "engine" / "mt5_feeder.py"), run_name="__main__")
