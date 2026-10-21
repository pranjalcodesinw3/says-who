// Runs the three spikes from docs/tracks/bee.md against the logged-in Bee account and prints measured numbers.
// Exit codes: 2 not logged in, 3 account has zero facts, 4 a spike failed. Writes only planted facts/to-dos it deletes again.
import { createBeeClient } from "@beeai/cli/lib";
import { NotFound, parseFact, realBee, toMs, type Fact } from "../src/bee.ts";
import { openLedger } from "../src/ledger.ts";
import { receiptFor, type Ctx } from "../src/provenance.ts";
import { tvContext, tvLikelihood } from "../src/tv.ts";
import { ensureReceipt, forgetFact, reconcile, type Deps } from "../src/watch.ts";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const bundled = fileURLToPath(new URL("../node_modules/.bin/bee", import.meta.url));
const command = process.env.BEE_BIN ?? (existsSync(bundled) ? bundled : "bee");
const raw = createBeeClient({ command });
const bee = realBee({ command });
const out = (k: string, v: string | number) => console.log(`${k}=${v}`);
const die = (code: number, msg: string): never => { console.error(`FAIL: ${msg}`); process.exit(code); };
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : NaN);

const WINDOW_H = Number(process.env.S1_WINDOW_H ?? 3);
const S2_TRIALS = Number(process.env.S2_TRIALS ?? 1);
const S2_TIMEOUT_S = Number(process.env.S2_TIMEOUT_S ?? 90);
const PLANTED_FALSE = "I hold a commercial pilot licence";
const TRUE_FACT = process.env.S3_TRUE_FACT ?? "I switched to oat milk this week";

const planted: number[] = [];
async function plant(text: string): Promise<Fact> {
  const f = parseFact(await raw.api.facts.create(text));
  planted.push(f.id);
  return f;
}
async function cleanup(): Promise<void> {
  for (const id of planted.splice(0)) {
    try { await bee.deleteFact(id); } catch (e) { if (!(e instanceof NotFound)) console.error(`cleanup of planted fact ${id} failed: ${e instanceof Error ? e.message : String(e)}`); }
    try { await bee.getFact(id); console.error(`WARNING: planted fact ${id} still exists after cleanup`); } catch (e) { if (!(e instanceof NotFound)) throw e; }
  }
}

// ---- login + non-empty account gates ----
let me: { id: number; name: string };
try { me = await bee.whoami(); } catch (e) { die(2, `not logged in to Bee (${e instanceof Error ? e.message : String(e)}). Run: bee login --no-wait, approve in the Bee app, then bee me`); }
const ctx: Ctx = { ownerNames: me!.name.split(/\s+/).filter(Boolean), tv: tvContext(me!.name) };
const confirmed = await bee.listFacts({});
const pending = await bee.listFacts({ unconfirmed: true });
const facts = [...confirmed, ...pending];
out("account", `${me!.name} (id ${me!.id})`);
out("facts_confirmed", confirmed.length);
out("facts_pending", pending.length);
if (facts.length === 0) die(3, "this Bee account has zero facts. Every spike would pass or fail on nothing. Talk near the wrist for a while, wait for facts, rerun.");

let failed = 0;
const verdict = (name: string, ok: boolean, why: string) => { console.log(`${name} ${ok ? "PASS" : "FAIL"}: ${why}`); if (!ok) failed++; };

try {
  // ---- S1: facts appear, with latency ----
  const now = Date.now();
  const recent = facts.filter((f) => (toMs(f.created_at) ?? 0) >= now - WINDOW_H * 3_600_000);
  const convs = ((await raw.api.conversations.list({ limit: 20 })) as { conversations?: { start_time: number; end_time: number | null }[] }).conversations ?? [];
  const ends = convs.map((c) => toMs(c.end_time ?? c.start_time)).filter((x): x is number => x !== null);
  const lags = recent
    .map((f) => { const t = toMs(f.created_at)!; const before = ends.filter((e) => e <= t); return before.length ? (t - Math.max(...before)) / 1000 : NaN; })
    .filter((x) => Number.isFinite(x));
  out("s1_facts_in_window", recent.length);
  out("s1_window_hours", WINDOW_H);
  out("s1_conversation_end_to_fact_created_s_median", Number.isFinite(median(lags)) ? Math.round(median(lags)) : "n/a");
  const changed = await bee.changed(undefined);
  out("s1_facts_in_changed_bootstrap_window", changed.facts.length);
  // must-fail: a claim nobody made
  const plantedFalse = await plant(PLANTED_FALSE);
  const rf = await receiptFor(bee, plantedFalse, ctx);
  out("s1_planted_false_verdict", rf.verdict);
  verdict("S1 facts appear", recent.length >= 3, `${recent.length} fact(s) created in the last ${WINDOW_H} h (need 3+)`);
  verdict("S1 must-fail (planted false fact)", rf.verdict === "no-evidence", `"${PLANTED_FALSE}" came back ${rf.verdict}, searched ${rf.searched} conversation(s)`);

  // ---- S3: attribution signal on the day's conversations ----
  const summaries = ((await raw.api.conversations.list({ limit: 30 })) as { conversations?: { id: number }[] }).conversations ?? [];
  const labels = new Map<string, number>();
  const rows: string[] = [];
  const scores: number[] = [];
  for (const s of summaries.slice(0, 15)) {
    const c = await bee.getConversation(s.id);
    if (c.utterances.length === 0) continue;
    for (const u of c.utterances) labels.set(u.speaker, (labels.get(u.speaker) ?? 0) + 1);
    const tv = tvLikelihood(c, null, ctx.tv);
    scores.push(tv.score);
    rows.push(`  conversation ${c.id}: ${c.utterances.length} utterances, speakers=${[...new Set(c.utterances.map((u) => u.speaker))].join("|")}, tv=${tv.score} ${tv.reasons.join("; ")}`);
  }
  console.log(rows.join("\n"));
  out("s3_speaker_labels", [...labels].map(([k, v]) => `${k}:${v}`).join(","));
  out("s3_conversations_scored", scores.length);
  out("s3_tv_score_min", scores.length ? Math.min(...scores) : "n/a");
  out("s3_tv_score_max", scores.length ? Math.max(...scores) : "n/a");
  const spread = scores.length > 0 ? Math.max(...scores) - Math.min(...scores) : 0;
  const trueFact = await plant(TRUE_FACT);
  const rt = await receiptFor(bee, trueFact, ctx);
  out("s3_true_fact_verdict", rt.verdict);
  out("s3_true_fact_quote", rt.quote ?? "none");
  verdict("S3 separable signal", scores.length >= 2 && spread >= 0.3, `${scores.length} conversation(s) scored, tv spread ${spread.toFixed(2)} (need 2+ conversations and spread >= 0.3)`);
  verdict("S3 must-fail (true planted fact)", rt.verdict === "supported", `"${TRUE_FACT}" came back ${rt.verdict}. It must have been said aloud near the wrist in a 60+ word conversation; set S3_TRUE_FACT to something you did say`);

  // ---- S2: wrist round trip. Needs the Watch: tick the to-do when it buzzes. ----
  const d: Deps = { bee, ledger: openLedger(join(mkdtempSync(join(tmpdir(), "receipts-live-")), "ledger.db")), ctx, log: (l) => console.log(`  ${l}`), alarmLeadMs: 0 };
  const lat: number[] = [];
  let controlOk = true;
  for (let i = 0; i < S2_TRIALS; i++) {
    const f = await plant(`${PLANTED_FALSE} (trial ${i + 1})`);
    const row = await ensureReceipt(d, { ...f, confirmed: false });
    if (row.todoId === null) die(4, `S2: no wrist to-do was created for planted fact ${f.id} (verdict ${row.verdict})`);
    const t0 = Date.now();
    console.log(`S2 trial ${i + 1}/${S2_TRIALS}: to-do ${row.todoId} created with alarm_at now. Tick it on the Watch (waiting up to ${S2_TIMEOUT_S}s)`);
    let ticked = false;
    let controlChecked = false;
    while (Date.now() - t0 < S2_TIMEOUT_S * 1000) {
      await new Promise((r) => setTimeout(r, 2000));
      const t = await bee.getTodo(row.todoId!);
      if (!t.completed && !controlChecked) {
        await reconcile(d); // unticked: must not delete
        try { await bee.getFact(f.id); } catch (e) { if (e instanceof NotFound) controlOk = false; else throw e; }
        controlChecked = true;
      }
      if (t.completed) { ticked = true; lat.push((Date.now() - t0) / 1000); break; }
    }
    if (!ticked) { console.log(`  no tick within ${S2_TIMEOUT_S}s`); break; }
    await reconcile(d);
    try { await bee.getFact(f.id); controlOk = false; console.log("  fact still readable after tick"); } catch (e) { if (!(e instanceof NotFound)) throw e; }
  }
  out("s2_ticks_observed", lat.length);
  out("s2_create_to_tick_observed_s", lat.map((x) => x.toFixed(1)).join(","));
  out("s2_median_s", lat.length ? median(lat).toFixed(1) : "n/a");
  verdict("S2 wrist round trip", lat.length === S2_TRIALS && median(lat) < 30, `${lat.length}/${S2_TRIALS} ticks observed, median ${lat.length ? median(lat).toFixed(1) : "n/a"}s from to-do creation (includes your reaction time; budget 30s)`);
  verdict("S2 must-fail (unticked leaves the fact)", controlOk, "fact survived reconcile while its to-do was unticked, and was deleted and read back gone after the tick");
} finally {
  await cleanup();
}
if (failed > 0) { console.error(`${failed} spike check(s) failed`); process.exit(4); }
console.log("ALL SPIKES PASS");
