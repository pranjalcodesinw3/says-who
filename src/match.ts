// Lexical support check: does a verbatim utterance actually say what the fact claims?
// Works on utterances only. Summaries are AI-written and never count as evidence.
import type { Utterance } from "./bee.ts";

const STOP = new Set(
  ("a an the and or but if so of to in on at by for with from as is are was were be been being am do does did has have had " +
    "it its this that these those he she they them his her their we us our you your i me my mine user users person " +
    "also very really just about into over than then there here who whom which what when where how not no yes " +
    "likely seems appears often usually currently recently").split(" "),
);

const SYNONYMS: Record<string, string> = {
  love: "like", enjoy: "like", prefer: "like", fan: "like", adore: "like",
  hate: "dislike", detest: "dislike",
  job: "work", employed: "work", employ: "work",
  attorney: "lawyer", lawyers: "lawyer",
  car: "vehicle", automobile: "vehicle",
};

export function stem(word: string): string {
  let w = word.toLowerCase().replace(/'s$/, "").replace(/[^a-z0-9]/g, "");
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ied")) w = w.slice(0, -3) + "y";
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 3 && w.endsWith("es") && /(s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return SYNONYMS[w] ?? w;
}

export function words(text: string): string[] {
  return text.match(/[A-Za-z0-9']+/g) ?? [];
}

// Content tokens of a fact. Owner name tokens are dropped: the wearer never says their own name,
// and "Dave is a criminal lawyer" is supported by "criminal lawyer", whoever it was said about.
export function contentTokens(text: string, ownerNames: string[] = []): string[] {
  const owner = new Set(ownerNames.flatMap((n) => words(n)).map(stem));
  const out = new Set<string>();
  for (const raw of words(text)) {
    if (STOP.has(raw.toLowerCase())) continue;
    const s = stem(raw);
    if (s.length < 3 || STOP.has(s) || owner.has(s)) continue;
    out.add(s);
  }
  return [...out];
}

export type Support = { score: number; index: number; matched: string[] };

export const SUPPORT_RATIO = 0.6;

// Best window (one utterance, or two adjacent) covering the fact's content tokens.
// Supported needs >= 60% of tokens and at least 2 distinct tokens (a single-token fact needs a token of 5+ letters).
export function findSupport(factText: string, utterances: Utterance[], ownerNames: string[] = []): Support | null {
  const need = contentTokens(factText, ownerNames);
  if (need.length === 0) return null;
  const sets = utterances.map((u) => new Set(words(u.text).map(stem)));
  let best: Support | null = null;
  for (let i = 0; i < utterances.length; i++) {
    for (const span of [1, 2]) {
      if (i + span > utterances.length) continue;
      const hit = need.filter((t) => Array.from({ length: span }, (_, k) => sets[i + k]!).some((s) => s.has(t)));
      const ratio = hit.length / need.length;
      const minHits = need.length === 1 ? 1 : 2;
      if (hit.length < minHits || ratio < SUPPORT_RATIO) continue;
      if (need.length === 1 && need[0]!.length < 5) continue;
      // inside the window, speaker/quote come from the utterance carrying most of the hits
      let at = i;
      let most = -1;
      for (let k = 0; k < span; k++) {
        const c = hit.filter((t) => sets[i + k]!.has(t)).length;
        if (c > most) { most = c; at = i + k; }
      }
      if (!best || ratio > best.score) best = { score: ratio, index: at, matched: hit };
    }
  }
  return best;
}

// <= 25 words of the utterance, centred on the first matched token.
export function quoteOf(text: string, matched: string[], maxWords = 25): string {
  const ws = text.trim().split(/\s+/);
  if (ws.length <= maxWords) return ws.join(" ");
  const at = Math.max(0, ws.findIndex((w) => matched.includes(stem(w))));
  const start = Math.min(Math.max(0, at - Math.floor(maxWords / 2)), ws.length - maxWords);
  return `${start > 0 ? "..." : ""}${ws.slice(start, start + maxWords).join(" ")}${start + maxWords < ws.length ? "..." : ""}`;
}
