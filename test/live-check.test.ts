// Gate tests for scripts/live-check.sh using a FIXTURE stand-in binary (test/fixtures/fake-bee-cli.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/live-check.sh", import.meta.url));
const fake = fileURLToPath(new URL("./fixtures/fake-bee-cli.mjs", import.meta.url));
const run = (env: Record<string, string>) => spawnSync("bash", [script], { env: { ...process.env, BEE_BIN: fake, ...env }, encoding: "utf8" });

test("live-check exits 2 when not logged in", () => {
  const r = run({ FAKE_BEE_LOGIN: "0" });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /not logged in/);
});

test("live-check exits 3 when the account has zero facts", () => {
  const r = run({ FAKE_BEE_FACTS: "0" });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stderr, /zero facts/);
  assert.match(r.stdout, /facts_confirmed=0/);
});

test("live-check gets past both gates when the account has facts (then stops on the fixture's missing commands)", () => {
  const r = run({ FAKE_BEE_FACTS: "2" });
  assert.match(r.stdout, /facts_confirmed=2/);
  assert.ok(r.status !== 2 && r.status !== 3, `status ${r.status}: ${r.stderr}`);
});
