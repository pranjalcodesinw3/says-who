// Restart safety: the ledger is a file, so a process that dies and comes back must lose no pending wrist decision, never double a to-do,
// and resume the `bee changed` cursor. Each test closes the ledger and reopens the same file, as a restart does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLedger } from "../src/ledger.ts";
import { receiptFor } from "../src/provenance.ts";
import { tvContext } from "../src/tv.ts";
import { LABEL_RE, tick, type Deps } from "../src/watch.ts";
import { FACT_LAWYER, FACT_OAT, FACT_PLANTED, FIXTURE_OWNER, NOISE_CONVO, TV_CONVO, WEARER_CONVO, fakeBee, type FakeBee } from "./fixtures/fixture-bee.ts";

const ctx = { ownerNames: FIXTURE_OWNER.split(" "), tv: tvContext(FIXTURE_OWNER) };
const todosFor = (bee: FakeBee, id: number) => [...bee.todos.values()].filter((t) => LABEL_RE.exec(t.text)?.[1] === String(id));

function boot(bee: FakeBee, dbPath: string): Deps {
  return { bee, ledger: openLedger(dbPath), log: () => {}, ctx, now: () => 1_000_000, alarmLeadMs: 0 };
}
const fresh = () => ({
  bee: fakeBee({ facts: [FACT_OAT, FACT_LAWYER, FACT_PLANTED], conversations: [WEARER_CONVO, TV_CONVO, NOISE_CONVO] }),
  db: join(mkdtempSync(join(tmpdir(), "receipts-restart-")), "ledger.db"),
});

test("restart after a full pass: same cursor sent to bee changed, no second receipt, no second to-do", async () => {
  const { bee, db } = fresh();
  let d = boot(bee, db);
  await tick(d);
  const cursor = d.ledger.cursor();
  assert.ok(cursor, "a cursor was saved");
  const before = { todos: bee.todos.size, rows: d.ledger.all().length };
  d.ledger.close();

  d = boot(bee, db);
  assert.equal(d.ledger.cursor(), cursor, "the cursor survives the restart");
  await tick(d);
  assert.ok(bee.calls.includes(`changed:${cursor}`), "the first call after restart resumes from the saved cursor");
  assert.deepEqual({ todos: bee.todos.size, rows: d.ledger.all().length }, before);
  assert.equal(todosFor(bee, 2).length, 1);
  assert.equal(todosFor(bee, 3).length, 1);
  d.ledger.close();
});

test("a tick on the wrist while the process is down is honoured on restart: forgotten and read back gone", async () => {
  const { bee, db } = fresh();
  let d = boot(bee, db);
  await tick(d);
  d.ledger.close();
  bee.tick(todosFor(bee, 2)[0]!.id, { completed: true }); // the wearer ticks while Receipts is not running

  d = boot(bee, db);
  assert.equal(d.ledger.get(2)!.decision, null, "nothing was decided while down");
  await tick(d);
  assert.equal(bee.facts.has(2), false);
  assert.equal(d.ledger.get(2)!.decision, "forgotten");
  assert.equal(d.ledger.get(2)!.verifiedGone, true);
  assert.ok(bee.facts.has(3), "the unticked fact is untouched");
  d.ledger.close();
});

test("a to-do dismissed while down keeps the fact, and nothing is deleted", async () => {
  const { bee, db } = fresh();
  let d = boot(bee, db);
  await tick(d);
  d.ledger.close();
  bee.todos.delete(todosFor(bee, 3)[0]!.id);

  d = boot(bee, db);
  await tick(d);
  assert.equal(d.ledger.get(3)!.decision, "kept-todo-deleted");
  assert.ok(bee.facts.has(3));
  assert.ok(!bee.calls.some((c) => c.startsWith("delete:")));
  d.ledger.close();
});

test("MUST-FAIL: a crash after the receipt was stored but before its to-do, with the cursor already past the fact, still gets exactly one to-do", async () => {
  const { bee, db } = fresh();
  const first = openLedger(db);
  // the state a crash leaves: receipt row written, no to-do, and a cursor that will not redeliver the fact
  first.insert(await receiptFor(bee, FACT_LAWYER, ctx));
  first.saveCursor("cursor-past-the-fact");
  first.close();
  bee.changedFacts = []; // bee changed has nothing new after that cursor

  const d = boot(bee, db);
  assert.equal(d.ledger.get(2)!.todoId, null);
  assert.equal(bee.todos.size, 0);
  await tick(d);
  assert.equal(todosFor(bee, 2).length, 1, "the pending decision was not lost");
  assert.equal(d.ledger.get(2)!.todoId, todosFor(bee, 2)[0]!.id);
  await tick(d);
  await tick(d);
  assert.equal(todosFor(bee, 2).length, 1, "and not duplicated by later passes");
  d.ledger.close();
});

test("a crash between creating the to-do and recording it adopts the existing to-do instead of creating a second", async () => {
  const { bee, db } = fresh();
  const first = openLedger(db);
  first.insert(await receiptFor(bee, FACT_LAWYER, ctx));
  first.close();
  await bee.createTodo({ text: `Bee wrote "Dave is a criminal lawyer". Did you say it, or hear it? Tick = forget [rcpt:2]`, alarmAt: new Date(1_000_000).toISOString() });
  bee.changedFacts = [];

  const d = boot(bee, db);
  await tick(d);
  assert.equal(todosFor(bee, 2).length, 1);
  assert.equal(d.ledger.get(2)!.todoId, todosFor(bee, 2)[0]!.id);
  d.ledger.close();
});

test("a pending receipt whose fact vanished from Bee while down is closed, not retried forever", async () => {
  const { bee, db } = fresh();
  const first = openLedger(db);
  first.insert(await receiptFor(bee, FACT_LAWYER, ctx));
  first.close();
  bee.facts.delete(2);
  bee.changedFacts = [];

  const d = boot(bee, db);
  await tick(d);
  assert.equal(d.ledger.get(2)!.decision, "already-gone");
  assert.equal(bee.todos.size, 0, "no reminder for a fact that no longer exists");
  d.ledger.close();
});
