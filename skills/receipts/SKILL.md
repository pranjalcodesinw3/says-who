---
name: receipts
description: "Says Who: explain where a Bee fact came from. Use when the user asks why Bee believes something about them (\"why does Bee think I'm a lawyer\", \"where did that fact come from\", \"did I actually say that\", \"was that the TV\"), wants a fact checked, wants Bee's stored facts audited for TV, podcast or other-people contamination, duplicates or contradictions, or wants to forget or confirm a fact with evidence in hand. Returns a receipt: the verbatim utterance behind the fact, who said it, when, a TV signal score with its listed cues, the search scope and a verdict (supported, likely-tv, unattributed, no-evidence, duplicate, contradicts). Requires the bee-cli to be logged in."
---

# Says Who

Bee extracts facts about its owner from every conversation it hears, and that includes the TV, podcasts and other people. Says Who finds the utterance each fact came from. A Bee fact has no pointer to its source conversation, so this skill reconstructs it from verbatim utterances and reports how much that conversation looks like television.

**Bee data is extremely sensitive.** Quote a receipt only to the owner who asked. Do not forward or store it elsewhere.

## Run it

Everything below runs from the Says Who repo root (the folder that contains `skills/`). Bee must be logged in: `bee me` must succeed. If it fails, run `bee login --no-wait`, give the user the link, and after they approve it confirm with `bee me`.

```bash
npm run why "criminal lawyer"   # receipt for the stored fact that best matches the text
npm run report                  # counts by verdict and the owner's decisions so far
npm run report -- --md          # the same as a markdown self-review: questionable facts before and now, each with its quote
npm run doctor                  # who is logged in, how many confirmed and pending facts
npm run once                    # one pass over new facts: receipts, wrist reminders, decisions
npm run watch                   # same, looping, plus the review page on http://127.0.0.1:8790
```

`why` prints one JSON receipt. It exits 1 with a message when the account has no facts or no stored fact shares content words with the text.

Add `--demo` to `why` or `report` to run against the bundled sample account (owner "Sam Rivera", four or three facts) with no Bee login. Use it to show the owner what a receipt looks like before they log in, never to answer about their own facts.

## Worked example

> **Owner:** Is the lawyer fact from the TV?

Run it (here on the sample account; drop `--demo` for the owner's own Bee):

```bash
npm run why -- --demo "criminal lawyer"
```

The receipt that comes back, trimmed to the fields the answer uses:

```json
{
  "factId": 2,
  "factText": "Sam is a criminal lawyer",
  "verdict": "likely-tv",
  "tvScore": 1,
  "quote": "He is a criminal lawyer with a reputation for getting his clients out of anything the district attorney throws at them.",
  "speaker": "Speaker 2",
  "spokenAt": 1792752194742,
  "conversationId": 4102,
  "reasons": [
    "the line is about someone else (\"he\")",
    "line spoken by \"Speaker 2\", not the wearer",
    "3 distinct non-wearer speakers",
    "scripted cadence: 6 even utterances averaging 20 words",
    "show cue: dexter, previously on",
    "quote is third person, not the wearer talking about themselves"
  ]
}
```

> **Agent:** Very likely. Bee heard it at 6:43 PM in conversation 4102: "He is a criminal lawyer with a reputation for getting his clients out of anything the district attorney throws at them.", spoken by Speaker 2, not you. The TV signal is 1.00 of 1: three other voices, scripted cadence, the show cue "previously on" from Dexter, and the line is about "he", not you. Want me to forget fact 2? It is also on your wrist as a reminder; ticking it does the same.

Format `spokenAt` (epoch milliseconds) as a local time. Only run `bee facts delete 2` after the owner says yes, then confirm with `bee facts get 2`.

## Read the receipt

| Field | Meaning |
|---|---|
| `verdict` | one of the verdicts below |
| `factId`, `factText` | the Bee fact this receipt is about |
| `quote` | at most 25 words, verbatim from an utterance. Never from a summary |
| `speaker` | the label Bee gave that utterance. `Unknown` means Bee did not name the speaker: it is not evidence for or against the wearer |
| `attributionWhy` | the sentence behind `attribution`, for example `the line is about someone else ("my brother")`. Show Bee's `speaker` label beside it: they are two readings of the same line |
| `attribution` | who the quoted line is about: `self` (tied to the wearer by a wearer label or first-person wording), `other` (names someone else, or a non-wearer spoke it), `unclear` (nothing ties it to anyone) |
| `spokenAt` | epoch milliseconds of the utterance (conversation start when the utterance has no time) |
| `conversationId` | the conversation holding the quote. `bee conversations get <id>` shows the full context |
| `tvScore` | 0 to 1 signal that adds up the cues listed in `reasons` (speaker, other voices, cadence, show cues, third person). 0.5 or more, with a cue on the line itself, makes the verdict `likely-tv` |
| `supportScore` | share of the fact's content words found in the quoted utterance |
| `reasons` | why, in words: non-wearer speaker, other voices, scripted cadence, show cue, third-person quote, judge notes |
| `relatedFactId`, `relatedFactText` | the other fact for `duplicate` and `contradicts` |
| `factCreatedAt`, `searched` | when Bee wrote the fact, and how many candidate conversations were read |
| `scope` | what was searched: `methods` (text, recent, neural), the `since` to `until` window, and `candidates` (conversation id and start time) |

| Verdict | Say it like this |
|---|---|
| `supported` | "You said it: <quote>, at <time>." |
| `likely-tv` | "Bee heard this at <time> in a conversation that looks like TV: <quote>, spoken by <speaker>. <reasons>." |
| `unattributed` | "A line matches the words, but nothing ties it to you: <quote>. <attribution reason>." It may be about someone else or from an unnamed speaker. |
| `no-evidence` | "I found no evidence for this in the <searched> conversations I searched (<scope.methods>, <scope.candidates> times)." Quote the scope, and say the source may also have been deleted (Bee drops recordings under about 50 words). |
| `duplicate` | "Bee already has this as fact <relatedFactId>." |
| `contradicts` | "This opposes the fact you confirmed: <relatedFactText>." |

Report scores as evidence, not certainty. A `likely-tv` verdict means the signals point to TV, not that the owner never said it. When `reasons` disagree with the verdict, show both.

## Acting on a receipt

Facts are the owner's memory. Never delete or confirm one on your own judgment.

- `bee facts delete <id>` forgets a fact. `bee facts confirm <id>` confirms it. Run either only after the owner says to, then run `bee facts get <id>`: a delete is done when that returns not found, a confirm when `confirmed` is true.
- `npm run watch` does this from the owner's wrist: each doubtful fact becomes a Bee reminder ending in `[rcpt:<id>]`. Ticking it forgets the fact and records that the owner decided.

## Without the Says Who repo

The same check by hand with bee-cli:

```bash
bee facts search --query "criminal lawyer" --json                    # the fact and its created_at
bee search --query "criminal lawyer" --filter conversations --since <createdAt - 48h> --until <createdAt + 10min> --json
bee conversations get <id> --json                                    # read utterances, not summaries
```

Match the fact's words against `transcriptions[].utterances[].text`. The speaker, `spoken_at` and the other voices in the same conversation say whether it was the wearer.
