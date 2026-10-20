#!/usr/bin/env bash
# Spikes S1-S3 from docs/tracks/bee.md against the real, logged-in Bee account.
# Exit 2 not logged in, 3 zero facts, 4 spike failed. Env: S1_WINDOW_H=3 S2_TRIALS=1 (use 5) S2_TIMEOUT_S=90 S3_TRUE_FACT="..."
set -uo pipefail
cd "$(dirname "$0")/.."
BEE="${BEE_BIN:-node_modules/.bin/bee}"
# `bee status` exits 0 when logged out, so the gate is `bee me`, which exits 1.
if ! "$BEE" me --json >/dev/null 2>&1; then
  echo "FAIL: not logged in to Bee. Run: $BEE login --no-wait, approve in the Bee app, then $BEE me" >&2
  exit 2
fi
exec node --disable-warning=ExperimentalWarning scripts/live-check.ts
