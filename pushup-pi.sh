#!/usr/bin/env bash
set -euo pipefail
PUSHUP_PI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$PUSHUP_PI_ROOT/pi-test.sh" --extension "$PUSHUP_PI_ROOT/packages/coding-agent/examples/extensions/pushups/index.ts" "$@"
