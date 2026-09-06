import { parseTaskRef } from "./taskRef.js";

/**
 * One ref/status unit parsed out of a `/update`, `/done`, or `/complete`
 * batch (issue #27/#32). `ref` is `undefined` when the token didn't parse
 * as a task ref at all — the executor reports that as its own per-item
 * failure rather than aborting the whole batch. `statusText` is
 * `undefined` for `/done`/`/complete`, whose status is fixed by the
 * command rather than parsed per item.
 *
 * `link` and `note` ride along from `/update`'s `link:<url>` /
 * `note:<text>` suffixes (issue #103 item 6) and are attached to the task
 * once the status change succeeds.
 */
export interface BatchItem {
  label: string;
  ref: number | undefined;
  statusText: string | undefined;
  link?: string;
  note?: string;
}

/** `/done 21,22,23`, `/complete t21, t22` — a bare comma-separated ref
 * list, no per-item status text (issue #32). */
export function parseRefListItems(raw: string): BatchItem[] {
  return splitNonEmpty(raw, ",").map((token) => ({
    label: token,
    ref: parseTaskRef(token),
    statusText: undefined,
  }));
}

// ---- Devie's /update grammar (issue #103 item 6) -------------------------
// Ported from `DEVCONC4/DevieBot` @ `632a22c`,
// `app/api/telegram/webhook/route.ts:307-412`. Copied behaviour-for-
// behaviour, warts included (#103 rule 2) — the specific ones are called
// out on each function below.

/** Devie's status vocabulary for *splitting* a segment into ref and status
 * (`route.ts:307`). Deliberately not the same table as
 * `statusParse.ts`'s `STATUS_WORDS`, which is what finally *maps* a status
 * word to a stored value: this one only has to be good enough to find the
 * boundary between the ref and the status text. Note `in[\s_-]+review`
 * requires a separator, so "inreview" is not a tail match — Devie rejects
 * that spelling explicitly, telling the user to say "review". */
const STATUS_TAIL_PATTERN =
  "(?:backlog|todo|in[\\s_-]*progress|progress|in[\\s_-]+review|review|blocked|done|complete|finished)";

/**
 * Pulls a trailing ` link:<url>` off `input` (`route.ts:316`). The leading
 * `\s+` is Devie's and is copied as-is: a `link:` that starts the string is
 * not recognised. Only `http`/`https` URLs match.
 */
export function extractLink(input: string): { text: string; link?: string } {
  const match = input.match(/\s+link:(https?:\/\/\S+)/i);
  if (match) return { text: input.slice(0, match.index).trim(), link: match[1] };
  return { text: input };
}

/**
 * Pulls both a ` link:<url>` (anywhere) and a trailing ` note:<text>` off
 * `input` (`route.ts:322`). The link is stripped first, which is what makes
 * the `note: ... link: ...` order work as well as `link: ... note: ...`.
 * An empty `note:` yields no note.
 */
export function extractMeta(input: string): { text: string; link?: string; note?: string } {
  let text = input.trim();

  const linkMatch = text.match(/\s+link:(https?:\/\/\S+)/i);
  const link = linkMatch?.[1];
  if (linkMatch) {
    text = text.replace(linkMatch[0], "").trim();
  }

  const noteMatch = text.match(/\s+note:\s*(.+)$/i);
  if (noteMatch) {
    const note = noteMatch[1]!.trim();
    return {
      text: text.slice(0, noteMatch.index).trim(),
      link,
      note: note || undefined,
    };
  }
  return { text, link };
}

export interface UpdateSpec {
  ref: string;
  statusRaw: string;
  link?: string;
  note?: string;
}

/**
 * Splits one segment into a ref and a status (`route.ts:343`), after
 * stripping any link/note off it. Three shapes, tried in order: a trailing
 * status word (`t21 done`), a leading one (`done T-233`), then a plain
 * "first token is the ref, the rest is the status text" fallback so an
 * unrecognised status still reaches the status mapper as a reportable
 * error. `null` when the segment is empty or is a bare ref with nothing
 * after it.
 */
export function splitRefAndStatus(segment: string): UpdateSpec | null {
  const { text: part, link, note } = extractMeta(segment.trim());
  if (!part) return null;

  const tail = part.match(new RegExp(`^(.*?)\\s+(${STATUS_TAIL_PATTERN})$`, "i"));
  if (tail) {
    const ref = tail[1]!.trim();
    const statusRaw = tail[2]!.trim();
    if (!ref || !statusRaw) return null;
    return { ref, statusRaw, link, note };
  }

  // "done T-233" — status word first, ref after
  const head = part.match(new RegExp(`^(${STATUS_TAIL_PATTERN})\\s+(.+)$`, "i"));
  if (head) {
    const statusRaw = head[1]!.trim();
    const ref = head[2]!.trim();
    if (!ref || !statusRaw) return null;
    return { ref, statusRaw, link, note };
  }

  const tokens = part.split(/\s+/);
  if (tokens.length < 2) return null;
  return {
    ref: tokens[0]!,
    statusRaw: tokens.slice(1).join(" "),
    link,
    note,
  };
}

/**
 * `/update`'s full grammar (`route.ts:374`). A segment with no comma or
 * newline is the single-item case. Otherwise every comma/newline-separated
 * item is tried independently first — `t21 done, t22 review` — and only if
 * *every* one of them parses is that reading used. Failing that, one shared
 * status is applied to the whole ref list, either trailing
 * (`t21,t22,t23 done`) or leading (`done t21,t22,t23`); Devie supports no
 * link/note in that shortcut, and neither does this.
 *
 * Devie's wart, copied: when neither the per-item nor the shared-status
 * reading covers everything, the per-item results are returned with the
 * unparseable segments silently dropped, so `t21 done, t22` updates t21 and
 * says nothing about t22.
 */
export function parseUpdateSpecs(raw: string): UpdateSpec[] {
  const input = raw.trim();
  if (!input) return [];

  if (!input.includes(",") && !input.includes("\n")) {
    return [splitRefAndStatus(input)].filter((spec): spec is UpdateSpec => spec !== null);
  }

  const rawParts = input
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const perItem = rawParts.map(splitRefAndStatus);
  if (perItem.length > 0 && perItem.every((spec): spec is UpdateSpec => spec !== null)) {
    return perItem;
  }

  const trailing = input.match(new RegExp(`^(.+?)\\s+(${STATUS_TAIL_PATTERN})$`, "i"));
  if (trailing) {
    const refs = trailing[1]!
      .split(/[\n,]+/)
      .map((r) => r.trim())
      .filter(Boolean);
    if (refs.length > 0) {
      const statusRaw = trailing[2]!.trim();
      return refs.map((ref) => ({ ref, statusRaw }));
    }
  }

  const leading = input.match(new RegExp(`^(${STATUS_TAIL_PATTERN})\\s+(.+)$`, "i"));
  if (leading) {
    const refs = leading[2]!
      .split(/[\n,]+/)
      .map((r) => r.trim())
      .filter(Boolean);
    if (refs.length > 0) {
      const statusRaw = leading[1]!.trim();
      return refs.map((ref) => ({ ref, statusRaw }));
    }
  }

  return perItem.filter((spec): spec is UpdateSpec => spec !== null);
}

/**
 * `/update`'s batch items, built on Devie's `parseUpdateSpecs` since issue
 * #103 item 6 — the single-item case is just the one-spec case of the same
 * grammar, which is what keeps the single path identical to the batch path.
 * A ref string that isn't a valid task ref becomes `ref: undefined` so the
 * executor can report it per item instead of aborting the batch.
 */
export function parseUpdateItems(raw: string): BatchItem[] {
  return parseUpdateSpecs(raw).map((spec) => ({
    label: spec.ref,
    ref: parseTaskRef(spec.ref),
    statusText: spec.statusRaw,
    link: spec.link,
    note: spec.note,
  }));
}

function splitNonEmpty(raw: string, separator: string): string[] {
  return raw
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
