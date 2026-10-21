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
    if (STOP.has(raw.toLowerCase()) || isNegator(raw)) continue;
    const s = stem(raw);
    if (s.length < 3 || STOP.has(s) || owner.has(s)) continue;
    out.add(s);
  }
  return [...out];
}

const NEGATORS = new Set(["not", "no", "never", "cant", "cannot", "wont", "doesnt", "dont", "isnt", "arent", "didnt", "wasnt", "hasnt", "havent", "nor"]);
const letters = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "");
export const isNegator = (w: string) => NEGATORS.has(letters(w));

// Polarity of a piece of text: every negator flips it once, and "dislike" (hate, detest) is "like" flipped.
export function isNegative(text: string): boolean {
  let flips = 0;
  for (const w of words(text)) if (isNegator(w) || stem(w) === "dislike") flips++;
  return flips % 2 === 1;
}

// The clause (split on punctuation and "but") that carries most of the needed tokens; polarity is judged on that clause only,
// so an unrelated "I don't know" elsewhere in the utterance does not flip it.
function bestClause(text: string, need: string[]): string {
  const clauses = text.split(/[,.;:!?]|\bbut\b|\bthough\b/i);
  let best = text;
  let most = -1;
  for (const c of clauses) {
    const have = new Set(words(c).map(stem));
    const n = need.filter((t) => have.has(t)).length;
    if (n > most) { most = n; best = c; }
  }
  return best;
}

// Who a matching line is about. Matching words is not enough: "my brother is vegan" shares every keyword of "is vegan".
// "Unknown" is a label Bee also puts on people who are not the wearer, so it proves nothing by itself.
export type SpeakerKind = "wearer" | "unknown" | "other";
export type Attribution = { kind: "self" | "other" | "unclear"; why: string };

const RELATIONS = "brother|sister|wife|husband|friend|mom|mum|mother|dad|father|boss|colleague|coworker|cousin|son|daughter|partner|neighbou?r|roommate|uncle|aunt|girlfriend|boyfriend|kid|sibling|manager|teacher|grandma|grandpa|grandmother|grandfather|family";
const RELATION_RE = new RegExp(`\\b(?:my|our|your)\\s+(?:[a-z]+\\s+)?(?:${RELATIONS})s?\\b`, "i");
const THIRD_RE = /\b(he|she|they|he's|she's|they're|his|her|hers|their|theirs|him|them)\b/i;
const FIRST_RE = /\b(i|i'm|i've|i'll|i'd|me|myself|my|mine|we|we're|we've|us|our)\b/i;

// Subject of one clause, from the text alone: a relation ("my brother"), a pronoun for someone else, a named participant, or first person.
export function subjectOf(clause: string, participantNames: Set<string>): { kind: "self" | "other" | "none"; cue: string | null } {
  const rel = RELATION_RE.exec(clause);
  if (rel) return { kind: "other", cue: rel[0].toLowerCase() };
  const third = THIRD_RE.exec(clause);
  if (third) return { kind: "other", cue: third[0].toLowerCase() };
  const named = words(clause).find((w) => participantNames.has(w.toLowerCase()));
  if (named) return { kind: "other", cue: named };
  const first = FIRST_RE.exec(clause);
  if (first) return { kind: "self", cue: first[0] };
  return { kind: "none", cue: null };
}

export function attribute(subject: ReturnType<typeof subjectOf>, speaker: string, kind: SpeakerKind): Attribution {
  if (subject.kind === "other") return { kind: "other", why: `the line is about someone else ("${subject.cue}")` };
  if (kind === "other") return { kind: "other", why: `the line was spoken by "${speaker}", not the wearer` };
  if (kind === "wearer") return { kind: "self", why: `spoken by "${speaker}", a configured wearer label` };
  if (subject.kind === "self") return { kind: "self", why: `first person ("${subject.cue}") in a line from an unlabelled speaker` };
  return { kind: "unclear", why: "speaker label is Unknown and the line names no subject, so nothing ties it to the wearer" };
}

export type Support = { score: number; index: number; matched: string[]; attribution: Attribution };

export const SUPPORT_RATIO = 0.6;
export const NEAR_MISS_RATIO = 0.33;

// Best window (one utterance, or two adjacent) covering the fact's content tokens.
// Supported needs >= 60% of tokens and at least 2 distinct tokens (a single-token fact needs a token of 5+ letters).
// speakerKind maps a Bee speaker label to wearer / unknown / other. Without it every label is unknown, so only the wording can attribute a line.
// Among windows that cover the fact, one attributed to the wearer beats a better lexical match about someone else.
export function findSupport(factText: string, utterances: Utterance[], ownerNames: string[] = [], loose = false, speakerKind: (label: string) => SpeakerKind = () => "unknown"): Support | null {
  const need = contentTokens(factText, ownerNames);
  if (need.length === 0) return null;
  const factNegative = isNegative(factText);
  const sets = utterances.map((u) => new Set(words(u.text).map(stem)));
  const participantNames = new Set(
    utterances.filter((u) => speakerKind(u.speaker) === "other" && !/^speaker\s*\d*$/i.test(u.speaker.trim())).flatMap((u) => words(u.speaker)).map((w) => w.toLowerCase()),
  );
  const rank = (a: Support) => (a.attribution.kind === "self" ? 1 : 0) * 10 + a.score;
  let best: Support | null = null;
  for (let i = 0; i < utterances.length; i++) {
    for (const span of [1, 2]) {
      if (i + span > utterances.length) continue;
      const hit = need.filter((t) => Array.from({ length: span }, (_, k) => sets[i + k]!).some((s) => s.has(t)));
      const ratio = hit.length / need.length;
      const minHits = loose || need.length === 1 ? 1 : 2;
      if (hit.length < minHits || ratio < (loose ? NEAR_MISS_RATIO : SUPPORT_RATIO)) continue;
      // loose mode feeds the optional judge: a lone "like" is not a hit worth a model call
      if (loose && hit.every((t) => t === "like")) continue;
      if (need.length === 1 && need[0]!.length < 5) continue;
      // "Does not like oat milk" is not supported by "I switched to oat milk", and "Likes jazz" is not supported by "I can't stand jazz".
      const window = Array.from({ length: span }, (_, k) => utterances[i + k]!.text).join(" ");
      if (isNegative(bestClause(window, hit)) !== factNegative) continue;
      // inside the window, speaker/quote come from the utterance carrying most of the hits
      let at = i;
      let most = -1;
      for (let k = 0; k < span; k++) {
        const c = hit.filter((t) => sets[i + k]!.has(t)).length;
        if (c > most) { most = c; at = i + k; }
      }
      const attribution = attribute(subjectOf(bestClause(window, hit), participantNames), utterances[at]!.speaker, speakerKind(utterances[at]!.speaker));
      const cand: Support = { score: ratio, index: at, matched: hit, attribution };
      if (!best || rank(cand) > rank(best)) best = cand;
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
