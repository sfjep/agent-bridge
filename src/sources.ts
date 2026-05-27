import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { extractChecklist } from "./extract.js";
import { renderLedger, renderTodos, type TaskEvent, type TodoItem } from "./claude.js";

const execAsync = promisify(exec);

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const ANTIGRAVITY_BRAIN_DIRS = [
  path.join(os.homedir(), ".gemini", "antigravity-cli", "brain"),
  path.join(os.homedir(), ".gemini", "antigravity-ide", "brain"),
];

const VSCODE_CONFIG_ROOTS = [
  path.join(os.homedir(), ".config", "Code"),
  path.join(os.homedir(), ".config", "Cursor"),
  path.join(os.homedir(), ".config", "Antigravity IDE"),
  path.join(os.homedir(), ".config", "VSCodium"),
  path.join(os.homedir(), "Library", "Application Support", "Code"),
  path.join(os.homedir(), "Library", "Application Support", "Cursor"),
  path.join(os.homedir(), "Library", "Application Support", "Antigravity IDE"),
  path.join(os.homedir(), "Library", "Application Support", "VSCodium"),
];

export type AgentSource = "Claude Code" | "Antigravity" | "Cursor" | "Codex";

export interface RawSession {
  source: AgentSource;
  id: string;
  title: string;
  time: Date;
  /** Authoritative checklist, when the source exposes structured task state. */
  checklist?: string | null;
  /** Authoritative plan, when the source exposes one (e.g. an approved plan). */
  plan?: string | null;
  /** Candidate text blobs in chronological order (oldest first), for fallback. */
  texts: string[];
}

export function resolveProjectPath(projectPath?: string): string {
  return path.resolve(projectPath ?? process.cwd());
}

/**
 * Antigravity transcripts carry no clean cwd field and freely mention other
 * projects' paths, so "path appears in transcript" false-positives. A session
 * belongs to `projectPath` only if it is the most-referenced sibling project.
 */
export function referencesDominantProject(transcript: string, projectPath: string): boolean {
  const parent = path.dirname(projectPath);
  const base = path.basename(projectPath);
  const re = new RegExp(escapeRegExp(parent) + "/([A-Za-z0-9._-]+)", "g");
  const counts = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(transcript)) !== null) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  const own = counts.get(base) ?? 0;
  if (own === 0) return false;
  for (const [name, count] of counts) {
    if (name !== base && count >= own) return false;
  }
  return true;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Scan every known agent for sessions belonging to `projectPath`, newest first. */
export async function collectSessions(projectPath: string): Promise<RawSession[]> {
  const scanners = [
    collectClaude(projectPath),
    collectAntigravity(projectPath),
    collectVscodeFamily(projectPath, "Cursor"),
    collectVscodeFamily(projectPath, "Codex"),
  ];
  const settled = await Promise.allSettled(scanners);
  const sessions: RawSession[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") sessions.push(...r.value);
  }
  return sessions.sort((a, b) => b.time.getTime() - a.time.getTime());
}

async function collectClaude(projectPath: string): Promise<RawSession[]> {
  const slug = projectPath.replace(/\//g, "-");
  const dir = path.join(CLAUDE_PROJECTS_DIR, slug);
  const files = await readdirSafe(dir);
  const sessions: RawSession[] = [];

  for (const file of files.filter((f) => f.endsWith(".jsonl"))) {
    const filePath = path.join(dir, file);
    const [content, stat] = await Promise.all([
      fs.readFile(filePath, "utf-8"),
      fs.stat(filePath),
    ]);
    const id = path.basename(file, ".jsonl");

    let customTitle = "";
    let firstUserPrompt = "";
    const texts: string[] = [];
    const taskEvents: TaskEvent[] = [];
    let lastTodos: TodoItem[] | null = null;
    let lastPlan: string | null = null;

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const role = obj.message?.role ?? obj.type;
      const c = obj.message?.content ?? obj.content;

      if (obj.type === "custom-title" && obj.customTitle) customTitle = obj.customTitle;
      if (role === "user" && typeof c === "string" && !firstUserPrompt && !c.includes("<")) {
        firstUserPrompt = c.split("\n")[0].slice(0, 80);
      }
      if (role === "assistant" && Array.isArray(c)) {
        const textBlocks: string[] = [];
        for (const b of c) {
          if (!b || typeof b !== "object") continue;
          if (b.type === "text" && typeof b.text === "string") {
            textBlocks.push(b.text);
          } else if (b.type === "tool_use") {
            collectClaudeToolState(b, taskEvents, (todos) => (lastTodos = todos), (plan) => (lastPlan = plan));
          }
        }
        if (textBlocks.length) texts.push(textBlocks.join("\n"));
      } else if (role === "assistant" && typeof c === "string") {
        texts.push(c);
      }
    }

    const checklist = renderLedger(taskEvents) ?? (lastTodos ? renderTodos(lastTodos) : null);
    if (texts.length === 0 && !checklist && !lastPlan) continue;
    sessions.push({
      source: "Claude Code",
      id,
      title: customTitle || firstUserPrompt || `Session ${id.slice(0, 8)}`,
      time: stat.mtime,
      checklist,
      plan: lastPlan,
      texts,
    });
  }
  return sessions;
}

function collectClaudeToolState(
  block: any,
  events: TaskEvent[],
  setTodos: (t: TodoItem[]) => void,
  setPlan: (p: string) => void
): void {
  const input = block.input ?? {};
  switch (block.name) {
    case "TaskCreate":
      if (typeof input.subject === "string") events.push({ type: "create", subject: input.subject });
      break;
    case "TaskUpdate":
      if (input.taskId != null && typeof input.status === "string") {
        events.push({ type: "update", taskId: String(input.taskId), status: input.status });
      }
      break;
    case "TodoWrite":
      if (Array.isArray(input.todos)) setTodos(input.todos);
      break;
    case "ExitPlanMode":
      if (typeof input.plan === "string" && input.plan.trim()) setPlan(input.plan);
      break;
  }
}

async function collectAntigravity(projectPath: string): Promise<RawSession[]> {
  const sessions: RawSession[] = [];

  for (const brainRoot of ANTIGRAVITY_BRAIN_DIRS) {
    for (const dirName of await readdirSafe(brainRoot)) {
      const dir = path.join(brainRoot, dirName);
      try {
        if (!(await fs.stat(dir)).isDirectory()) continue;
        const transcript = path.join(dir, ".system_generated", "logs", "transcript.jsonl");
        const transcriptContent = await readFileSafe(transcript);
        if (!referencesDominantProject(transcriptContent, projectPath)) continue;

        const plan = (await readFileSafe(path.join(dir, "implementation_plan.md"))).trim();
        const tasks = (await readFileSafe(path.join(dir, "task.md"))).trim();
        if (!plan && !tasks) continue;

        sessions.push({
          source: "Antigravity",
          id: dirName,
          title: (await antigravitySummary(dir)) || `Session ${dirName.slice(0, 8)}`,
          time: (await fs.stat(dir)).mtime,
          checklist: extractChecklist([tasks]),
          plan: plan || null,
          texts: [plan, tasks].filter(Boolean),
        });
      } catch {
        // skip unreadable brain dir
      }
    }
  }
  return sessions;
}

async function antigravitySummary(dir: string): Promise<string> {
  const raw = await readFileSafe(path.join(dir, "implementation_plan.md.metadata.json"));
  if (!raw) return "";
  try {
    const meta = JSON.parse(raw);
    return typeof meta.summary === "string" ? meta.summary.slice(0, 80) : "";
  } catch {
    return "";
  }
}

async function collectVscodeFamily(
  projectPath: string,
  source: "Cursor" | "Codex"
): Promise<RawSession[]> {
  const sessions: RawSession[] = [];

  for (const root of VSCODE_CONFIG_ROOTS) {
    const storageDir = path.join(root, "User", "workspaceStorage");
    const app = path.basename(root);

    for (const hash of await readdirSafe(storageDir)) {
      const hashDir = path.join(storageDir, hash);
      const dbPath = path.join(hashDir, "state.vscdb");
      try {
        const workspaceRaw = await readFileSafe(path.join(hashDir, "workspace.json"));
        if (!workspaceRaw) continue;
        const ws = JSON.parse(workspaceRaw);
        const folderUri = ws.folder ?? ws.workspace?.folders?.[0]?.uri ?? "";
        const decoded = decodeURIComponent(folderUri).replace(/^file:\/\//, "");
        if (!decoded || path.resolve(decoded) !== projectPath) continue;

        const dbStat = await fs.stat(dbPath);
        const records = await queryStateDb(dbPath);
        const texts: string[] = [];
        for (const rec of records) findStrings(rec.value, texts);
        if (texts.length === 0) continue;

        sessions.push({
          source,
          id: `${hash.slice(0, 8)}`,
          title: `${source} workspace (${app})`,
          time: dbStat.mtime,
          texts,
        });
      } catch {
        // skip workspace we can't read
      }
    }
  }
  return sessions;
}

async function queryStateDb(dbPath: string): Promise<{ key: string; value: any }[]> {
  const query =
    "SELECT key, value FROM ItemTable WHERE key LIKE '%chat%' OR key LIKE '%composer%' OR key LIKE 'interactive.%' OR key LIKE '%copilot%'";
  try {
    const { stdout } = await execAsync(`sqlite3 -json "${dbPath}" "${query}"`);
    return stdout.trim() ? JSON.parse(stdout) : [];
  } catch {
    return [];
  }
}

function findStrings(val: any, out: string[]): string[] {
  if (typeof val === "string") {
    if (val.length > 1) out.push(val);
  } else if (Array.isArray(val)) {
    for (const item of val) findStrings(item, out);
  } else if (val && typeof val === "object") {
    for (const key of Object.keys(val)) findStrings(val[key], out);
  }
  return out;
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function readFileSafe(file: string): Promise<string> {
  try {
    return await fs.readFile(file, "utf-8");
  } catch {
    return "";
  }
}
