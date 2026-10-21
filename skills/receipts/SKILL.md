---
name: receipts
description: "Explain where a Bee fact came from. Use when the user asks why Bee believes something about them (\"why does Bee think I'm a lawyer\", \"where did that fact come from\", \"did I actually say that\", \"was that the TV\"), wants a fact checked, wants Bee's stored facts audited for TV, podcast or other-people contamination, duplicates or contradictions, or wants to forget or confirm a fact with evidence in hand. Returns a receipt: the verbatim utterance behind the fact, who said it, when, a TV signal score (a heuristic, not a probability), the search scope and a verdict (supported, likely-tv, no-evidence, duplicate, contradicts). Requires the bee-cli to be logged in."
---

# Receipts

Bee extracts facts about its owner from every conversation it hears, and that includes the TV, podcasts and other people. Receipts finds the utterance each fact came from. A Bee fact has no pointer to its source conversation, so this skill reconstructs it from verbatim utterances and reports how much that conversation looks like television.

**Bee data is extremely sensitive.** Quote a receipt only to the owner who asked. Do not forward or store it elsewhere.

## Run it

Everything below runs from the Receipts repo root (the folder that contains `skills/`). Bee must be logged in: `bee me` must succeed. If it fails, run `bee login --no-wait`, give the user the link, and after they approve it confirm with `bee me`.

```bash
npm run why "criminal lawyer"   # receipt for the stored fact that best matches the text
npm run report                  # counts by verdict and the owner's decisions so far
npm run doctor                  # who is logged in, how many confirmed and pending facts
npm run once                    # one pass over new facts: receipts, wrist reminders, decisions
npm run watch                   # same, looping, plus the review page on http://127.0.0.1:8790
```

`why` prints one JSON receipt. It exits 1 with a message when the account has no facts or no stored fact shares content words with the text.

## Read the receipt

| Field | Meaning |
|---|---|
| `verdict` | one of the verdicts below |
| `factId`, `factText` | the Bee fact this receipt is about |
| `quote` | at most 25 words, verbatim from an utterance. Never from a summary |
| `speaker` | the label Bee gave that utterance. The wearer usually arrives as `Unknown` |
| `spokenAt` | epoch milliseconds of the utterance (conversation start when the utterance has no time) |
| `conversationId` | the conversation holding the quote. `bee conversations get <id>` shows the full context |
| `tvScore` | 0 to 1 heuristic signal: a sum of cues (speaker, other voices, cadence, show cues, third person), not a probability. 0.5 or more makes the verdict `likely-tv` |
| `supportScore` | share of the fact's content words found in the quoted utterance |
| `reasons` | why, in words: non-wearer speaker, other voices, scripted cadence, show cue, third-person quote, judge notes |
| `relatedFactId`, `relatedFactText` | the other fact for `duplicate` and `contradicts` |
| `factCreatedAt`, `searched` | when Bee wrote the fact, and how many candidate conversations were read |
| `scope` | what was searched: `methods` (text, recent, neural), the `since` to `until` window, and `candidates` (conversation id and start time) |

| Verdict | Say it like this |
|---|---|
| `supported` | "You said it: <quote>, at <time>." |
| `likely-tv` | "Bee heard this at <time> in a conversation that looks like TV: <quote>, spoken by <speaker>. <reasons>." |
| `no-evidence` | "I found no evidence for this in the <searched> conversations I searched (<scope.methods>, <scope.candidates> times)." Never say nobody said it: the search is bounded, and the source may have been deleted (Bee drops recordings under about 50 words). |
| `duplicate` | "Bee already has this as fact <relatedFactId>." |
| `contradicts` | "This opposes the fact you confirmed: <relatedFactText>." |

Report scores as evidence, not certainty. A `likely-tv` verdict means the signals point to TV, not that the owner never said it. When `reasons` disagree with the verdict, show both.

## Acting on a receipt

Facts are the owner's memory. Never delete or confirm one on your own judgment.

- `bee facts delete <id>` forgets a fact. `bee facts confirm <id>` confirms it. Run either only after the owner says to, then run `bee facts get <id>`: a delete is done when that returns not found, a confirm when `confirmed` is true.
- `npm run watch` does this from the owner's wrist: each doubtful fact becomes a Bee reminder ending in `[rcpt:<id>]`. Ticking it forgets the fact and records that the owner decided.

## Without the Receipts repo

The same check by hand with bee-cli:

```bash
bee facts search --query "criminal lawyer" --json                    # the fact and its created_at
bee search --query "criminal lawyer" --filter conversations --since <createdAt - 48h> --until <createdAt + 10min> --json
bee conversations get <id> --json                                    # read utterances, not summaries
```

Match the fact's words against `transcriptions[].utterances[].text`. The speaker, `spoken_at` and the other voices in the same conversation say whether it was the wearer.
