#!/usr/bin/env bash
# Record the real-account demo day. Starts the watch loop with the review page, records the screen, runs scripts/forced-fault.sh
# (TV clip near the Watch, Bee writes a fact, receipt, wrist reminder, tick, read-back) and files everything under recordings/<stamp>/:
#   run.log (the driver output), watch.log (the loop), timings.txt (the t+ marks), receipt-<id>.json (the stored receipt), screen.mov.
# Needs a logged-in Bee. Exit: the driver's exit code (0 complete, 2 not logged in, 3..7 see forced-fault.sh), 8 recorder failed to start.
# Env: RECORD_SECONDS=900 (screen length), RECORD_SCREEN=0 skips the screen recording, RECORD_OPEN=0 does not open the page in deepsurge,
#      RECEIPTS_INTERVAL_S=10 (loop interval), plus every FAULT_* variable of forced-fault.sh. Extra arguments go to forced-fault.sh.
set -uo pipefail
cd "$(dirname "$0")/.."
BEE="${BEE_BIN:-node_modules/.bin/bee}"
RCPT=(node --disable-warning=ExperimentalWarning src/cli.ts)

# The gate comes before anything is created or started.
if ! "$BEE" me --json >/dev/null 2>&1; then
  echo "FAIL(2): not logged in to Bee. Run: $BEE login --no-wait, approve the link in the Bee app, then $BEE me" >&2
  exit 2
fi

out="recordings/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"
watch_pid=""; rec_pid=""
cleanup() {
  [ -n "$rec_pid" ] && kill -INT "$rec_pid" 2>/dev/null && wait "$rec_pid" 2>/dev/null
  [ -n "$watch_pid" ] && kill "$watch_pid" 2>/dev/null && wait "$watch_pid" 2>/dev/null
  return 0
}
trap cleanup EXIT

RECEIPTS_INTERVAL_S="${RECEIPTS_INTERVAL_S:-10}" "${RCPT[@]}" watch --serve > "$out/watch.log" 2>&1 &
watch_pid=$!
url=""
for _ in $(seq 1 50); do
  url=$(grep -o 'http://127.0.0.1:[0-9]*' "$out/watch.log" | head -1)
  [ -n "$url" ] && break
  kill -0 "$watch_pid" 2>/dev/null || { cat "$out/watch.log" >&2; echo "FAIL(8): the watch loop exited before the review page came up" >&2; exit 8; }
  sleep 0.2
done
[ -n "$url" ] || { echo "FAIL(8): the review page never came up, see $out/watch.log" >&2; exit 8; }
echo "review page: $url   recording into $out"

if [ "${RECORD_OPEN:-1}" = "1" ] && command -v bhn >/dev/null 2>&1; then
  bhn deepsurge open "$url" >/dev/null 2>&1 || echo "could not open $url in deepsurge; open it by hand" >&2
fi

if [ "${RECORD_SCREEN:-1}" = "1" ]; then
  command -v screencapture >/dev/null 2>&1 || { echo "FAIL(8): screencapture is not available; set RECORD_SCREEN=0 to record logs only" >&2; exit 8; }
  screencapture -v -x -V "${RECORD_SECONDS:-900}" "$out/screen.mov" 2> "$out/screen.err" &
  rec_pid=$!
  sleep 3
  kill -0 "$rec_pid" 2>/dev/null || { echo "FAIL(8): the screen recorder stopped at once: $(cat "$out/screen.err")" >&2; rec_pid=""; exit 8; }
  echo "screen recording started"
fi

bash scripts/forced-fault.sh "$@" 2>&1 | tee "$out/run.log"
status=${PIPESTATUS[0]}

grep -E '^\[t\+[0-9]+s\]' "$out/run.log" > "$out/timings.txt"
id=$(grep -o 'Bee wrote fact [0-9]*' "$out/run.log" | head -1 | grep -o '[0-9]*$')
[ -n "$id" ] && "${RCPT[@]}" receipt "$id" > "$out/receipt-$id.json" 2>/dev/null

cleanup; rec_pid=""; watch_pid=""
echo "--- recorded files"
ls -l "$out" | tail -n +2
exit "$status"
