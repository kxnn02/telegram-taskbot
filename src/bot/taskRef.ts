/**
 * Parses a task ref — `23`, `t23`, or the hyphenated `T-001` form Devie's
 * task numbers use (issue #101, case-insensitive, hyphen only ever follows
 * a `t`) — into its numeric task id. This is the foundation #32's ref lists
 * build on, so it lands here as a standalone unit shared by every command
 * that takes an id, rather than duplicated inline per handler.
 *
 * Rejects anything that isn't digits with an optional leading `t`/`t-`:
 * trailing garbage (`23abc`), a bare `t` or `t-` with no digits, id `0`
 * (task ids are 1-indexed), a bare hyphen with no `t` (`-23`), and anything
 * past `Number.MAX_SAFE_INTEGER`.
 */
const TASK_REF_RE = /^(?:t-?)?(\d+)$/i;

export function parseTaskRef(raw: string): number | undefined {
  const match = TASK_REF_RE.exec(raw.trim());
  if (!match) return undefined;
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id < 1) return undefined;
  return id;
}

/** Formats a task id as Devie's `T-001` display form (issue #101): zero-
 * padded to 3 digits, `T-` prefixed. Ids above 999 render unpadded
 * (`T-1000`) rather than truncated. */
export function formatTaskRef(id: number): string {
  return `T-${String(id).padStart(3, "0")}`;
}
