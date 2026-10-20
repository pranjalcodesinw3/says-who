import type { Row } from "./ledger.ts";
import type { Verdict } from "./provenance.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const time = (ms: number | null) =>
  ms === null ? "time unknown" : new Date(ms).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

const STAMP: Record<Verdict, { label: string; cls: string }> = {
  supported: { label: "Receipt found", cls: "ok" },
  "likely-tv": { label: "Likely TV", cls: "warn" },
  unsupported: { label: "No receipt", cls: "bad" },
  duplicate: { label: "Duplicate", cls: "warn" },
  contradicts: { label: "Conflict", cls: "bad" },
};

function status(r: Row): string {
  if (r.decision === "forgotten" || r.decision === "already-gone") return `<p class="status">Forgotten. Bee no longer holds this fact${r.verifiedGone ? " (read back, gone)" : ""}.</p>`;
  if (r.decision === "confirmed") return `<p class="status">Confirmed in Bee.</p>`;
  if (r.decision === "kept-todo-deleted") return `<p class="status">Kept. The wrist to-do was dismissed without a tick.</p>`;
  if (r.todoId !== null) return `<p class="status">On your wrist as to-do ${r.todoId}. Tick it to forget this fact.</p>`;
  return "";
}

function slip(r: Row): string {
  const stamp = STAMP[r.verdict];
  const open = r.decision === null;
  const buttons = open
    ? `<div class="actions">
        ${r.verdict === "supported" ? `<button class="btn primary" data-act="confirm" data-id="${r.factId}">Confirm fact</button>` : ""}
        <button class="btn ${r.verdict === "supported" ? "ghost" : "primary"}" data-act="forget" data-id="${r.factId}">Forget fact</button>
      </div>`
    : "";
  const related = r.relatedFactId !== null
    ? `<p class="rel">${r.verdict === "duplicate" ? "Same claim as" : "Opposes confirmed"} fact ${r.relatedFactId}: &ldquo;${esc(r.relatedFactText ?? "")}&rdquo;</p>`
    : "";
  const evidence = r.quote
    ? `<dl class="ev">
        <dt>Heard</dt><dd class="quote">&ldquo;${esc(r.quote)}&rdquo;</dd>
        <dt>Speaker</dt><dd>${esc(r.speaker ?? "unknown")}</dd>
        <dt>When</dt><dd>${esc(time(r.spokenAt))}</dd>
        <dt>Conversation</dt><dd>${r.conversationId ?? "none"}</dd>
      </dl>`
    : `<p class="none">No utterance in ${r.searched} candidate conversation${r.searched === 1 ? "" : "s"} says this.</p>`;
  const reasons = r.reasons.length ? `<ul class="why">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  return `<article class="slip ${stamp.cls}" id="fact-${r.factId}">
    <header><span>FACT ${r.factId}</span><span>${esc(time(r.factCreatedAt))}</span></header>
    <h2>${esc(r.factText)}</h2>
    <div class="stamp ${stamp.cls}" aria-label="Verdict: ${stamp.label}">${stamp.label}</div>
    <hr>
    ${related}
    ${evidence}
    <div class="tv"><span>TV-likelihood</span><meter min="0" max="1" low="0.3" high="0.5" optimum="0" value="${r.tvScore}"></meter><span class="num">${r.tvScore.toFixed(2)}</span></div>
    ${reasons}
    ${status(r)}
    ${buttons}
  </article>`;
}

export function renderPage(rows: Row[], opts: { error?: string } = {}): string {
  const n = (v: Verdict) => rows.filter((r) => r.verdict === v).length;
  const body = opts.error
    ? `<p class="empty">The ledger could not be read: ${esc(opts.error)}</p>`
    : rows.length === 0
      ? `<p class="empty">The tape is blank. Start <code>receipts watch</code> while Bee is listening and each new fact prints here with the line that caused it.</p>`
      : rows.map(slip).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipts</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--desk:#1f1d1a;--desk-2:#2a2824;--paper:#efe8d8;--paper-edge:#d9d0bb;--ink:#1d1b17;--ink-soft:#5d574a;--chalk:#e9e3d3;--chalk-soft:#a49d8c;--ok:#2d6a4f;--warn:#b4561f;--bad:#a8321f;
--font-display:"Big Shoulders Display",Impact,sans-serif;--font-mono:"IBM Plex Mono",ui-monospace,Menlo,monospace}
*{box-sizing:border-box}
html,body{margin:0;overflow-x:clip}
body{background:var(--desk);color:var(--chalk);font:400 14px/1.55 var(--font-mono);padding:40px 16px}
main{max-width:560px;margin:0 auto}
h1{font:700 40px/1 var(--font-display);margin:0 0 8px;letter-spacing:.02em;text-transform:uppercase}
.lede{color:var(--chalk-soft);margin:0 0 24px}
.tape{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;background:#3a3731;border:1px solid #3a3731;border-radius:2px;margin:0 0 24px}
.tape div{padding:12px;background:var(--desk-2);min-width:0}
.tape b{display:block;font:600 20px/1.2 var(--font-mono);font-variant-numeric:tabular-nums}
.tape span{display:block;color:var(--chalk-soft);font-size:12px;overflow-wrap:anywhere}
.slip{position:relative;background:var(--paper);color:var(--ink);padding:16px 16px 24px;margin:0 0 24px;border-radius:2px;
 -webkit-mask:radial-gradient(circle 6px at 8px 100%,#0000 98%,#000) bottom/16px 51% repeat-x,linear-gradient(#000 0 0) top/100% 51% no-repeat;
 mask:radial-gradient(circle 6px at 8px 100%,#0000 98%,#000) bottom/16px 51% repeat-x,linear-gradient(#000 0 0) top/100% 51% no-repeat}
.slip header{display:flex;justify-content:space-between;gap:12px;color:var(--ink-soft);font-size:12px;letter-spacing:.06em}
.slip h2{font:600 16px/1.4 var(--font-mono);margin:12px 0;padding-right:112px;overflow-wrap:anywhere}
hr{border:0;border-top:1px dashed var(--paper-edge);margin:12px 0}
.stamp{position:absolute;top:36px;right:12px;border:2px solid currentColor;padding:2px 8px;font:600 12px/1.4 var(--font-mono);text-transform:uppercase;letter-spacing:.08em;transform:rotate(-6deg);border-radius:2px}
.stamp.ok{color:var(--ok)}.stamp.warn{color:var(--warn)}.stamp.bad{color:var(--bad)}
.ev{display:grid;grid-template-columns:104px minmax(0,1fr);gap:4px 12px;margin:0}
.ev dt{color:var(--ink-soft);font-size:12px;text-transform:uppercase;letter-spacing:.06em;padding-top:2px}
.ev dd{margin:0;overflow-wrap:anywhere}
.quote{font-weight:500}
.none{margin:0;color:var(--ink-soft)}
.rel{margin:0 0 12px;font-weight:500}
.tv{display:grid;grid-template-columns:104px minmax(0,1fr) auto;gap:12px;align-items:center;margin:12px 0 0;font-size:12px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.06em}
.tv meter{width:100%;height:8px}
.num{font-variant-numeric:tabular-nums;color:var(--ink)}
.why{margin:8px 0 0;padding-left:16px;color:var(--ink-soft);font-size:12px}
.status{margin:12px 0 0;font-weight:500}
.actions{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
.btn{font:500 14px/1 var(--font-mono);padding:12px 16px;border-radius:6px;border:1px solid var(--ink);cursor:pointer;transition:background-color .12s}
.btn.primary{background:var(--ink);color:var(--paper)}.btn.primary:hover{background:#3b372f}
.btn.ghost{background:transparent;color:var(--ink)}.btn.ghost:hover{background:var(--paper-edge)}
.btn:focus-visible{outline:2px solid var(--warn);outline-offset:2px}
.btn[disabled]{opacity:.5;cursor:progress}
.empty{background:var(--desk-2);padding:24px;border-radius:2px;color:var(--chalk-soft)}
code{color:var(--chalk)}
@media (prefers-reduced-motion:reduce){.btn{transition:none}}
@media (max-width:420px){.tape{grid-template-columns:repeat(2,minmax(0,1fr))}.slip h2{padding-right:0;margin-top:44px}.stamp{top:44px;right:auto;left:16px;margin-top:-8px}}
</style></head>
<body><main>
<h1>Receipts</h1>
<p class="lede">Every fact Bee wrote about you, with the line that caused it.</p>
<section class="tape" aria-label="Totals">
<div><b>${rows.length}</b><span>facts checked</span></div>
<div><b>${n("supported")}</b><span>receipt found</span></div>
<div><b>${n("likely-tv")}</b><span>likely TV</span></div>
<div><b>${n("unsupported")}</b><span>no receipt</span></div>
<div><b>${n("duplicate") + n("contradicts")}</b><span>duplicate or conflict</span></div>
</section>
${body}
</main>
<script>
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  b.disabled = true;
  const res = await fetch("/api/facts/" + b.dataset.id + "/" + b.dataset.act, { method: "POST", headers: { "x-receipts": "1" } });
  if (!res.ok) { b.disabled = false; b.textContent = "Failed: " + (await res.text()).slice(0, 80); return; }
  location.reload();
});
</script>
</body></html>`;
}
