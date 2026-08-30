import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const require = createRequire(import.meta.url);
// Imported via createRequire rather than a static ESM import: some bundlers
// (Vite/vitest included) don't yet recognize "node:sqlite" as a Node
// built-in and mis-resolve the static specifier. require() sidesteps that.
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
export type { DatabaseSyncType as DatabaseSync };

/**
 * Creates (or opens) the SQLite database and ensures the schema exists.
 * Pass ":memory:" for tests, a file path for real use.
 */
export function openDatabase(path: string): DatabaseSyncType {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER NOT NULL,
      cohort_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      assignee_username TEXT NOT NULL,
      assigned_by_username TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL,
      blocked INTEGER NOT NULL DEFAULT 0,
      blocked_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (cohort_id, id)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      note_id INTEGER PRIMARY KEY AUTOINCREMENT,
      cohort_id TEXT NOT NULL,
      task_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      author_username TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cohort_counters (
      cohort_id TEXT PRIMARY KEY,
      next_id INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS registrations (
      telegram_user_id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      registered_at TEXT NOT NULL
    );
  `);
  return db;
}
