# Receipts

Bee writes facts about you from everything its microphone hears, including the TV. Receipts gives every one of those facts a receipt: the verbatim utterance that caused it, who said it, when, and how much that conversation looks like television. The doubtful ones reach your wrist as a Bee reminder. Tick it and the fact is gone from Bee, read back to prove it.

```
fact 2 "Dave is a criminal lawyer" -> likely-tv
  heard   "He is a criminal lawyer with a reputation for getting his clients out of anything..."
  speaker Speaker 2, 9:14 PM, conversation 102
  tv 1.00 : spoken by a non-wearer, 3 other voices, scripted cadence, show cue "previously on"
  wrist   reminder 500  ->  Bee thinks "Dave is a criminal lawyer". Heard 9:14 PM, TV-like. Tick = forget [rcpt:2]
```

## How it works

1. `receipts watch` reads the `bee changed` cursor every 60 seconds and saves the cursor only after the batch is processed.
2. Each new fact is searched against conversations: BM25 first, the most recent conversations next, neural search only when those find nothing. Candidates are re-read through `conversations get` and matched on **utterances**. Bee's AI-written summaries are never evidence and never quoted.
3. The verdict is one of `supported`, `likely-tv` or `unsupported`. The TV score combines who spoke the line, how many other voices were present, scripted cadence, show and podcast cues, and whether the quote is the wearer talking about themselves.
4. `likely-tv` and `unsupported` facts become a Bee reminder with `alarm_at` set to now. The fact id rides in the reminder text as `[rcpt:<id>]`.
5. A stream wake-up on the reminder-updated event, plus a poll, finds the ticked reminder. Receipts runs `facts delete`, then `facts get` and only records the decision when Bee answers not found.
6. Facts the wearer already confirmed get a receipt and no reminder. Supported facts are confirmed from the review page, with a read-back on `confirmed`.

Every receipt is stored in a local SQLite ledger (fact id, verdict, 25-word quote, speaker, time, TV score, decision), which keeps the evidence after Bee's history window and after Bee deletes short recordings.

## Run it

```bash
npm install
npx bee login --no-wait          # approve the link in the Bee app, then: npx bee me
npm run receipts -- doctor       # account, confirmed and pending fact counts
npm run receipts -- watch --serve   # loop + review page on http://127.0.0.1:8790
npm run receipts -- why "criminal lawyer"   # receipt for one stored fact
npm run receipts -- report       # provenance counts and the wearer's decisions
```

Environment: `RECEIPTS_DB` (default `.receipts/ledger.db`), `RECEIPTS_PORT` (8790), `RECEIPTS_INTERVAL_S` (60), `RECEIPTS_WEARER_SPEAKERS` (speaker labels that mean the wearer, default `unknown,you,me,user,owner,wearer`), `RECEIPTS_SHOW_NAMES` (extra show cues, comma separated), `BEE_BIN` (path to a different `bee`).

## Bee surfaces called

`createBeeClient` from `@beeai/cli/lib` drives `me`, `changed --cursor`, `facts list/get/confirm/delete`, `search` (BM25 and `--neural`), `conversations list/get`, reminder create with `--alarm-at`, get and list, and `stream --types` for reminder updates. File and line references are in `NOTES.md`.

## Proof

- `npm test` runs the suite on labeled fixtures whose payload shapes are copied from the bee-cli source, including the real client calling the bundled `bee` binary and a full `receipts once` pass through a spawned `bee` process.
- Must-fail cases: a planted fact no utterance supports comes back `unsupported` even when search returns every conversation; an unticked reminder produces no delete.
- `npm run mutation` breaks the guarded code seven ways (matcher always hits, forget without a tick, TV signal removed, cursor saved after a failure, cursor never passed, search scope widened, zero-facts gate removed), requires red each time, restores, and requires green.
- `npm run live-check` runs the three device spikes against the logged-in account and prints measured numbers. It exits 2 when logged out and 3 when the account has no facts.

MIT licensed.
