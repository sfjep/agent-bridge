#!/usr/bin/env node
import * as fs from "fs/promises";
import * as path from "path";
import { buildContext } from "./context.js";
import { collectSessions, resolveProjectPath } from "./sources.js";

const USAGE = `agent-bridge — distill cross-agent session history into a portable handoff file

Usage:
  agent-bridge pull [path]    Scan local agent logs for the project and write
                              .agent-bridge/CONTEXT.md (zero LLM tokens)
  agent-bridge list [path]    Show sessions found for the project (no files written)
  agent-bridge help           Show this message

Scans Claude Code, Antigravity, Cursor, and Codex logs. [path] defaults to the
current directory.`;

async function pull(projectPath: string): Promise<void> {
  const sessions = await collectSessions(projectPath);
  const result = buildContext(sessions, projectPath);

  const outDir = path.join(projectPath, ".agent-bridge");
  const outFile = path.join(outDir, "CONTEXT.md");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outFile, result.markdown, "utf-8");

  console.log(`Scanned ${result.sessionCount} session(s) for ${projectPath}`);
  console.log(
    `  checklist: ${result.checklistFrom ? `${result.checklistFrom.source} (${result.checklistFrom.id.slice(0, 8)})` : "none found"}`
  );
  console.log(
    `  plan:      ${result.planFrom ? `${result.planFrom.source} (${result.planFrom.id.slice(0, 8)})` : "none found"}`
  );
  console.log(`Wrote ${path.relative(process.cwd(), outFile) || outFile}`);
}

async function list(projectPath: string): Promise<void> {
  const sessions = await collectSessions(projectPath);
  if (sessions.length === 0) {
    console.log(`No agent sessions found for ${projectPath}`);
    return;
  }
  console.log(`Sessions for ${projectPath} (newest first):\n`);
  for (const s of sessions) {
    console.log(`  ${s.time.toISOString().slice(0, 16).replace("T", " ")}  ${s.source.padEnd(12)}  ${s.title}`);
  }
}

async function main(): Promise<void> {
  const [command, maybePath] = process.argv.slice(2);
  const projectPath = resolveProjectPath(maybePath);

  switch (command) {
    case "pull":
      await pull(projectPath);
      break;
    case "list":
      await list(projectPath);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      console.log(USAGE);
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("agent-bridge failed:", err?.message ?? err);
  process.exit(1);
});
