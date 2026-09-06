"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertCircle, CalendarDays, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { visibleTagChips } from "@/src/web/tagChips";
import type { BoardTask } from "./types";

/**
 * Port of DevieBot's `components/kanban/task-card.tsx` (issue #105 sub-stage
 * 5b) — title, description preview, priority badge for high/urgent, due
 * date with overdue/due-today styling, tag chips via `visibleTagChips`, and
 * a drag handle via `useSortable`. Simpler than Devie's own card in one
 * deliberate way: this repo's `Task.assigneeUsername` is a plain string, not
 * a `Member`/`assignees[]` object, so the assignee is rendered as
 * `@username` directly rather than routed through `memberColor`/
 * `memberShortLabel` — those still exist, are tested, and are used in
 * `task-dialog.tsx`'s member-independent color badge below the tag picker.
 */

const PRIORITY_STYLES: Record<string, { label: string; hex: string }> = {
  high: { label: "High", hex: "#f97316" },
  urgent: { label: "Urgent", hex: "#ef4444" },
};

function isOverdue(task: BoardTask): boolean {
  if (task.status === "done") return false;
  return new Date(task.dueDate) < new Date(new Date().toDateString());
}

function isDueToday(task: BoardTask): boolean {
  const today = new Date().toDateString();
  return new Date(task.dueDate).toDateString() === today;
}

export function TaskCard({ task, onClick }: { task: BoardTask; onClick: (task: BoardTask) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const priority = PRIORITY_STYLES[task.priority];
  const overdue = isOverdue(task);
  const dueToday = isDueToday(task);
  const { visible: visibleTags, overflowCount } = visibleTagChips(task.tags);

  return (
    <div ref={setNodeRef} style={style} className={cn("group", isDragging && "opacity-40")}>
      <div
        className="cursor-pointer rounded-xl p-3 transition-all"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        onClick={() => onClick(task)}
      >
        <div className="flex items-start gap-2">
          <button
            {...attributes}
            {...listeners}
            type="button"
            className="mt-0.5 shrink-0 cursor-grab text-muted-foreground opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-40"
            style={{ background: "none", border: "none", padding: 0 }}
            onClick={(e) => e.stopPropagation()}
            aria-label="Drag to reorder"
          >
            <GripVertical className="h-4 w-4" />
          </button>

          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "mb-1 text-sm font-medium leading-snug",
                task.status === "done" ? "text-muted-foreground line-through" : "text-foreground",
              )}
            >
              {task.title}
            </p>

            {task.description && (
              <p className="mb-2 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
            )}

            <div className="mb-2 flex flex-wrap items-center gap-1">
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: "var(--muted)",
                  color: "var(--muted-foreground)",
                }}
              >
                @{task.assigneeUsername}
              </span>
              {visibleTags.map((tag) => (
                <span
                  key={tag.id}
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: `${tag.color}22`,
                    color: tag.color,
                    border: `1px solid ${tag.color}30`,
                  }}
                >
                  {tag.name}
                </span>
              ))}
              {overflowCount > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  +{overflowCount}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {priority && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: `${priority.hex}22`,
                    color: priority.hex,
                    border: `1px solid ${priority.hex}40`,
                  }}
                >
                  {priority.label}
                </span>
              )}

              <div
                className={cn(
                  "ml-auto flex items-center gap-1 text-[10px]",
                  overdue ? "text-destructive" : dueToday ? "text-yellow-600" : "text-muted-foreground/60",
                )}
              >
                {overdue && <AlertCircle className="h-3 w-3" />}
                <CalendarDays className="h-3 w-3" />
                {task.dueDate}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
