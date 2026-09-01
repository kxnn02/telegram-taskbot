import { parseTaskRef } from "./taskRef.js";

/**
 * One ref/status unit parsed out of a `/update`, `/done`, or `/complete`
 * batch (issue #27/#32). `ref` is `undefined` when the token didn't parse
 * as a task ref at all — the executor reports that as its own per-item
 * failure rather than aborting the whole batch. `statusText` is
 * `undefined` for `/done`/`/complete`, whose status is fixed by the
 * command rather than parsed per item; it's `""` (not `undefined`) when
 * `/update` expected a status word and got none.
 */
export interface BatchItem {
  label: string;
  ref: number | undefined;
  statusText: string | undefined;
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

/**
 * `/update`'s full batch grammar (issue #32): a single line of
 * comma-separated refs sharing one trailing status (`t21,t22 done`), a
 * single line of comma-separated `<ref> <status>` pairs with mixed
 * statuses (`t21 done, t22 review`), or newline-separated `<ref> <status>`
 * pairs. All three collapse to the same flat item list; a bare
 * `/update t21 done` is just the one-item case of this same grammar,
 * which is what keeps the single-item path identical to the batch path.
 */
export function parseUpdateItems(raw: string): BatchItem[] {
  return splitNonEmpty(raw, "\n").flatMap(parseUpdateLine);
}

function parseUpdateLine(line: string): BatchItem[] {
  const parts = splitNonEmpty(line, ",");
  if (parts.length === 0) return [];

  const last = parts[parts.length - 1]!;
  const spaceIdx = last.indexOf(" ");
  if (spaceIdx !== -1) {
    const lastRefToken = last.slice(0, spaceIdx);
    const statusText = last.slice(spaceIdx + 1);
    const othersAreBareRefs = parts.slice(0, -1).every((p) => parseTaskRef(p) !== undefined);
    if (othersAreBareRefs && parseTaskRef(lastRefToken) !== undefined) {
      // Format A: one trailing status governs the whole ref list.
      return [...parts.slice(0, -1), lastRefToken].map((token) => ({
        label: token,
        ref: parseTaskRef(token),
        statusText,
      }));
    }
  }

  // Format B: each comma segment carries its own ref and status.
  return parts.map((part) => {
    const idx = part.indexOf(" ");
    const refToken = idx === -1 ? part : part.slice(0, idx);
    return {
      label: refToken,
      ref: parseTaskRef(refToken),
      statusText: idx === -1 ? "" : part.slice(idx + 1),
    };
  });
}

function splitNonEmpty(raw: string, separator: string): string[] {
  return raw
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
