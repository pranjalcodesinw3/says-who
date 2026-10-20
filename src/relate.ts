// Relations between facts, decided in code (no model): the same claim stored twice, or a claim that flips a confirmed one.
import type { Fact } from "./bee.ts";
import { contentTokens, isNegative, isNegator, words } from "./match.ts";

export type Relation = { kind: "duplicate" | "contradicts"; other: Fact };

export const DUPLICATE_JACCARD = 0.8;
export const CONTRADICT_JACCARD = 0.6;

// Claim = content tokens + polarity. Negators are removed from the tokens; "dislike" becomes "like" with the polarity flipped.
export function claimOf(text: string, ownerNames: string[] = []): { tokens: Set<string>; negative: boolean } {
  const kept = words(text).filter((w) => !isNegator(w));
  const tokens = new Set(contentTokens(kept.join(" "), ownerNames).map((t) => (t === "dislike" ? "like" : t)));
  return { tokens, negative: isNegative(text) };
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const inter = [...a].filter((t) => b.has(t)).length;
  return inter / (a.size + b.size - inter);
}

// Duplicate: an OLDER fact (lower id) says the same thing with the same polarity, so the newer one is the clutter.
// Contradicts: a CONFIRMED fact says the opposite polarity about (nearly) the same content.
export function relate(fact: Fact, peers: Fact[], ownerNames: string[] = []): Relation | null {
  const mine = claimOf(fact.text, ownerNames);
  if (mine.tokens.size === 0) return null;
  let contradiction: Relation | null = null;
  for (const other of peers) {
    if (other.id === fact.id) continue;
    const theirs = claimOf(other.text, ownerNames);
    const j = jaccard(mine.tokens, theirs.tokens);
    if (theirs.negative === mine.negative && j >= DUPLICATE_JACCARD && other.id < fact.id) return { kind: "duplicate", other };
    if (theirs.negative !== mine.negative && j >= CONTRADICT_JACCARD && other.confirmed && !contradiction) contradiction = { kind: "contradicts", other };
  }
  return contradiction;
}
