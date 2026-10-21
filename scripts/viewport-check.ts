// DOM check of the review page at 320 and 390 px in the `deepsurge` browser profile (a new tab, closed afterwards).
// The page is framed at the target width on a same-origin host page, so its media queries see that width.
// Data is a FIXTURE ledger (test/fixtures) so every verdict renders; nothing here is Bee data.
// A control run injects CSS that must break the layout; if the probe stays green on it, the check fails.
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openLedger } from "../src/ledger.ts";
import { startServer } from "../src/server.ts";
import { tvContext } from "../src/tv.ts";
import { forgetFact, tick, type Deps } from "../src/watch.ts";
import {
  FACT_ALMOND, FACT_LAWYER, FACT_OAT, FACT_OAT_CONFIRMED_NEG, FACT_OAT_DUP, FACT_PLANTED, FIXTURE_OWNER, NOISE_CONVO, TV_CONVO, WEARER_CONVO, fakeBee,
} from "../test/fixtures/fixture-bee.ts";

const probe = readFileSync(fileURLToPath(new URL("./viewport-probe.js", import.meta.url)), "utf8");
// async on purpose: the page being measured is served by this process, so a blocking child call would deadlock it
const bhn = (...args: string[]) =>
  new Promise<string>((resolve, reject) => {
    const c = execFile("bhn", ["deepsurge", ...args], { encoding: "utf8", maxBuffer: 1 << 24 }, (err, stdout, stderr) => (err ? reject(new Error(`bhn ${args[0]}: ${stderr || err.message}`)) : resolve(stdout)));
    c.stdin?.end(); // bhn waits on an open stdin pipe
  });

const LONG: typeof FACT_OAT = { ...FACT_OAT, id: 9, text: `Opens https://example.test/${"a".repeat(70)} every morning before breakfast` };
const bee = fakeBee({ facts: [FACT_OAT, FACT_LAWYER, FACT_PLANTED, FACT_OAT_DUP, FACT_OAT_CONFIRMED_NEG, FACT_ALMOND, LONG], conversations: [WEARER_CONVO, TV_CONVO, NOISE_CONVO] });
const d: Deps = { bee, ledger: openLedger(":memory:"), log: () => {}, ctx: { ownerNames: FIXTURE_OWNER.split(" "), tv: tvContext(FIXTURE_OWNER) }, alarmLeadMs: 0 };
await tick(d);
await forgetFact(d, 7); // one decided slip, so the status line renders too

const review = await startServer(d, 0);
const reviewPort = (review.address() as { port: number }).port;
const host = createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", "http://x");
  if (u.pathname === "/__host") {
    res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><body style="margin:0;background:#888"><iframe id="f" src="/" style="width:${Number(u.searchParams.get("w"))}px;height:1400px;border:0;display:block"></iframe></body>`);
    return;
  }
  const up = await fetch(`http://127.0.0.1:${reviewPort}${u.pathname}`);
  res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "text/plain" }).end(Buffer.from(await up.arrayBuffer()));
});
await new Promise<void>((r) => host.listen(0, "127.0.0.1", r));
const hostPort = (host.address() as { port: number }).port;

type Result = { width: number; slips: number; violations: string[] };
const dir = mkdtempSync(join(tmpdir(), "receipts-vp-"));
async function run(width: number, inject?: string): Promise<Result> {
  const url = `http://127.0.0.1:${hostPort}/__host?w=${width}`;
  await bhn("open", url);
  const tabs = JSON.parse(await bhn("tabs")) as { tabs: { targetId: string; url: string }[] };
  const tab = tabs.tabs.find((t) => t.url.startsWith(url));
  if (!tab) throw new Error(`opened tab for ${url} not found`);
  try {
    await bhn("use", tab.targetId);
    const injection = inject ? `var s=document.getElementById("f").contentDocument.createElement("style");s.textContent=${JSON.stringify(inject)};document.getElementById("f").contentDocument.head.appendChild(s);` : "";
    const file = join(dir, `probe-${width}-${inject ? "ctl" : "run"}.js`);
    writeFileSync(file, `${injection}\nvar __v = (${probe})("f");\n`);
    // the framed page loads asynchronously and `bhn wait` cannot see inside an iframe, so poll the probe until the slips exist
    for (let attempt = 0; ; attempt++) {
      const out = JSON.parse(await bhn("eval", "--file", file)) as { value?: string };
      const r = out.value ? (JSON.parse(out.value) as Result) : null;
      if (r && r.slips >= 5) return r;
      if (attempt >= 8) throw new Error(`framed page never rendered 5 slips at ${width}px: ${JSON.stringify(out).slice(0, 200)}`);
      await new Promise((res) => setTimeout(res, 750));
    }
  } finally {
    await bhn("close", tab.targetId);
  }
}

let failed = 0;
try {
  for (const w of [320, 390, 1440]) {
    const r = await run(w);
    console.log(`${w}px: viewport ${r.width}, ${r.slips} slips, ${r.violations.length} violation(s)`);
    for (const v of r.violations) console.log(`  - ${v}`);
    if (r.width !== w) { console.log(`  - iframe viewport is ${r.width}, not ${w}: the check measured the wrong width`); failed++; }
    failed += r.violations.length;
  }
  const control = await run(390, ".tape{grid-template-columns:repeat(5,200px)!important}.slip h2{padding-right:0!important}.stamp{top:12px!important;left:16px!important;right:auto!important}");
  console.log(`control (broken CSS injected): ${control.violations.length} violation(s)`);
  if (control.violations.length === 0) { console.log("  - the probe stayed green on a broken layout, so it cannot fail"); failed++; }
} finally {
  review.close();
  host.close();
}
process.exit(failed === 0 ? 0 : 1);
