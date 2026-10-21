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
