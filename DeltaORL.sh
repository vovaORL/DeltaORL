#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$root/ui"
if [[ ! -d node_modules ]]; then npm ci; fi
exec npm run app
