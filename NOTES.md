# Source notes: Bee shapes Says Who relies on

All paths are under `sources/` of `bee-computer/bee-cli` at 0.8.0, commit `84a6e8f` (cloned 2026-10-21), except the skill rows, which are `bee-computer/bee-skill` at `64e10ad`. Package: `@beeai/cli` 0.8.0, pinned in `package.json`, whose `./lib` export is the runtime hook (`src/bee.ts`).

| Says Who needs | Bee call | Shape relied on | Source |
|---|---|---|---|
| Client | `createBeeClient({ command, env })` returns `{ auth, api, sse, run, runJson }` | every `api.*` call shells out to `bee <args> --json` and JSON-parses stdout, throwing the stderr text on a non-zero exit | `lib/index.ts:29-38`, `lib/runner.ts:150-160, 178-180` |
| Who am I | `api.me()` = `bee me --json` | `{ id, first_name, last_name }` | `client/clientMe.ts:7-11, 32-44`; `lib/api.ts:125` |
| New facts, cursor | `api.changed({ cursor })` = `bee changed --cursor X --json` | `{ meta: { cursor, next_cursor, since, until, updated, timezone }, facts: Fact[], todos: Todo[], dailies, conversations, journals }`; facts are fetched by id, not ids | `commands/changed/index.ts:21-45, 144-182, 229-240`; `lib/api.ts:128-134` |
| Cursor discipline | persist the cursor only after the batch is processed | skill rule, "Cursor handling" steps 1-6 | `bee-skill/bee-cli/SKILL.md` section "Monitoring Changes" |
| List facts | `api.facts.list({ limit, cursor, unconfirmed })` | `{ facts: Fact[], next_cursor, timezone }`; `Fact = { id, text, tags, created_at, confirmed }`; `--unconfirmed` sets `confirmed=false` | `resources/facts/index.ts:55-82, 233-290`; `lib/api.ts:136-144` |
| Get fact | `api.facts.get(id)` | bare Fact or `{ fact }`; a deleted id is an HTTP error whose message is the server error or `Request failed with status N` | `resources/facts/index.ts:84-117, 381`; `client/clientApi.ts:50-56` |
| Confirm fact | `api.facts.confirm(id)` | PUT `/v1/facts/:id` with `{ text, confirmed: true }`, text re-fetched | `resources/facts/index.ts:498-513, 530-545`; `lib/api.ts:157` |
| Delete fact | `api.facts.delete(id)` | DELETE `/v1/facts/:id` | `resources/facts/index.ts:561-575`; `lib/api.ts:158` |
| Candidate conversations, keyword | `api.search({ query, filter: "conversations", since, until, limit })` | POST `/v1/search/conversations`; response `{ results: [...], total }`; `since`/`until` epoch ms | `resources/search/index.ts:137-157, 441-460`; `lib/api.ts:236-259` |
| Candidate conversations, neural | `api.search({ query, neural: true, since, until, limit })` | POST `/v1/search/conversations/neural`; `--filter/--sort` rejected with `--neural` | `resources/search/index.ts:120-135, 226-236`; `lib/api.ts:59-77` |
| Recent conversations | `api.conversations.list({ limit })` | `{ conversations: [{ id, start_time, end_time, created_at, summary, state }], next_cursor }` | `resources/conversations/index.ts:66-73, 75-145` |
| Verbatim utterances | `api.conversations.get(id)` | `{ conversation: { id, start_time, end_time, transcriptions: [{ realtime, utterances: [{ id, text, speaker, spoken_at, start, end }] }] } }`; renderer picks the first non-realtime transcription and sorts by `spoken_at ?? start ?? 0` | `resources/conversations/index.ts:200-215, 353-386, 503-506, 541-549` |
| Summaries are not evidence | utterances are verbatim, summaries are AI-generated | skill "Source of truth" | `bee-skill/bee-cli/SKILL.md`, "Output format" paragraph |
| Wrist to-do | `api.todos.create({ text, alarmAt })` = `bee todos create --text T --alarm-at ISO` | POST `/v1/todos` with `{ text, alarm_at }`; Todo = `{ id, text, alarm_at, completed, created_at }`; no tags field | `resources/todos/index.ts:49-55, 337-378`; `lib/api.ts:167-173` |
| Tick detection | `api.todos.get(id)` | `completed: boolean`; a ticked to-do stays readable | `resources/todos/index.ts:49-55, 331`; `lib/api.ts:166` |
| To-do list for orphan lookup | `api.todos.list({ limit, cursor })` | raw server response, completed to-dos included | `resources/todos/index.ts:5, 296-316` |
| Wake-up on tick | `sse.streamJson({ types: ["todo-updated"] })` = `bee stream --json --types todo-updated` | newline-delimited JSON of the raw event data with no `event` field; at-most-once | `lib/sse.ts:30-37, 122-151`; `commands/stream/index.ts:10-24, 315, 351` |
| Timestamp units | seconds or milliseconds | `> 1e12` is ms, `> 1e9` is seconds | `commands/now/index.ts:200-211` |
| Login gate | `bee me` exits 1 when logged out; `bee status` exits 0 | `requireClientToken` throws `Not logged in. Run "bee login" first.`; `status` prints "Not logged in." | `client/clientApi.ts:16-26`; `commands/status/index.ts:38-42` |
| Isolated test config | `BEE_CONFIG_DIR`, `BEE_FORCE_FILE_STORE=1` | token file `token-<env>` under the config dir | `secureStore.ts:12-24, 28-31` |

## Design choices that follow from these shapes

- A fact carries no conversation pointer (`resources/facts/index.ts:55-61`), so provenance is rebuilt by search plus lexical match over utterances.
- A to-do carries no metadata, so the fact id is encoded as `[rcpt:<id>]` at the end of the to-do text, and the label is searched again before any retry creates a second to-do.
- `bee changed` fetches each changed id and rejects on the first failure (`commands/changed/index.ts:28-35`), so `tick` falls back to the pending-facts list and holds the cursor when it throws.
- Helper to-dos are completed in Bee and left in place. Deleting one would add a dead id to the next `changed` batch, which that command cannot fetch.
- Stream payloads have no `event` field, so the stream only wakes the poll, and `todos get` supplies the truth.
