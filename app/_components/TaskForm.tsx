"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./icons";

/**
 * Shared create/edit task form (Phase 6.2, issue #17). A faithful port of
 * `dashboardServer.ts`'s `taskFormBody`/confirm-step flow into a Client
 * Component that calls the new REST mutation routes via `fetch`, per
 * ADR-0008 (REST, not Server Actions). Two-step interaction preserved from
 * the Express dashboard: due-date text is parsed server-side
 * (`POST /api/tasks/parse-due-date`, reusing the same `parseDueDate` the
 * bot's wizard uses) and echoed back for confirmation before the actual
 * create/edit call fires — never trusts the natural-language parse
 * silently, same as the bot and the old dashboard.
 */

export interface TaskFormFields {
  assigneeUsername: string;
  title: string;
  description: string;
  dueDateText: string;
}

export interface TaskFormProps {
  mode: "create" | "edit";
  taskId?: number;
  interns: string[];
  initial?: Partial<TaskFormFields>;
}

type Step =
  | { kind: "form"; error?: string }
  | { kind: "confirm"; isoDate: string; friendly: string };

export function TaskForm({ mode, taskId, interns, initial }: TaskFormProps) {
  const router = useRouter();
  const [fields, setFields] = useState<TaskFormFields>({
    assigneeUsername: initial?.assigneeUsername ?? "",
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    dueDateText: initial?.dueDateText ?? "",
  });
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [pending, setPending] = useState(false);

  async function handleParseSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      const res = await fetch("/api/tasks/parse-due-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fields.dueDateText }),
      });
      const data = (await res.json()) as
        | { ok: true; isoDate: string; friendly: string }
        | { ok: false; error: string };
      if (!data.ok) {
        setStep({ kind: "form", error: data.error });
        return;
      }
      setStep({ kind: "confirm", isoDate: data.isoDate, friendly: data.friendly });
    } finally {
      setPending(false);
    }
  }

  async function handleConfirm(isoDate: string) {
    setPending(true);
    try {
      const payload = {
        assigneeUsername: fields.assigneeUsername,
        title: fields.title,
        description: fields.description,
        dueDate: isoDate,
      };
      const res = await fetch(mode === "create" ? "/api/tasks" : `/api/tasks/${taskId}`, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok: true } | { ok: false; error: string };
      if (!data.ok) {
        setStep({ kind: "form", error: data.error });
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (step.kind === "confirm") {
    return (
      <section className="panel" style={{ maxWidth: 720 }}>
        <div className="panel-head">
          <h2 style={{ color: "#0F172A" }}>Confirm due date</h2>
        </div>
        <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            style={{
              display: "flex",
              gap: 14,
              alignItems: "center",
              background: "#E4EEFE",
              borderRadius: 14,
              padding: "16px 18px",
            }}
          >
            <span style={{ color: "#1A5FCC", display: "flex" }}>
              <Icon name="calendar" size={22} />
            </span>
            <div>
              <div style={{ font: "700 17px/24px var(--font-sans)", color: "#1A5FCC" }}>
                That&rsquo;s {step.friendly}.
              </div>
              <div style={{ font: "var(--md3-body-md)", color: "#1A5FCC", opacity: 0.8 }}>
                {mode === "create" ? "Save this task?" : `Save these changes${taskId ? ` to Task ${taskId}` : ""}?`}
              </div>
            </div>
          </div>
          <div style={{ paddingTop: 8 }}>
            <SummaryRow label="Assignee" value={`@${fields.assigneeUsername}`} />
            <SummaryRow label="Title" value={fields.title} />
            <SummaryRow label="Description" value={fields.description} />
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", paddingTop: 20 }}>
            <button
              type="button"
              className="btn primary"
              style={{ background: "#4263EB", color: "#fff", border: 0, cursor: "pointer" }}
              disabled={pending}
              onClick={() => handleConfirm(step.isoDate)}
            >
              {mode === "create" ? "Yes, create task" : "Yes, save changes"}
            </button>
            <button
              type="button"
              className="btn secondary"
              style={{ cursor: "pointer" }}
              disabled={pending}
              onClick={() => setStep({ kind: "form" })}
            >
              No, start over
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel" style={{ maxWidth: 820 }}>
      <div className="panel-head">
        <h2 style={{ color: "#0F172A" }}>{mode === "create" ? "New task" : "Edit task"}</h2>
        {mode === "edit" && taskId ? (
          <span className="id" style={{ fontSize: 14 }}>
            #{taskId}
          </span>
        ) : null}
      </div>
      <form
        onSubmit={handleParseSubmit}
        style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 20 }}
      >
        {step.error ? <div style={{ font: "var(--md3-body-md)", color: "#C2363B" }}>{step.error}</div> : null}
        <div className="field">
          <label htmlFor="assigneeUsername">Assignee</label>
          <div className="input">
            <select
              id="assigneeUsername"
              required
              value={fields.assigneeUsername}
              onChange={(e) => setFields((f) => ({ ...f, assigneeUsername: e.target.value }))}
            >
              <option value="" disabled>
                Choose an assignee
              </option>
              {interns.map((username) => (
                <option key={username} value={username}>
                  @{username}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="title">Title</label>
          <div className="input">
            <input
              id="title"
              type="text"
              placeholder="Short, specific title"
              required
              value={fields.title}
              onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="description">Description</label>
          <div className="input area">
            <textarea
              id="description"
              placeholder="What does done look like?"
              required
              value={fields.description}
              onChange={(e) => setFields((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="dueDateText">Due date</label>
          <div className="hint">Plain English works &mdash; &ldquo;next Friday&rdquo;, &ldquo;in 3 days&rdquo;, &ldquo;Sept 5&rdquo;.</div>
          <div className="input">
            <input
              id="dueDateText"
              type="text"
              placeholder="next Friday"
              required
              value={fields.dueDateText}
              onChange={(e) => setFields((f) => ({ ...f, dueDateText: e.target.value }))}
            />
            <span style={{ color: "#94A3B8", display: "flex" }}>
              <Icon name="calendar" size={18} />
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", paddingTop: 4 }}>
          <button
            type="submit"
            className="btn primary"
            style={{ background: "#4263EB", color: "#fff", border: 0, cursor: "pointer" }}
            disabled={pending}
          >
            Continue
          </button>
          <a className="btn ghost" href="/">
            Back to dashboard
          </a>
        </div>
      </form>
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 16, padding: "12px 0", borderBottom: "1px solid #E2E8F0" }}>
      <div style={{ width: 120, flex: "none", font: "var(--md3-label-lg)", color: "#94A3B8" }}>{label}</div>
      <div style={{ font: "var(--md3-body-lg)", color: "#0F172A" }}>{value}</div>
    </div>
  );
}
