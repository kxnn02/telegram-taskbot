export type WizardKind = "assign" | "edit";

export type WizardStep =
  | "awaiting_assignee"
  | "awaiting_title"
  | "awaiting_description"
  | "awaiting_due_date"
  | "awaiting_due_date_confirm";

export interface WizardData {
  assigneeUsername?: string;
  title?: string;
  description?: string;
  dueDate?: string; // set once the Yes/No confirmation is accepted
  pendingDueDate?: { isoDate: string; friendly: string };
  /** Only present for /edit — the task being edited. */
  taskId?: number;
  /** For /edit: which fields the wizard is walking through (assignee is
   * optional there, since editing doesn't force reassignment). */
  fieldsToCollect?: WizardStep[];
}

export interface WizardState {
  kind: WizardKind;
  step: WizardStep;
  data: WizardData;
  lastActivity: number;
}

export const WIZARD_EXPIRY_MS = 20 * 60 * 1000; // ~20 minutes, PRD §6

/** Per-user (DM chat === user, so keyed by Telegram user id) in-progress
 * wizard state for the assignment and edit flows. Deliberately a plain
 * in-memory map, not persisted — a restart losing an in-progress wizard is
 * an acceptable v1 tradeoff given cohort scale and the auto-expiry design
 * already treating abandonment as normal. */
export class WizardManager {
  private readonly states = new Map<number, WizardState>();

  get(userId: number): WizardState | undefined {
    const state = this.states.get(userId);
    if (!state) return undefined;
    if (this.isExpired(state)) {
      this.states.delete(userId);
      return undefined;
    }
    return state;
  }

  isExpired(state: WizardState): boolean {
    return Date.now() - state.lastActivity > WIZARD_EXPIRY_MS;
  }

  start(userId: number, kind: WizardKind, initial: WizardData = {}): WizardState {
    const step: WizardStep =
      kind === "assign" ? "awaiting_assignee" : "awaiting_title";
    const state: WizardState = {
      kind,
      step,
      data: initial,
      lastActivity: Date.now(),
    };
    this.states.set(userId, state);
    return state;
  }

  update(userId: number, patch: Partial<WizardState>): WizardState | undefined {
    const state = this.get(userId);
    if (!state) return undefined;
    const next: WizardState = {
      ...state,
      ...patch,
      data: { ...state.data, ...patch.data },
      lastActivity: Date.now(),
    };
    this.states.set(userId, next);
    return next;
  }

  cancel(userId: number): boolean {
    return this.states.delete(userId);
  }

  has(userId: number): boolean {
    return this.get(userId) !== undefined;
  }
}
