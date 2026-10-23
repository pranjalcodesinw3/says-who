// Demo account: invented conversations and facts run through the real engine, ledger and review page, so the page can be tried with no Bee login.
// The data is invented; the receipts, verdicts, attribution, read-backs and buttons are the product's own code paths.
import { NotFound, type Bee, type Changes, type Conversation, type Fact, type Todo } from "./bee.ts";
import { openLedger } from "./ledger.ts";
import { tvContext } from "./tv.ts";
import { tick, type Deps } from "./watch.ts";

// The demo Bee also lets the page play the wrist: completeTodo is what a tick on the Watch does to the to-do in Bee.
export type DemoBee = Bee & { completeTodo(id: number): void };
export type DemoDeps = Deps & { bee: DemoBee };

export const DEMO_OWNER = "Sam Rivera";

export function demoBee(now = Date.now()): DemoBee {
  const min = 60_000;
  const u = (id: number, speaker: string, text: string, at: number) => ({ id, speaker, text, spoken_at: at, start: null });
  const kitchen = now - 95 * min;
  const living = now - 50 * min;
  const conversations: Conversation[] = [
    {
      id: 4101, start_time: kitchen, end_time: kitchen + 12 * min,
      utterances: [
        u(1, "Unknown", "I switched to oat milk this week because the dairy stuff was upsetting my stomach.", kitchen),
        u(2, "Priya", "Oh nice, does it work in coffee or does it split?", kitchen + min),
        u(3, "Unknown", "It works fine in coffee, the barista one is better than the supermarket one though.", kitchen + 2 * min),
      ],
    },
    {
      id: 4102, start_time: living, end_time: living + 20 * min,
      utterances: [
        u(11, "Speaker 1", "Previously on Dexter, the investigation into the harbor killings stalled after the second witness disappeared overnight.", living),
        u(12, "Speaker 2", "He is a criminal lawyer with a reputation for getting his clients out of anything the district attorney throws at them.", living + min),
        u(13, "Speaker 3", "You cannot walk into that courtroom tomorrow without the files from the warehouse, they will bury the whole defense.", living + 2 * min),
        u(14, "Speaker 1", "The detective has been watching the house for three nights and nobody has come or gone since the storm began.", living + 3 * min),
        u(15, "Speaker 2", "Bring the car around to the back entrance and keep the engine running until I signal from the second floor window.", living + 4 * min),
        u(16, "Speaker 3", "There is a rumor in the precinct that the commissioner knew about the money long before the audit even started.", living + 5 * min),
      ],
    },
    {
      id: 4103, start_time: now - 180 * min, end_time: now - 170 * min,
      utterances: [u(21, "Unknown", "Can you send the invoice to accounting before five, they close the books on Friday.", now - 180 * min), u(22, "Marcus", "Sure, I will forward it now and copy you on the thread.", now - 179 * min)],
    },
  ];
  const facts = new Map<number, Fact>([
    [1, { id: 1, text: "Prefers oat milk", tags: [], created_at: now - 40 * min, confirmed: false }],
    [2, { id: 2, text: "Sam is a criminal lawyer", tags: [], created_at: now - 30 * min, confirmed: false }],
    [3, { id: 3, text: "Holds a commercial pilot licence", tags: [], created_at: now - 20 * min, confirmed: false }],
  ]);
  const todos = new Map<number, Todo>();
  let nextTodo = 9001;
  let calls = 0;
  const conv = (id: number) => conversations.find((c) => c.id === id);
  return {
    async whoami() { return { id: 0, name: DEMO_OWNER }; },
    async changed(): Promise<Changes> { return { facts: [...facts.values()], todos: [], nextCursor: `demo-${++calls}` }; },
    async listFacts({ unconfirmed }) { return [...facts.values()].filter((f) => f.confirmed === !unconfirmed); },
    async getFact(id) { const f = facts.get(id); if (!f) throw new NotFound("not found"); return f; },
    async confirmFact(id) { facts.set(id, { ...(await this.getFact(id)), confirmed: true }); },
    async deleteFact(id) { if (!facts.delete(id)) throw new NotFound("not found"); },
    async searchConversationIds() { return conversations.map((c) => c.id); },
    async recentConversationIds() { return conversations.map((c) => c.id); },
    async getConversation(id) { const c = conv(id); if (!c) throw new NotFound("not found"); return c; },
    async createTodo({ text, alarmAt }) { const t: Todo = { id: nextTodo++, text, alarm_at: Date.parse(alarmAt), completed: false, created_at: now }; todos.set(t.id, t); return t; },
    async getTodo(id) { const t = todos.get(id); if (!t) throw new NotFound("not found"); return t; },
    async listTodos() { return [...todos.values()]; },
    onTodoUpdated() { return () => {}; },
    completeTodo(id) { const t = todos.get(id); if (!t) throw new NotFound("not found"); todos.set(id, { ...t, completed: true }); },
  };
}

export async function buildDemo(): Promise<DemoDeps> {
  const d: DemoDeps = { bee: demoBee(), ledger: openLedger(":memory:"), log: () => {}, ctx: { ownerNames: DEMO_OWNER.split(" "), tv: tvContext(DEMO_OWNER) }, alarmLeadMs: 0 };
  const r = await tick(d);
  if (r.failed > 0 || d.ledger.all().length !== 3) throw new Error(`demo account did not build: ${JSON.stringify(r)}`);
  return d;
}
