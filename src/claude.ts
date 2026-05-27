export type TaskEvent =
  | { type: "create"; subject: string }
  | { type: "update"; taskId: string; status: string };

export interface TodoItem {
  content: string;
  status: string;
}

export function statusMark(status: string): string {
  const s = status.toLowerCase();
  if (s === "completed" || s === "done") return "[x]";
  if (s === "in_progress" || s === "active") return "[/]";
  return "[ ]";
}

/**
 * Reconstruct the current task ledger from Claude's TaskCreate/TaskUpdate event
 * stream. TaskCreate assigns sequential ids ("1", "2", ...) matching Claude's
 * own numbering; TaskUpdate mutates a task's status by that id.
 */
export function renderLedger(events: TaskEvent[]): string | null {
  const order: string[] = [];
  const subject = new Map<string, string>();
  const status = new Map<string, string>();
  let seq = 0;

  for (const e of events) {
    if (e.type === "create") {
      const id = String(++seq);
      order.push(id);
      subject.set(id, e.subject);
      status.set(id, "pending");
    } else if (subject.has(e.taskId)) {
      status.set(e.taskId, e.status);
    }
  }

  if (order.length === 0) return null;
  return order.map((id) => `- ${statusMark(status.get(id)!)} ${subject.get(id)}`).join("\n");
}

/** Render a TodoWrite snapshot (legacy Claude Code) as a markdown checklist. */
export function renderTodos(todos: TodoItem[]): string | null {
  const items = todos.filter((t) => t && typeof t.content === "string" && t.content.trim());
  if (items.length === 0) return null;
  return items.map((t) => `- ${statusMark(t.status ?? "")} ${t.content.trim()}`).join("\n");
}
