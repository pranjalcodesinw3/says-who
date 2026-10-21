// Ledgers written by an older build keep working: the renamed verdict is migrated and a missing scope reads as "not recorded".
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLedger } from "../src/ledger.ts";

test("an old ledger row with verdict 'unsupported' reads back as 'no-evidence' with an empty scope", () => {
  const path = join(mkdtempSync(join(tmpdir(), "receipts-ledger-")), "old.db");
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE receipts (fact_id INTEGER PRIMARY KEY, fact_text TEXT NOT NULL, fact_created_at INTEGER, verdict TEXT NOT NULL, tv_score REAL NOT NULL, support_score REAL NOT NULL,
    quote TEXT, speaker TEXT, spoken_at INTEGER, conversation_id INTEGER, reasons TEXT NOT NULL, searched INTEGER NOT NULL, todo_id INTEGER, decision TEXT, decided_at INTEGER, verified_gone INTEGER, created_at INTEGER NOT NULL);
    INSERT INTO receipts (fact_id, fact_text, verdict, tv_score, support_score, reasons, searched, created_at) VALUES (7, 'x', 'unsupported', 0, 0, '[]', 4, 1);`);
  old.close();
  const row = openLedger(path).get(7)!;
  assert.equal(row.verdict, "no-evidence");
  assert.deepEqual(row.scope.candidates, []);
  assert.equal(row.searched, 4);
});

test("rev is a change counter: insert, to-do link and decision each bump it, replays do not, and since() returns only newer rows", () => {
  const l = openLedger(":memory:");
  const receipt = (factId: number) => ({
    factId, factText: `fact ${factId}`, factCreatedAt: null, verdict: "no-evidence" as const, tvScore: 0, supportScore: 0, quote: null, speaker: null, attribution: null, attributionWhy: null,
    spokenAt: null, conversationId: null, reasons: [], searched: 0, scope: { methods: [], since: null, until: null, candidates: [] }, relatedFactId: null, relatedFactText: null,
  });
  assert.equal(l.maxRev(), 0);
  l.insert(receipt(1));
  l.insert(receipt(2));
  assert.deepEqual(l.since(0).map((r) => [r.factId, r.rev]), [[1, 1], [2, 2]]);
  l.insert(receipt(1));
  assert.equal(l.maxRev(), 2, "an ignored replay does not look like a change");
  l.setTodo(1, 900);
  assert.deepEqual(l.since(2).map((r) => [r.factId, r.rev]), [[1, 3]]);
  l.decide(2, "forgotten", true);
  assert.deepEqual(l.since(3).map((r) => [r.factId, r.decision]), [[2, "forgotten"]]);
  l.decide(2, "confirmed", null);
  assert.equal(l.maxRev(), 4, "a second decision on a decided fact changes nothing");
});
