// FIXTURE-backed tests of the watch loop (test/fixtures/fixture-bee.ts). Real-client wiring is tested at the bottom.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openLedger } from "../src/ledger.ts";
import { realBee } from "../src/bee.ts";
import { tvContext } from "../src/tv.ts";
import { confirmFact, LABEL_RE, reconcile, tick, todoText, type Deps } from "../src/watch.ts";
import {
  FACT_ALREADY_CONFIRMED, FACT_LAWYER, FACT_OAT, FACT_PLANTED, FIXTURE_OWNER, NOISE_CONVO, TV_CONVO, WEARER_CONVO, fakeBee, type FakeBee,
} from "./fixtures/fixture-bee.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function setup(facts = [FACT_OAT, FACT_LAWYER, FACT_PLANTED]) {
  const bee = fakeBee({ facts, conversations: [WEARER_CONVO, TV_CONVO, NOISE_CONVO] });
  const logs: string[] = [];
  const d: Deps = {
    bee, ledger: openLedger(":memory:"), log: (l) => logs.push(l),
    ctx: { ownerNames: FIXTURE_OWNER.split(" "), tv: tvContext(FIXTURE_OWNER) }, now: () => 1_000_000, alarmLeadMs: 0,
  };
  return { bee, d, logs };
}
const todoFor = (bee: FakeBee, factId: number) => [...bee.todos.values()].find((t) => LABEL_RE.exec(t.text)?.[1] === String(factId));

test("tick: doubtful facts go to the wrist labelled with the fact id, the supported one does not", async () => {
  const { bee, d } = setup();
  const r = await tick(d);
  assert.equal(r.failed, 0);
  assert.deepEqual(d.ledger.all().map((x) => [x.factId, x.verdict]).sort(), [[1, "supported"], [2, "likely-tv"], [3, "unsupported"]]);
  assert.equal(bee.todos.size, 2, "one to-do per doubtful fact");
  assert.ok(todoFor(bee, 2) && todoFor(bee, 3) && !todoFor(bee, 1));
  const t = todoFor(bee, 2)!;
  assert.equal(t.alarm_at, 1_000_000, "alarm_at is now");
  assert.match(t.text, /Tick = forget \[rcpt:2\]$/);
  assert.ok(t.text.length < 220);
  assert.equal(d.ledger.cursor(), "cursor-1", "cursor saved after the batch");
});

test("idempotent: replaying the same changed batch makes no second receipt and no second to-do", async () => {
  const { bee, d } = setup();
  await tick(d);
  const before = { todos: bee.todos.size, rows: d.ledger.all().length };
  await tick(d);
  await tick(d);
  assert.deepEqual({ todos: bee.todos.size, rows: d.ledger.all().length }, before);
  assert.equal(bee.calls.filter((c) => c.startsWith("todo-create")).length, 2);
});

test("tick on the wrist forgets the fact and the read-back proves it is gone", async () => {
  const { bee, d } = setup();
  await tick(d);
  const t = todoFor(bee, 2)!;
  bee.tick(t.id, { completed: true });
  assert.equal(await reconcile(d), 1);
  assert.equal(bee.facts.has(2), false, "fact 2 deleted in Bee");
  const row = d.ledger.get(2)!;
  assert.equal(row.decision, "forgotten");
  assert.equal(row.verifiedGone, true);
  assert.ok(bee.facts.has(3) && bee.facts.has(1), "other facts untouched");
});

test("MUST-FAIL: an unticked to-do produces no delete", async () => {
  const { bee, d } = setup();
  await tick(d);
  await tick(d);
  await reconcile(d);
  assert.ok(!bee.calls.some((c) => c.startsWith("delete")), bee.calls.join(","));
  assert.ok(bee.facts.has(2) && bee.facts.has(3));
  assert.equal(d.ledger.get(2)!.decision, null);
});

test("a to-do dismissed without a tick keeps the fact and writes nothing to Bee", async () => {
  const { bee, d } = setup();
  await tick(d);
  bee.todos.delete(todoFor(bee, 3)!.id);
  await reconcile(d);
  assert.equal(d.ledger.get(3)!.decision, "kept-todo-deleted");
  assert.ok(bee.facts.has(3));
  assert.ok(!bee.calls.some((c) => c.startsWith("delete")));
});

test("a failure mid-batch keeps the cursor back and the retry completes without duplicates", async () => {
  const { bee, d, logs } = setup();
  bee.failConversationOnce = true;
  const first = await tick(d);
  assert.ok(first.failed >= 1);
  assert.equal(first.cursorSaved, false);
  assert.equal(d.ledger.cursor(), undefined);
  assert.ok(logs.some((l) => /will retry/.test(l)));
  const second = await tick(d);
  assert.equal(second.failed, 0);
  assert.equal(d.ledger.all().length, 3);
  assert.equal(bee.todos.size, 2);
  assert.deepEqual(bee.calls.filter((c) => c.startsWith("changed")), ["changed:-", "changed:-"], "retry re-reads from the same place");
  const saved = d.ledger.cursor()!;
  assert.match(saved, /^cursor-/);
  await tick(d);
  assert.equal(bee.calls.filter((c) => c.startsWith("changed")).at(-1), `changed:${saved}`, "next tick resumes from the saved cursor");
});

test("a to-do created before a crash is found by its label, not duplicated", async () => {
  const { bee, d } = setup([FACT_PLANTED]);
  await bee.createTodo({ text: "Bee thinks it. [rcpt:3]", alarmAt: new Date(0).toISOString() });
  await tick(d);
  assert.equal(bee.todos.size, 1);
  assert.equal(d.ledger.get(3)!.todoId, 500);
});

test("a fact the wearer already confirmed gets a receipt but no to-do", async () => {
  const { bee, d } = setup([FACT_ALREADY_CONFIRMED]);
  await tick(d);
  assert.equal(d.ledger.all().length, 1);
  assert.equal(bee.todos.size, 0);
});

test("when `bee changed` throws, pending facts are still receipted and the cursor does not move", async () => {
  const { bee, d, logs } = setup();
  bee.failChangedWith = "Request failed with status 404";
  const r = await tick(d);
  assert.equal(r.cursorSaved, false);
  assert.equal(d.ledger.all().length, 3);
  assert.ok(logs.some((l) => /falling back/.test(l)));
});

test("confirm is verified by reading the fact back", async () => {
  const { bee, d } = setup();
  await tick(d);
  assert.equal(await confirmFact(d, 1), true);
  assert.equal(bee.facts.get(1)!.confirmed, true);
  assert.equal(d.ledger.get(1)!.decision, "confirmed");
});

test("wrist text keeps the label even for a long fact", () => {
  const text = todoText({ factId: 12, factText: "x".repeat(400), verdict: "unsupported", quote: null, spokenAt: null } as never);
  assert.match(text, /\[rcpt:12\]$/);
  assert.ok(text.length < 220);
});

test("REAL CLIENT: createBeeClient -> bundled bee binary reports a missing login (isolated config dir, no fixtures)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "receipts-nologin-"));
  const bee = realBee({ env: { BEE_CONFIG_DIR: dir, BEE_FORCE_FILE_STORE: "1" } });
  await assert.rejects(bee.whoami(), /Not logged in/);
  await assert.rejects(bee.listFacts({}), /Not logged in/);
});
