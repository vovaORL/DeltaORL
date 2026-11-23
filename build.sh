#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$root"
build_engine=true
build_ui=true
run_tests=false
for argument in "$@"; do
    case "$argument" in
        --ui-only) build_engine=false ;;
        --engine-only) build_ui=false ;;
        --test) run_tests=true ;;
        *) echo "Usage: build.sh [--ui-only | --engine-only] [--test]" >&2; exit 2 ;;
    esac
done
if "$build_engine"; then
    cmake -S engine -B build/cmake -DCMAKE_BUILD_TYPE=Release
    cmake --build build/cmake --parallel "${CMAKE_BUILD_PARALLEL_LEVEL:-2}"
    if "$run_tests"; then ctest --test-dir build/cmake --output-on-failure; fi
    install -m 755 build/cmake/delta_engine build/delta_engine
    install -m 755 build/cmake/delta_engine engine/delta_engine
fi
if "$build_ui"; then
    cd "$root/ui"
    if [[ ! -d node_modules ]]; then npm ci; fi
    npm run build
    if "$run_tests"; then npm test; fi
fi
