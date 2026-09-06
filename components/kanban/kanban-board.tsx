"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BOARD_STATUS_ORDER, groupTasksByStatus, reorderColumn } from "@/src/web/boardView";
import type { TaskStatus } from "@/src/domain/types";
import { KanbanColumn } from "./kanban-column";
import { TaskCard } from "./task-card";
import { TaskDialog } from "./task-dialog";
import type { BoardTask } from "./types";

/**
 * Port of DevieBot's `components/kanban/kanban-board.tsx` (issue #105
 * sub-stage 5b): `DndContext` with a `PointerSensor` (5px activation
 * distance) and `closestCorners` collision detection, fetching
 * `/api/board` + `/api/tags` on mount. Drag-end handles two cases:
 *  - same-column reorder: `reorderColumn` (pure, tested in
 *    `boardView.test.ts`) computes the new sequential `orderIndex` values
 *    client-side, then this component PATCHes each *changed* task's order
 *    via `/api/tasks/[id]/order` (one call per task in the affected
 *    column, via `Promise.all` — same granularity as Devie's own
 *    `reorderTasks`, see that route's doc comment).
 *  - cross-column move: PATCHes `status` via the existing
 *    `/api/tasks/[id]` route, then reorders the destination column the
 *    same way.
 *
 * No browser-side Supabase client anywhere here (ADR-0002/ADR-0006) — every
 * read/write is a plain `fetch` against this repo's own Route Handlers.
 */
export function KanbanBoard({ assignees }: { assignees: string[] }) {
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null);
  const [dialogTask, setDialogTask] = useState<BoardTask | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [defaultStatus, setDefaultStatus] = useState<TaskStatus>("todo");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function fetchBoard() {
    setLoading(true);
    const res = await fetch("/api/board");
    const data = await res.json();
    if (data.ok) setTasks(data.tasks);
    setLoading(false);
  }

  useEffect(() => {
    fetchBoard();
  }, []);

  const grouped = useMemo(() => groupTasksByStatus(tasks), [tasks]);

  function handleDragStart(e: DragStartEvent) {
    const task = tasks.find((t) => t.id === e.active.id);
    if (task) setActiveTask(task);
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveTask(null);
    if (!over) return;

    const activeId = Number(active.id);
    const moved = tasks.find((t) => t.id === activeId);
    if (!moved) return;

    // Dropped directly on a column (empty column, or the column's own
    // droppable area) vs dropped on another card.
    const overIsColumn = BOARD_STATUS_ORDER.includes(over.id as TaskStatus);
    const overTask = overIsColumn ? undefined : tasks.find((t) => t.id === Number(over.id));
    const destinationStatus: TaskStatus = overIsColumn ? (over.id as TaskStatus) : overTask!.status;

    let workingTasks = tasks;
    if (moved.status !== destinationStatus) {
      // Cross-column move: persist the status change first.
      const res = await fetch(`/api/tasks/${moved.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: destinationStatus }),
      });
      const data = await res.json();
      if (!data.ok) return;
      workingTasks = tasks.map((t) => (t.id === moved.id ? { ...t, status: destinationStatus } : t));
    }

    const destinationColumn = workingTasks
      .filter((t) => t.status === destinationStatus)
      .sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);

    const targetIndex = overTask
      ? destinationColumn.findIndex((t) => t.id === overTask.id)
      : destinationColumn.length - 1;

    const reordered = reorderColumn(destinationColumn, moved.id, Math.max(targetIndex, 0));

    // Only PATCH the tasks whose orderIndex actually changed.
    const changed = reordered.filter((r) => {
      const original = destinationColumn.find((t) => t.id === r.id);
      return !original || original.orderIndex !== r.orderIndex;
    });

    setTasks((prev) =>
      prev.map((t) => {
        const updated = reordered.find((r) => r.id === t.id);
        return updated ? { ...t, orderIndex: updated.orderIndex } : t;
      }),
    );

    await Promise.all(
      changed.map((r) =>
        fetch(`/api/tasks/${r.id}/order`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderIndex: r.orderIndex }),
        }),
      ),
    );

    await fetchBoard();
  }

  function openNewTask(status: TaskStatus = "todo") {
    setDefaultStatus(status);
    setDialogTask(null);
    setDialogOpen(true);
  }

  function openEditTask(task: BoardTask) {
    setDialogTask(task);
    setDialogOpen(true);
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--primary)" }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => openNewTask()} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add Task
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 gap-4 pb-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {BOARD_STATUS_ORDER.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={grouped.get(status) ?? []}
              onTaskClick={openEditTask}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask && (
            <div className="rotate-2 opacity-90">
              <TaskCard task={activeTask} onClick={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <TaskDialog
        task={dialogTask}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={fetchBoard}
        assignees={assignees}
        defaultStatus={defaultStatus}
      />
    </div>
  );
}
