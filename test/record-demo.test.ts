// FIXTURE drive of scripts/record-demo.sh against test/fixtures/fake-bee-cli.mjs: gate, wiring, files and cleanup. The screen recorder is off here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FACT_LAWYER, FIXTURE_OWNER, NOISE_CONVO, TV_CONVO, WEARER_CONVO } from "./fixtures/fixture-bee.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const fake = fileURLToPath(new URL("./fixtures/fake-bee-cli.mjs", import.meta.url));
const recordings = join(root, "recordings");
const stamps = () => (existsSync(recordings) ? readdirSync(recordings) : []);

function run(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "receipts-record-"));
  const statePath = join(dir, "state.json");
  const [first, ...last] = FIXTURE_OWNER.split(" ");
  writeFileSync(statePath, JSON.stringify({ owner: { first, last: last.join(" ") }, facts: [], arrival: FACT_LAWYER, conversations: [WEARER_CONVO, TV_CONVO, NOISE_CONVO], todos: [] }));
  return spawnSync("bash", ["scripts/record-demo.sh"], {
    cwd: root, encoding: "utf8", timeout: 90_000,
    env: { ...process.env, BEE_BIN: fake, FAKE_BEE_STATE: statePath, RECEIPTS_DB: join(dir, "ledger.db"), RECEIPTS_PORT: "0", RECEIPTS_INTERVAL_S: "30", FAULT_POLL_S: "1", RECORD_SCREEN: "0", RECORD_OPEN: "0", ...env },
  });
}

test("MUST-FAIL: refuses to record when Bee is not logged in, and creates no recording folder and no process", () => {
  const before = stamps();
  const r = run({ FAKE_BEE_LOGIN: "0" });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /not logged in to Bee/);
  assert.deepEqual(stamps(), before, "nothing was created");
  assert.ok(!/review page:/.test(r.stdout), "the watch loop was never started");
});

test("a recording day files the driver log, the loop log, the timings and the stored receipt, then stops the loop", () => {
  const before = new Set(stamps());
  const r = run({ FAKE_BEE_ARRIVE_ON_LIST: "3", FAKE_BEE_TICK_AFTER_GETS: "5", FAULT_WAIT_FACT_S: "30", FAULT_WAIT_TICK_S: "30" });
  const made = stamps().filter((s) => !before.has(s));
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(made.length, 1);
    const dir = join(recordings, made[0]!);
    for (const f of ["run.log", "watch.log", "timings.txt", "receipt-2.json"]) assert.ok(existsSync(join(dir, f)) && statSync(join(dir, f)).size > 0, `${f} exists and is not empty`);
    assert.match(readFileSync(join(dir, "timings.txt"), "utf8"), /Bee wrote fact 2/);
    assert.match(readFileSync(join(dir, "timings.txt"), "utf8"), /is gone from Bee/);
    assert.equal((JSON.parse(readFileSync(join(dir, "receipt-2.json"), "utf8")) as { verdict: string }).verdict, "likely-tv");
    assert.match(readFileSync(join(dir, "watch.log"), "utf8"), /review page on http:\/\/127\.0\.0\.1:\d+/);
    assert.ok(!existsSync(join(dir, "screen.mov")), "the recorder was off");
    const port = /review page: http:\/\/127\.0\.0\.1:(\d+)/.exec(r.stdout)![1];
    assert.equal(spawnSync("curl", ["-s", "-m", "2", "-o", "/dev/null", `http://127.0.0.1:${port}/`]).status !== 0, true, "the review page is down after the run");
  } finally {
    for (const s of made) rmSync(join(recordings, s), { recursive: true, force: true });
  }
});

test("a driver failure is the script's exit code and the files are still filed", () => {
  const before = new Set(stamps());
  const r = run({ FAULT_WAIT_FACT_S: "3" });
  const made = stamps().filter((s) => !before.has(s));
  try {
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.ok(existsSync(join(recordings, made[0]!, "run.log")));
  } finally {
    for (const s of made) rmSync(join(recordings, s), { recursive: true, force: true });
  }
});
