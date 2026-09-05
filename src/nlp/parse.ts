// Ported from DevieBot's `lib/nlp.ts` (DEVCONC4/DevieBot, lib/nlp.ts,
// verified against current `main` 2026-09-05 — 663 lines, matches the line
// numbers issue #102 cites) — the single most valuable file in DevieBot,
// four months of cohort tuning behind its edge cases. Ported as *behaviour*,
// not as a file copy, per the three decisions issue #102 records:
//
// 1. Due-date extraction is reimplemented over `src/date/parseDueDate`
//    (chrono-node + Manila timezone), not DevieBot's hand-rolled day/month
//    regexes — chrono already covers every case they hand-rolled (verified
//    directly against chrono-node's actual output, not assumed). Their
//    `stripPatternOutsideUrls` URL-safety guarantee is real and is kept,
//    reimplemented as `maskUrls` so a URL containing a date-like substring
//    (a path segment like "/4/23" or "/2026-09-05/") is never misread as a
//    deadline.
// 2. No event-grouping concept anywhere — DevieBot's per-event intents are
//    dropped entirely; this repo has no equivalent notion.
// 3. Every assignee here is a *raw, unresolved* name; roster resolution
//    happens at the stage-4 call site, never here.
import type { TaskPriority, TaskStatus } from "../domain/types.js";
import { parseDueDate } from "../date/parseDueDate.js";
import type { TextModel } from "./textModel.js";
import type { BulkTask, BulkUpdate, ParseMessageContext, ParsedIntent } from "./types.js";

// ── assignee / description folding ──────────────────────────────────────────

/** The last non-bot @mention in the text, lowercased — DevieBot's rule for
 * "who is this paragraph for" when the model/heuristic doesn't say. */
export function pickAssigneeFromText(text: string): string | null {
  const mentions = [...text.matchAll(/@(\w+)/g)].map((m) => m[1]!.toLowerCase());
  if (mentions.length === 0) return null;

  const filtered = mentions.filter((m) => !["deviethebot", "deviebot", "bot"].includes(m));
  const source = filtered.length > 0 ? filtered : mentions;
  return source[source.length - 1] ?? null;
}

export function appendDescription(base: string | null | undefined, extra: string): string {
  if (!base) return extra;
  return `${base}\n${extra}`;
}

interface FoldableBulkTask extends BulkTask {
  _isContextNote?: boolean;
}

/** A "Note:"/"FYI:" paragraph isn't its own task — it's context that folds
 * into the immediately preceding task for the same assignee. */
export function foldContextNotes(tasks: FoldableBulkTask[]): BulkTask[] {
  const folded: BulkTask[] = [];
  for (const task of tasks) {
    if (task._isContextNote && folded.length > 0) {
      const prev = folded[folded.length - 1]!;
      if (prev.assignee === task.assignee) {
        const noteBody = task.description ?? task.title;
        prev.description = appendDescription(prev.description, noteBody);
        continue;
      }
    }

    const { _isContextNote: _drop, ...clean } = task;
    folded.push(clean);
  }
  return folded;
}

// ── model JSON parsing ──────────────────────────────────────────────────────

/** Extracts a JSON array from a model response, tolerating a markdown
 * fence or stray prose around it. `null` on anything unparseable — never
 * throws, so every caller can degrade to its heuristic path. */
export function parseJsonArrayFromModel(raw: string): unknown[] | null {
  const trimmed = raw.trim();

  const attempts = [
    trimmed,
    trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim(),
  ];

  for (const candidate of attempts) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Keep trying other extraction paths.
    }
  }

  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start >= 0 && end > start) {
    const slice = trimmed.slice(start, end + 1);
    try {
      const parsed: unknown = JSON.parse(slice);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }

  return null;
}

// ── priority ─────────────────────────────────────────────────────────────

export function inferPriority(text: string): TaskPriority {
  const lower = text.toLowerCase();
  if (/\b(urgent|asap|immediately|critical|p0|p1)\b/.test(lower)) return "urgent";
  if (/\b(high\s+priority|high|important|priority\s*1)\b/.test(lower)) return "high";
  if (/\b(low\s+priority|low|whenever|nice\s+to\s+have)\b/.test(lower)) return "low";
  return "medium";
}

const VALID_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

// ── bulk-task sanitizing ─────────────────────────────────────────────────

export function sanitizeBulkTask(item: unknown, fallbackAssignee: string | null): BulkTask | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;

  const rawTitle = typeof record.title === "string" ? record.title.trim() : "";
  if (!rawTitle) return null;

  const rawAssignee =
    typeof record.assignee === "string" ? record.assignee.trim().toLowerCase() : "";
  const assignee = (rawAssignee || fallbackAssignee || "").trim();
  if (!assignee) return null;

  const rawPriority = typeof record.priority === "string" ? record.priority.toLowerCase() : "";
  const priority: TaskPriority = VALID_PRIORITIES.includes(rawPriority as TaskPriority)
    ? (rawPriority as TaskPriority)
    : inferPriority(rawTitle);

  const dueDate =
    typeof record.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.dueDate)
      ? record.dueDate
      : null;

  const description =
    typeof record.description === "string" && record.description.trim()
      ? record.description.trim()
      : null;

  const title = rawTitle.replace(/^(action\s*plan|note|fyi|task|update)\s*:\s*/i, "").trim();
  if (!title) return null;

  return { assignee, title, description, priority, dueDate };
}

export function sanitizeBulkTaskWithContext(
  item: unknown,
  fallbackAssignee: string | null,
): FoldableBulkTask | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const rawTitle = typeof record.title === "string" ? record.title.trim() : "";
  const isContextNote = /^\s*(note|fyi)\s*:/i.test(rawTitle);
  const normalized = sanitizeBulkTask(item, fallbackAssignee);
  if (!normalized) return null;
  if (isContextNote) return { ...normalized, _isContextNote: true };
  return normalized;
}

// ── due-date extraction ──────────────────────────────────────────────────

/** Gate — only attempt full date parsing when one of these appears (tested
 * against the URL-masked text, so a URL path segment can't trigger it). */
const DEADLINE_KEYWORDS =
  /\b(by|due|until|before|deadline|tomorrow|tmr|tmrw|tonight|today|tdy|next\s+week|next\s+\w+day|in\s+\d+\s+days?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

const URL_RE = /https?:\/\/\S+/g;

/** Replaces every URL with same-length filler so chrono can never match a
 * date-like substring inside one, while leaving every non-URL character's
 * position unchanged — a matched span's `index`/`text` from the masked
 * text is therefore still valid to cut out of the *original* text. */
export function maskUrls(text: string): string {
  return text.replace(URL_RE, (match) => " ".repeat(match.length));
}

/** Tidies up whatever's left after a deadline phrase is cut out: a
 * dangling leading preposition ("prepare ppt for" -> "prepare ppt"),
 * doubled-up whitespace, and a stray space before punctuation. */
export function cleanupDeadlineStrippedText(text: string): string {
  return text
    .replace(/\s+\b(by|due|until|before|for|on|at)\b\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
}

/**
 * Extracts a due date from natural-language text, Asia/Manila-resolved via
 * `src/date/parseDueDate` (chrono-node). Returns the ISO date plus the
 * text with the deadline phrase removed. `dueDate: null` and the original
 * text back, untouched, when no deadline keyword is present at all — the
 * gate keeps chrono from being invoked (and mis-firing on words like "now")
 * on ordinary text with no date-like phrase in it.
 */
export function extractDueDate(
  text: string,
  referenceDate: Date = new Date(),
): { dueDate: string | null; cleanText: string } {
  const masked = maskUrls(text);
  if (!DEADLINE_KEYWORDS.test(masked)) {
    return { dueDate: null, cleanText: text };
  }

  const parsed = parseDueDate(masked, referenceDate);
  if (!parsed) {
    return { dueDate: null, cleanText: text };
  }

  const before = text.slice(0, parsed.index);
  const after = text.slice(parsed.index + parsed.text.length);
  return { dueDate: parsed.isoDate, cleanText: cleanupDeadlineStrippedText(`${before}${after}`) };
}

// ── cleanTaskTitle ───────────────────────────────────────────────────────

/** Strips a deadline phrase and any priority-meta phrase ("urgent", "low
 * priority", "asap") out of raw task text, returning the cleaned title
 * alongside the inferred priority and extracted due date. */
export function cleanTaskTitle(
  text: string,
  referenceDate: Date = new Date(),
): { title: string; priority: TaskPriority; dueDate: string | null } {
  const { dueDate, cleanText } = extractDueDate(text, referenceDate);
  const withoutPriority = cleanText
    .replace(/\b(?:priority\s*[:=-]?\s*)?(urgent|high|medium|low)\s+priority\b/gi, "")
    .replace(/\bpriority\s*[:=-]?\s*(urgent|high|medium|low)\b/gi, "")
    .replace(/\b(urgent|high|medium|low)\b/gi, "")
    .replace(/\b(asap|immediately|critical|p0|p1)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s:,-]+/, "")
    .trim();

  return {
    title: withoutPriority || cleanText || text,
    priority: inferPriority(text),
    dueDate,
  };
}

// ── bulk tasks ───────────────────────────────────────────────────────────

const BULK_TASK_LABEL_STRIP_RE = /^(action\s*plan|note|fyi|task|update)\s*:\s*/i;

/** The no-model fallback `parseBulkTasks` degrades to — on a missing API
 * key, a garbage response, or the model throwing. Deterministic paragraph
 * splitting plus the same due-date/priority extraction the model path
 * grounds itself against. */
export function parseBulkTasksHeuristic(
  message: string,
  referenceDate: Date = new Date(),
): BulkTask[] {
  const fallbackAssignee = pickAssigneeFromText(message) ?? "unassigned";

  const withoutCmd = message
    .replace(/^\s*\/addtask(?:@\w+)?\s*/i, "")
    .replace(/@\w+/, "")
    .trim();

  const chunked = withoutCmd
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const paragraphs =
    chunked.length > 1
      ? chunked
      : withoutCmd
          .split(/(?=(?:^|\s)(?:Action\s*Plan|Note|FYI|Task|Update)\s*:)/i)
          .map((s) => s.trim())
          .filter(Boolean);

  const tasks: FoldableBulkTask[] = [];
  for (const paragraph of paragraphs) {
    const isContextNote = /^\s*(note|fyi)\s*:/i.test(paragraph);
    const cleaned = paragraph
      .replace(/^[-*•\d.)\s]+/, "")
      .replace(BULK_TASK_LABEL_STRIP_RE, "")
      .trim();
    if (!cleaned) continue;

    const { dueDate, cleanText } = extractDueDate(cleaned, referenceDate);
    const normalized = cleanText.trim();
    if (!normalized) continue;

    const sentenceSplit = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
    const titleRaw = (sentenceSplit[0] ?? normalized).replace(/[.!?]+$/, "").trim();
    const title = titleRaw.length > 70 ? `${titleRaw.slice(0, 67).trim()}...` : titleRaw;
    if (!title) continue;

    const description = sentenceSplit.length > 1 ? sentenceSplit.slice(1).join(" ").trim() : null;

    tasks.push({
      assignee: fallbackAssignee,
      title,
      description,
      priority: inferPriority(normalized),
      dueDate,
      _isContextNote: isContextNote,
    });
  }

  return foldContextNotes(tasks);
}

const BULK_TASKS_SYSTEM_PROMPT = (today: string) => `You are a task extractor for a project management bot.
The user will send text that assigns work to one or more people via @mentions.
Extract every actionable task and return ONLY a JSON array.
Today's date is ${today}.

SUPPORTED MESSAGE FORMATS:
1. Single @mention at top, multiple paragraphs below — each paragraph is a SEPARATE task for that person.
2. Multiple @mentions inline — one task per mention.
3. Bullet / numbered lists under a single @mention — each bullet is a separate task.

SKIP THESE — return []:
- Messages asking someone to add/post/update tasks in the chat.
- Conversational messages with no concrete deliverable.
- Messages where the @mention is tagging someone in a conversation, not assigning real project work.

EXTRACTION RULES:
- "assignee": @username without @, lowercase, first word only if full name.
- "title": concise action (max 70 chars). Strip label prefixes like "Action Plan:", "Note:", "FYI:", "Task:", "Update:".
- "description": any supporting context, details, or URLs within that paragraph beyond the main action verb phrase. Preserve URLs verbatim. null if nothing extra.
- "priority": "low"|"medium"|"high"|"urgent" — infer from urgency words, default "medium".
- "dueDate": YYYY-MM-DD if a deadline is mentioned, else null.
- Strip deadline phrases from title but keep them in dueDate.
- NEVER discard URLs — put them in description if not in title.
- Return ONLY a raw JSON array. No markdown, no explanation.`;

/**
 * Model-backed bulk-task extraction, grounded against the deterministic
 * heuristic for due dates (issue #102: prevents bulk-mode date
 * hallucination) whenever the model and heuristic agree on task count.
 * Falls back to `parseBulkTasksHeuristic` entirely on a garbage response,
 * an empty result, or the model throwing.
 */
export async function parseBulkTasks(
  message: string,
  model: TextModel,
  referenceDate: Date = new Date(),
): Promise<BulkTask[]> {
  const today = parseDueDate("today", referenceDate)?.isoDate ?? referenceDate.toISOString().slice(0, 10);
  let raw: string;
  try {
    raw = await model.complete({
      system: BULK_TASKS_SYSTEM_PROMPT(today),
      user: message,
      maxTokens: 2048,
    });
  } catch {
    return parseBulkTasksHeuristic(message, referenceDate);
  }

  const fallbackAssignee = pickAssigneeFromText(message) ?? "unassigned";
  const parsed = parseJsonArrayFromModel(raw);
  if (parsed) {
    const normalized = parsed
      .map((item) => sanitizeBulkTaskWithContext(item, fallbackAssignee))
      .filter((task): task is FoldableBulkTask => task !== null);
    const folded = foldContextNotes(normalized);
    if (folded.length > 0) {
      const heuristic = parseBulkTasksHeuristic(message, referenceDate);
      if (heuristic.length === folded.length) {
        return folded.map((task, idx) => ({
          ...task,
          dueDate: heuristic[idx]?.dueDate ?? task.dueDate ?? null,
        }));
      }
      return folded;
    }
  }

  return parseBulkTasksHeuristic(message, referenceDate);
}

// ── bulk updates ─────────────────────────────────────────────────────────

const VALID_STATUSES: TaskStatus[] = ["backlog", "todo", "in_progress", "in_review", "blocked", "done"];

const BULK_UPDATES_SYSTEM_PROMPT = `You extract task status update pairs from a message.
Return ONLY a JSON array of objects with:
- "taskRef": a short keyword or number identifying the task (e.g. "login bug", "deploy app", "23")
- "status": one of: backlog | todo | in_progress | in_review | blocked | done

Map natural language to status values:
- "done" / "finished" / "completed" / "shipped" / "wrapped up" -> done
- "working on" / "started" / "in progress" / "wip" / "picking up" -> in_progress
- "in review" / "reviewing" / "up for review" / "ready for review" -> in_review
- "blocked" / "stuck" / "waiting for" / "held up" -> blocked
- "todo" / "not started" / "will do" -> todo
- "backlog" / "parked" -> backlog

Handle both formats:
- Structured: "done: login bug, deploy app" or "login -> done, docs -> in review"
- Natural: "finished login bug and docs is now in review"

Return ONLY raw JSON array, no markdown, no explanation.`;

/**
 * Extracts `{ taskRef, status }` pairs from a message. Unlike DevieBot's
 * original (which trusted the model's `status` string as-is), every item
 * here is validated against our six-value `TaskStatus` enum and dropped if
 * it doesn't match — a hallucinated status word never reaches the caller.
 */
export async function parseBulkUpdates(message: string, model: TextModel): Promise<BulkUpdate[]> {
  let raw: string;
  try {
    raw = await model.complete({
      system: BULK_UPDATES_SYSTEM_PROMPT,
      user: message,
      maxTokens: 512,
    });
  } catch {
    return [];
  }

  const parsed = parseJsonArrayFromModel(raw);
  if (!parsed) return [];

  const updates: BulkUpdate[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const taskRef = typeof record.taskRef === "string" ? record.taskRef.trim() : "";
    const status = typeof record.status === "string" ? record.status : "";
    if (!taskRef || !VALID_STATUSES.includes(status as TaskStatus)) continue;
    updates.push({ taskRef, status: status as TaskStatus });
  }
  return updates;
}

// ── parseStatus ──────────────────────────────────────────────────────────

const PARSE_STATUS_SYSTEM_PROMPT = `Map the following text to exactly one task status enum value.
Return ONLY one of these exact strings with no quotes and no extra words:
  backlog | todo | in_progress | in_review | blocked | done
If the text does not clearly indicate a task status, return exactly: null`;

export async function parseStatus(text: string, model: TextModel): Promise<TaskStatus | null> {
  let raw: string;
  try {
    raw = await model.complete({ system: PARSE_STATUS_SYSTEM_PROMPT, user: text, maxTokens: 20 });
  } catch {
    return null;
  }
  return VALID_STATUSES.includes(raw as TaskStatus) ? (raw as TaskStatus) : null;
}

// ── parseMessage ─────────────────────────────────────────────────────────

function parseMessageSystemPrompt(today: string, context: ParseMessageContext): string {
  const tasksContext = context.recentTasks.length
    ? `Recent tasks:\n${context.recentTasks
        .slice(0, 20)
        .map((t) => `- [#${t.id}] "${t.title}" (${t.status})`)
        .join("\n")}`
    : "No recent tasks.";

  return `You are the intent parser for a task management bot.
Extract the user's intent from their message and return ONLY valid JSON.
Today's date is ${today}.

${tasksContext}

Possible intents and their JSON shapes:
- Add a task: {"intent":"addtask","title":"<task title>","priority":"low|medium|high|urgent","assignedTo":"<username without @ or null>","dueDate":"<YYYY-MM-DD or null>"}
- Update task status: {"intent":"update","taskId":<task number from the list above, or null>,"status":"backlog|todo|in_progress|in_review|blocked|done"}
- Mark task done: {"intent":"done","taskId":<task number from the list above, or null>}
- Show standup report: {"intent":"standup"}
- List all tasks: {"intent":"tasks"}
- Show help: {"intent":"help"}
- Unclear/chitchat: {"intent":"unknown","reply":"<friendly short reply>"}

Rules:
- The user may use slash commands like /addtask, /update, /done as hints — treat them accordingly.
- Extract the task title cleanly, stripping out priority/assignee/deadline phrases from it.
- If no priority mentioned, default to "medium".
- If no assignee (@mention) present, omit assignedTo or set to null.
- Extract due date from natural language and convert to YYYY-MM-DD format. If no deadline mentioned, set dueDate to null.
- Task references come in several equivalent forms, all meaning the same numeric id: "task 23", "#23", "23", "t23", "T23", "T-023". Whenever the message references a task this way, strip any "t"/"T"/"T-"/"#" prefix and leading zeros to get the number, and use that exact number as taskId if it appears in the recent-tasks list above (e.g. "/done t3" against a list containing "[#3] ..." means taskId 3 — do not return null just because the reference used a "t" prefix instead of a bare number).
- If the user references a task by partial title instead of a number, find the closest match from recent tasks above and use its exact number as taskId.
- If the intent is clearly a status update but no task matches recent tasks, still return the update intent with taskId set to null.
- Only use intent:"unknown" for genuine chitchat with zero task/project relevance.
- Always return ONLY raw JSON, no markdown, no explanation.`;
}

const DEFAULT_UNKNOWN_REPLY = "I didn't quite understand that. Try /help to see what I can do.";

/** Top-level intent router. On a garbage response or the model throwing,
 * degrades to `{ intent: "unknown" }` rather than crashing the caller. */
export async function parseMessage(
  message: string,
  model: TextModel,
  context: ParseMessageContext,
  referenceDate: Date = new Date(),
): Promise<ParsedIntent> {
  const today =
    parseDueDate("today", referenceDate)?.isoDate ?? referenceDate.toISOString().slice(0, 10);

  let raw: string;
  try {
    raw = await model.complete({
      system: parseMessageSystemPrompt(today, context),
      user: message,
      maxTokens: 256,
    });
  } catch {
    return { intent: "unknown", reply: DEFAULT_UNKNOWN_REPLY };
  }

  try {
    return JSON.parse(raw) as ParsedIntent;
  } catch {
    return { intent: "unknown", reply: DEFAULT_UNKNOWN_REPLY };
  }
}
