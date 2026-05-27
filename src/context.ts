import { extractChecklist, extractPlan } from "./extract.js";
import type { RawSession } from "./sources.js";

export interface ContextResult {
  markdown: string;
  checklistFrom: RawSession | null;
  planFrom: RawSession | null;
  sessionCount: number;
}

const MAX_LISTED = 10;

/** Build the portable CONTEXT.md handoff snapshot from collected sessions (newest first). */
export function buildContext(sessions: RawSession[], projectPath: string): ContextResult {
  let checklist: string | null = null;
  let checklistFrom: RawSession | null = null;
  let plan: string | null = null;
  let planFrom: RawSession | null = null;

  for (const s of sessions) {
    if (!checklist) {
      const c = s.checklist ?? extractChecklist(s.texts);
      if (c) {
        checklist = c;
        checklistFrom = s;
      }
    }
    if (!plan) {
      const p = s.plan ?? extractPlan(s.texts);
      if (p) {
        plan = p;
        planFrom = s;
      }
    }
    if (checklist && plan) break;
  }

  const lines: string[] = [];
  lines.push("# Agent Bridge — Session Context");
  lines.push("");
  lines.push(
    `Distilled from local agent logs for \`${projectPath}\` with zero LLM tokens on ${new Date().toISOString()}.`
  );
  lines.push(
    "Handoff snapshot, not a live document. Re-run `agent-bridge pull` to refresh."
  );
  lines.push("");

  lines.push("## Active Task Checklist");
  lines.push("");
  lines.push(checklist ?? "_No checklist found in recent sessions._");
  if (checklistFrom) lines.push("", `> From ${provenance(checklistFrom)}`);
  lines.push("");

  lines.push("## Active Plan");
  lines.push("");
  lines.push(plan ?? "_No plan found in recent sessions._");
  if (planFrom) lines.push("", `> From ${provenance(planFrom)}`);
  lines.push("");

  lines.push("## Recent Sessions");
  lines.push("");
  if (sessions.length === 0) {
    lines.push("_None found for this project._");
  } else {
    lines.push("| When | Agent | Title |");
    lines.push("| --- | --- | --- |");
    for (const s of sessions.slice(0, MAX_LISTED)) {
      lines.push(`| ${isoMinute(s.time)} | ${s.source} | ${escapeCell(s.title)} |`);
    }
  }
  lines.push("");

  return {
    markdown: lines.join("\n"),
    checklistFrom,
    planFrom,
    sessionCount: sessions.length,
  };
}

function provenance(s: RawSession): string {
  return `${s.source} · ${isoMinute(s.time)} · ${s.id.slice(0, 8)}`;
}

function isoMinute(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}
