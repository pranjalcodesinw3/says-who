#!/usr/bin/env bash
# Demo-day driver, see scripts/demo-day.md. Uses only the real bee CLI (BEE_BIN overrides the path) and the receipts CLI.
# Plays no audio, plants no fact: it waits for Bee itself to write a fact after a TV clip is played near the Watch, then
# shows the receipt, reads the wrist reminder back from Bee, waits for the tick and proves the fact is gone.
# Exit: 0 chain complete, 2 not logged in, 3 no new fact in time, 4 reminder not readable, 5 verdict supported (nothing doubtful),
#       6 reminder not ticked in time, 7 tick seen but fact still readable.
# Env: FAULT_WAIT_FACT_S=600 FAULT_WAIT_TICK_S=300 FAULT_POLL_S=5. Flag: --no-tick stops after the reminder reads back.
set -uo pipefail
cd "$(dirname "$0")/.."
BEE="${BEE_BIN:-node_modules/.bin/bee}"
RCPT=(node --disable-warning=ExperimentalWarning src/cli.ts)
WAIT_FACT_S="${FAULT_WAIT_FACT_S:-600}"
WAIT_TICK_S="${FAULT_WAIT_TICK_S:-300}"
POLL_S="${FAULT_POLL_S:-5}"
NO_TICK=0
[ "${1:-}" = "--no-tick" ] && NO_TICK=1

die() { echo "FAIL($1): $2" >&2; exit "$1"; }
t0=$(date +%s)
mark() { echo "[t+$(( $(date +%s) - t0 ))s] $*"; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);const v=(new Function("o","return "+process.argv[1]))(o);if(v!==undefined&&v!==null)console.log(v)})' "$1"; }

# 0. The gate. `bee status` exits 0 when logged out, `bee me` does not.
if ! me=$("$BEE" me --json 2>/dev/null); then
  die 2 "not logged in to Bee. Run: $BEE login --no-wait, approve the link in the Bee app, then $BEE me"
fi
mark "logged in as $(printf '%s' "$me" | json '[o.first_name,o.last_name].filter(Boolean).join(" ")')"

# every pending fact as "id<TAB>text", following next_cursor like the app does
pending() {
  local cursor="" page n
  for n in $(seq 1 20); do
    if [ -n "$cursor" ]; then page=$("$BEE" facts list --unconfirmed --json --limit 50 --cursor "$cursor") || return 1
    else page=$("$BEE" facts list --unconfirmed --json --limit 50) || return 1; fi
    printf '%s' "$page" | json '(o.facts||[]).map(f=>f.id+"\t"+String(f.text).replace(/\s+/g," ")).join("\n")'
    cursor=$(printf '%s' "$page" | json 'o.next_cursor')
    [ -n "$cursor" ] || return 0
  done
}

base=$(pending) || die 2 "could not read pending facts from Bee"
base_ids=$(printf '%s\n' "$base" | cut -f1 | sed '/^$/d' | sort)
mark "baseline: $(printf '%s\n' "$base_ids" | sed '/^$/d' | wc -l | tr -d ' ') pending fact(s) before the clip"
echo ">>> Play the TV clip next to the Watch now (50+ spoken words, a voice that is not yours)."
echo ">>> Waiting up to ${WAIT_FACT_S}s for Bee to write a new fact."

# 1. Wait for Bee itself to write a fact that was not in the baseline.
new_id=""; new_text=""
deadline=$(( $(date +%s) + WAIT_FACT_S ))
while [ -z "$new_id" ]; do
  [ "$(date +%s)" -lt "$deadline" ] || die 3 "no new fact from Bee within ${WAIT_FACT_S}s. Nothing was planted; play a longer clip and rerun."
  sleep "$POLL_S"
  now=$(pending) || { echo "pending read failed, retrying" >&2; continue; }
  while IFS=$'\t' read -r id text; do
    [ -n "$id" ] || continue
    if ! printf '%s\n' "$base_ids" | grep -qx "$id"; then new_id="$id"; new_text="$text"; break; fi
  done <<< "$now"
done
mark "Bee wrote fact $new_id: \"$new_text\""

# 2. Receipt. `once` is idempotent and shares the ledger with `npm run watch`, so the review page shows this fact live.
"${RCPT[@]}" once >/dev/null || die 4 "says-who once failed"
receipt=$("${RCPT[@]}" receipt "$new_id") || die 4 "no receipt in the ledger for fact $new_id after says-who once"
printf '%s' "$receipt" | json '"verdict " + o.verdict + " | attribution " + o.attribution + " | tv signal " + o.tvScore + "\nline    " + (o.quote ? JSON.stringify(o.quote) : "none") + "\nspeaker " + o.speaker + ", conversation " + o.conversationId + "\nsearched " + o.scope.candidates.length + " conversation(s): " + o.scope.methods.join("; ")'
mark "receipt filed"

todo_id=$(printf '%s' "$receipt" | json 'o.todoId')
if [ -z "$todo_id" ]; then
  verdict=$(printf '%s' "$receipt" | json 'o.verdict')
  die 5 "fact $new_id came back '$verdict', which is not doubtful, so there is no wrist reminder. Play a clip whose speaker is clearly someone else."
fi

# 3. The wrist reminder must be readable back from Bee, with the fact label in its text.
back=$("$BEE" todos get "$todo_id" --json 2>/dev/null) || die 4 "reminder $todo_id is not readable from Bee"
printf '%s' "$back" | json '(o.todo||o).text' | grep -q "\[rcpt:$new_id\]" || die 4 "reminder $todo_id does not carry [rcpt:$new_id]"
mark "wrist reminder $todo_id read back from Bee: $(printf '%s' "$back" | json '(o.todo||o).text')"
if [ "$NO_TICK" = "1" ]; then mark "--no-tick: stopping before the tick"; exit 0; fi

# 4. Wait for the tick on the Watch.
echo ">>> Tick the reminder on the Watch now. Waiting up to ${WAIT_TICK_S}s."
deadline=$(( $(date +%s) + WAIT_TICK_S ))
ticked=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  done_flag=$("$BEE" todos get "$todo_id" --json 2>/dev/null | json '(o.todo||o).completed')
  if [ "$done_flag" = "true" ]; then ticked=1; break; fi
  sleep "$POLL_S"
done
[ "$ticked" = "1" ] || die 6 "reminder $todo_id was not ticked within ${WAIT_TICK_S}s"
mark "tick seen on reminder $todo_id"

# 5. Reconcile, then the post-condition only a real delete can produce: the fact no longer exists in Bee.
"${RCPT[@]}" once >/dev/null || die 7 "says-who once failed after the tick"
if out=$("$BEE" facts get "$new_id" --json 2>&1); then
  die 7 "tick seen but fact $new_id is still readable in Bee"
fi
printf '%s' "$out" | grep -qiE "404|not.?found" || die 7 "facts get $new_id failed for a reason other than not found: $out"
decision=$("${RCPT[@]}" receipt "$new_id" | json '"decision " + o.decision + ", verifiedGone " + o.verifiedGone')
mark "fact $new_id is gone from Bee (facts get: not found). Ledger: $decision"
