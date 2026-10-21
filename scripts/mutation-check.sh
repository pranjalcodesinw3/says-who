#!/usr/bin/env bash
# Break what the tests guard, confirm red, restore, confirm green. Each mutation must change the file and turn the suite red.
# Works on macOS bash 3.2 (no associative arrays).
set -uo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
cur_file=""; cur_bak=""
restore() { [ -n "$cur_file" ] && cp "$cur_bak" "$cur_file"; }
trap restore EXIT

suite() { env -u AWS_BEARER_TOKEN_BEDROCK node --disable-warning=ExperimentalWarning --test test/*.test.ts 2>&1; }
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
mutate "no TV signal at all" src/tv.ts 's/return \{ score: Math\.min\(1, Number\(score\.toFixed\(2\)\)\), reasons, lineLevel \};/return { score: 0, reasons, lineLevel };/'
mutate "cursor saved even when the batch failed" src/watch.ts 's/const cursorSaved = failed === 0 && next !== null;/const cursorSaved = next !== null;/'
mutate "cursor never passed to bee changed" src/bee.ts 's/api\.changed\(cursor \? \{ cursor \} : undefined\)/api.changed(undefined)/'
mutate "search not scoped to conversations" src/bee.ts 's/filter: "conversations" \}/filter: "all" }/'
mutate "no duplicate/contradiction detection" src/relate.ts 's/(export function relate\([^\n]*\{\n)/$1  return null;\n/'
mutate "contradiction ignores polarity" src/relate.ts 's/theirs\.negative !== mine\.negative && j >= CONTRADICT_JACCARD/j >= CONTRADICT_JACCARD/'
mutate "evidence ignores polarity" src/match.ts 's/if \(isNegative\(bestClause\(window, hit\)\) !== factNegative\) continue;//'
mutate "judge verdict ignored on near-miss" src/provenance.ts 's/if \(receipt\.verdict === "no-evidence" && d\.supports\)/if (receipt.verdict === "no-evidence")/'
mutate "strong support also asks the judge" src/provenance.ts 's/const WEAK_SUPPORT = 0\.8;/const WEAK_SUPPORT = 1.1;/'
mutate "zero-facts gate removed from live-check" scripts/live-check.ts 's/if \(facts\.length === 0\) die\(3/if (false) die(3/'
mutate "search scope not recorded on the receipt" src/provenance.ts 's/receipt = \{ \.\.\.receipt, scope: scopeOf\(\[\.\.\.seen\.values\(\)\], methods, window\) \};//'
mutate "review page hides the search scope" src/page.ts 's/\$\{scope\(r\)\}\n//'
mutate "attribution ignored: any keyword match is support" src/provenance.ts 's/attr\.kind === "self" \? "supported" : tv\.lineLevel && tv\.score >= TV_THRESHOLD \? "likely-tv" : "unattributed"/tv.score >= TV_THRESHOLD ? "likely-tv" : "supported"/'
mutate "conversation-level cues alone convict a line" src/provenance.ts 's/attr\.kind === "self" \? "supported" : tv\.lineLevel && tv\.score >= TV_THRESHOLD \? "likely-tv" : "unattributed"/tv.score >= TV_THRESHOLD ? "likely-tv" : attr.kind === "self" ? "supported" : "unattributed"/'
mutate "likely-tv without a line-level cue" src/provenance.ts 's/tv\.lineLevel && tv\.score >= TV_THRESHOLD \? "likely-tv"/tv.score >= TV_THRESHOLD ? "likely-tv"/'
mutate "Unknown is a default wearer label again" src/tv.ts 's/"you,me,user,owner,wearer"/"unknown,you,me,user,owner,wearer"/'
mutate "non-wearer speaker does not block self attribution" src/match.ts 's/  if \(kind === "other"\) return \{ kind: "other", why: \`the line was spoken by/  if (false) return { kind: "other", why: \`the line was spoken by/'
mutate "relations and pronouns no longer name someone else" src/match.ts 's/(export function subjectOf\([^\n]*\{\n)/$1  const f = FIRST_RE.exec(clause); if (f) return { kind: "self", cue: f[0] };\n/'
mutate "wrist prompt drops the say-or-hear question" src/watch.ts 's/const ask = "Did you say it, or hear it\?";/const ask = "Looks like TV.";/'
mutate "a decision does not bump the change counter" src/ledger.ts 's/verified_gone = \?, rev = \$\{NEXT_REV\} WHERE/verified_gone = ? WHERE/'
mutate "live feed replays the whole ledger on connect" src/server.ts 's/let last = Number\.isFinite\(resumed\)[^\n]*;/let last = 0;/'
mutate "demo-day script runs without a Bee login" scripts/forced-fault.sh 's/if ! me=\$\(/if false \&\& me=\$(/'
mutate "demo-day script accepts an unticked reminder" scripts/forced-fault.sh 's/\[ "\$ticked" = "1" \] \|\| die 6[^\n]*\n//'
mutate "demo-day script skips the gone read-back" scripts/forced-fault.sh 's/if out=\$\("\$BEE" facts get "\$new_id" --json 2>&1\); then/if false; then/'
mutate "page drops Receipts' reading beside Bee's speaker label" src/page.ts 's/\n      \$\{attribution\(r\)\}//'
mutate "receipt of the day picks the least doubtful receipt" src/page.ts 's/URGENCY\[b\.verdict\] - URGENCY\[a\.verdict\]/URGENCY[a.verdict] - URGENCY[b.verdict]/'
mutate "demo buttons write to the real ledger" src/server.ts 's/d = await \(demo \?\?= buildDemo\(\)\);/d = d0;/'
mutate "restart forgets receipts that never got a to-do" src/watch.ts 's/\n    await resumePending\(d\);//'
mutate "restart loses the saved cursor" src/ledger.ts 's/const r = db\.prepare\("SELECT v FROM kv WHERE k = .cursor."\)\.get\(\);\n      return r \? String\(r\.v\) : undefined;/return undefined;/'
[ $status -eq 0 ] && echo "ALL MUTANTS KILLED, tree restored green" || echo "MUTATION CHECK FAILED"
exit $status
