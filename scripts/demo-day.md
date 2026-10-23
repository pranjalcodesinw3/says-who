# Demo day procedure

One fault, played live: a TV clip near the wearer's Watch, Bee writes a fact from it, Says Who shows the line that caused it, the doubtful fact lands on the wrist as a reminder, and a tick forgets it with a read-back. Every step below runs against the real Bee account through the real `bee` CLI, and the fact on screen is the one Bee wrote itself.

## Before the room fills (10 minutes)

1. Log in once and confirm it: `npx bee login --no-wait`, approve the link in the Bee app, then `npx bee me`. It prints the account name. `scripts/forced-fault.sh` refuses to run until `bee me` succeeds and exits 2 with the login instructions.
2. `npm run doctor` prints the account, the confirmed fact count and the pending fact count.
3. `npm run live-check` prints the measured numbers for the three device spikes: facts appearing with their latency and the planted-fact must-fail case, the TV signal spread across the day's conversations, and the wrist tick round trip. Keep the output on screen.
4. Pick the clip. It needs at least 50 spoken words (Bee drops shorter recordings), a clear first-person or character statement that makes a claim about a person, and a voice that is not the wearer's. A scene with a character stating a profession works well. Play it from a speaker within a metre of the Watch.

## Two terminals

Terminal A, the review page and the loop:

```bash
RECEIPTS_INTERVAL_S=10 npm run watch
```

Open http://127.0.0.1:8790. The live tape in the left rail reads "Live. Watching the ledger for new facts". The loop polls `bee changed` every 10 seconds and a new receipt reaches the page within a second of being written.

Terminal B, the driver:

```bash
bash scripts/forced-fault.sh
```

It reads the pending facts as a baseline, tells the room to play the clip, then polls Bee until a fact appears that was not in the baseline. The wait is 10 minutes by default (`FAULT_WAIT_FACT_S`). Bee writes facts after it finishes processing a conversation, so the wait is Bee's, not the script's.

## One command for the recorded run

```bash
bash scripts/record-demo.sh
```

It starts the watch loop with the review page, opens the page in the `deepsurge` browser profile, records the screen (`RECORD_SECONDS`, default 900) and runs `scripts/forced-fault.sh`. Everything lands in `recordings/<stamp>/`: `screen.mov`, `run.log`, `watch.log`, `timings.txt` (the elapsed marks) and `receipt-<id>.json` (the stored receipt). It starts only after `bee me` confirms the login. `RECORD_SCREEN=0` files the logs without the screen recording.

## The beats

1. Baseline printed: "N pending facts before the clip". Play the clip now.
2. "Bee wrote fact N" with its text and the seconds since the script started. This is the moment Bee's memory changed.
3. The receipt prints: verdict, the verbatim line, the speaker label, the conversation id, the TV signal with each cue listed, and the search scope (which conversations were read, their times, the window, the method). On the review page the same slip appears at the top with the quote under the fact, and the live tape gets a line.
4. "Wrist: reminder N" is read back from Bee with `bee todos get`. The reminder text on the Watch asks "Did you say it, or hear it?" over the matching line. Show the Watch.
5. Tick the reminder on the Watch. The script polls `bee todos get` until `completed` is true, then runs one `says-who once` pass.
6. The post-condition prints: `bee facts get N` answers not found. The slip on the review page changes to "Forgotten 9:41 PM, read back from Bee: gone" (the time is when the read-back landed) without a reload.

The elapsed seconds between beats 2, 3, 4 and 5 are printed by the script. Read them out as measured on that run.

## What the verdicts mean on stage

- `likely-tv`: a non-wearer voice said the line and the conversation carries TV cues.
- `unattributed`: a line matches the words but nothing ties it to the wearer, for example the speaker label is Unknown or the line is about someone else. The wrist question is the same: did you say it, or hear it.
- `no-evidence`: the searched conversations contain no matching line. The receipt lists exactly which conversations were read.
- `supported`: the wearer's own first-person line backs the fact. No reminder is created, and the script says so and exits 5. If that happens, play a clip whose speaker is clearly someone else.

## Script exit codes

| Code | Meaning |
|---|---|
| 0 | the full chain completed and the forgotten fact reads back as not found |
| 2 | not logged in to Bee |
| 3 | no new fact appeared within `FAULT_WAIT_FACT_S` |
| 4 | the receipt exists but the wrist reminder could not be read back from Bee |
| 5 | the new fact has a `supported` verdict, so there is nothing doubtful to send to the wrist |
| 6 | the reminder was not ticked within `FAULT_WAIT_TICK_S` (default 300) |
| 7 | the tick arrived but the fact is still readable in Bee |

`scripts/forced-fault.sh --no-tick` stops after beat 4 and exits 0 once the reminder reads back from Bee.
