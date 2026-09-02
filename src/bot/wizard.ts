import type { WizardStateStorePort } from "../storage/wizardStateStorePort.js";

export type WizardKind = "assign" | "edit";

export type WizardStep =
  | "awaiting_field_choice"
  | "awaiting_assignee"
  | "awaiting_title"
  | "awaiting_description"
  | "awaiting_due_date"
  | "awaiting_due_date_confirm";

export type EditField = "assignee" | "title" | "description" | "dueDate";

export interface WizardData {
  assigneeUsername?: string;
  title?: string;
  description?: string;
  dueDate?: string; // set once the Yes/No confirmation is accepted
  pendingDueDate?: { isoDate: string; friendly: string };
  /** Only present for /edit — the task being edited. */
  taskId?: number;
  /** Only present for /edit — which single field this edit wizard is
   * collecting, chosen via the field-choice menu. */
  editField?: EditField;
  /** The chat the form was started in (issue #52/#53, finding F3). Wizard
   * input — free-text answers, the interruption auto-cancel, and the
   * editfield/duedate callbacks — is only accepted from this chat, so an
   * in-progress form in one chat doesn't eat unrelated messages the same
   * user sends elsewhere. `undefined` matches any chat, so wizard rows
   * already in the database when this deploys keep working. */
  chatId?: number;
}

export interface WizardState {
  kind: WizardKind;
  step: WizardStep;
  data: WizardData;
  lastActivity: number;
}

export const WIZARD_EXPIRY_MS = 20 * 60 * 1000; // ~20 minutes, PRD §6

/** Per-user (DM chat === user, so keyed by Telegram user id) in-progress
 * wizard state for the assignment and edit flows. Backed by a
 * `WizardStateStorePort` (ADR-0006) — a real Vercel serverless deployment
 * has no long-lived process memory to hold this in, since a different
 * disposable Lambda invocation can handle each message mid-wizard. */
export class WizardManager {
  constructor(private readonly store: WizardStateStorePort) {}

  async get(userId: number): Promise<WizardState | undefined> {
    if (await this.takeExpired(userId)) return undefined;
    return this.store.get(userId);
  }

  isExpired(state: WizardState): boolean {
    return Date.now() - state.lastActivity > WIZARD_EXPIRY_MS;
  }

  /** Reports whether `userId` had a wizard that has just expired, deleting
   * it as a side effect (issue #63, finding H7). Returns `true` exactly
   * once per expiry — a user with no wizard at all, or a still-live one,
   * gets `false`. `get` delegates to this so the two never disagree about
   * what "expired" means. Reads the store directly (not through `get`) so
   * it can observe the row before it's deleted. */
  async takeExpired(userId: number): Promise<boolean> {
    const state = await this.store.get(userId);
    if (!state || !this.isExpired(state)) return false;
    await this.store.delete(userId);
    return true;
  }

  async start(userId: number, kind: WizardKind, initial: WizardData = {}): Promise<WizardState> {
    const step: WizardStep =
      kind === "assign" ? "awaiting_assignee" : "awaiting_field_choice";
    const state: WizardState = {
      kind,
      step,
      data: initial,
      lastActivity: Date.now(),
    };
    await this.store.set(userId, state);
    return state;
  }

  async update(userId: number, patch: Partial<WizardState>): Promise<WizardState | undefined> {
    const state = await this.get(userId);
    if (!state) return undefined;
    const next: WizardState = {
      ...state,
      ...patch,
      data: { ...state.data, ...patch.data },
      lastActivity: Date.now(),
    };
    await this.store.set(userId, next);
    return next;
  }

  async cancel(userId: number): Promise<boolean> {
    return this.store.delete(userId);
  }

  async has(userId: number): Promise<boolean> {
    return (await this.get(userId)) !== undefined;
  }
}
