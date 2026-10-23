// The self-review a wearer can keep: what Bee wrote, which facts had no receipt, what the wearer did about them.
import type { Row } from "./ledger.ts";
import { VERDICTS, type Verdict } from "./provenance.ts";
import { isDoubtful } from "./watch.ts";

const LABEL: Record<Verdict, string> = {
  supported: "receipt found",
  "likely-tv": "heard from TV or others",
  unattributed: "matching line not tied to the wearer",
  "no-evidence": "no evidence found",
  duplicate: "stored twice",
  contradicts: "opposes a confirmed fact",
};
const when = (ms: number) => new Date(ms).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
const gone = (r: Row) => r.decision === "forgotten" || r.decision === "already-gone";

function outcome(r: Row): string {
  const t = r.decidedAt === null ? "" : ` ${when(r.decidedAt)}`;
  if (gone(r)) return `Forgotten${t}${r.verifiedGone ? ", read back from Bee: gone" : ""}.`;
  if (r.decision === "confirmed") return `Kept: confirmed${t}.`;
  if (r.decision === "kept-todo-deleted") return `Kept${t}: the wrist reminder was dismissed without a tick.`;
  return r.todoId !== null ? `Open: on the wrist as to-do ${r.todoId}.` : "Open.";
}

// "before" is every questionable fact Bee wrote; "now" is the ones still in Bee.
export function reportMarkdown(rows: Row[]): string {
  const doubtful = rows.filter(isDoubtful).sort((a, b) => a.factId - b.factId);
  const before = doubtful.length;
  const now = doubtful.filter((r) => !gone(r)).length;
  const out = [
    "# Says Who self-review",
    "",
    `Facts checked: ${rows.length}`,
    "",
    ...VERDICTS.map((v) => `- \`${v}\` (${LABEL[v]}): ${rows.filter((r) => r.verdict === v).length}`),
    "",
    `Questionable facts in Bee: before ${before}, now ${now}`,
    "",
  ];
  for (const r of doubtful) {
    const heard = r.quote ? `Heard "${r.quote}"${r.speaker ? ` (${r.speaker}${r.spokenAt !== null ? `, ${when(r.spokenAt)}` : ""})` : ""}.` : `No line in the ${r.searched} conversations searched.`;
    out.push(`- Fact ${r.factId}, "${r.factText}": \`${r.verdict}\`. ${heard} ${outcome(r)}`);
  }
  return out.join("\n") + "\n";
}
