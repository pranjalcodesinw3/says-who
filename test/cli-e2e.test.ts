// FIXTURE end-to-end: `says-who once` -> real createBeeClient -> subprocess (test/fixtures/fake-bee-cli.mjs) -> JSON -> ledger.
// Proves argument shapes and parsing across the process boundary; the data is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FACT_LAWYER, FACT_OAT, FACT_PLANTED, FIXTURE_OWNER, NOISE_CONVO, TV_CONVO, WEARER_CONVO } from "./fixtures/fixture-bee.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fake = fileURLToPath(new URL("./fixtures/fake-bee-cli.mjs", import.meta.url));

test("once -> wrist reminders -> tick -> forget, across the real client and a subprocess", () => {
  const dir = mkdtempSync(join(tmpdir(), "receipts-e2e-"));
  const statePath = join(dir, "state.json");
  const [first, ...last] = FIXTURE_OWNER.split(" ");
  const state = {
    owner: { first, last: last.join(" ") },
    facts: [FACT_OAT, FACT_LAWYER, FACT_PLANTED],
    conversations: [WEARER_CONVO, TV_CONVO, NOISE_CONVO],
    todos: [] as { id: number; text: string; completed: boolean }[],
  };
  writeFileSync(statePath, JSON.stringify(state));
  // RECEIPTS_JUDGE=none: this test pins the word-match engine across the process boundary, with or without a Bedrock key in the shell
  const env = { ...process.env, BEE_BIN: fake, FAKE_BEE_STATE: statePath, RECEIPTS_DB: join(dir, "ledger.db"), RECEIPTS_JUDGE: "none" };
  const run = (...args: string[]) => spawnSync("node", ["--disable-warning=ExperimentalWarning", cli, ...args], { env, encoding: "utf8" });
  const read = () => JSON.parse(readFileSync(statePath, "utf8")) as typeof state;

  const one = run("once");
  assert.equal(one.status, 0, one.stdout + one.stderr);
  assert.match(one.stdout, /"facts":3/);
  assert.match(one.stdout, /"failed":0/);
  assert.match(one.stdout, /"cursorSaved":true/);
  const afterOne = read();
  assert.equal(afterOne.todos.length, 2, "reminders for the TV fact and the planted fact only");
  assert.ok(afterOne.todos.every((t) => /\[rcpt:[23]\]$/.test(t.text)));
  const argv = readFileSync(`${statePath}.argv`, "utf8");
  assert.match(argv, /todos create --text .*--alarm-at \d{4}-\d\d-\d\dT.*Z --json/);
  assert.match(argv, /search --query .*--filter conversations .*--json/);
  assert.match(argv, /changed --json/);

  const two = run("once");
  assert.equal(two.status, 0, two.stdout + two.stderr);
  assert.match(readFileSync(`${statePath}.argv`, "utf8"), /changed --cursor fx-1 --json/, "second pass resumes from the saved cursor");
  assert.equal(read().todos.length, 2, "no duplicate reminders on replay");
  assert.equal(read().facts.length, 3, "an unticked reminder deletes nothing");

  const ticked = read();
  ticked.todos.find((t) => t.text.endsWith("[rcpt:2]"))!.completed = true;
  writeFileSync(statePath, JSON.stringify(ticked));
  const three = run("once");
  assert.equal(three.status, 0, three.stdout + three.stderr);
  assert.deepEqual(read().facts.map((f) => f.id).sort(), [1, 3], "ticked reminder forgot fact 2 and only fact 2");

  const why = run("why", "criminal", "lawyer");
  assert.equal(why.status, 1, "fact 2 is gone, so nothing matches and why says so instead of guessing");
  assert.match(why.stderr, /No stored fact shares content words/);
  const why2 = run("why", "oat", "milk");
  assert.equal(why2.status, 0, why2.stdout + why2.stderr);
  const receipt = JSON.parse(why2.stdout) as { verdict: string; quote: string; speaker: string; factId: number };
  assert.equal(receipt.factId, 1);
  assert.equal(receipt.verdict, "supported");
  assert.match(receipt.quote, /oat milk/);

  const rep = run("report");
  assert.match(rep.stdout, /3 facts checked/);
  assert.match(rep.stdout, /forgot 1/);
});

test("report on an empty ledger fails loudly instead of printing zeros", () => {
  const r = spawnSync("node", ["--disable-warning=ExperimentalWarning", cli, "report"], { env: { ...process.env, RECEIPTS_DB: join(mkdtempSync(join(tmpdir(), "receipts-empty-")), "l.db") }, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /ledger is empty/);
});
