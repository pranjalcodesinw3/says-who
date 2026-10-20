#!/usr/bin/env bash
# Break what the tests guard, confirm red, restore, confirm green. Each mutation must change the file and turn the suite red.
# Works on macOS bash 3.2 (no associative arrays).
set -uo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
cur_file=""; cur_bak=""
restore() { [ -n "$cur_file" ] && cp "$cur_bak" "$cur_file"; }
trap restore EXIT

suite() { node --disable-warning=ExperimentalWarning --test test/*.test.ts 2>&1; }
fails() { suite | grep -E "^ℹ fail" | awk '{print $3}'; }
status=0

base=$(fails)
echo "baseline: fail=$base"
[ "$base" = "0" ] || { echo "baseline suite is not green, refusing to mutate"; exit 1; }

mutate() { # name file perl-expression
  local name=$1 file=$2 expr=$3
  cur_file=$file; cur_bak="$tmp/$(basename "$file").bak"; cp "$file" "$cur_bak"
  perl -0pi -e "$expr" "$file"
  if cmp -s "$file" "$cur_bak"; then echo "MUTATION '$name' did not change $file"; status=1; return; fi
  local out red; out=$(suite); red=$(echo "$out" | grep -E "^ℹ fail" | awk '{print $3}')
  echo "mutant '$name': fail=$red"
  echo "$out" | grep -E "^✖" | sort -u | head -6 | sed 's/^/    red: /'
  [ "${red:-0}" -gt 0 ] || { echo "  SURVIVED: the suite cannot see this bug"; status=1; }
  cp "$cur_bak" "$file"
  local green; green=$(fails)
  echo "restored: fail=$green"
  [ "$green" = "0" ] || status=1
  cur_file=""
}

mutate "matcher always returns a hit" src/match.ts 's/(export function findSupport\([^\n]*\{\n)/$1  return { score: 1, index: 0, matched: contentTokens(factText, ownerNames) };\n/'
mutate "forget without checking the tick" src/watch.ts 's/if \(completed && \(await forgetFact/if (true \&\& (await forgetFact/'
mutate "no TV signal at all" src/tv.ts 's/return \{ score: Math\.min\(1, Number\(score\.toFixed\(2\)\)\), reasons \};/return { score: 0, reasons };/'
mutate "cursor saved even when the batch failed" src/watch.ts 's/const cursorSaved = failed === 0 && next !== null;/const cursorSaved = next !== null;/'
mutate "zero-facts gate removed from live-check" scripts/live-check.ts 's/if \(facts\.length === 0\) die\(3/if (false) die(3/'
[ $status -eq 0 ] && echo "ALL MUTANTS KILLED, tree restored green" || echo "MUTATION CHECK FAILED"
exit $status
