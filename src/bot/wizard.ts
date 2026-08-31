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
    const state = await this.store.get(userId);
    if (!state) return undefined;
    if (this.isExpired(state)) {
      await this.store.delete(userId);
      return undefined;
    }
    return state;
  }

  isExpired(state: WizardState): boolean {
    return Date.now() - state.lastActivity > WIZARD_EXPIRY_MS;
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
