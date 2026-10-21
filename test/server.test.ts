// FIXTURE-backed test of the review page and its write endpoints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { openLedger } from "../src/ledger.ts";
import { startServer } from "../src/server.ts";
import { tvContext } from "../src/tv.ts";
import { reconcile, tick, type Deps } from "../src/watch.ts";
import { BROTHER_CONVO, FACT_LAWYER, FACT_OAT, FACT_PLANTED, FACT_VEGAN, FIXTURE_OWNER, NOISE_CONVO, TV_CONVO, WEARER_CONVO, fakeBee } from "./fixtures/fixture-bee.ts";

function http(port: number, method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("review page lists every fact with its receipt, and the buttons write through verified paths", async () => {
  const bee = fakeBee({ facts: [FACT_OAT, FACT_LAWYER, FACT_PLANTED], conversations: [WEARER_CONVO, TV_CONVO, NOISE_CONVO] });
  const d: Deps = { bee, ledger: openLedger(":memory:"), log: () => {}, ctx: { ownerNames: FIXTURE_OWNER.split(" "), tv: tvContext(FIXTURE_OWNER) }, alarmLeadMs: 0 };
  await tick(d);
  const server = await startServer(d, 0);
  const port = (server.address() as { port: number }).port;
  try {
    const page = await http(port, "GET", "/");
    assert.equal(page.status, 200);
    for (const needle of ["Prefers oat milk", "Dave is a criminal lawyer", "I hold a commercial pilot licence", "I switched to oat milk this week", "Likely TV", "No evidence found", "Searched 3 conversations", "not a probability", "Receipt found", "facts checked"]) {
      assert.ok(page.body.includes(needle), `page is missing "${needle}"`);
    }
    assert.ok(!page.body.includes("\u2014"), "no em dashes in page copy");
    assert.equal((JSON.parse((await http(port, "GET", "/api/receipts")).body) as unknown[]).length, 3);

    assert.equal((await http(port, "POST", "/api/facts/2/forget")).status, 403, "write without the header is refused");
    assert.ok(bee.facts.has(2));
    assert.equal((await http(port, "POST", "/api/facts/99/forget", { "x-receipts": "1" })).status, 404);
    assert.equal((await http(port, "POST", "/api/facts/2/forget", { "x-receipts": "1" })).status, 200);
    assert.equal(bee.facts.has(2), false);
    assert.equal((await http(port, "POST", "/api/facts/1/confirm", { "x-receipts": "1" })).status, 200);
    assert.equal(bee.facts.get(1)!.confirmed, true);
    assert.match((await http(port, "GET", "/")).body, /Forgotten\. Bee no longer holds this fact/);

    const wrongHost = await http(port, "GET", "/", { host: "evil.example" });
    assert.equal(wrongHost.status, 403);
  } finally {
    server.close();
  }
});

test("empty ledger renders the blank-tape state, not an empty list", async () => {
  const d = { ledger: openLedger(":memory:") } as Deps;
  const server = await startServer(d, 0);
  try {
    const page = await http((server.address() as { port: number }).port, "GET", "/");
    assert.match(page.body, /The tape is blank/);
    assert.match(page.body, /<b>0<\/b><span>facts checked/);
  } finally {
    server.close();
  }
});

type FeedEvent = { rev: number; factId: number; verdict: string; slip: string; tape: string; decision: string | null; quote: string | null };
function openFeed(port: number, path: string) {
  const events: FeedEvent[] = [];
  let buf = "";
  const req = request({ host: "127.0.0.1", port, method: "GET", path, headers: { accept: "text/event-stream" } }, (res) => {
    res.setEncoding("utf8");
    res.on("data", (c: string) => {
      buf += c;
      for (let i = buf.indexOf("\n\n"); i !== -1; i = buf.indexOf("\n\n")) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (/^event: receipt$/m.test(block)) events.push(JSON.parse(/^data: (.*)$/m.exec(block)![1]!) as FeedEvent);
      }
    });
  });
  req.end();
  const waitFor = async (pred: (e: FeedEvent[]) => boolean, ms = 4000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (pred(events)) return;
    throw new Error(`feed never produced the expected event; saw ${JSON.stringify(events.map((e) => [e.factId, e.verdict, e.decision]))}`);
  };
  return { events, waitFor, close: () => req.destroy() };
}

test("live feed: a fact that arrives through the changed cursor shows up with its matched line and verdict, then its wrist tick shows up, and nothing replays", async () => {
  const bee = fakeBee({ facts: [FACT_OAT], conversations: [WEARER_CONVO, NOISE_CONVO] });
  const d: Deps = { bee, ledger: openLedger(":memory:"), log: () => {}, ctx: { ownerNames: ["Dave"], tv: tvContext("Dave") }, alarmLeadMs: 0 };
  await tick(d);
  const server = await startServer(d, 0, { feedMs: 25 });
  const port = (server.address() as { port: number }).port;
  const page = await http(port, "GET", "/");
  const rev = Number(/data-rev="(\d+)"/.exec(page.body)![1]);
  assert.ok(rev > 0 && page.body.includes('id="feed"') && page.body.includes("new EventSource"));
  const feed = openFeed(port, `/api/feed?after=${rev}`);
  try {
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(feed.events.length, 0, "rows from before the page loaded are not replayed");

    bee.conversations.set(BROTHER_CONVO.id, BROTHER_CONVO);
    bee.facts.set(FACT_VEGAN.id, { ...FACT_VEGAN });
    bee.changedFacts = [FACT_VEGAN.id];
    await tick(d);
    await feed.waitFor((e) => e.some((x) => x.factId === 20 && /On your wrist as to-do/.test(x.slip)));
    const arrived = feed.events.find((x) => x.factId === 20)!;
    assert.equal(arrived.verdict, "unattributed");
    assert.match(arrived.slip, /My brother is vegan/);
    assert.match(arrived.slip, /Not tied to you/);
    assert.match(arrived.tape, /<b>2<\/b><span>facts checked/);
    assert.ok(!feed.events.some((x) => x.factId === 1), "the old fact did not replay");

    const todo = [...bee.todos.values()].find((t) => t.text.includes("[rcpt:20]"))!;
    bee.tick(todo.id, { completed: true });
    await reconcile(d);
    await feed.waitFor((e) => e.some((x) => x.factId === 20 && x.decision === "forgotten" && /Forgotten\. Bee no longer holds this fact/.test(x.slip)));
  } finally {
    feed.close();
    server.close();
  }
});

test("live feed resumes from Last-Event-ID after a dropped connection", async () => {
  const bee = fakeBee({ facts: [FACT_OAT, FACT_LAWYER], conversations: [WEARER_CONVO, TV_CONVO] });
  const d: Deps = { bee, ledger: openLedger(":memory:"), log: () => {}, ctx: { ownerNames: ["Dave"], tv: tvContext("Dave") }, alarmLeadMs: 0 };
  await tick(d);
  const server = await startServer(d, 0, { feedMs: 25 });
  const port = (server.address() as { port: number }).port;
  const maxRev = d.ledger.maxRev();
  const feed = openFeed(port, `/api/feed?after=${maxRev}`);
  try {
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(feed.events.length, 0);
  } finally {
    feed.close();
  }
  const resumed = await new Promise<string>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/api/feed?after=999999", headers: { "last-event-id": String(maxRev - 1) } }, (res) => {
      let b = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => { b += c; if (/event: receipt/.test(b)) { req.destroy(); resolve(b); } });
    });
    req.on("error", reject);
    setTimeout(() => { req.destroy(); reject(new Error("no replay from Last-Event-ID")); }, 3000);
    req.end();
  }).catch((e: unknown) => String(e));
  try {
    assert.match(resumed, /event: receipt/, "Last-Event-ID wins over the stale ?after");
    assert.match(resumed, new RegExp(`^id: ${maxRev}$`, "m"), "replays exactly the change after the last id it saw");
  } finally {
    server.close();
  }
});
