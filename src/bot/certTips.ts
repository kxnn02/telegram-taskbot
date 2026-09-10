import { DateTime } from "luxon";
import { MANILA_ZONE } from "../domain/overdue.js";
import { esc } from "./html.js";

/**
 * Issue #180: replaces the deleted books-reminder line with a rotating,
 * attributed CCA-F certification exam tip. Static content — this array,
 * transcribed verbatim from the issue's appendix — so selection can be
 * unconditional: nothing here can fail at runtime the way a model call can.
 */
export type CertTip = {
  readonly id: number;
  readonly lead: string;
  readonly body: string;
  readonly from: string;
};

export const CERT_TIPS = [
  {
    id: 1,
    lead: "Trust your prep and stop putting it off.",
    body: "Don't let anxiety delay you — the real exam is often comparable in difficulty to the mock tests you've practiced with.",
    from: "Kim Fajardo",
  },
  {
    id: 2,
    lead: 'Practice choosing the "best" answer, not just a correct one.',
    body: "Multiple options are often technically true; train on mocks with closely competing choices so you stop second-guessing.",
    from: "Kim Fajardo",
  },
  {
    id: 3,
    lead: "Secure the easy points first.",
    body: "Passing score is ~720, so you have room for error — nail the ~50 straightforward questions and don't let one hard one drain your time.",
    from: "Kim Fajardo",
  },
  {
    id: 4,
    lead: "If you're not an engineer, follow a structured path.",
    body: "Claude Partner Network learning path → Claude Certification Guide for review → CertSafari domain-by-domain practice.",
    from: "Kim Fajardo",
  },
  {
    id: 5,
    lead: 'Keep practicing even after a domain shows "Strong."',
    body: "More mocks = more question variety, and it deepens why an answer is right, not just recognition.",
    from: "Kim Fajardo",
  },
  {
    id: 6,
    lead: "Don't let confidence replace preparation.",
    body: "Perfect mock scores can create false confidence — the real exam is noticeably harder than it feels after a good streak.",
    from: "Jello Mangune",
  },
  {
    id: 7,
    lead: "Study the learning material, don't skim it.",
    body: "claudecertificationguide.com/learn covers concepts that are genuinely tested — go through it thoroughly.",
    from: "Jello Mangune",
  },
  {
    id: 8,
    lead: "Manage your time carefully.",
    body: "~2 minutes/question can feel rushed with long scenarios — don't let one item eat your pace.",
    from: "Jello Mangune",
  },
  {
    id: 9,
    lead: 'Don\'t chase a "favorite" domain.',
    body: "Domains are drawn randomly, so build proficiency across all of them rather than leaning on what's easy for you.",
    from: "Daniel James Rodriguez",
  },
  {
    id: 10,
    lead: "Answer fast when unsure, flag it, and return later.",
    body: "There's more time on the clock than you think, so don't stall on any single question.",
    from: "Daniel James Rodriguez",
  },
  {
    id: 11,
    lead: "Book your exam date at least a few days out.",
    body: "A fixed date creates urgency and keeps your remaining study time focused.",
    from: "Lady Diane Casilang",
  },
  {
    id: 12,
    lead: "Use CertSafari's study-prompt generator.",
    body: "Understand why an answer is correct (and why the others are wrong) — not just to drill for a score.",
    from: "Lady Diane Casilang",
  },
  {
    id: 13,
    lead: "Chase consistency, not a single high score.",
    body: "Passing several different mock exams reliably is a better readiness signal than one 90%+ run.",
    from: "Lady Diane Casilang",
  },
  {
    id: 14,
    lead: "Diversify your mock exam sources.",
    body: "A high score on one bank may just reflect familiarity with that question set — cross-check with others.",
    from: "Lady Diane Casilang",
  },
  {
    id: 15,
    lead: "Use CertSafari's Review Mode as your main study loop.",
    body: "Knowing why you got something wrong matters far more than seeing the right answer.",
    from: "David Uy",
  },
  {
    id: 16,
    lead: "Screenshot confusing concepts and ask Claude to explain them.",
    body: "You're studying for a Claude exam — use Claude itself to study.",
    from: "David Uy",
  },
  {
    id: 17,
    lead: "Watch for near-identical answer choices.",
    body: "The exam text is readable; what's hard is spotting the one small but important difference between two similar options.",
    from: "David Uy",
  },
  {
    id: 18,
    lead: "Prepare mental resilience for test day.",
    body: "Expect quiet waiting periods before the exam starts — stay calm and lean on your preparation.",
    from: "Dondi Imperial",
  },
  {
    id: 19,
    lead: "Schedule your exam during your peak-performance hours.",
    body: "Avoid very early slots that leave you groggy going in.",
    from: "Dondi Imperial",
  },
  {
    id: 20,
    lead: "Master the essential vocabulary before your first mock.",
    body: "tool_choice, regex, ORM, PKCE, git worktrees, error codes (400 vs 503), and Glob vs. Grep show up constantly.",
    from: "Niclas Nabe",
  },
  {
    id: 21,
    lead: "CI/CD is one of the most heavily tested subtopics.",
    body: "Dan G estimates ~10 questions in his sitting came from CI/CD integration alone — don't skip it just because it sounds technical.",
    from: "Dan Galano",
  },
  {
    id: 22,
    lead: "Mix your mock exam sources.",
    body: "Different question banks phrase things differently, which builds real pattern recognition instead of memorized familiarity.",
    from: "Dan Galano",
  },
  {
    id: 23,
    lead: "Learn a simple tool mnemonic.",
    body: "Grep searches content, Glob searches filenames/patterns, Read opens a file, Edit changes it.",
    from: "Dan Galano",
  },
  {
    id: 24,
    lead: "Use the process of elimination.",
    body: "Strike through at least two options you believe are wrong on every question — it turns a guess into an informed one.",
    from: "John Aparri",
  },
  {
    id: 25,
    lead: "Budget time for a two-pass approach.",
    body: "Answer and flag on pass one, then revisit flagged questions with fresh eyes on pass two.",
    from: "John Aparri",
  },
  {
    id: 26,
    lead: 'Be suspicious of "upgrade the model" or "increase max tokens" options.',
    body: "They're almost always distractors — the exam rewards optimizing what you have.",
    from: "John Aparri",
  },
  {
    id: 27,
    lead: "Read every question as a comprehension test first, a knowledge test second.",
    body: "Several answers can look plausible — slow down on wording to find the one the question is actually after.",
    from: "LM Inocentes",
  },
  {
    id: 28,
    lead: "Expect the real exam to hit harder than the mock.",
    body: "Roughly 2x harder if you use Claude Code daily, closer to 3x if you don't. Budget your prep runway accordingly.",
    from: "LM Inocentes",
  },
  {
    id: 29,
    lead: "Prepare for all six scenario types.",
    body: "Customer support, code generation, multi-agent research, developer productivity, CI/CD, structured data extraction. The draw is random — skip none.",
    from: "Francis Plaza",
  },
  {
    id: 30,
    lead: "Budget real exam time generously.",
    body: "Plan ~1hr 20min including review for 60 questions in a 120-minute window — mock pacing (~30 min) undersells what you'll need.",
    from: "Francis Plaza",
  },
] as const satisfies readonly CertTip[];

/**
 * A tiny seeded PRNG (Mulberry32) — deterministic across runs and platforms,
 * unlike `Math.random()`. Used only to shuffle the cycle order, never to
 * pick something unconditionally random.
 */
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle of `0..n-1`, seeded by `cycle` so the same cycle
 * always produces the same order — the property the 30-day-uniqueness test
 * relies on. */
function shuffledIndices(n: number, cycle: number): number[] {
  const rand = mulberry32(cycle);
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }
  return indices;
}

/**
 * Date-seeded shuffled cycle: every one of the 30 tips appears once before
 * any repeat, and the order reshuffles (seeded by the cycle number) once a
 * full cycle completes. Manila-resolved, reusing this codebase's existing
 * `MANILA_ZONE` rather than adding a second timezone path.
 */
export function selectCertTipForDate(now: Date): CertTip {
  const manilaMidnightUtcMs = DateTime.fromJSDate(now, { zone: MANILA_ZONE })
    .startOf("day")
    .toUTC()
    .toMillis();
  const epochDay = Math.floor(manilaMidnightUtcMs / 86_400_000);
  const n = CERT_TIPS.length;
  const cycle = Math.floor(epochDay / n);
  const position = epochDay % n;
  const order = shuffledIndices(n, cycle);
  return CERT_TIPS[order[position]!]!;
}

/** Mirrors `renderMemberBucketsHtml`/`renderMemberBucketsPlain` (this
 * codebase's existing HTML/plain rendering-pair pattern, `standupBuckets.ts`):
 * one function per surface, both driven off the same data. */
export function renderCertTipHtml(tip: CertTip): string {
  const bodyPart = tip.body ? ` ${esc(tip.body)}` : "";
  return `💡 <b>${esc(tip.lead)}</b>${bodyPart}\n— <i>${esc(tip.from)}</i>`;
}

export function renderCertTipPlain(tip: CertTip): string {
  const bodyPart = tip.body ? ` ${tip.body}` : "";
  return `💡 ${tip.lead}${bodyPart}\n— ${tip.from}`;
}
