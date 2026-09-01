/**
 * Parses a task ref — `23` or `t23` (case-insensitive), issue #27's
 * command grammar — into its numeric task id. This is the foundation #32's
 * ref lists build on, so it lands here as a standalone unit shared by every
 * command that takes an id, rather than duplicated inline per handler.
 *
 * Rejects anything that isn't purely digits with an optional leading `t`:
 * trailing garbage (`23abc`), a bare `t` with no digits, id `0` (task ids
 * are 1-indexed), and anything past `Number.MAX_SAFE_INTEGER`.
 */
const TASK_REF_RE = /^t?(\d+)$/i;

export function parseTaskRef(raw: string): number | undefined {
  const match = TASK_REF_RE.exec(raw.trim());
  if (!match) return undefined;
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id < 1) return undefined;
  return id;
}
