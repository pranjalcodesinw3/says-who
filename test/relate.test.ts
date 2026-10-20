// Tests on FIXTURE facts (test/fixtures/fixture-bee.ts): duplicate and contradiction verdicts, each with a must-fail case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { claimOf, relate } from "../src/relate.ts";
import { assess, withRelation } from "../src/provenance.ts";
import { findSupport } from "../src/match.ts";
import { openLedger } from "../src/ledger.ts";
import { tvContext } from "../src/tv.ts";
import { tick, todoText, type Deps } from "../src/watch.ts";
import {
  FACT_ALMOND, FACT_NO_CAR_CONFIRMED, FACT_OAT, FACT_OAT_CONFIRMED_NEG, FACT_OAT_DUP, FIXTURE_OWNER, NOISE_CONVO, TV_CONVO, WEARER_CONVO, fakeBee,
} from "./fixtures/fixture-bee.ts";

const owner = FIXTURE_OWNER.split(" ");
const ctx = { ownerNames: owner, tv: tvContext(FIXTURE_OWNER) };

test("claims carry polarity: negators and dislike flip it, tokens are the content words", () => {
  assert.deepEqual([...claimOf("Does not like oat milk").tokens].sort(), ["like", "milk", "oat"]);
  assert.equal(claimOf("Does not like oat milk").negative, true);
  assert.equal(claimOf("Dislikes oat milk").negative, true);
  assert.deepEqual([...claimOf("Dislikes oat milk").tokens].sort(), ["like", "milk", "oat"]);
  assert.equal(claimOf("Prefers oat milk").negative, false);
  assert.equal(claimOf("Never says no to oat milk").negative, false, "two negators cancel");
});

test("DUPLICATE: the newer fact with the same claim points at the older one", () => {
  const r = relate(FACT_OAT_DUP, [FACT_OAT, FACT_ALMOND], owner);
  assert.equal(r?.kind, "duplicate");
  assert.equal(r?.other.id, 1);
});

test("MUST-FAIL duplicate: the older fact is not flagged, a different claim is not flagged, an opposite claim is not a duplicate", () => {
  assert.equal(relate(FACT_OAT, [FACT_OAT_DUP], owner), null, "older id is the keeper");
  assert.equal(relate(FACT_ALMOND, [FACT_OAT], owner), null, "almond milk is not oat milk");
  assert.equal(relate(FACT_OAT_DUP, [{ ...FACT_OAT, text: "Does not like oat milk", confirmed: false }], owner), null, "opposite polarity, unconfirmed peer");
  assert.equal(relate(FACT_OAT_DUP, [FACT_OAT_DUP], owner), null, "a fact is not its own duplicate");
});

test("CONTRADICTS: a fact opposing a confirmed fact points at it", () => {
  const r = relate(FACT_OAT, [FACT_OAT_CONFIRMED_NEG, FACT_ALMOND], owner);
  assert.equal(r?.kind, "contradicts");
  assert.equal(r?.other.id, 6);
  assert.equal(relate({ ...FACT_OAT, text: "Hates oat milk" }, [{ ...FACT_OAT, id: 9, confirmed: true }], owner)?.kind, "contradicts", "dislike vs like");
});

test("MUST-FAIL contradicts: unrelated negative, unconfirmed opposite, and same-polarity peers do not trigger it", () => {
  assert.equal(relate(FACT_OAT, [FACT_NO_CAR_CONFIRMED], owner), null, "unrelated confirmed negative");
  assert.equal(relate(FACT_OAT, [{ ...FACT_OAT_CONFIRMED_NEG, confirmed: false }], owner), null, "peer must be confirmed");
  assert.equal(relate(FACT_OAT, [{ ...FACT_OAT_DUP, confirmed: true }], owner), null, "a confirmed peer saying the SAME thing is no contradiction");
  assert.equal(relate({ ...FACT_OAT, id: 20, text: "Likes oat milk" }, [{ ...FACT_OAT_DUP, confirmed: true }], owner)?.kind, "duplicate", "same polarity is a duplicate, never a contradiction");
});

test("polarity gates evidence: a negative fact is not supported by a positive utterance, and the reverse", () => {
  const said = [{ id: 1, speaker: "Unknown", text: "I switched to oat milk this week.", spoken_at: null, start: null }];
  assert.ok(findSupport("Likes oat milk", said, owner));
  assert.equal(findSupport("Does not like oat milk", said, owner), null);
  const refused = [{ id: 1, speaker: "Unknown", text: "I really don't like oat milk, I don't know why people drink it.", spoken_at: null, start: null }];
  assert.ok(findSupport("Does not like oat milk", refused, owner));
  assert.equal(findSupport("Likes oat milk", refused, owner), null);
  const unrelatedNegation = [{ id: 1, speaker: "Unknown", text: "I don't know about the rest, but I like oat milk a lot.", spoken_at: null, start: null }];
  assert.ok(findSupport("Likes oat milk", unrelatedNegation, owner), "negation in another clause does not flip it");
});

test("a relation outranks the evidence verdict but keeps the receipt's evidence", () => {
  const base = assess(FACT_OAT_DUP, [WEARER_CONVO, TV_CONVO, NOISE_CONVO], ctx);
  assert.equal(base.verdict, "supported");
  const r = withRelation(base, FACT_OAT_DUP, [FACT_OAT], ctx);
  assert.equal(r.verdict, "duplicate");
  assert.equal(r.relatedFactId, 1);
  assert.equal(r.quote, base.quote);
  assert.match(r.reasons[0]!, /same claim as older fact 1/);
  assert.match(todoText(r as never), /already has this as fact 1\. Tick = forget \[rcpt:5\]$/);
  const c = withRelation(assess(FACT_OAT, [WEARER_CONVO], ctx), FACT_OAT, [FACT_OAT_CONFIRMED_NEG], ctx);
  assert.equal(c.verdict, "contradicts");
  assert.match(todoText(c as never), /You confirmed the opposite: "Does not like oat milk"\. Tick = forget \[rcpt:1\]$/);
});

test("watch loop: duplicate and contradicting facts go to the wrist, the keeper and the confirmed fact do not", async () => {
  const bee = fakeBee({ facts: [FACT_OAT, FACT_OAT_DUP, FACT_OAT_CONFIRMED_NEG, FACT_ALMOND], conversations: [WEARER_CONVO, TV_CONVO, NOISE_CONVO] });
  const d: Deps = { bee, ledger: openLedger(":memory:"), log: () => {}, ctx, alarmLeadMs: 0 };
  const r = await tick(d);
  assert.equal(r.failed, 0);
  const v = Object.fromEntries(d.ledger.all().map((x) => [x.factId, x.verdict]));
  assert.equal(v[5], "duplicate");
  assert.equal(v[1], "contradicts", "Prefers oat milk opposes the confirmed Does not like oat milk");
  assert.equal(v[6], "unsupported", "the confirmed negative has no negative utterance behind it, and is not asked about");
  assert.equal(v[7], "unsupported");
  const labelled = [...bee.todos.values()].map((t) => /\[rcpt:(\d+)\]/.exec(t.text)![1]).sort();
  assert.deepEqual(labelled, ["1", "5", "7"], "no reminder for confirmed fact 6");
  assert.equal(d.ledger.get(5)!.relatedFactId, 1);
  assert.equal(d.ledger.get(5)!.relatedFactText, "Prefers oat milk");
});
