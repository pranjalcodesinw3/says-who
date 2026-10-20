#!/usr/bin/env node
// FIXTURE, NOT BEE. A stand-in `bee` binary for testing scripts/live-check.sh gates.
// FAKE_BEE_LOGIN=0 -> logged out. FAKE_BEE_FACTS=N -> `facts list` returns N invented facts. Shapes per bee-cli 0.8.0 source.
const a = process.argv.slice(2);
const say = (o) => console.log(JSON.stringify(o));
if (process.env.FAKE_BEE_LOGIN === "0") { console.error('Not logged in. Run "bee login" first.'); process.exit(1); }
if (a[0] === "me") say({ id: 1, first_name: "Fixture", last_name: null });
else if (a[0] === "facts" && a[1] === "list") {
  const n = Number(process.env.FAKE_BEE_FACTS ?? 0);
  const unconf = a.includes("--unconfirmed");
  say({ facts: unconf ? [] : Array.from({ length: n }, (_, i) => ({ id: i + 1, text: `fixture fact ${i + 1}`, tags: [], created_at: 1_700_000_000, confirmed: true })), next_cursor: null });
} else { console.error(`fixture: unsupported command ${a.join(" ")}`); process.exit(1); }
