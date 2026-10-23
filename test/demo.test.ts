// The demo account: invented data through the real engine, ledger, page and verified write paths. It needs no Bee login.
import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDemo } from "../src/demo.ts";
import { openLedger } from "../src/ledger.ts";
import { startServer } from "../src/server.ts";
import type { Deps } from "../src/watch.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

function http(port: number, method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; location?: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers, agent: false }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, location: res.headers.location }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("the demo account builds a supported, a heard-on-TV and a no-evidence receipt with real quotes", async () => {
  const d = await buildDemo();
  const rows = d.ledger.all().sort((a, b) => a.factId - b.factId);
  assert.deepEqual(rows.map((r) => r.verdict), ["supported", "likely-tv", "no-evidence"]);
  assert.match(rows[0]!.quote!, /oat milk/);
  assert.equal(rows[0]!.attribution, "self");
  assert.match(rows[1]!.quote!, /criminal lawyer/);
  assert.equal(rows[1]!.speaker, "Speaker 2");
  assert.equal(rows[2]!.quote, null);
  assert.ok(rows[2]!.scope.candidates.length >= 3, "the no-evidence receipt lists what it read");
});

test("/demo renders the three receipts side by side with the hero, and its buttons act on the demo account only", async () => {
  const mine: Deps = { ...(await buildDemo()), ledger: openLedger(":memory:") }; // the real ledger of this server stays empty
  const server = await startServer(mine, 0);
  const port = (server.address() as { port: number }).port;
  try {
    const page = await http(port, "GET", "/demo");
    assert.equal(page.status, 200);
    assert.match(page.body, /<main class="demo"/);
    assert.equal((page.body.match(/<article class="slip/g) ?? []).length, 3);
    for (const needle of ["Receipt found", "Likely TV", "No evidence found", "Receipt of the day", "Prefers oat milk", "criminal lawyer", "Demo", "Reset the demo"]) assert.ok(page.body.includes(needle), `demo page is missing "${needle}"`);
    const at = (n: number) => page.body.indexOf(`id="fact-${n}"`);
    assert.ok(at(1) > 0 && at(1) < at(2) && at(2) < at(3), "supported, then TV, then no evidence, left to right");

    assert.equal((await http(port, "POST", "/demo/api/facts/2/forget")).status, 403, "write without the header is refused");
    assert.equal((await http(port, "POST", "/demo/api/facts/2/forget", { "x-receipts": "1" })).status, 200);
    assert.match((await http(port, "GET", "/demo")).body, /Forgotten \d{1,2}:\d{2} [AP]M, read back from Bee: gone/);
    assert.equal((await http(port, "GET", "/api/receipts")).body, "[]", "the real ledger was not touched");

    assert.equal((await http(port, "POST", "/demo/api/reset", { "x-receipts": "1" })).status, 200);
    assert.ok(!/Forgotten \d/.test((await http(port, "GET", "/demo")).body), "reset rebuilds the account");
  } finally {
    server.close();
  }
});

test("an empty real ledger offers the demo in one click", async () => {
  const server = await startServer({ ledger: openLedger(":memory:") } as Deps, 0);
  try {
    const page = await http((server.address() as { port: number }).port, "GET", "/");
    assert.match(page.body, /The tape is blank/);
    assert.match(page.body, /<a class="btn primary" href="\/demo">Open the demo<\/a>/);
  } finally {
    server.close();
  }
});

test("`receipts demo` serves the demo with no Bee login and `/` goes straight to it", async () => {
  const child = spawn("node", ["--disable-warning=ExperimentalWarning", cli, "demo"], { env: { ...process.env, BEE_BIN: "/nonexistent/bee", RECEIPTS_PORT: "0" } });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let out = "";
      child.stdout.on("data", (c) => { out += c; const m = /demo on (http:\/\/127\.0\.0\.1:\d+)\/demo/.exec(out); if (m) resolve(m[1]!); });
      child.on("exit", (code) => reject(new Error(`exited ${code}: ${out}`)));
      setTimeout(() => reject(new Error(`no url: ${out}`)), 8000);
    });
    const port = Number(new URL(url).port);
    const root = await http(port, "GET", "/");
    assert.equal(root.status, 302);
    assert.equal(root.location, "/demo");
    assert.equal((await http(port, "GET", "/demo")).body.match(/<article class="slip/g)?.length, 3);
  } finally {
    child.kill();
  }
});
