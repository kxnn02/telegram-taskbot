"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { TaskStatus } from "@/src/domain/types";
import { TaskCard } from "./task-card";
import type { BoardTask } from "./types";

/** Port of DevieBot's `components/kanban/kanban-column.tsx` (issue #105
 * sub-stage 5b) — one droppable column per status, sortable context over
 * its tasks (already sorted by `orderIndex` via `groupTasksByStatus`). */

const COLUMN_STYLE: Record<TaskStatus, { label: string; hex: string }> = {
  backlog: { label: "Backlog", hex: "#64748b" },
  todo: { label: "To do", hex: "#3b82f6" },
  in_progress: { label: "In progress", hex: "#eab308" },
  in_review: { label: "In review", hex: "#8b5cf6" },
  blocked: { label: "Blocked", hex: "#ef4444" },
  done: { label: "Done", hex: "#22c55e" },
};

export function KanbanColumn({
  status,
  tasks,
  onTaskClick,
}: {
  status: TaskStatus;
  tasks: BoardTask[];
  onTaskClick: (task: BoardTask) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const { label, hex } = COLUMN_STYLE[status];

  return (
    <div className="flex min-w-0 flex-col">
      <div
        className="mb-2 flex items-center justify-between rounded-xl px-3 py-2.5"
        style={{ background: `${hex}1a`, border: `1px solid ${hex}38` }}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hex }} />
          <span className="text-xs font-semibold tracking-wide" style={{ color: hex }}>
            {label}
          </span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
            style={{ background: `${hex}2a`, color: hex }}
          >
            {tasks.length}
          </span>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className="min-h-[160px] max-h-[60vh] space-y-2 overflow-y-auto rounded-xl p-2 transition-all"
        style={{
          background: isOver ? `${hex}0f` : "var(--muted)",
          border: isOver ? `1px solid ${hex}4d` : "1px solid var(--border)",
        }}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={onTaskClick} />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className="flex h-24 items-center justify-center text-xs text-muted-foreground/50">
            No tasks
          </div>
        )}
      </div>
    </div>
  );
}
