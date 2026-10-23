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

test("MUST-FAIL: a planted fact with no supporting utterance has no evidence, even when search returns every conversation", async () => {
  const direct = assess(FACT_PLANTED, pool, ctx);
  assert.equal(direct.verdict, "no-evidence");
  assert.equal(direct.quote, null);
  const bee = fakeBee({ facts: [FACT_PLANTED], conversations: pool });
  const viaClient = await receiptFor(bee, FACT_PLANTED, ctx);
  assert.equal(viaClient.verdict, "no-evidence");
  assert.ok(viaClient.searched >= 3, "must have actually looked at the candidates");
  assert.ok(bee.calls.includes("search:neural"), "no-evidence falls through to neural search");
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

test("no-evidence is a bounded-search verdict: the receipt records which conversations were read, when, and how they were found", async () => {
  const bee = fakeBee({ facts: [FACT_PLANTED], conversations: pool });
  const r = await receiptFor(bee, FACT_PLANTED, ctx);
  assert.equal(r.verdict, "no-evidence");
  assert.deepEqual(r.scope.candidates.map((c) => c.id).sort(), [101, 102, 103]);
  assert.ok(r.scope.candidates.every((c) => c.at !== null), "candidate conversation times are kept");
  assert.equal(r.scope.since, FACT_PLANTED.created_at - 48 * 3_600_000);
  assert.equal(r.scope.until, FACT_PLANTED.created_at + 10 * 60_000);
  assert.equal(r.scope.methods.length, 3, "text search, most recent, neural");
  assert.ok(r.scope.methods.some((m) => /neural/.test(m)) && r.scope.methods.some((m) => /text search/.test(m)));
  assert.ok(r.reasons.some((x) => /no evidence found/.test(x)), "reason says no evidence found, never 'nobody said it'");
  assert.ok(!r.reasons.some((x) => /unsupported|no one|nobody/i.test(x)));
});

// ---- attribution: matching words is not evidence that the line is about the wearer ----
import { subjectOf } from "../src/match.ts";
import { BROTHER_CONVO, BROTHER_THEN_SELF_CONVO, FACT_VEGAN, NO_SUBJECT_CONVO, PRIYA_VEGAN_CONVO, TV_OAT_CONVO, WEARER_IN_TV_CONVO } from "./fixtures/fixture-bee.ts";

test("MUST-FAIL: 'my brother is vegan' shares every keyword of the fact but is not support for 'Dave is vegan'", () => {
  const lexical = findSupport(FACT_VEGAN.text, BROTHER_CONVO.utterances, ["Dave"]);
  assert.ok(lexical, "the keywords do match, so only attribution can reject it");
  assert.equal(lexical!.attribution.kind, "other");
  const r = assess(FACT_VEGAN, [BROTHER_CONVO], { ownerNames: ["Dave"], tv: tvContext("Dave") });
  assert.equal(r.verdict, "unattributed");
  assert.equal(r.attribution, "other");
  assert.match(r.quote!, /brother is vegan/);
  assert.ok(r.reasons.some((x) => /my brother/.test(x)), r.reasons.join(" | "));
});

test("the same conversation becomes supported once the wearer says it about themselves", () => {
  const r = assess(FACT_VEGAN, [BROTHER_THEN_SELF_CONVO], { ownerNames: ["Dave"], tv: tvContext("Dave") });
  assert.equal(r.verdict, "supported");
  assert.match(r.quote!, /I'm vegan too/);
  assert.equal(r.attribution, "self");
});

test("a pronoun, a relation or a named participant each mark a clause as about someone else; first person marks it self", () => {
  const names = new Set(["priya"]);
  assert.deepEqual(subjectOf("she is vegan", names), { kind: "other", cue: "she" });
  assert.equal(subjectOf("my younger sister is vegan", names).kind, "other");
  assert.equal(subjectOf("Priya is vegan", names).kind, "other");
  assert.equal(subjectOf("I am vegan", names).kind, "self");
  assert.equal(subjectOf("my job is lawyer", names).kind, "self");
  assert.equal(subjectOf("vegan food is great", names).kind, "none");
});

test("Unknown is unknown attribution: no subject in the line means nothing ties it to the wearer", () => {
  const ctx0 = { ownerNames: ["Dave"], tv: tvContext("Dave") };
  const r = assess(FACT_VEGAN, [NO_SUBJECT_CONVO], ctx0);
  assert.equal(r.verdict, "unattributed");
  assert.equal(r.attribution, "unclear");
  assert.ok(r.reasons.some((x) => /Unknown/.test(x)));
  assert.equal(r.tvScore, 0, "Unknown adds no TV points either");
  assert.equal(tvContext("Dave").wearerSpeakers.has("unknown"), false, "Unknown is not a default wearer label");
  // opting in is explicit: the label then counts as the wearer even without first person
  const optIn = { ownerNames: ["Dave"], tv: { wearerSpeakers: new Set(["unknown"]), extraCues: [] } };
  assert.equal(assess(FACT_VEGAN, [NO_SUBJECT_CONVO], optIn).verdict, "supported");
});

test("a labelled non-wearer saying it about themselves is not the wearer, and a quiet room is not TV: unattributed", () => {
  const r = assess(FACT_VEGAN, [PRIYA_VEGAN_CONVO], { ownerNames: ["Dave"], tv: tvContext("Dave") });
  assert.equal(r.verdict, "unattributed");
  assert.equal(r.speaker, "Priya");
  assert.ok(r.tvScore < 0.5, `tv ${r.tvScore}`);
});

test("MUST-FAIL: the wearer's own sentence inside a TV-like conversation is not likely-tv from conversation-level cues alone", () => {
  const room = tvLikelihood(WEARER_IN_TV_CONVO, WEARER_IN_TV_CONVO.utterances.length - 1, ctx.tv);
  assert.ok(room.score >= 0.5, `the room must look like TV for this test to mean anything, got ${room.score}`);
  assert.equal(room.lineLevel, false);
  const r = assess(FACT_OAT, [WEARER_IN_TV_CONVO], ctx);
  assert.equal(r.verdict, "supported");
  assert.ok(r.tvScore >= 0.5);
  assert.ok(r.reasons.some((x) => /conversation-level cues/.test(x)), "the receipt still shows the room looked like TV");
  // control: same room, same words, but a labelled non-wearer voice says them -> a line-level cue exists -> likely-tv
  const control = assess(FACT_OAT, [TV_OAT_CONVO], ctx);
  assert.equal(control.verdict, "likely-tv");
});

test("an Unknown-labelled line in a TV-like room is unattributed, not likely-tv: the room alone cannot convict the line", async () => {
  const { TV_UNKNOWN_LABEL_CONVO } = await import("./fixtures/fixture-bee.ts");
  const r = assess(FACT_LAWYER, [TV_UNKNOWN_LABEL_CONVO], ctx);
  assert.ok(r.tvScore >= 0.5, `the room must score as TV, got ${r.tvScore}`);
  assert.equal(r.verdict, "unattributed");
  assert.ok(r.reasons.some((x) => /Unknown/.test(x)));
});

test("recency: the same wearer line in two conversations is credited to the one closest to when Bee wrote the fact", () => {
  const created = 1_800_000_000_000;
  const line = "I switched to oat milk this week because the dairy stuff was upsetting my stomach.";
  const convo = (id: number, at: number) => ({ id, start_time: at, end_time: at + 60_000, utterances: [{ id: id * 10, speaker: "Unknown", text: line, spoken_at: at, start: null }] });
  const older = convo(501, created - 40 * 3_600_000);
  const recent = convo(502, created - 10 * 60_000);
  const fact = { ...FACT_OAT, created_at: created };
  const r = assess(fact, [older, recent], ctx);
  assert.equal(r.verdict, "supported");
  assert.equal(r.conversationId, 502, "the older conversation is listed first and still loses");
  assert.equal(r.spokenAt, created - 10 * 60_000);
  assert.equal(assess(fact, [recent, older], ctx).conversationId, 502, "order of the candidates does not matter");
});
