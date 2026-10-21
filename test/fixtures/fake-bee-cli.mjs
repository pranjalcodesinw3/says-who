#!/usr/bin/env node
// FIXTURE, NOT BEE. A stand-in `bee` binary so tests can drive the real createBeeClient -> subprocess -> JSON path.
// Output shapes follow bee-cli 0.8.0 source (see NOTES.md). Invented data lives in the state file named by FAKE_BEE_STATE.
// FAKE_BEE_ARRIVE_ON_LIST=N -> the state's `arrival` fact appears on the Nth `facts list --unconfirmed` call (stands in for Bee writing a fact after a clip).
// FAKE_BEE_TICK_AFTER_GETS=M -> a to-do reads as completed from its Mth `todos get` (stands in for a tick on the Watch).
// FAKE_BEE_LOGIN=0 -> logged out. Without FAKE_BEE_STATE, FAKE_BEE_FACTS=N makes `facts list` return N invented facts.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, rmdirSync } from "node:fs";

const a = process.argv.slice(2);
const say = (o) => console.log(JSON.stringify(o));
const fail = (m) => { console.error(m); process.exit(1); };
if (process.env.FAKE_BEE_LOGIN === "0") fail('Not logged in. Run "bee login" first.');
const flag = (n) => { const i = a.indexOf(n); return i === -1 ? undefined : a[i + 1]; };

if (!process.env.FAKE_BEE_STATE) {
  if (a[0] === "me") say({ id: 1, first_name: "Fixture", last_name: null });
  else if (a[0] === "facts" && a[1] === "list") {
    const n = Number(process.env.FAKE_BEE_FACTS ?? 0);
    say({ facts: a.includes("--unconfirmed") ? [] : Array.from({ length: n }, (_, i) => ({ id: i + 1, text: `fixture fact ${i + 1}`, tags: [], created_at: 1_700_000_000, confirmed: true })), next_cursor: null });
  } else fail(`fixture: unsupported command ${a.join(" ")}`);
  process.exit(0);
}

const path = process.env.FAKE_BEE_STATE;
// Several processes (the watch loop and the driver script) share one state file: serialise each command behind a lock directory.
for (let i = 0; ; i++) {
  try { mkdirSync(`${path}.lock`); break; } catch { if (i > 400) fail("fixture: state lock timeout"); await new Promise((r) => setTimeout(r, 10)); }
}
process.on("exit", () => { try { rmdirSync(`${path}.lock`); } catch {} });
const st = JSON.parse(readFileSync(path, "utf8"));
appendFileSync(`${path}.argv`, `${a.join(" ")}\n`);
const save = () => writeFileSync(path, JSON.stringify(st));
const find = (list, id) => list.find((x) => x.id === Number(id)) ?? fail("Request failed with status 404");
const [c, s] = a;
if (c === "me") say({ id: 1, first_name: st.owner.first, last_name: st.owner.last });
else if (c === "changed") say({ meta: { cursor: flag("--cursor") ?? null, next_cursor: `fx-${st.calls = (st.calls ?? 0) + 1}`, since: 1, until: 2, updated: true, timezone: "UTC" }, facts: st.facts, todos: [], dailies: [], conversations: [], journals: [] }), save();
else if (c === "facts" && s === "list") {
  if (a.includes("--unconfirmed")) {
    st.unconfirmedLists = (st.unconfirmedLists ?? 0) + 1;
    if (st.arrival && st.unconfirmedLists === Number(process.env.FAKE_BEE_ARRIVE_ON_LIST ?? 0)) st.facts.push(st.arrival);
    save();
  }
  say({ facts: st.facts.filter((f) => f.confirmed === !a.includes("--unconfirmed")), next_cursor: null, timezone: "UTC" });
} else if (c === "facts" && s === "get") say(find(st.facts, a[2]));
else if (c === "facts" && s === "delete") { find(st.facts, a[2]); st.facts = st.facts.filter((f) => f.id !== Number(a[2])); save(); say({ deleted: true }); }
else if (c === "facts" && s === "confirm") { find(st.facts, a[2]).confirmed = true; save(); say(find(st.facts, a[2])); }
else if (c === "search") say({ results: st.conversations.map((x) => ({ id: x.id })), total: st.conversations.length });
else if (c === "conversations" && s === "list") say({ conversations: st.conversations.map((x) => ({ id: x.id, start_time: x.start_time, end_time: x.end_time, created_at: x.start_time, summary: null, state: "COMPLETED" })), next_cursor: null });
else if (c === "conversations" && s === "get") { const x = find(st.conversations, a[2]); say({ conversation: { ...x, transcriptions: [{ id: 1, realtime: false, utterances: x.utterances }] }, timezone: "UTC" }); }
else if (c === "todos" && s === "create") {
  const t = { id: (st.nextTodo = (st.nextTodo ?? 900) + 1), text: flag("--text"), alarm_at: Date.parse(flag("--alarm-at")), completed: false, created_at: 1_800_000_000 };
  st.todos.push(t); save(); say({ todo: t, timezone: "UTC" });
} else if (c === "todos" && s === "get") {
  const t = find(st.todos, a[2]);
  t.gets = (t.gets ?? 0) + 1;
  if (process.env.FAKE_BEE_TICK_AFTER_GETS && t.gets >= Number(process.env.FAKE_BEE_TICK_AFTER_GETS)) t.completed = true;
  save();
  say({ todo: t, timezone: "UTC" });
}
else if (c === "todos" && s === "list") say({ todos: st.todos, next_cursor: null, timezone: "UTC" });
else fail(`fixture: unsupported command ${a.join(" ")}`);
