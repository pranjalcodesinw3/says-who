// The self-review export and the --demo paths of `why` and `report`: the sample account, the real engine, no Bee login.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDemo } from "../src/demo.ts";
import { reportMarkdown } from "../src/report.ts";
import { forgetFact } from "../src/watch.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const counts = (md: string) => /Questionable facts in Bee: before (\d+), now (\d+)/.exec(md)!.slice(1).map(Number);

test("report --md: a verified forget moves 'now' down by one and the fact keeps its quote and decision time", async () => {
  const d = await buildDemo({});
  const first = reportMarkdown(d.ledger.all());
  assert.match(first, /^# Says Who self-review\n/);
  assert.match(first, /Facts checked: 3\n/);
  assert.match(first, /- `likely-tv` \(heard from TV or others\): 1\n/);
  const [n, m] = counts(first);
  assert.equal(n, 2, "the TV fact and the planted fact are questionable");
  assert.equal(m, n);
  assert.ok(await forgetFact(d, 2));
  const after = reportMarkdown(d.ledger.all());
  assert.deepEqual(counts(after), [n, n! - 1]);
  assert.match(after, /- Fact 2, "Sam is a criminal lawyer": `likely-tv`\. Heard "He is a criminal lawyer[^\n]*Forgotten \w{3} \d{1,2}:\d{2} [AP]M, read back from Bee: gone\./);
  assert.match(after, /- Fact 3, [^\n]*Open: on the wrist as to-do 9002\./);
});

const run = (...args: string[]) =>
  spawnSync("node", ["--disable-warning=ExperimentalWarning", cli, ...args], { env: { ...process.env, BEE_BIN: "/nonexistent/bee", RECEIPTS_JUDGE: "none" }, encoding: "utf8" });

test("why --demo and report --demo --md run with no Bee login", () => {
  const why = run("why", "--demo", "criminal lawyer");
  assert.equal(why.status, 0, why.stderr);
  const r = JSON.parse(why.stdout) as { factId: number; verdict: string; tvScore: number };
  assert.deepEqual([r.factId, r.verdict, r.tvScore], [2, "likely-tv", 1]);
  const miss = run("why", "--demo", "astronaut");
  assert.equal(miss.status, 1);
  assert.match(miss.stderr, /No stored fact shares content words with "astronaut"/);
  const md = run("report", "--demo", "--md");
  assert.equal(md.status, 0, md.stderr);
  assert.match(md.stdout, /Facts checked: 3/);
  assert.deepEqual(counts(md.stdout), [2, 2]);
  assert.equal(run("why", "criminal lawyer").status, 1, "without --demo, why still needs the Bee login");
});
