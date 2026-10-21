// FIXTURE, NOT BEE DATA. Everything in this file is invented test input.
// Payload shapes come from bee-cli 0.8.0 source (see NOTES.md): conversations get
// resources/conversations/index.ts:353-386, facts resources/facts/index.ts:55-61, todos resources/todos/index.ts:49-55.
// Nothing under src/ imports this file; the product path only ever builds realBee().
import { NotFound, type Bee, type Changes, type Conversation, type Fact, type Todo } from "../../src/bee.ts";

export const FIXTURE_OWNER = "Dave Elfman";

const NOW = Date.UTC(2026, 9, 22, 21, 30); // fixed clock so quotes and times are stable
const u = (id: number, speaker: string, text: string, minute: number) => ({ id, speaker, text, spoken_at: NOW - 3_600_000 + minute * 60_000, start: null });

// FIXTURE: the wearer (label "Unknown", per the Nectar friction log) talking with one other person, 60+ words.
export const WEARER_CONVO: Conversation = {
  id: 101,
  start_time: NOW - 3_600_000,
  end_time: NOW - 3_300_000,
  utterances: [
    u(1, "Unknown", "I switched to oat milk this week because the dairy stuff was upsetting my stomach.", 0),
    u(2, "Priya", "Oh nice, does it work in coffee or does it split?", 1),
    u(3, "Unknown", "It works fine in coffee, the barista one is better than the supermarket one though.", 2),
    u(4, "Priya", "I should try that. We are out of milk again anyway and I need to shop on Saturday.", 3),
    u(5, "Unknown", "Pick up some for me then, I will pay you back when we meet for lunch.", 4),
  ],
};

// FIXTURE: a TV drama playing near the wrist. Three non-wearer voices, long even lines, a show cue.
const tvLine = (n: number, who: string, text: string) => u(200 + n, who, text, 10 + n);
export const TV_CONVO: Conversation = {
  id: 102,
  start_time: NOW - 1_800_000,
  end_time: NOW - 600_000,
  utterances: [
    tvLine(1, "Speaker 1", "Previously on Dexter, the investigation into the harbor killings stalled after the second witness disappeared overnight."),
    tvLine(2, "Speaker 2", "He is a criminal lawyer with a reputation for getting his clients out of anything the district attorney throws at them."),
    tvLine(3, "Speaker 3", "You cannot walk into that courtroom tomorrow without the files from the warehouse, they will bury the whole defense."),
    tvLine(4, "Speaker 1", "The detective has been watching the house for three nights and nobody has come or gone since the storm began."),
    tvLine(5, "Speaker 2", "Bring the car around to the back entrance and keep the engine running until I signal from the second floor window."),
    tvLine(6, "Speaker 3", "There is a rumor in the precinct that the commissioner knew about the money long before the audit even started."),
  ],
};

// FIXTURE: unrelated chatter, so the candidate pool contains noise.
export const NOISE_CONVO: Conversation = {
  id: 103,
  start_time: NOW - 7_200_000,
  end_time: NOW - 7_000_000,
  utterances: [
    u(31, "Unknown", "Can you send the invoice to accounting before five, they close the books on Friday.", 0),
    u(32, "Marcus", "Sure, I will forward it now and copy you on the thread.", 1),
  ],
};

export const FACT_OAT: Fact = { id: 1, text: "Prefers oat milk", tags: [], created_at: NOW, confirmed: false };
export const FACT_LAWYER: Fact = { id: 2, text: "Dave is a criminal lawyer", tags: [], created_at: NOW, confirmed: false };
// FIXTURE: planted claim that no utterance in any fixture conversation supports.
export const FACT_PLANTED: Fact = { id: 3, text: "I hold a commercial pilot licence", tags: [], created_at: NOW, confirmed: false };
export const FACT_ALREADY_CONFIRMED: Fact = { id: 4, text: "Works with accountants on invoices", tags: [], created_at: NOW, confirmed: true };

export type FakeBee = Bee & {
  facts: Map<number, Fact>;
  todos: Map<number, Todo>;
  conversations: Map<number, Conversation>;
  calls: string[];
  changedFacts: number[];
  failConversationOnce: boolean;
  failChangedWith: string | null;
  tick(todoId: number, patch: Partial<Todo>): void;
};

export function fakeBee(seed: { facts: Fact[]; conversations: Conversation[] }): FakeBee {
  let nextTodo = 500;
  const bee: FakeBee = {
    facts: new Map(seed.facts.map((f) => [f.id, { ...f }])),
    todos: new Map(),
    conversations: new Map(seed.conversations.map((c) => [c.id, c])),
    calls: [],
    changedFacts: seed.facts.map((f) => f.id),
    failConversationOnce: false,
    failChangedWith: null,
    tick: (id, patch) => void bee.todos.set(id, { ...bee.todos.get(id)!, ...patch }),
    async whoami() { return { id: 1, name: FIXTURE_OWNER }; },
    async changed(cursor): Promise<Changes> {
      bee.calls.push(`changed:${cursor ?? "-"}`);
      if (bee.failChangedWith) throw new Error(bee.failChangedWith);
      return { facts: bee.changedFacts.map((id) => bee.facts.get(id)).filter((f): f is Fact => !!f), todos: [], nextCursor: `cursor-${bee.calls.length}` };
    },
    async listFacts({ unconfirmed }) { return [...bee.facts.values()].filter((f) => f.confirmed === !unconfirmed); },
    async getFact(id) { const f = bee.facts.get(id); if (!f) throw new NotFound("Request failed with status 404"); return f; },
    async confirmFact(id) { bee.calls.push(`confirm:${id}`); bee.facts.set(id, { ...(await bee.getFact(id)), confirmed: true }); },
    async deleteFact(id) { bee.calls.push(`delete:${id}`); if (!bee.facts.delete(id)) throw new NotFound("Request failed with status 404"); },
    // Deliberately loose search: returns every conversation, like a server returning noise. The engine must still decide on utterances.
    async searchConversationIds({ neural }) { bee.calls.push(`search:${neural ? "neural" : "bm25"}`); return [...bee.conversations.keys()]; },
    async recentConversationIds() { return [...bee.conversations.keys()]; },
    async getConversation(id) {
      if (bee.failConversationOnce) { bee.failConversationOnce = false; throw new Error("fixture: conversations get failed"); }
      const c = bee.conversations.get(id);
      if (!c) throw new NotFound("Request failed with status 404");
      return c;
    },
    async createTodo({ text, alarmAt }) {
      const t: Todo = { id: nextTodo++, text, alarm_at: Date.parse(alarmAt), completed: false, created_at: NOW };
      bee.todos.set(t.id, t);
      bee.calls.push(`todo-create:${t.id}`);
      return t;
    },
    async getTodo(id) { const t = bee.todos.get(id); if (!t) throw new NotFound("Request failed with status 404"); return t; },
    async listTodos() { return [...bee.todos.values()]; },
    onTodoUpdated() { return () => {}; },
  };
  return bee;
}

// FIXTURE facts for relations. Ids matter: a duplicate is the NEWER id, a contradiction needs a CONFIRMED peer.
export const FACT_OAT_DUP: Fact = { id: 5, text: "Likes oat milk", tags: [], created_at: NOW, confirmed: false };
export const FACT_OAT_CONFIRMED_NEG: Fact = { id: 6, text: "Does not like oat milk", tags: [], created_at: NOW, confirmed: true };
export const FACT_ALMOND: Fact = { id: 7, text: "Likes almond milk", tags: [], created_at: NOW, confirmed: false };
export const FACT_NO_CAR_CONFIRMED: Fact = { id: 8, text: "Does not drive a car", tags: [], created_at: NOW, confirmed: true };

// FIXTURE: attribution cases. The wearer talks about someone else, with every keyword of the fact present.
export const FACT_VEGAN: Fact = { id: 20, text: "Dave is vegan", tags: [], created_at: NOW, confirmed: false };
export const BROTHER_CONVO: Conversation = {
  id: 301, start_time: NOW - 5_400_000, end_time: NOW - 5_000_000,
  utterances: [
    u(40, "Unknown", "My brother is vegan, he cooks everything from scratch and never buys anything frozen.", 0),
    u(41, "Priya", "Does he eat eggs at all or is it strictly plants only for him?", 1),
    u(42, "Unknown", "Strictly plants, it took the whole family a while to get used to it at dinner.", 2),
  ],
};
// FIXTURE: the wearer says it about themselves later in the same conversation.
export const BROTHER_THEN_SELF_CONVO: Conversation = {
  ...BROTHER_CONVO, id: 302,
  utterances: [...BROTHER_CONVO.utterances, u(43, "Unknown", "Honestly I'm vegan too since last spring, he talked me into it.", 3)],
};
// FIXTURE: a line from an unlabelled speaker that names no subject at all.
export const NO_SUBJECT_CONVO: Conversation = {
  id: 303, start_time: NOW - 5_400_000, end_time: NOW - 5_000_000,
  utterances: [u(50, "Unknown", "Vegan food is the best thing at that market, honestly.", 0), u(51, "Priya", "I never noticed, I always get the noodles.", 1)],
};
// FIXTURE: a named participant says it about themselves in a quiet, non-TV conversation.
export const PRIYA_VEGAN_CONVO: Conversation = {
  id: 304, start_time: NOW - 5_400_000, end_time: NOW - 5_000_000,
  utterances: [u(60, "Priya", "I'm vegan, so I will bring my own dessert on Saturday.", 0), u(61, "Unknown", "Fine by me, I will make a salad.", 1)],
};
// FIXTURE: the wearer's own true sentence inside a conversation that scores as TV from conversation-level cues alone.
export const WEARER_IN_TV_CONVO: Conversation = {
  ...TV_CONVO, id: 305,
  utterances: [...TV_CONVO.utterances, u(70, "Unknown", "I switched to oat milk this week and my stomach is much happier about it.", 17)],
};
// FIXTURE: identical conversation, but the oat-milk line is spoken by a labelled non-wearer voice.
export const TV_OAT_CONVO: Conversation = {
  ...WEARER_IN_TV_CONVO, id: 306,
  utterances: WEARER_IN_TV_CONVO.utterances.map((x) => (x.id === 70 ? { ...x, speaker: "Speaker 2" } : x)),
};
// FIXTURE: a TV room where Bee labelled the lawyer line "Unknown". The room looks like TV, but nothing on the line itself says who spoke.
export const TV_UNKNOWN_LABEL_CONVO: Conversation = {
  ...TV_CONVO, id: 307,
  utterances: TV_CONVO.utterances.map((x) => (x.id === 202 ? { ...x, speaker: "Unknown" } : x)),
};
