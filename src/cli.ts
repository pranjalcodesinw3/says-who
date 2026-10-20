#!/usr/bin/env node
import { realBee, type Fact } from "./bee.ts";
import { openLedger } from "./ledger.ts";
import { contentTokens } from "./match.ts";
import { receiptFor, type Ctx } from "./provenance.ts";
import { startServer } from "./server.ts";
import { tvContext } from "./tv.ts";
import { tick, watch, type Deps } from "./watch.ts";

const USAGE = `receipts <command>
  doctor            verify Bee login and print the account the receipts will be filed under
  once              one pass: changed feed -> receipts -> wrist to-dos -> decisions
  watch [--serve]   loop every RECEIPTS_INTERVAL_S (60) seconds, wake on todo-updated; --serve also starts the review page
  review            review page only on http://127.0.0.1:$RECEIPTS_PORT (8790)
  why "<fact text>" print the receipt for the stored fact that best matches the text
  report            fact provenance counts and the wearer's decisions from the ledger`;

const dbPath = process.env.RECEIPTS_DB ?? ".receipts/ledger.db";
const port = Number(process.env.RECEIPTS_PORT ?? 8790);
const intervalMs = Number(process.env.RECEIPTS_INTERVAL_S ?? 60) * 1000;
const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);

async function deps(): Promise<Deps> {
  const bee = realBee();
  const me = await bee.whoami(); // throws 'Not logged in. Run "bee login" first.' when there is no session
  const ctx: Ctx = { ownerNames: me.name.split(/\s+/).filter(Boolean), tv: tvContext(me.name) };
  return { bee, ledger: openLedger(dbPath), ctx, log };
}

function report() {
  const rows = openLedger(dbPath).all();
  if (rows.length === 0) {
    console.log("ledger is empty: run `receipts once` or `receipts watch` against a logged-in Bee first");
    process.exitCode = 1;
    return;
  }
  const by = (v: string) => rows.filter((r) => r.verdict === v).length;
  console.log(`Bee fact provenance: ${rows.length} facts checked`);
  console.log(`  receipt found (supported): ${by("supported")}`);
  console.log(`  heard from TV or others (likely-tv): ${by("likely-tv")}`);
  console.log(`  no receipt (unsupported): ${by("unsupported")}`);
  const forgot = rows.filter((r) => r.decision === "forgotten" || r.decision === "already-gone").length;
  const kept = rows.filter((r) => r.decision === "confirmed" || r.decision === "kept-todo-deleted").length;
  console.log(`wearer decisions: forgot ${forgot}, kept ${kept}, undecided ${rows.filter((r) => r.decision === null).length}`);
  if (forgot + kept > 0) console.log(`  facts Bee wrote that the wearer kept: ${((kept / (forgot + kept)) * 100).toFixed(0)}% of ${forgot + kept} decided`);
}

async function why(text: string) {
  const d = await deps();
  const all = [...(await d.bee.listFacts({})), ...(await d.bee.listFacts({ unconfirmed: true }))];
  if (all.length === 0) throw new Error("This Bee account has zero facts, nothing to explain.");
  const want = new Set(contentTokens(text, d.ctx.ownerNames));
  let best: { fact: Fact; hit: number } | null = null;
  for (const fact of all) {
    const hit = contentTokens(fact.text, d.ctx.ownerNames).filter((t) => want.has(t)).length;
    if (hit > 0 && (!best || hit > best.hit)) best = { fact, hit };
  }
  if (!best) throw new Error(`No stored fact shares content words with "${text}".`);
  const r = await receiptFor(d.bee, best.fact, d.ctx);
  console.log(JSON.stringify(r, null, 2));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "doctor": {
      const d = await deps();
      const me = await d.bee.whoami();
      const facts = await d.bee.listFacts({});
      const pending = await d.bee.listFacts({ unconfirmed: true });
      console.log(`logged in as ${me.name} (id ${me.id}); ${facts.length} confirmed fact(s), ${pending.length} pending`);
      break;
    }
    case "once": {
      const d = await deps();
      console.log(JSON.stringify(await tick(d)));
      break;
    }
    case "watch": {
      const d = await deps();
      const ac = new AbortController();
      process.on("SIGINT", () => ac.abort());
      if (rest.includes("--serve")) log(`review page on http://127.0.0.1:${(await startServer(d, port).then((s) => (s.address() as { port: number }).port))}`);
      await watch(d, { intervalMs, signal: ac.signal });
      break;
    }
    case "review": {
      const d = await deps();
      const s = await startServer(d, port);
      log(`review page on http://127.0.0.1:${(s.address() as { port: number }).port}`);
      break;
    }
    case "why":
      if (!rest[0]) throw new Error('usage: receipts why "<fact text>"');
      await why(rest.join(" "));
      break;
    case "report":
      report();
      break;
    default:
      console.log(USAGE);
      process.exitCode = cmd ? 2 : 0;
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
