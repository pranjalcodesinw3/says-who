// FIXTURE drive of scripts/forced-fault.sh: the script talks to test/fixtures/fake-bee-cli.mjs through BEE_BIN, so these tests prove the
// script's gate, waits, exit codes and post-conditions. They do not prove that Bee writes facts from a TV clip; that happens on demo day.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FACT_LAWYER, FACT_OAT, FIXTURE_OWNER, NOISE_CONVO, TV_CONVO, WEARER_CONVO } from "./fixtures/fixture-bee.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const fake = fileURLToPath(new URL("./fixtures/fake-bee-cli.mjs", import.meta.url));

function run(arrival: typeof FACT_LAWYER | null, env: Record<string, string>, args: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "receipts-fault-"));
  const statePath = join(dir, "state.json");
  const [first, ...last] = FIXTURE_OWNER.split(" ");
  writeFileSync(statePath, JSON.stringify({ owner: { first, last: last.join(" ") }, facts: [], arrival, conversations: [WEARER_CONVO, TV_CONVO, NOISE_CONVO], todos: [] }));
  const r = spawnSync("bash", ["scripts/forced-fault.sh", ...args], {
    cwd: root, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, BEE_BIN: fake, FAKE_BEE_STATE: statePath, RECEIPTS_DB: join(dir, "ledger.db"), FAULT_POLL_S: "1", ...env },
  });
  return { ...r, state: () => JSON.parse(readFileSync(statePath, "utf8")) as { facts: { id: number }[]; todos: { id: number; text: string; completed: boolean }[] }, argv: () => { try { return readFileSync(`${statePath}.argv`, "utf8"); } catch { return ""; } } };
}

test("MUST-FAIL: refuses to run when Bee is not logged in, before touching facts, with the login instructions", () => {
  const r = run(FACT_LAWYER, { FAKE_BEE_LOGIN: "0" });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /not logged in to Bee/);
  assert.match(r.stderr, /login --no-wait/);
  assert.ok(!/baseline/.test(r.stdout), "it must not have started the procedure");
});

test("the whole chain: Bee writes a fact, the receipt prints, the reminder reads back, the tick forgets it and the read-back says gone", () => {
  const r = run(FACT_LAWYER, { FAKE_BEE_ARRIVE_ON_LIST: "3", FAKE_BEE_TICK_AFTER_GETS: "4", FAULT_WAIT_FACT_S: "20", FAULT_WAIT_TICK_S: "20" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /baseline: 0 pending fact/);
  assert.match(r.stdout, /Bee wrote fact 2: "Dave is a criminal lawyer"/);
  assert.match(r.stdout, /verdict likely-tv/);
  assert.match(r.stdout, /searched 3 conversation/);
  assert.match(r.stdout, /wrist reminder \d+ read back from Bee: .*\[rcpt:2\]/);
  assert.match(r.stdout, /tick seen on reminder/);
  assert.match(r.stdout, /fact 2 is gone from Bee \(facts get: not found\)\. Ledger: decision forgotten, verifiedGone true/);
  assert.ok(!r.state().facts.some((f) => f.id === 2), "the fact is really gone from the fixture's Bee");
  assert.match(r.argv(), /facts delete 2/);
});

test("MUST-FAIL: no new fact within the window exits 3 and never plants one", () => {
  const r = run(FACT_LAWYER, { FAULT_WAIT_FACT_S: "3" });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stderr, /Nothing was planted/);
  assert.ok(!/facts create/.test(r.argv()));
});

test("MUST-FAIL: a reminder that is never ticked exits 6 and deletes nothing", () => {
  const r = run(FACT_LAWYER, { FAKE_BEE_ARRIVE_ON_LIST: "3", FAULT_WAIT_FACT_S: "20", FAULT_WAIT_TICK_S: "3" });
  assert.equal(r.status, 6, r.stdout + r.stderr);
  assert.ok(r.state().facts.some((f) => f.id === 2));
  assert.ok(!/facts delete/.test(r.argv()));
});

test("a supported fact has no reminder, and the script says so instead of pretending the fault happened", () => {
  const r = run({ ...FACT_OAT, id: 9 }, { FAKE_BEE_ARRIVE_ON_LIST: "3", FAULT_WAIT_FACT_S: "20" });
  assert.equal(r.status, 5, r.stdout + r.stderr);
  assert.match(r.stdout, /verdict supported/);
  assert.match(r.stderr, /not doubtful/);
});

test("--no-tick stops once the reminder reads back from Bee", () => {
  const r = run(FACT_LAWYER, { FAKE_BEE_ARRIVE_ON_LIST: "3", FAULT_WAIT_FACT_S: "20" }, ["--no-tick"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /--no-tick: stopping before the tick/);
  assert.ok(r.state().facts.some((f) => f.id === 2));
});
