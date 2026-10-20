// Tests run on FIXTURES (test/fixtures/fixture-bee.ts). They prove the engine's logic, not that Bee produces any particular data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assess, receiptFor } from "../src/provenance.ts";
import { contentTokens, findSupport, quoteOf } from "../src/match.ts";
import { tvContext, tvLikelihood } from "../src/tv.ts";
import { parseConversation, parseFact, parseSearchIds, parseTodo, toMs } from "../src/bee.ts";
import {
  FACT_LAWYER, FACT_OAT, FACT_PLANTED, FIXTURE_OWNER, NOISE_CONVO, TV_CONVO, WEARER_CONVO, fakeBee,
} from "./fixtures/fixture-bee.ts";

const ctx = { ownerNames: FIXTURE_OWNER.split(" "), tv: tvContext(FIXTURE_OWNER) };
const pool = [WEARER_CONVO, TV_CONVO, NOISE_CONVO];

test("content tokens drop stopwords and the owner's own name", () => {
  assert.deepEqual(contentTokens("Dave is a criminal lawyer", ["Dave"]), ["criminal", "lawyer"]);
  assert.deepEqual(contentTokens("Prefers oat milk"), ["like", "oat", "milk"]);
});

test("supported: wearer fact is matched to the wearer's own verbatim utterance", () => {
  const r = assess(FACT_OAT, pool, ctx);
  assert.equal(r.verdict, "supported");
  assert.equal(r.conversationId, 101);
  assert.equal(r.speaker, "Unknown");
  assert.match(r.quote!, /oat milk/);
  assert.ok(r.tvScore < 0.5, `tv ${r.tvScore}`);
  assert.ok(r.spokenAt !== null);
});

test("likely-tv: the lawyer line exists, but only in the TV conversation", () => {
  const r = assess(FACT_LAWYER, pool, ctx);
  assert.equal(r.verdict, "likely-tv");
  assert.equal(r.conversationId, 102);
  assert.equal(r.speaker, "Speaker 2");
  assert.ok(r.tvScore >= 0.5, `tv ${r.tvScore}`);
  assert.ok(r.reasons.some((x) => /show cue/.test(x)) && r.reasons.some((x) => /not the wearer/.test(x)));
});

test("MUST-FAIL: a planted fact with no supporting utterance is unsupported, even when search returns every conversation", async () => {
  const direct = assess(FACT_PLANTED, pool, ctx);
  assert.equal(direct.verdict, "unsupported");
  assert.equal(direct.quote, null);
  const bee = fakeBee({ facts: [FACT_PLANTED], conversations: pool });
  const viaClient = await receiptFor(bee, FACT_PLANTED, ctx);
  assert.equal(viaClient.verdict, "unsupported");
  assert.ok(viaClient.searched >= 3, "must have actually looked at the candidates");
  assert.ok(bee.calls.includes("search:neural"), "unsupported falls through to neural search");
});

test("a fact the wearer really said stays supported when the same words also played on TV", () => {
  const both = assess(FACT_LAWYER, [TV_CONVO, { ...WEARER_CONVO, utterances: [...WEARER_CONVO.utterances, { id: 9, speaker: "Unknown", text: "I always wanted to be a criminal lawyer, honestly.", spoken_at: null, start: null }] }], ctx);
  assert.equal(both.verdict, "supported");
  assert.equal(both.conversationId, 101);
});

test("near-miss does not count: one shared word out of two is not support", () => {
  const u = [{ id: 1, speaker: "Unknown", text: "Jazz is overrated if you ask me.", spoken_at: null, start: null }];
  assert.equal(findSupport("Likes jazz", u), null);
  assert.ok(findSupport("Likes jazz", [{ ...u[0]!, text: "I really love jazz on Sunday mornings." }]));
});

test("tv score separates the fixtures and each signal can be switched off", () => {
  const wearer = tvLikelihood(WEARER_CONVO, 0, ctx.tv);
  const tv = tvLikelihood(TV_CONVO, 1, ctx.tv);
  assert.equal(wearer.score, 0);
  assert.ok(tv.score >= 0.8, `tv ${tv.score}`);
  const noCue = tvLikelihood({ ...TV_CONVO, utterances: TV_CONVO.utterances.slice(1) }, 0, ctx.tv);
  assert.ok(noCue.score < tv.score);
  assert.ok(!noCue.reasons.some((x) => /show cue/.test(x)));
});

test("quotes are at most 25 words and centred on the match", () => {
  const long = Array.from({ length: 60 }, (_, i) => (i === 40 ? "oat" : `w${i}`)).join(" ");
  const q = quoteOf(long, ["oat"]);
  assert.ok(q.replace(/\.\.\./g, "").trim().split(/\s+/).length <= 25);
  assert.match(q, /oat/);
});

test("payload parsers accept the shapes bee-cli prints", () => {
  assert.equal(parseFact({ id: 1, text: "x", tags: [], created_at: 1_700_000_000, confirmed: true }).confirmed, true);
  assert.equal(parseFact({ fact: { id: 2, text: "y", tags: ["a"], created_at: 1, confirmed: false }, timezone: "UTC" }).tags[0], "a");
  assert.equal(parseTodo({ todo: { id: 3, text: "t", alarm_at: null, completed: true, created_at: 1 } }).completed, true);
  assert.throws(() => parseFact({ nope: 1 }));
  const conv = parseConversation({
    conversation: {
      id: 7, start_time: 1_700_000_000_000, end_time: null,
      transcriptions: [
        { id: 1, realtime: true, utterances: [{ id: 1, text: "rt", speaker: "Unknown", spoken_at: 5, start: null }] },
        { id: 2, realtime: false, utterances: [{ id: 3, text: "late", speaker: "", spoken_at: 1_700_000_002_000, start: null }, { id: 2, text: "early", speaker: "A", spoken_at: 1_700_000_001_000, start: null }] },
      ],
    },
  });
  assert.deepEqual(conv.utterances.map((x) => x.text), ["early", "late"], "non-realtime transcription, sorted by time");
  assert.equal(conv.utterances[1]!.speaker, "Unknown", "empty speaker label becomes Unknown");
  assert.deepEqual(parseSearchIds({ results: [{ id: 4 }, { id: "x" }, { conversation_id: 9 }], total: 3 }), [4, 9]);
  assert.equal(toMs(1_700_000_000), 1_700_000_000_000);
  assert.equal(toMs(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(toMs(12), null);
});
