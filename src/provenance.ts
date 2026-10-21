import type { Bee, Conversation, Fact } from "./bee.ts";
import { toMs } from "./bee.ts";
import { contentTokens, findSupport, quoteOf, type Support } from "./match.ts";
import type { Judge } from "./judge.ts";
import { relate } from "./relate.ts";
import { TV_THRESHOLD, tvLikelihood, type TvContext } from "./tv.ts";

export const VERDICTS = ["supported", "likely-tv", "no-evidence", "duplicate", "contradicts"] as const;
export type Verdict = (typeof VERDICTS)[number];

// What was actually searched. A no-evidence verdict is only as strong as this: a bounded search, not a proof that nobody said it.
export type Scope = { methods: string[]; since: number | null; until: number | null; candidates: { id: number; at: number | null }[] };

export type Receipt = {
  factId: number;
  factText: string;
  factCreatedAt: number | null;
  verdict: Verdict;
  tvScore: number;
  supportScore: number;
  quote: string | null;
  speaker: string | null;
  spokenAt: number | null;
  conversationId: number | null;
  reasons: string[];
  searched: number;
  scope: Scope;
  relatedFactId: number | null;
  relatedFactText: string | null;
};

export type Ctx = { ownerNames: string[]; tv: TvContext; judge?: Judge };

const HOUR = 3_600_000;
const WEAK_SUPPORT = 0.8;

// Pure: facts + the conversations that might have produced them -> receipt.
// If any conversation supports the fact with a low TV score, that one wins: a fact the wearer really said stays supported
// even when the same words also played on TV.
export function assess(fact: Fact, conversations: Conversation[], ctx: Ctx): Receipt {
  let pick: { conv: Conversation; support: Support; tv: ReturnType<typeof tvLikelihood> } | null = null;
  for (const conv of conversations) {
    const support = findSupport(fact.text, conv.utterances, ctx.ownerNames);
    if (!support) continue;
    const tv = tvLikelihood(conv, support.index, ctx.tv);
    if (!pick || tv.score < pick.tv.score || (tv.score === pick.tv.score && support.score > pick.support.score)) pick = { conv, support, tv };
  }
  const base = { factId: fact.id, factText: fact.text, factCreatedAt: toMs(fact.created_at), searched: conversations.length, scope: scopeOf(conversations) };
  if (!pick) {
    const reason = contentTokens(fact.text, ctx.ownerNames).length === 0
      ? "fact has no checkable content words"
      : `no evidence found in the ${conversations.length} searched conversation(s)`;
    return { ...base, verdict: "no-evidence", tvScore: 0, supportScore: 0, quote: null, speaker: null, spokenAt: null, conversationId: null, reasons: [reason], relatedFactId: null, relatedFactText: null };
  }
  return build(base, pick.conv, pick.support, pick.tv);
}

export function scopeOf(conversations: Conversation[], methods: string[] = [], window: { since: number; until: number } | null = null): Scope {
  return {
    methods, since: window?.since ?? null, until: window?.until ?? null,
    candidates: conversations.map((c) => ({ id: c.id, at: toMs(c.start_time) })),
  };
}

function build(base: Pick<Receipt, "factId" | "factText" | "factCreatedAt" | "searched" | "scope">, conv: Conversation, support: Support, tv: ReturnType<typeof tvLikelihood>): Receipt {
  const u = conv.utterances[support.index]!;
  return {
    ...base,
    verdict: tv.score >= TV_THRESHOLD ? "likely-tv" : "supported",
    tvScore: tv.score,
    supportScore: Number(support.score.toFixed(2)),
    quote: quoteOf(u.text, support.matched),
    speaker: u.speaker,
    spokenAt: toMs(u.spoken_at) ?? toMs(conv.start_time),
    conversationId: conv.id,
    reasons: tv.reasons,
    relatedFactId: null,
    relatedFactText: null,
  };
}

// Borderline = a match the lexical rules are not sure about: a supported receipt under 0.8 coverage (could be a coincidence),
// or a no-evidence one with a partial hit (could be a paraphrase). The judge sees one utterance and its neighbours, once per fact.
// Its failure never changes the verdict: the heuristic stands and the receipt says the judge was unavailable.
export async function refine(fact: Fact, conversations: Conversation[], ctx: Ctx, receipt: Receipt): Promise<Receipt> {
  const judge = ctx.judge;
  if (!judge) return receipt;
  type Pick = { conv: Conversation; index: number; support: Support };
  let pick: Pick | null = null;
  if (receipt.verdict === "no-evidence") {
    for (const conv of conversations) {
      const support = findSupport(fact.text, conv.utterances, ctx.ownerNames, true);
      if (support && (!pick || support.score > pick.support.score)) pick = { conv, index: support.index, support };
    }
  } else if (receipt.supportScore < WEAK_SUPPORT) {
    const conv = conversations.find((c) => c.id === receipt.conversationId);
    const support = conv && findSupport(fact.text, conv.utterances, ctx.ownerNames);
    if (conv && support) pick = { conv, index: support.index, support };
  }
  if (!pick) return receipt;
  const us = pick.conv.utterances;
  try {
    const d = await judge.decide({
      factText: fact.text, utterance: us[pick.index]!.text, speaker: us[pick.index]!.speaker,
      before: us[pick.index - 1]?.text ?? null, after: us[pick.index + 1]?.text ?? null,
    });
    const note = `judge ${judge.name}: ${d.supports ? "supports" : "does not support"}${d.reason ? ` (${d.reason})` : ""}`;
    if (receipt.verdict === "no-evidence" && d.supports) {
      const r = build({ factId: fact.id, factText: fact.text, factCreatedAt: receipt.factCreatedAt, searched: receipt.searched, scope: receipt.scope }, pick.conv, pick.support, tvLikelihood(pick.conv, pick.index, ctx.tv));
      return { ...r, reasons: [note, ...r.reasons] };
    }
    if (receipt.verdict !== "no-evidence" && !d.supports) {
      return { ...receipt, verdict: "no-evidence", supportScore: 0, quote: null, speaker: null, spokenAt: null, conversationId: null, tvScore: 0, reasons: [note, `heuristic match was weak (${receipt.supportScore})`] };
    }
    return { ...receipt, reasons: [note, ...receipt.reasons] };
  } catch (e) {
    return { ...receipt, reasons: [`judge ${judge.name} unavailable (${e instanceof Error ? e.name : "error"}), heuristic verdict kept`, ...receipt.reasons] };
  }
}

async function fetchAll(bee: Bee, ids: number[], seen: Map<number, Conversation>, max: number): Promise<number> {
  let fetched = 0;
  for (const id of ids) {
    if (seen.has(id) || fetched >= max) continue;
    seen.set(id, await bee.getConversation(id));
    fetched++;
  }
  return fetched;
}

// Candidate conversations: BM25 over conversations in [created-48h, created+10min], then the most recent conversations.
// Neural search is slow by design, so it only runs when the cheap candidates produce no supported receipt.
export async function receiptFor(bee: Bee, fact: Fact, ctx: Ctx, peers: Fact[] = []): Promise<Receipt> {
  const created = toMs(fact.created_at) ?? Date.now();
  const window = { since: created - 48 * HOUR, until: created + 10 * 60_000 };
  const query = contentTokens(fact.text, ctx.ownerNames).join(" ") || fact.text;
  const seen = new Map<number, Conversation>();

  const methods: string[] = [];
  const bm = await bee.searchConversationIds({ query, neural: false, limit: 10, ...window });
  methods.push(`text search in the window: ${bm.length} hit(s), ${await fetchAll(bee, bm, seen, 6)} read`);
  const recent = await bee.recentConversationIds({ limit: 10 });
  methods.push(`most recent conversations: ${await fetchAll(bee, recent, seen, 6)} more read`);
  let receipt = assess(fact, [...seen.values()], ctx);
  if (receipt.verdict === "no-evidence") {
    const neural = await bee.searchConversationIds({ query: fact.text, neural: true, limit: 5, ...window });
    methods.push(`neural search in the window: ${neural.length} hit(s), ${await fetchAll(bee, neural, seen, 4)} more read`);
    receipt = assess(fact, [...seen.values()], ctx);
  }
  receipt = await refine(fact, [...seen.values()], ctx, receipt);
  receipt = { ...receipt, scope: scopeOf([...seen.values()], methods, window) };
  return withRelation(receipt, fact, peers, ctx);
}

// A relation to another stored fact outranks the evidence verdict: a duplicate is clutter and a contradiction needs the wearer,
// even when each of them has a real receipt. The evidence fields stay on the receipt.
export function withRelation(receipt: Receipt, fact: Fact, peers: Fact[], ctx: Ctx): Receipt {
  const rel = relate(fact, peers, ctx.ownerNames);
  if (!rel) return receipt;
  const why = rel.kind === "duplicate"
    ? `same claim as older fact ${rel.other.id} "${rel.other.text}"`
    : `opposes confirmed fact ${rel.other.id} "${rel.other.text}"`;
  return { ...receipt, verdict: rel.kind, relatedFactId: rel.other.id, relatedFactText: rel.other.text, reasons: [why, ...receipt.reasons] };
}
