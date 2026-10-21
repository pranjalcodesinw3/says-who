// Receipt ledger: ids, verdicts, 25-word quotes. Survives Bee's 14-day history window and conversations
// Bee deleted for being under 50 words. node:sqlite, one file.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Receipt, Scope, Verdict } from "./provenance.ts";

export type Decision = "forgotten" | "confirmed" | "kept-todo-deleted" | "already-gone";

export type Row = Receipt & {
  todoId: number | null;
  decision: Decision | null;
  decidedAt: number | null;
  verifiedGone: boolean | null;
  createdAt: number;
  // monotonic change counter: bumped on insert, to-do link and decision, so a reader can ask "what changed since rev N"
  rev: number;
};

export type Ledger = ReturnType<typeof openLedger>;

export function openLedger(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 3000");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL"); // watch and review may be two processes on one file
  db.exec(`
    CREATE TABLE IF NOT EXISTS receipts (
      fact_id INTEGER PRIMARY KEY, fact_text TEXT NOT NULL, fact_created_at INTEGER,
      verdict TEXT NOT NULL, tv_score REAL NOT NULL, support_score REAL NOT NULL,
      quote TEXT, speaker TEXT, spoken_at INTEGER, conversation_id INTEGER, reasons TEXT NOT NULL, searched INTEGER NOT NULL,
      todo_id INTEGER, decision TEXT, decided_at INTEGER, verified_gone INTEGER, created_at INTEGER NOT NULL,
      related_fact_id INTEGER, related_fact_text TEXT, attribution TEXT, scope TEXT, rev INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `);
  // ledgers written before duplicate/contradicts existed lack the relation columns
  const have = new Set(db.prepare("PRAGMA table_info(receipts)").all().map((c) => String(c.name)));
  if (!have.has("related_fact_id")) db.exec("ALTER TABLE receipts ADD COLUMN related_fact_id INTEGER");
  if (!have.has("related_fact_text")) db.exec("ALTER TABLE receipts ADD COLUMN related_fact_text TEXT");
  if (!have.has("attribution")) db.exec("ALTER TABLE receipts ADD COLUMN attribution TEXT");
  if (!have.has("rev")) db.exec("ALTER TABLE receipts ADD COLUMN rev INTEGER NOT NULL DEFAULT 0");
  if (!have.has("scope")) db.exec("ALTER TABLE receipts ADD COLUMN scope TEXT");
  // "unsupported" was renamed: a search that found nothing is no evidence, which is a different claim from "nobody said it"
  db.exec("UPDATE receipts SET verdict = 'no-evidence' WHERE verdict = 'unsupported'");

  const toRow = (r: Record<string, unknown>): Row => ({
    factId: Number(r.fact_id), factText: String(r.fact_text),
    factCreatedAt: r.fact_created_at === null ? null : Number(r.fact_created_at),
    verdict: r.verdict as Verdict, tvScore: Number(r.tv_score), supportScore: Number(r.support_score),
    quote: (r.quote as string | null) ?? null, speaker: (r.speaker as string | null) ?? null,
    attribution: (r.attribution as Receipt["attribution"] | null | undefined) ?? null,
    spokenAt: r.spoken_at === null ? null : Number(r.spoken_at),
    conversationId: r.conversation_id === null ? null : Number(r.conversation_id),
    reasons: JSON.parse(String(r.reasons)) as string[], searched: Number(r.searched),
    scope: r.scope ? (JSON.parse(String(r.scope)) as Scope) : { methods: [], since: null, until: null, candidates: [] },
    relatedFactId: r.related_fact_id === null || r.related_fact_id === undefined ? null : Number(r.related_fact_id),
    relatedFactText: (r.related_fact_text as string | null | undefined) ?? null,
    todoId: r.todo_id === null ? null : Number(r.todo_id),
    decision: (r.decision as Decision | null) ?? null,
    decidedAt: r.decided_at === null ? null : Number(r.decided_at),
    verifiedGone: r.verified_gone === null ? null : Number(r.verified_gone) === 1,
    createdAt: Number(r.created_at),
    rev: Number(r.rev ?? 0),
  });
  const NEXT_REV = "(SELECT COALESCE(MAX(rev), 0) + 1 FROM receipts)";

  return {
    close: () => db.close(),
    get(factId: number): Row | null {
      const r = db.prepare("SELECT * FROM receipts WHERE fact_id = ?").get(factId);
      return r ? toRow(r) : null;
    },
    all(): Row[] {
      return db.prepare("SELECT * FROM receipts ORDER BY created_at DESC, fact_id DESC").all().map(toRow);
    },
    // INSERT OR IGNORE: the first receipt for a fact id is the one that stays, so replays are no-ops.
    insert(r: Receipt): boolean {
      const res = db.prepare(
        `INSERT OR IGNORE INTO receipts (fact_id, fact_text, fact_created_at, verdict, tv_score, support_score, quote, speaker,
          spoken_at, conversation_id, reasons, searched, created_at, related_fact_id, related_fact_text, scope, attribution, rev) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,${NEXT_REV})`,
      ).run(r.factId, r.factText, r.factCreatedAt, r.verdict, r.tvScore, r.supportScore, r.quote, r.speaker, r.spokenAt,
        r.conversationId, JSON.stringify(r.reasons), r.searched, Date.now(), r.relatedFactId, r.relatedFactText, JSON.stringify(r.scope), r.attribution);
      return Number(res.changes) === 1;
    },
    setTodo(factId: number, todoId: number) {
      db.prepare(`UPDATE receipts SET todo_id = ?, rev = ${NEXT_REV} WHERE fact_id = ?`).run(todoId, factId);
    },
    decide(factId: number, decision: Decision, verifiedGone: boolean | null) {
      db.prepare(`UPDATE receipts SET decision = ?, decided_at = ?, verified_gone = ?, rev = ${NEXT_REV} WHERE fact_id = ? AND decision IS NULL`)
        .run(decision, Date.now(), verifiedGone === null ? null : verifiedGone ? 1 : 0, factId);
    },
    // rows that changed after `rev`, oldest change first: the live feed reads this
    since(rev: number): Row[] {
      return db.prepare("SELECT * FROM receipts WHERE rev > ? ORDER BY rev ASC").all(rev).map(toRow);
    },
    maxRev(): number {
      return Number(db.prepare("SELECT COALESCE(MAX(rev), 0) AS m FROM receipts").get()!.m);
    },
    cursor(): string | undefined {
      const r = db.prepare("SELECT v FROM kv WHERE k = 'cursor'").get();
      return r ? String(r.v) : undefined;
    },
    saveCursor(cursor: string) {
      db.prepare("INSERT INTO kv (k, v) VALUES ('cursor', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(cursor);
    },
  };
}
