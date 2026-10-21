# Receipts

Bee writes facts about you from everything its microphone hears, including the TV. Receipts gives every one of those facts a receipt: the verbatim utterance that caused it, who said it, when, and a heuristic TV signal for that conversation. The doubtful ones reach your wrist as a Bee reminder. Tick it and the fact is gone from Bee, read back to prove it.

```
# example receipt on a fixture conversation
fact 2 "Dave is a criminal lawyer" -> likely-tv
  heard   "He is a criminal lawyer with a reputation for getting his clients out of anything..."
  speaker Speaker 2, 9:14 PM, conversation 102
  tv signal 1.00 (heuristic) : spoken by a non-wearer, 3 other voices, scripted cadence, show cue "previously on"
  wrist   reminder 500  ->  Bee wrote "Dave is a criminal lawyer". Did you say it, or hear it? Heard 9:14 PM, Speaker 2: "He is a criminal lawyer with a reputation ...". Tick = forget [rcpt:2]
```

## How it works

1. `receipts watch` reads the `bee changed` cursor every 60 seconds and saves the cursor only after the batch is processed.
2. Each new fact is searched against conversations: BM25 first, the most recent conversations next, neural search only when those find nothing. Candidates are re-read through `conversations get` and matched on **utterances**. Bee's AI-written summaries are never evidence and never quoted.
3. The verdict is one of `supported`, `likely-tv`, `unattributed` (a line matches the words but nothing ties it to the wearer), `no-evidence`, `duplicate` (the same claim as an older stored fact) or `contradicts` (opposes a fact the wearer confirmed). `supported` needs attribution: a wearer label or first-person wording, so "my brother is vegan" never supports "is vegan". `Unknown` speaker labels count as unknown attribution, never as the wearer. Negation is read per clause, so "does not like oat milk" is never supported by "I switched to oat milk". The TV signal is a heuristic sum of cues (who spoke the line, other voices, scripted cadence, show and podcast cues, third person), not a probability, and `likely-tv` needs a cue on the line itself, so the wearer's own sentence inside a TV-like room stays `supported`. Every receipt lists the conversations read, their times, the search window and the method, and `no-evidence` means a bounded search found nothing.
4. Every verdict except `supported` becomes a Bee reminder with `alarm_at` set to now, phrased as a question ("Did you say it, or hear it?") over the matching line, or for `no-evidence` the number of conversations searched. The fact id rides in the reminder text as `[rcpt:<id>]`.
5. A stream wake-up on the reminder-updated event, plus a poll, finds the ticked reminder. Receipts runs `facts delete`, then `facts get` and only records the decision when Bee answers not found.
6. Facts the wearer already confirmed get a receipt and no reminder. Supported facts are confirmed from the review page, with a read-back on `confirmed`.

Every receipt is stored in a local SQLite ledger (fact id, verdict, 25-word quote, speaker, time, TV score, decision), which keeps the evidence after Bee's history window and after Bee deletes short recordings.

## Run it

```bash
npm install
npx bee login --no-wait          # approve the link in the Bee app, then: npx bee me
npm run doctor                   # account, confirmed and pending fact counts
npm run watch                    # loop + review page on http://127.0.0.1:8790
npm run why "criminal lawyer"    # receipt for one stored fact
npm run report                   # provenance counts and the wearer's decisions
```

Environment: `RECEIPTS_DB` (default `.receipts/ledger.db`), `RECEIPTS_PORT` (8790), `RECEIPTS_INTERVAL_S` (60), `RECEIPTS_WEARER_SPEAKERS` (speaker labels that mean the wearer, default `you,me,user,owner,wearer`; add `unknown` only if your device labels you so), `RECEIPTS_SHOW_NAMES` (extra show cues, comma separated), `BEE_BIN` (path to a different `bee`).

## Agent Skill

`skills/receipts/SKILL.md` (bundled as `skills/receipts.skill`, the same single-entry zip format as `bee-computer/bee-skill`) teaches Claude Code or any skills-capable agent to answer "why does Bee think I'm a lawyer?" with the receipt: verbatim quote, speaker, time, TV score, verdict. It also carries the same check as plain bee-cli commands for machines without this repo. A test ties the skill to the code: every command, verdict and receipt field it names must exist.

## Bee surfaces called

`createBeeClient` from `@beeai/cli/lib` drives `me`, `changed --cursor`, `facts list/get/confirm/delete`, `search` (BM25 and `--neural`), `conversations list/get`, reminder create with `--alarm-at`, get and list, and `stream --types` for reminder updates. File and line references are in `NOTES.md`.

## Proof

- `npm test` runs the suite on labeled fixtures whose payload shapes are copied from the bee-cli source, including the real client calling the bundled `bee` binary and a full `receipts once` pass through a spawned `bee` process.
- Must-fail cases: a planted fact no utterance supports comes back `no-evidence` even when search returns every conversation; a line that shares the fact's keywords but is about someone else comes back `unattributed`; the wearer's own sentence inside a TV-like conversation is not marked `likely-tv`; an unticked reminder produces no delete.
- `RECEIPTS_JUDGE=bedrock` (off by default) adds an Amazon Bedrock tie-breaker for borderline matches: `openai.gpt-oss-120b` through the Bedrock OpenAI-compatible endpoint, keyed by `AWS_BEARER_TOKEN_BEDROCK`. A judge error never changes a verdict; the live test in `test/judge.test.ts` makes a real call and requires a parseable verdict.
- `npm run mutation` breaks the guarded code twelve ways (matcher always hits, forget without a tick, TV signal removed, cursor handling, search scope, relation detectors, polarity, the judge's verdict, the zero-facts gate and more), requires red each time, restores, and requires green.
- `npm run viewport-check` frames the review page at 320 and 390 px in a browser tab and fails on horizontal scroll, clipped text, a stamp over heading text, small tap targets or broken-mid-word labels. A control run with deliberately broken CSS must fail or the check itself fails.
- `npm run live-check` runs the three device spikes against the logged-in account and prints measured numbers. It exits 2 when logged out and 3 when the account has no facts.

MIT licensed.
