import type { Row } from "./ledger.ts";
import type { Verdict } from "./provenance.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const time = (ms: number | null) =>
  ms === null ? "time unknown" : new Date(ms).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

const STAMP: Record<Verdict, { label: string; cls: string }> = {
  supported: { label: "Receipt found", cls: "ok" },
  "likely-tv": { label: "Likely TV", cls: "warn" },
  unattributed: { label: "Not tied to you", cls: "warn" },
  "no-evidence": { label: "No evidence found", cls: "bad" },
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

// "Unknown" is Bee's label for anyone it could not name. It is not the wearer and not a stranger, so the copy says so.
const speakerCopy = (r: Row) => (!r.speaker || r.speaker.toLowerCase() === "unknown" ? "Unknown (Bee did not name the speaker)" : r.speaker);
const shortTime = (ms: number) => new Date(ms).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

// The search scope: which conversations were read, when they started, how they were found, and the time window.
// A receipt is only as good as this list, so it is printed on every slip.
function scope(r: Row): string {
  const sc = r.scope;
  const n = sc.candidates.length;
  const times = sc.candidates.slice(0, 6).map((c) => (c.at === null ? `#${c.id}` : `#${c.id} ${shortTime(c.at)}`));
  const more = n > times.length ? `, +${n - times.length} more` : "";
  const window = sc.since !== null && sc.until !== null ? `<dt>Window</dt><dd>${esc(shortTime(sc.since))} to ${esc(shortTime(sc.until))}</dd>` : "";
  const how = sc.methods.length ? `<dt>Method</dt><dd>${sc.methods.map(esc).join("<br>")}</dd>` : "";
  const list = n > 0 ? `<dt>Read</dt><dd>${esc(times.join(", ") + more)}</dd>` : "";
  return `<details class="scope"${r.verdict === "no-evidence" ? " open" : ""}><summary>Searched ${n} conversation${n === 1 ? "" : "s"}</summary><dl class="ev">${list}${window}${how}</dl></details>`;
}

export function slip(r: Row): string {
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
        <dt>Speaker</dt><dd>${esc(speakerCopy(r))}</dd>
        <dt>When</dt><dd>${esc(time(r.spokenAt))}</dd>
        <dt>Conversation</dt><dd>${r.conversationId ?? "none"}</dd>
      </dl>`
    : `<p class="none">No evidence found. Receipts read ${r.searched} conversation${r.searched === 1 ? "" : "s"} around this fact and none contains the line. Exactly where it looked is listed below.</p>`;
  // the "no evidence" sentence is already the slip's headline, so the reason list keeps only what adds to it
  const shown = r.verdict === "no-evidence" ? r.reasons.filter((x) => !/^no evidence found/.test(x)) : r.reasons;
  const reasons = shown.length ? `<ul class="why">${shown.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  return `<article class="slip ${stamp.cls}" id="fact-${r.factId}">
    <header><span>Fact ${r.factId}</span><span>${esc(time(r.factCreatedAt))}</span></header>
    <h2>${esc(r.factText)}</h2>
    <div class="stamp ${stamp.cls}" aria-label="Verdict: ${stamp.label}">${stamp.label}</div>
    <hr>
    ${related}
    ${evidence}
    ${scope(r)}
    <div class="tv"><span>TV signal</span><div class="gauge${r.tvScore >= 0.5 ? " hot" : ""}" role="img" aria-label="TV signal ${r.tvScore.toFixed(2)} of 1, the likely TV line is 0.50">${Array.from({ length: 10 }, (_, i) => `<b class="${i < Math.round(r.tvScore * 10) ? "on" : ""}"></b>`).join("")}</div><span class="num">${r.tvScore.toFixed(2)}</span></div>
    ${reasons}
    ${status(r)}
    ${buttons}
  </article>`;
}

export function tape(rows: Row[]): string {
  const n = (v: Verdict) => rows.filter((r) => r.verdict === v).length;
  return `<section class="tape" id="tape" aria-label="Totals">
<div><b>${rows.length}</b><span>facts checked</span></div>
<div><b>${n("supported")}</b><span>receipt found</span></div>
<div><b>${n("likely-tv")}</b><span>likely TV</span></div>
<div><b>${n("unattributed")}</b><span>not tied to you</span></div>
<div><b>${n("no-evidence")}</b><span>no evidence found</span></div>
<div><b>${n("duplicate") + n("contradicts")}</b><span>duplicate or conflict</span></div>
</section>`;
}

export function renderPage(rows: Row[], opts: { error?: string; rev?: number } = {}): string {
  const body = opts.error
    ? `<p class="empty">The ledger could not be read: ${esc(opts.error)}</p>`
    : rows.length === 0
      ? `<p class="empty" id="empty">The tape is blank. Start <code>receipts watch</code> while Bee is listening and each new fact prints here with the line that caused it.</p>`
      : rows.map(slip).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipts: where each Bee fact came from</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--desk:#1d1d1b;--desk-2:#292927;--paper:#e4e5df;--paper-edge:#d0cdc2;--ink:#1c1b18;--ink-soft:#55524a;--chalk:#e6e4dd;--chalk-soft:#aaa8a0;--ok:#1f5a3f;--warn:#8a3f10;--bad:#922a18;
--font-display:"Big Shoulders Display",Impact,sans-serif;--font-mono:"IBM Plex Mono",ui-monospace,Menlo,monospace}
*{box-sizing:border-box}
html,body{margin:0;overflow-x:clip}
body{background:var(--desk);color:var(--chalk);font:400 14px/1.55 var(--font-mono);padding:40px 16px}
main{max-width:560px;margin:0 auto}
@media (min-width:1024px){main{max-width:984px;display:grid;grid-template-columns:352px minmax(0,560px);gap:72px;align-items:start}.rail{position:sticky;top:40px}.rail .tape{grid-template-columns:repeat(2,minmax(0,1fr))}.slip h2{padding-right:148px}}
h1{font:700 28px/1 var(--font-display);margin:0 0 8px;letter-spacing:.03em;text-transform:uppercase}
.lede{color:var(--chalk-soft);margin:0 0 24px}
.tape{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:#3a3731;border:1px solid #3a3731;border-radius:2px;margin:0 0 24px}
.tape div{padding:12px;background:var(--desk-2);min-width:0}
.tape b{display:block;font:600 20px/1.2 var(--font-mono);font-variant-numeric:tabular-nums}
.tape span{display:block;color:var(--chalk-soft);font-size:13px;overflow-wrap:anywhere}
.slip{position:relative;background:var(--paper);color:var(--ink);padding:16px 16px 24px;margin:0 0 24px;border-radius:2px;
 -webkit-mask:radial-gradient(circle 6px at 8px 100%,#0000 98%,#000) bottom/16px 51% repeat-x,linear-gradient(#000 0 0) top/100% 51% no-repeat;
 mask:radial-gradient(circle 6px at 8px 100%,#0000 98%,#000) bottom/16px 51% repeat-x,linear-gradient(#000 0 0) top/100% 51% no-repeat}
.slip header{display:flex;justify-content:space-between;gap:12px;color:var(--ink-soft);font-size:13px}
.slip h2{font:600 16px/1.4 var(--font-mono);margin:12px 0;padding-right:148px;overflow-wrap:anywhere}
hr{border:0;border-top:1px dashed var(--paper-edge);margin:12px 0}
.stamp{position:absolute;top:46px;right:12px;max-width:140px;text-align:center;border:2px solid currentColor;padding:2px 8px;font:600 13px/1.35 var(--font-mono);text-transform:uppercase;letter-spacing:.03em;transform:rotate(-6deg);border-radius:2px}
.stamp.ok{color:var(--ok)}.stamp.warn{color:var(--warn)}.stamp.bad{color:var(--bad)}
.ev{display:grid;grid-template-columns:104px minmax(0,1fr);gap:4px 12px;margin:0}
.ev dt{color:var(--ink-soft);font-size:13px;padding-top:1px}
.ev dd{margin:0;overflow-wrap:anywhere}
.quote{font-weight:500}
.none{margin:0;color:var(--ink-soft)}
.rel{margin:0 0 12px;font-weight:500}
.tv{display:grid;grid-template-columns:104px minmax(0,1fr) auto;gap:12px;align-items:center;margin:12px 0 0;font-size:13px;color:var(--ink-soft)}
.gauge{display:grid;grid-template-columns:repeat(5,minmax(0,1fr)) 8px repeat(5,minmax(0,1fr));gap:2px;height:10px}
.gauge b{background:var(--paper-edge)}
.gauge b.on{background:var(--ink)}
.gauge.hot b.on{background:var(--warn)}
.gauge b:nth-child(6){grid-column:7}
.num{font-variant-numeric:tabular-nums;color:var(--ink)}
.scope{margin:12px 0 0}
.scope summary{cursor:pointer;color:var(--ink-soft);font-size:13px;padding:4px 0}
.scope summary:focus-visible{outline:2px solid var(--warn);outline-offset:2px}
.scope .ev{margin-top:8px;font-size:13px}
.why{margin:8px 0 0;padding-left:16px;color:var(--ink-soft);font-size:13px}
.status{margin:12px 0 0;font-weight:500}
.actions{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
.btn{font:500 14px/1 var(--font-mono);padding:12px 16px;border-radius:6px;border:1px solid var(--ink);cursor:pointer;transition:background-color .12s}
.btn.primary{background:var(--ink);color:var(--paper)}.btn.primary:hover{background:#3b372f}
.btn.ghost{background:transparent;color:var(--ink)}.btn.ghost:hover{background:var(--paper-edge)}
.btn:focus-visible{outline:2px solid var(--warn);outline-offset:2px}
.btn[disabled]{opacity:.5;cursor:progress}
.live{margin:0 0 24px}
.live-head{display:flex;align-items:center;gap:8px;margin:0 0 8px;color:var(--chalk-soft);font-size:13px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--chalk-soft);flex:none}
.dot.on{background:#6fbf8f}.dot.off{background:var(--bad)}
.feed{list-style:none;margin:0;padding:0;border-top:1px dashed #5a564b}
.feed li{padding:8px 0 8px 12px;border-bottom:1px dashed #5a564b;border-left:2px solid transparent;font-size:13px;overflow-wrap:anywhere;color:var(--chalk-soft)}
.feed li:first-child{border-left-color:var(--warn);color:var(--chalk)}
.feed li time{color:var(--chalk-soft);margin-right:8px;font-variant-numeric:tabular-nums}
.feed li b{font-weight:600}
.feed .feed-wait{color:var(--chalk-soft)!important;border-left-color:transparent!important}
.slip.fresh{animation:fresh 1.6s ease-out}
@keyframes fresh{from{outline:3px solid var(--warn);outline-offset:4px}to{outline:3px solid transparent;outline-offset:4px}}
.empty{background:var(--desk-2);padding:24px;border-radius:2px;color:var(--chalk-soft)}
code{color:var(--chalk)}
@media (prefers-reduced-motion:reduce){.btn{transition:none}.slip.fresh{animation:none}}
@media (max-width:420px){.tape{grid-template-columns:repeat(2,minmax(0,1fr))}.slip h2{padding-right:0}.stamp{position:static;display:inline-block;max-width:none;margin:0 0 4px;transform:rotate(-3deg)}}
</style></head>
<body><main data-rev="${opts.rev ?? 0}">
<div class="rail">
<h1>Receipts</h1>
<p class="lede">Every fact Bee wrote about you, with the line that caused it.</p>
${tape(rows)}
<section class="live" aria-label="Live provenance feed">
<p class="live-head"><span class="dot" id="dot"></span><span id="live-state">Connecting to the ledger</span></p>
<ol id="feed" class="feed"><li class="feed-wait">Waiting for the next fact Bee writes. It lands here with the line that caused it.</li></ol>
</section>
</div>
<div id="slips">
${body}
</div>
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

// Live feed: the server pushes every receipt change (a new fact, its wrist to-do, the wearer's tick) as it lands in the ledger.
const rev0 = Number(document.querySelector("main").dataset.rev || 0);
const feed = document.getElementById("feed"), state = document.getElementById("live-state"), dot = document.getElementById("dot");
const verdictLabel = { supported: "Receipt found", "likely-tv": "Likely TV", unattributed: "Not tied to you", "no-evidence": "No evidence found", duplicate: "Duplicate", contradicts: "Conflict" };
function line(r, isNew) {
  const li = document.createElement("li");
  const t = document.createElement("time");
  t.textContent = new Date().toLocaleTimeString("en-GB");
  li.append(t);
  const what = document.createElement("b");
  what.textContent = isNew ? "Fact " + r.factId + " arrived" : "Fact " + r.factId + " updated";
  li.append(what, document.createTextNode(': "' + r.factText + '" '));
  const out = r.decision ? "Decision: " + r.decision + "." : verdictLabel[r.verdict] + (r.quote ? '. Matched "' + r.quote + '"' : ". Searched " + r.searched + " conversations, found no line.");
  li.append(document.createTextNode(out));
  return li;
}
function connect() {
  const es = new EventSource("/api/feed?after=" + rev0);
  es.onopen = () => { dot.className = "dot on"; state.textContent = "Live. Watching the ledger for new facts"; };
  es.onerror = () => { dot.className = "dot off"; state.textContent = "Reconnecting"; };
  es.addEventListener("feed-error", (ev) => { dot.className = "dot off"; state.textContent = "Ledger read failed: " + ev.data; });
  es.addEventListener("receipt", (ev) => {
    const r = JSON.parse(ev.data);
    const slips = document.getElementById("slips");
    document.getElementById("empty")?.remove();
    const tmp = document.createElement("div");
    tmp.innerHTML = r.slip;
    const next = tmp.firstElementChild;
    const old = document.getElementById("fact-" + r.factId);
    const isNew = !old;
    if (old) old.replaceWith(next); else slips.prepend(next);
    next.classList.add("fresh");
    document.getElementById("tape").outerHTML = r.tape;
    feed.querySelector(".feed-wait")?.remove();
    feed.prepend(line(r, isNew));
    while (feed.children.length > 6) feed.lastElementChild.remove();
  });
}
connect();
</script>
</body></html>`;
}
