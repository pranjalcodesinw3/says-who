// FIXTURE-backed test of the review page and its write endpoints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { openLedger } from "../src/ledger.ts";
import { startServer } from "../src/server.ts";
import { tvContext } from "../src/tv.ts";
import { tick, type Deps } from "../src/watch.ts";
import { FACT_LAWYER, FACT_OAT, FACT_PLANTED, FIXTURE_OWNER, NOISE_CONVO, TV_CONVO, WEARER_CONVO, fakeBee } from "./fixtures/fixture-bee.ts";

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
    for (const needle of ["Prefers oat milk", "Dave is a criminal lawyer", "I hold a commercial pilot licence", "I switched to oat milk this week", "Likely TV", "No receipt", "Receipt found", "facts checked"]) {
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
