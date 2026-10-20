// The only module that talks to Bee. Everything else takes a `Bee`.
// Shapes below come from bee-cli 0.8.0 (84a6e8f); each type cites its source in NOTES.md.
import { createBeeClient } from "@beeai/cli/lib";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The CLI that ships inside @beeai/cli, so the repo runs without a global install; BEE_BIN or `command` override it.
const bundled = fileURLToPath(new URL("../node_modules/.bin/bee", import.meta.url));
const defaultCommand = () => process.env.BEE_BIN ?? (existsSync(bundled) ? bundled : "bee");

export type Fact = { id: number; text: string; tags: string[]; created_at: number; confirmed: boolean };
export type Todo = { id: number; text: string; alarm_at: number | string | null; completed: boolean; created_at: number };
export type Utterance = { id: number; text: string; speaker: string; spoken_at: number | null; start: number | null };
export type Conversation = { id: number; start_time: number; end_time: number | null; utterances: Utterance[] };
export type Changes = { facts: Fact[]; todos: Todo[]; nextCursor: string | null };

export type Bee = {
  whoami(): Promise<{ id: number; name: string }>;
  changed(cursor: string | undefined): Promise<Changes>;
  listFacts(opts: { unconfirmed?: boolean }): Promise<Fact[]>;
  getFact(id: number): Promise<Fact>;
  confirmFact(id: number): Promise<void>;
  deleteFact(id: number): Promise<void>;
  searchConversationIds(opts: { query: string; neural: boolean; since: number; until: number; limit: number }): Promise<number[]>;
  recentConversationIds(opts: { limit: number }): Promise<number[]>;
  getConversation(id: number): Promise<Conversation>;
  createTodo(opts: { text: string; alarmAt: string }): Promise<Todo>;
  getTodo(id: number): Promise<Todo>;
  listTodos(): Promise<Todo[]>;
  onTodoUpdated(wake: () => void): () => void;
};

export class NotFound extends Error {}

// Bee timestamps arrive as epoch seconds or milliseconds (sources/commands/now/index.ts:200).
export function toMs(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v > 1e12) return v;
  if (v > 1e9) return v * 1000;
  return null;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// get/create/update responses are either the bare object or { fact } / { todo } (facts/index.ts:49-70, todos/index.ts:78-92).
export function parseFact(payload: unknown): Fact {
  const r = rec(payload);
  const f = rec(r.fact ?? r);
  if (typeof f.id !== "number" || typeof f.text !== "string") throw new Error("Unexpected fact payload from Bee CLI.");
  return {
    id: f.id,
    text: f.text,
    tags: arr(f.tags).map(String),
    created_at: typeof f.created_at === "number" ? f.created_at : 0,
    confirmed: f.confirmed === true,
  };
}

export function parseTodo(payload: unknown): Todo {
  const r = rec(payload);
  const t = rec(r.todo ?? r);
  if (typeof t.id !== "number" || typeof t.text !== "string") throw new Error("Unexpected todo payload from Bee CLI.");
  return {
    id: t.id,
    text: t.text,
    alarm_at: (t.alarm_at as Todo["alarm_at"]) ?? null,
    completed: t.completed === true,
    created_at: typeof t.created_at === "number" ? t.created_at : 0,
  };
}

// conversations get -> { conversation: { transcriptions: [{ realtime, utterances: [...] }] } } (conversations/index.ts:353-380).
// Same transcription pick as the CLI renderer: first non-realtime, else first (conversations/index.ts:541-549).
export function parseConversation(payload: unknown): Conversation {
  const c = rec(rec(payload).conversation ?? payload);
  if (typeof c.id !== "number") throw new Error("Unexpected conversation payload from Bee CLI.");
  const transcriptions = arr(c.transcriptions).map(rec);
  const picked = transcriptions.find((t) => t.realtime !== true) ?? transcriptions[0];
  const utterances = arr(picked?.utterances)
    .map(rec)
    .filter((u) => typeof u.text === "string")
    .map((u) => ({
      id: Number(u.id ?? 0),
      text: String(u.text),
      speaker: typeof u.speaker === "string" && u.speaker ? u.speaker : "Unknown",
      spoken_at: typeof u.spoken_at === "number" ? u.spoken_at : null,
      start: typeof u.start === "number" ? u.start : null,
    }))
    .sort((a, b) => (toMs(a.spoken_at) ?? a.start ?? 0) - (toMs(b.spoken_at) ?? b.start ?? 0));
  return {
    id: c.id,
    start_time: typeof c.start_time === "number" ? c.start_time : 0,
    end_time: typeof c.end_time === "number" ? c.end_time : null,
    utterances,
  };
}

// search results: { results: [{ id, ... }], total } (search/index.ts:468-486). Result shape beyond id is not
// documented in source, so only ids are read and every candidate is re-fetched through conversations get.
export function parseSearchIds(payload: unknown): number[] {
  return arr(rec(payload).results)
    .map(rec)
    .map((r) => r.conversation_id ?? r.conversationId ?? r.id)
    .filter((id): id is number => typeof id === "number");
}

function notFoundOr<T>(p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (/404|not.?found/i.test(msg)) throw new NotFound(msg);
    throw e;
  });
}

export function realBee(options: { command?: string; env?: Record<string, string | undefined> } = {}): Bee {
  const client = createBeeClient({ command: options.command ?? defaultCommand(), ...(options.env ? { env: options.env } : {}) });
  const api = client.api;
  return {
    async whoami() {
      // `bee me --json` is { id, first_name, last_name } (client/clientMe.ts:32-45).
      const u = rec(await api.me());
      if (typeof u.id !== "number") throw new Error("Unexpected profile payload from Bee CLI.");
      return { id: Number(u.id), name: [u.first_name, u.last_name].filter(Boolean).join(" ") };
    },
    async changed(cursor) {
      // `bee changed --json` prints { meta: { next_cursor }, facts: [Fact], todos: [Todo], conversations: [...] } (commands/changed/index.ts:30-45).
      const r = rec(await api.changed(cursor ? { cursor } : undefined));
      const next = rec(r.meta).next_cursor;
      return {
        facts: arr(r.facts).map(parseFact),
        todos: arr(r.todos).map(parseTodo),
        nextCursor: typeof next === "string" ? next : null,
      };
    },
    async listFacts({ unconfirmed }) {
      const out: Fact[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const r = rec(await api.facts.list({ limit: 50, ...(cursor ? { cursor } : {}), ...(unconfirmed ? { unconfirmed: true } : {}) }));
        out.push(...arr(r.facts).map(parseFact));
        cursor = typeof r.next_cursor === "string" ? r.next_cursor : undefined;
        if (!cursor) break;
      }
      return out;
    },
    getFact: async (id) => parseFact(await notFoundOr(api.facts.get(id))),
    async confirmFact(id) {
      await api.facts.confirm(id);
    },
    async deleteFact(id) {
      await notFoundOr(api.facts.delete(id));
    },
    async searchConversationIds({ query, neural, since, until, limit }) {
      const base = { query, limit, since, until };
      const r = neural ? await api.search({ ...base, neural: true }) : await api.search({ ...base, filter: "conversations" });
      return parseSearchIds(r);
    },
    async recentConversationIds({ limit }) {
      const r = rec(await api.conversations.list({ limit }));
      return arr(r.conversations).map(rec).map((c) => c.id).filter((id): id is number => typeof id === "number");
    },
    getConversation: async (id) => parseConversation(await notFoundOr(api.conversations.get(id))),
    createTodo: async ({ text, alarmAt }) => parseTodo(await api.todos.create({ text, alarmAt })),
    getTodo: async (id) => parseTodo(await notFoundOr(api.todos.get(id))),
    async listTodos() {
      const out: Todo[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        const r = rec(await api.todos.list({ limit: 50, ...(cursor ? { cursor } : {}) }));
        out.push(...arr(r.todos).map(parseTodo));
        cursor = typeof r.next_cursor === "string" ? r.next_cursor : undefined;
        if (!cursor) break;
      }
      return out;
    },
    // `bee stream --json` payloads carry no top-level `event` field, so the stream is only a wake-up
    // signal: --types todo-updated filters server side and the poll in watch.ts reads the truth.
    onTodoUpdated(wake) {
      let closed = false;
      let current: { close: () => void } | null = null;
      const connect = async () => {
        while (!closed) {
          const s = client.sse.streamJson({ types: ["todo-updated"] });
          current = s;
          try {
            for await (const _ of s.events) wake();
          } catch (e) {
            // at-most-once, no replay: the poll in watch.ts covers whatever was missed
            console.error(`[stream] dropped, reconnecting in 5s: ${e instanceof Error ? e.message : String(e)}`);
          }
          if (!closed) await new Promise((r) => setTimeout(r, 5000));
        }
      };
      void connect();
      return () => {
        closed = true;
        current?.close();
      };
    },
  };
}
