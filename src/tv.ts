// TV-likelihood of a conversation, from signals that need no model:
// who spoke the supporting line, how many other voices, cadence, show cues, first vs third person.
import type { Conversation } from "./bee.ts";
import { words, type SpeakerKind } from "./match.ts";

// lineLevel: some cue concerns the supporting line itself (a known non-wearer spoke it), not just the conversation around it.
// Conversation-level cues alone never make a line "TV": the wearer's own sentence can sit inside a TV-like conversation.
export type TvResult = { score: number; reasons: string[]; lineLevel: boolean };

export const TV_THRESHOLD = 0.5;

const SHOW_TITLES = [
  "dexter", "breaking bad", "better call saul", "game of thrones", "succession", "the office", "seinfeld",
  "friends", "law and order", "law & order", "stranger things", "the sopranos", "the wire", "mad men",
  "house of the dragon", "the bear", "ted lasso", "love is blind", "grey's anatomy", "criminal minds",
  "saturday night live", "the daily show",
];
const SHOW_PHRASES = [
  "previously on", "coming up next", "after the break", "stay tuned", "welcome back to", "tonight on",
  "season finale", "next episode", "in this episode", "today's episode", "this podcast", "like and subscribe",
  "sponsored by", "brought to you by", "we'll be right back", "you're watching",
];

export type TvContext = { wearerSpeakers: Set<string>; extraCues: string[] };

export function defaultWearerSpeakers(ownerName?: string): Set<string> {
  // "Unknown" is deliberately not a default wearer label: Bee uses it for anyone it could not name. Opt in with RECEIPTS_WEARER_SPEAKERS=unknown,... if your device labels you so.
  const base = (process.env.RECEIPTS_WEARER_SPEAKERS ?? "you,me,user,owner,wearer").split(",");
  if (ownerName) base.push(ownerName);
  return new Set(base.map((s) => s.trim().toLowerCase()).filter(Boolean));
}

export function tvContext(ownerName?: string): TvContext {
  const extraCues = (process.env.RECEIPTS_SHOW_NAMES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { wearerSpeakers: defaultWearerSpeakers(ownerName), extraCues };
}

const FIRST_PERSON = /\b(i|i'm|i've|i'll|i'd|me|my|mine|myself)\b/i;
const THIRD_PERSON = /\b(he|she|they|he's|she's|they're|his|her|their|him|them)\b/i;

export function speakerKind(ctx: TvContext, label: string): SpeakerKind {
  const l = label.trim().toLowerCase();
  if (ctx.wearerSpeakers.has(l)) return "wearer";
  return l === "" || l === "unknown" ? "unknown" : "other";
}

export function cueHits(text: string, extra: string[] = []): string[] {
  const t = text.toLowerCase();
  return [...SHOW_TITLES, ...SHOW_PHRASES, ...extra].filter((cue) => new RegExp(`\\b${cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t));
}

export function tvLikelihood(conv: Conversation, supportIndex: number | null, ctx: TvContext): TvResult {
  const reasons: string[] = [];
  let score = 0;
  const us = conv.utterances;
  let lineLevel = false;

  const support = supportIndex === null ? null : us[supportIndex] ?? null;
  const kind = support ? speakerKind(ctx, support.speaker) : null;
  if (support && kind === "other") {
    score += 0.35;
    lineLevel = true;
    reasons.push(`line spoken by "${support.speaker}", not the wearer`);
  } else if (support && kind === "unknown") {
    reasons.push("speaker label is Unknown: it is neither evidence for nor against the wearer");
  }

  const others = new Set(us.filter((u) => speakerKind(ctx, u.speaker) === "other").map((u) => u.speaker.trim().toLowerCase()));
  if (others.size >= 2) {
    score += 0.2;
    reasons.push(`${others.size} distinct non-wearer speakers`);
  }

  const counts = us.map((u) => words(u.text).length);
  if (counts.length >= 6) {
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const sd = Math.sqrt(counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length);
    if (mean >= 12 && sd / mean <= 0.6) {
      score += 0.2;
      reasons.push(`scripted cadence: ${counts.length} even utterances averaging ${mean.toFixed(0)} words`);
    }
  }

  const cues = cueHits(us.map((u) => u.text).join(" \n "), ctx.extraCues);
  if (cues.length > 0) {
    score += 0.25;
    reasons.push(`show cue: ${cues.slice(0, 3).join(", ")}`);
  }

  if (support && !FIRST_PERSON.test(support.text) && THIRD_PERSON.test(support.text)) {
    score += 0.15;
    reasons.push("quote is third person, not the wearer talking about themselves");
  }

  return { score: Math.min(1, Number(score.toFixed(2))), reasons, lineLevel };
}
