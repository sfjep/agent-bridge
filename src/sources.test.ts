import { describe, expect, it } from "vitest";
import { referencesDominantProject } from "./sources.js";

describe("referencesDominantProject", () => {
  it("matches when the project is the only one referenced", () => {
    const t = "working in /home/sfj/code/agent-bridge on the parser";
    expect(referencesDominantProject(t, "/home/sfj/code/agent-bridge")).toBe(true);
  });

  it("rejects a session that only mentions the project in passing", () => {
    // 3 hits for agent-bridge, 1 for telos: telos is not dominant.
    const t =
      "/home/sfj/code/agent-bridge /home/sfj/code/agent-bridge " +
      "/home/sfj/code/agent-bridge also touched /home/sfj/code/telos once";
    expect(referencesDominantProject(t, "/home/sfj/code/telos")).toBe(false);
    expect(referencesDominantProject(t, "/home/sfj/code/agent-bridge")).toBe(true);
  });

  it("returns false when the project is never referenced", () => {
    expect(referencesDominantProject("nothing here", "/home/sfj/code/telos")).toBe(false);
  });

  it("does not match on a path that is merely a prefix of another", () => {
    const t = "/home/sfj/code/agent-bridge-extras /home/sfj/code/agent-bridge-extras";
    expect(referencesDominantProject(t, "/home/sfj/code/agent-bridge")).toBe(false);
  });
});
