import type { Bee, Conversation, Fact } from "./bee.ts";
import { toMs } from "./bee.ts";
import { contentTokens, findSupport, quoteOf, type Support } from "./match.ts";
import { relate } from "./relate.ts";
import { TV_THRESHOLD, tvLikelihood, type TvContext } from "./tv.ts";

export type Verdict = "supported" | "unsupported" | "likely-tv" | "duplicate" | "contradicts";

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
  relatedFactId: number | null;
  relatedFactText: string | null;
};

export type Ctx = { ownerNames: string[]; tv: TvContext };

const HOUR = 3_600_000;

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
  const base = { factId: fact.id, factText: fact.text, factCreatedAt: toMs(fact.created_at), searched: conversations.length };
  if (!pick) {
    const reason = contentTokens(fact.text, ctx.ownerNames).length === 0
      ? "fact has no checkable content words"
      : `no utterance in ${conversations.length} candidate conversation(s) says this`;
    return { ...base, verdict: "unsupported", tvScore: 0, supportScore: 0, quote: null, speaker: null, spokenAt: null, conversationId: null, reasons: [reason], relatedFactId: null, relatedFactText: null };
  }
  const u = pick.conv.utterances[pick.support.index]!;
  return {
    ...base,
    verdict: pick.tv.score >= TV_THRESHOLD ? "likely-tv" : "supported",
    tvScore: pick.tv.score,
    supportScore: Number(pick.support.score.toFixed(2)),
    quote: quoteOf(u.text, pick.support.matched),
    speaker: u.speaker,
    spokenAt: toMs(u.spoken_at) ?? toMs(pick.conv.start_time),
    conversationId: pick.conv.id,
    reasons: pick.tv.reasons,
    relatedFactId: null,
    relatedFactText: null,
  };
}

async function fetchAll(bee: Bee, ids: number[], seen: Map<number, Conversation>, max: number): Promise<void> {
  let fetched = 0;
  for (const id of ids) {
    if (seen.has(id) || fetched >= max) continue;
    seen.set(id, await bee.getConversation(id));
    fetched++;
  }
}

// Candidate conversations: BM25 over conversations in [created-48h, created+10min], then the most recent conversations.
// Neural search is slow by design, so it only runs when the cheap candidates produce no supported receipt.
export async function receiptFor(bee: Bee, fact: Fact, ctx: Ctx, peers: Fact[] = []): Promise<Receipt> {
  const created = toMs(fact.created_at) ?? Date.now();
  const window = { since: created - 48 * HOUR, until: created + 10 * 60_000 };
  const query = contentTokens(fact.text, ctx.ownerNames).join(" ") || fact.text;
  const seen = new Map<number, Conversation>();

  await fetchAll(bee, await bee.searchConversationIds({ query, neural: false, limit: 10, ...window }), seen, 6);
  await fetchAll(bee, await bee.recentConversationIds({ limit: 10 }), seen, 6);
  let receipt = assess(fact, [...seen.values()], ctx);
  if (receipt.verdict === "unsupported") {
    await fetchAll(bee, await bee.searchConversationIds({ query: fact.text, neural: true, limit: 5, ...window }), seen, 4);
    receipt = assess(fact, [...seen.values()], ctx);
  }
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
