/**
 * Typo-tolerant username suggestion for the /assign and /edit wizards'
 * "who is this task for?" step (issue #8). Pure and independently
 * unit-testable — no roster/DB/bot dependency — so the wizard step handler
 * in createBot.ts only needs to pass it the caller's cohort roster of
 * intern usernames.
 */

/** Levenshtein edit distance (case-insensitive) between two strings:
 * the minimum number of single-character insertions, deletions, or
 * substitutions to turn one into the other. */
export function levenshteinDistance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const rows = s.length + 1;
  const cols = t.length + 1;
  const dp: number[][] = Array.from({ length: rows }, (_, i) =>
    new Array<number>(cols).fill(0).map((_v, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      const row = dp[i]!;
      const prevRow = dp[i - 1]!;
      row[j] = Math.min(
        prevRow[j]! + 1, // deletion
        row[j - 1]! + 1, // insertion
        prevRow[j - 1]! + cost, // substitution
      );
    }
  }
  return dp[rows - 1]![cols - 1]!;
}

/** Threshold chosen per issue #8's design guidance: a Levenshtein distance
 * of up to 2 catches the common typo shapes for short Telegram usernames
 * (one substitution, one dropped/extra/swapped character, or two of those
 * combined) without drifting into suggesting an unrelated name — cohort
 * usernames are short (first names / handles), so a wider threshold risks
 * false positives among ~8 candidates. */
const MAX_SUGGESTION_DISTANCE = 2;

/**
 * Suggests the single closest candidate username to a mistyped input, or
 * `undefined` when there's nothing worth suggesting: no candidate within
 * the distance threshold, more than one candidate tied for closest
 * (ambiguous — never guess), or the input already matches a candidate
 * exactly. Callers pass only the candidates the suggestion is allowed to
 * point at (e.g. the caller's own cohort's interns), so this never
 * suggests a different cohort or a higher-up.
 */
export function suggestClosestUsername(
  input: string,
  candidates: string[],
): string | undefined {
  const normalizedInput = input.trim().replace(/^@/, "").toLowerCase();
  if (candidates.length === 0) return undefined;

  let best: string | undefined;
  let bestDistance = Infinity;
  let tied = false;

  for (const candidate of candidates) {
    const distance = levenshteinDistance(normalizedInput, candidate);
    if (distance === 0) return undefined; // already an exact match
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance) {
      tied = true;
    }
  }

  if (bestDistance > MAX_SUGGESTION_DISTANCE || tied) return undefined;
  return best;
}
