import { describe, expect, it } from "vitest";
import { renderLedger, renderTodos, statusMark, type TaskEvent } from "./claude.js";

describe("statusMark", () => {
  it("maps Claude statuses to checklist marks", () => {
    expect(statusMark("completed")).toBe("[x]");
    expect(statusMark("in_progress")).toBe("[/]");
    expect(statusMark("pending")).toBe("[ ]");
    expect(statusMark("anything else")).toBe("[ ]");
  });
});

describe("renderLedger", () => {
  it("returns null with no create events", () => {
    expect(renderLedger([])).toBeNull();
    expect(renderLedger([{ type: "update", taskId: "1", status: "completed" }])).toBeNull();
  });

  it("reconstructs current state from create + update events", () => {
    const events: TaskEvent[] = [
      { type: "create", subject: "Build guard" },
      { type: "create", subject: "Gate route" },
      { type: "create", subject: "Add tests" },
      { type: "update", taskId: "1", status: "completed" },
      { type: "update", taskId: "2", status: "in_progress" },
    ];
    expect(renderLedger(events)).toBe(
      "- [x] Build guard\n- [/] Gate route\n- [ ] Add tests"
    );
  });

  it("keeps creation order and applies the latest status per task", () => {
    const events: TaskEvent[] = [
      { type: "create", subject: "A" },
      { type: "update", taskId: "1", status: "in_progress" },
      { type: "update", taskId: "1", status: "completed" },
    ];
    expect(renderLedger(events)).toBe("- [x] A");
  });

  it("ignores updates to unknown task ids", () => {
    const events: TaskEvent[] = [
      { type: "create", subject: "A" },
      { type: "update", taskId: "99", status: "completed" },
    ];
    expect(renderLedger(events)).toBe("- [ ] A");
  });
});

describe("renderTodos", () => {
  it("renders a TodoWrite snapshot", () => {
    expect(
      renderTodos([
        { content: "Done thing", status: "completed" },
        { content: "Doing thing", status: "in_progress" },
        { content: "Todo thing", status: "pending" },
      ])
    ).toBe("- [x] Done thing\n- [/] Doing thing\n- [ ] Todo thing");
  });

  it("returns null when empty", () => {
    expect(renderTodos([])).toBeNull();
  });
});
