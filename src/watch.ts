import { NotFound, type Bee, type Fact } from "./bee.ts";
import type { Ledger, Row } from "./ledger.ts";
import { receiptFor, type Ctx, type Receipt } from "./provenance.ts";

export type Deps = {
  bee: Bee;
  ledger: Ledger;
  ctx: Ctx;
  log: (line: string) => void;
  now?: () => number;
  alarmLeadMs?: number;
  // Every stored fact, confirmed and pending, for duplicate/contradiction checks. Defaults to reading Bee.
  peers?: () => Promise<Fact[]>;
};

// The fact id rides in the to-do text because a Bee to-do has no tags or metadata field (resources/todos/index.ts:49-55).
export const LABEL_RE = /\[rcpt:(\d+)\]/;
export const labelFor = (factId: number) => `[rcpt:${factId}]`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

// The prompt asks instead of accusing: a doubtful fact is either something the wearer said or something they only heard.
// Wording never claims TV as fact, and "no evidence" names how many conversations were searched.
export function todoText(r: Receipt): string {
  const when = r.spokenAt ? new Date(r.spokenAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
  const q = r.quote ? `: "${clip(r.quote, 45)}"` : "";
  const ask = "Did you say it, or hear it?";
  const why =
    r.verdict === "likely-tv"
      ? `${ask} Heard${when ? ` ${when}` : ""}${r.speaker && r.speaker.toLowerCase() !== "unknown" ? `, ${clip(r.speaker, 20)}` : ""}${q}`
      : r.verdict === "unattributed"
        ? `${ask} ${r.attribution === "other" ? "Nearby line is about someone else" : "Nearby line has no clear speaker"}${q}`
        : r.verdict === "duplicate"
          ? `Bee already has this as fact ${r.relatedFactId}`
          : r.verdict === "contradicts"
            ? `You confirmed the opposite: "${clip(r.relatedFactText ?? "", 45)}"`
            : `Did you say it? No line in the ${r.searched} searched conversation${r.searched === 1 ? "" : "s"} shows it`;
  return `Bee wrote "${clip(r.factText, 60)}". ${why}. Tick = forget ${labelFor(r.factId)}`;
}

export function isDoubtful(r: Pick<Receipt, "verdict">): boolean {
  return r.verdict !== "supported";
}

async function ensureTodo(d: Deps, row: Row): Promise<void> {
  if (row.todoId !== null || !isDoubtful(row)) return;
  // A crash between createTodo and setTodo leaves an orphan; find it by label before creating a second one.
  const existing = (await d.bee.listTodos()).find((t) => LABEL_RE.exec(t.text)?.[1] === String(row.factId));
  const todo =
    existing ??
    (await d.bee.createTodo({
      text: todoText(row),
      alarmAt: new Date((d.now?.() ?? Date.now()) + (d.alarmLeadMs ?? 5000)).toISOString(),
    }));
  d.ledger.setTodo(row.factId, todo.id);
  d.log(`todo ${todo.id} for fact ${row.factId}: ${row.verdict}`);
}

export async function ensureReceipt(d: Deps, fact: Fact): Promise<Row> {
  let row = d.ledger.get(fact.id);
  if (!row) {
    const peers = await (d.peers ?? (async () => [...(await d.bee.listFacts({})), ...(await d.bee.listFacts({ unconfirmed: true }))]))();
    d.ledger.insert(await receiptFor(d.bee, fact, d.ctx, peers));
    row = d.ledger.get(fact.id)!;
    d.log(`fact ${fact.id} "${clip(fact.text, 60)}" -> ${row.verdict}${row.quote ? ` ("${clip(row.quote, 50)}")` : ""}`);
  }
  // The wearer already confirmed it in the Bee app: keep the receipt, do not ask again.
  if (!fact.confirmed && row.decision === null) {
    await ensureTodo(d, row);
    row = d.ledger.get(fact.id)!;
  }
  return row;
}

// Delete, then read back: a 200 from delete is an accepted request, `facts get` returning not-found is the post-condition.
export async function forgetFact(d: Deps, factId: number): Promise<boolean> {
  let already = false;
  try {
    await d.bee.deleteFact(factId);
  } catch (e) {
    if (!(e instanceof NotFound)) throw e;
    already = true;
  }
  try {
    await d.bee.getFact(factId);
    d.log(`fact ${factId}: delete accepted but fact still readable, will retry`);
    return false;
  } catch (e) {
    if (!(e instanceof NotFound)) throw e;
  }
  d.ledger.decide(factId, already ? "already-gone" : "forgotten", true);
  d.log(`fact ${factId}: forgotten (verified gone)`);
  return true;
}

export async function confirmFact(d: Deps, factId: number): Promise<boolean> {
  await d.bee.confirmFact(factId);
  const f = await d.bee.getFact(factId);
  if (!f.confirmed) {
    d.log(`fact ${factId}: confirm accepted but fact not confirmed`);
    return false;
  }
  d.ledger.decide(factId, "confirmed", null);
  d.log(`fact ${factId}: confirmed (verified)`);
  return true;
}

// Open helper to-dos -> decisions. Ticked = forget. Deleted without ticking = keep the fact, no write.
export async function reconcile(d: Deps): Promise<number> {
  let decided = 0;
  for (const row of d.ledger.all()) {
    if (row.todoId === null || row.decision !== null) continue;
    let completed: boolean;
    try {
      completed = (await d.bee.getTodo(row.todoId)).completed;
    } catch (e) {
      if (!(e instanceof NotFound)) throw e;
      d.ledger.decide(row.factId, "kept-todo-deleted", null);
      d.log(`fact ${row.factId}: to-do ${row.todoId} deleted without a tick, fact kept`);
      decided++;
      continue;
    }
    if (completed && (await forgetFact(d, row.factId))) decided++;
  }
  return decided;
}

export type TickResult = { facts: number; decided: number; failed: number; cursorSaved: boolean };

export async function tick(d0: Deps): Promise<TickResult> {
  // one read of the stored facts per tick, shared by every new fact in the batch
  let cached: Promise<Fact[]> | null = null;
  const base = d0.peers ?? (async () => [...(await d0.bee.listFacts({})), ...(await d0.bee.listFacts({ unconfirmed: true }))]);
  const d: Deps = { ...d0, peers: () => (cached ??= base()) };
  let facts: Fact[];
  let next: string | null = null;
  try {
    const ch = await d.bee.changed(d.ledger.cursor());
    facts = ch.facts;
    next = ch.nextCursor;
  } catch (e) {
    // `bee changed` GETs every changed id (commands/changed/index.ts:28-35, 229-240) and throws on the first that fails,
    // so one deleted fact can wedge the feed. Fall back to the pending list and leave the cursor where it is.
    d.log(`changed failed (${e instanceof Error ? e.message : String(e)}); falling back to pending facts, cursor unchanged`);
    facts = await d.bee.listFacts({ unconfirmed: true });
  }
  let failed = 0;
  for (const fact of facts) {
    try {
      await ensureReceipt(d, fact);
    } catch (e) {
      failed++;
      d.log(`fact ${fact.id}: ${e instanceof Error ? e.message : String(e)} (will retry)`);
    }
  }
  let decided = 0;
  try {
    decided = await reconcile(d);
  } catch (e) {
    failed++;
    d.log(`reconcile: ${e instanceof Error ? e.message : String(e)} (will retry)`);
  }
  // Skill rule: persist the cursor only after the batch is processed.
  const cursorSaved = failed === 0 && next !== null;
  if (cursorSaved) d.ledger.saveCursor(next!);
  return { facts: facts.length, decided, failed, cursorSaved };
}

export async function watch(d: Deps, opts: { intervalMs: number; signal: AbortSignal }): Promise<void> {
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => (chain = chain.then(fn, fn));
  const stopStream = d.bee.onTodoUpdated(() => {
    serial(() => reconcile(d)).catch((e: unknown) => d.log(`reconcile after stream wake: ${e instanceof Error ? e.message : String(e)}`));
  });
  try {
    while (!opts.signal.aborted) {
      try {
        const r = await serial(() => tick(d));
        d.log(`tick: ${(r as TickResult).facts} fact(s), ${(r as TickResult).decided} decision(s), ${(r as TickResult).failed} failure(s)`);
      } catch (e) {
        d.log(`tick failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, opts.intervalMs);
        opts.signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
      });
    }
  } finally {
    stopStream();
  }
}
