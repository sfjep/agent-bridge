import { describe, expect, it } from "vitest";
import { extractChecklist, extractPlan } from "./extract.js";

describe("extractChecklist", () => {
  it("returns null when no text contains a checklist", () => {
    expect(extractChecklist(["just prose", "more prose"])).toBeNull();
  });

  it("extracts a markdown checklist with mixed states", () => {
    const text = "Here is the plan:\n- [x] Set up repo\n- [ ] Write tests\n- [/] Wire CLI";
    expect(extractChecklist([text])).toBe(
      "- [x] Set up repo\n- [ ] Write tests\n- [/] Wire CLI"
    );
  });

  it("prefers the most recent multi-item ledger over an earlier one", () => {
    const older = "- [ ] A\n- [ ] B";
    const newer = "- [x] A\n- [x] B\n- [ ] C";
    expect(extractChecklist([older, newer])).toBe(newer);
  });

  it("does not let a trailing single bullet clobber a real ledger", () => {
    const ledger = "- [x] A\n- [ ] B\n- [ ] C";
    const aside = "- [ ] one tangential thing";
    expect(extractChecklist([ledger, aside])).toBe(ledger);
  });

  it("keeps indented sub-items inside the checklist block", () => {
    const text = "- [x] Parent\n  - [ ] Child\n- [ ] Sibling";
    expect(extractChecklist([text])).toBe(text);
  });

  it("ignores bracket noise that is not a checklist item", () => {
    expect(extractChecklist(["see [1] and [link](url)"])).toBeNull();
  });
});

describe("extractPlan", () => {
  it("returns null when no plan heading is present", () => {
    expect(extractPlan(["- [ ] a task", "some notes"])).toBeNull();
  });

  it("captures from the plan heading to the end of the blob", () => {
    const text = "Intro chatter\n## Plan\nStep 1\nStep 2";
    expect(extractPlan([text])).toBe("## Plan\nStep 1\nStep 2");
  });

  it("matches alternative plan-like headings", () => {
    const text = "# Implementation Plan - Foo\nbody";
    expect(extractPlan([text])).toBe("# Implementation Plan - Foo\nbody");
  });

  it("prefers the most recent plan", () => {
    const older = "## Plan\nold approach";
    const newer = "## Roadmap\nnew approach";
    expect(extractPlan([older, newer])).toBe("## Roadmap\nnew approach");
  });
});
