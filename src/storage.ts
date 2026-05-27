import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Expand user home directory
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.config', 'agent-bridge');
const GLOBAL_MEMORY_FILE = path.join(GLOBAL_CONFIG_DIR, 'memory.md');

export interface SessionStatus {
  plan: string;
  tasks: string;
  projectMemory: string;
  globalMemory: string;
}

export function resolveProjectPath(projectPath?: string): string {
  if (projectPath) {
    return path.resolve(projectPath);
  }
  return process.cwd();
}

function getProjectBridgeDir(resolvedProjectPath: string): string {
  return path.join(resolvedProjectPath, '.agent-bridge');
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Ignore if directory already exists
  }
}

async function readFileOrDefault(filePath: string, defaultContent: string = ''): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return defaultContent;
    }
    throw error;
  }
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf-8');
}

async function appendToFile(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  
  let formatted = content;
  if (!formatted.startsWith('\n')) {
    formatted = '\n' + formatted;
  }
  if (!formatted.endsWith('\n')) {
    formatted = formatted + '\n';
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.size === 0) {
      await fs.writeFile(filePath, content.trim() + '\n', 'utf-8');
    } else {
      await fs.appendFile(filePath, formatted, 'utf-8');
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(filePath, content.trim() + '\n', 'utf-8');
    } else {
      throw error;
    }
  }
}

export async function getSessionStatus(projectPath?: string): Promise<SessionStatus> {
  const resolvedPath = resolveProjectPath(projectPath);
  const bridgeDir = getProjectBridgeDir(resolvedPath);

  const planPath = path.join(bridgeDir, 'plan.md');
  const tasksPath = path.join(bridgeDir, 'tasks.md');
  const projectMemoryPath = path.join(bridgeDir, 'memory.md');

  const plan = await readFileOrDefault(planPath, '# Active Plan\n\n*(No active plan initialized. Use update_plan to write a plan.)*\n');
  const tasks = await readFileOrDefault(tasksPath, '# Tasks Checklist\n\n- [ ] Initial Task\n');
  const projectMemory = await readFileOrDefault(projectMemoryPath, '# Project Memories & Insights\n\n');
  const globalMemory = await readFileOrDefault(GLOBAL_MEMORY_FILE, '# Global Agent Memory & Preferences\n\n');

  return { plan, tasks, projectMemory, globalMemory };
}

export async function updatePlan(content: string, projectPath?: string): Promise<void> {
  const resolvedPath = resolveProjectPath(projectPath);
  const bridgeDir = getProjectBridgeDir(resolvedPath);
  const filePath = path.join(bridgeDir, 'plan.md');
  await writeFile(filePath, content);
}

export async function updateTasks(content: string, projectPath?: string): Promise<void> {
  const resolvedPath = resolveProjectPath(projectPath);
  const bridgeDir = getProjectBridgeDir(resolvedPath);
  const filePath = path.join(bridgeDir, 'tasks.md');
  await writeFile(filePath, content);
}

export async function recordMemory(content: string, scope: 'project' | 'global', projectPath?: string): Promise<void> {
  let bullet = content.trim();
  if (!bullet.startsWith('-') && !bullet.startsWith('*')) {
    bullet = `- ${bullet}`;
  }

  if (scope === 'global') {
    await appendToFile(GLOBAL_MEMORY_FILE, bullet);
  } else {
    const resolvedPath = resolveProjectPath(projectPath);
    const bridgeDir = getProjectBridgeDir(resolvedPath);
    const filePath = path.join(bridgeDir, 'memory.md');
    await appendToFile(filePath, bullet);
  }
}

export async function getMemories(projectPath?: string, query?: string): Promise<{ project: string[]; global: string[] }> {
  const resolvedPath = resolveProjectPath(projectPath);
  const bridgeDir = getProjectBridgeDir(resolvedPath);
  
  const projectMemoryPath = path.join(bridgeDir, 'memory.md');
  const projectMemoryRaw = await readFileOrDefault(projectMemoryPath, '');
  const globalMemoryRaw = await readFileOrDefault(GLOBAL_MEMORY_FILE, '');

  const parseBullets = (raw: string): string[] => {
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('-') || line.startsWith('*'));
  };

  const projectBullets = parseBullets(projectMemoryRaw);
  const globalBullets = parseBullets(globalMemoryRaw);

  if (!query) {
    return { project: projectBullets, global: globalBullets };
  }

  const normalizedQuery = query.toLowerCase();
  const filterFn = (bullet: string) => bullet.toLowerCase().includes(normalizedQuery);

  return {
    project: projectBullets.filter(filterFn),
    global: globalBullets.filter(filterFn),
  };
}
