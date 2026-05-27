import { describe, expect, it } from "vitest";
import { buildContext } from "./context.js";
import type { RawSession } from "./sources.js";

function session(over: Partial<RawSession>): RawSession {
  return {
    source: "Claude Code",
    id: "abcdef123456",
    title: "Untitled",
    time: new Date("2026-05-27T10:00:00Z"),
    texts: [],
    ...over,
  };
}

describe("buildContext", () => {
  it("reports nothing found when there are no sessions", () => {
    const r = buildContext([], "/proj");
    expect(r.sessionCount).toBe(0);
    expect(r.checklistFrom).toBeNull();
    expect(r.markdown).toContain("_No checklist found");
    expect(r.markdown).toContain("_None found for this project._");
  });

  it("pulls checklist and plan from the newest session that has each", () => {
    const sessions = [
      session({
        id: "newest00",
        time: new Date("2026-05-27T12:00:00Z"),
        texts: ["- [x] A\n- [ ] B"],
      }),
      session({
        id: "older000",
        source: "Antigravity",
        time: new Date("2026-05-27T09:00:00Z"),
        texts: ["## Plan\nbuild the thing"],
      }),
    ];
    const r = buildContext(sessions, "/proj");
    expect(r.checklistFrom?.id).toBe("newest00");
    expect(r.planFrom?.id).toBe("older000");
    expect(r.markdown).toContain("- [ ] B");
    expect(r.markdown).toContain("build the thing");
    expect(r.markdown).toContain("Antigravity");
  });

  it("prefers a source's authoritative structured fields over text scraping", () => {
    const s = session({
      checklist: "- [x] reconstructed from tool state",
      plan: "# Plan\nauthoritative",
      texts: ["- [ ] stale prose checklist", "## Plan\nstale prose plan"],
    });
    const r = buildContext([s], "/proj");
    expect(r.markdown).toContain("reconstructed from tool state");
    expect(r.markdown).toContain("authoritative");
    expect(r.markdown).not.toContain("stale prose");
  });

  it("falls back to text extraction when no structured fields exist", () => {
    const s = session({ texts: ["- [ ] from prose\n- [x] also prose"] });
    const r = buildContext([s], "/proj");
    expect(r.markdown).toContain("from prose");
  });

  it("escapes pipes in titles so the session table stays valid", () => {
    const r = buildContext([session({ title: "fix a|b parsing" })], "/proj");
    expect(r.markdown).toContain("fix a\\|b parsing");
  });
});
