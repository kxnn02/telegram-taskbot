"use client";

import { useEffect, useState } from "react";
import type { Tag, TaskPriority, TaskStatus } from "@/src/domain/types";
import { memberColor, memberShortLabel } from "@/src/web/memberUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { BoardTask } from "./types";

/**
 * Port of DevieBot's `components/kanban/task-dialog.tsx` (issue #105
 * sub-stage 5b) — title/description/status/priority/due-date fields, a
 * tag-picker (toggle chips loaded from `/api/tags`, new-tag creation with a
 * color input defaulting to `#6366f1`), and an assignee picker. The
 * assignee picker is where `memberColor`/`memberShortLabel` (the ported
 * `memberUtils.ts`) actually get used in this app — built from a minimal
 * `Member` (`{ id: username, username }`) per task's assignee, since this
 * repo has no `members` table (only `roster.username`).
 *
 * Saves via `POST /api/tasks` (create) or `PATCH /api/tasks/[id]` (edit) +
 * `PATCH /api/tasks/[id]/priority` (when priority changed — see that
 * route's doc comment for why it's separate) + `PUT /api/tasks/[id]/tags`.
 */

const STATUSES: TaskStatus[] = ["backlog", "todo", "in_progress", "in_review", "blocked", "done"];
const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];
const DEFAULT_TAG_COLOR = "#6366f1";

export interface TaskDialogProps {
  task: BoardTask | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  assignees: string[];
  defaultStatus?: TaskStatus;
}

export function TaskDialog({ task, open, onClose, onSaved, assignees, defaultStatus }: TaskDialogProps) {
  const isNew = !task;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>(defaultStatus ?? "todo");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [assignee, setAssignee] = useState<string>("");
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(DEFAULT_TAG_COLOR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setStatus(task?.status ?? defaultStatus ?? "todo");
    setPriority(task?.priority ?? "medium");
    setDueDate(task?.dueDate ?? "");
    setAssignee(task?.assigneeUsername ?? assignees[0] ?? "");
    setSelectedTagIds(task?.tags.map((t) => t.id) ?? []);
    setError(null);
    fetchTags();
  }, [open, task, defaultStatus, assignees]);

  async function fetchTags() {
    const res = await fetch("/api/tags");
    const data = await res.json();
    if (data.ok) setAllTags(data.tags);
  }

  function toggleTag(tagId: number) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  }

  async function createNewTag() {
    if (!newTagName.trim()) return;
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
    });
    const data = await res.json();
    if (data.ok) {
      setAllTags((prev) => [...prev, data.tag]);
      setSelectedTagIds((prev) => [...prev, data.tag.id]);
      setNewTagName("");
      setNewTagColor(DEFAULT_TAG_COLOR);
    }
  }

  async function handleSave() {
    if (!title.trim() || !assignee) return;
    setSaving(true);
    setError(null);
    try {
      let taskId: number;
      if (isNew) {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assigneeUsername: assignee,
            title: title.trim(),
            description: description.trim(),
            dueDate,
          }),
        });
        const data = await res.json();
        if (!data.ok) {
          setError(data.error);
          return;
        }
        taskId = data.task.id;
        if (status !== "todo") {
          await fetch(`/api/tasks/${taskId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          });
        }
        if (priority !== "medium") {
          await fetch(`/api/tasks/${taskId}/priority`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ priority }),
          });
        }
      } else {
        taskId = task!.id;
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assigneeUsername: assignee,
            title: title.trim(),
            description: description.trim() || undefined,
            dueDate,
            status,
          }),
        });
        const data = await res.json();
        if (!data.ok) {
          setError(data.error);
          return;
        }
        if (priority !== task!.priority) {
          await fetch(`/api/tasks/${taskId}/priority`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ priority }),
          });
        }
      }

      await fetch(`/api/tasks/${taskId}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagIds: selectedTagIds }),
      });

      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "New Task" : "Edit Task"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title..." autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add details, context, or notes..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Due Date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Assignee</Label>
            <div className="flex flex-wrap gap-2">
              {assignees.map((username) => {
                const selected = assignee === username;
                const color = memberColor({ id: username, username });
                return (
                  <button
                    key={username}
                    type="button"
                    onClick={() => setAssignee(username)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-all",
                      selected ? "border-transparent text-white" : "border-border text-muted-foreground",
                    )}
                    style={selected ? { backgroundColor: color } : {}}
                  >
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    {memberShortLabel({ id: username, username })}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-2">
              {allTags.map((tag) => {
                const selected = selectedTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
                      selected ? "opacity-100" : "opacity-40",
                    )}
                    style={{
                      backgroundColor: selected ? `${tag.color}22` : "transparent",
                      borderColor: tag.color,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="New tag name..."
                className="flex-1"
              />
              <input
                type="color"
                value={newTagColor}
                onChange={(e) => setNewTagColor(e.target.value)}
                className="h-8 w-10 rounded border border-border"
                aria-label="New tag color"
              />
              <Button type="button" variant="outline" size="sm" onClick={createNewTag} disabled={!newTagName.trim()}>
                Add tag
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !title.trim() || !assignee}>
            {isNew ? "Create Task" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
