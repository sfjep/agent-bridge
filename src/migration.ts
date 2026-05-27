import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { resolveProjectPath } from './storage.js';

const execAsync = promisify(exec);

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const ANTIGRAVITY_BRAIN_DIR = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');

const CONFIG_ROOTS = [
  // Linux
  path.join(os.homedir(), '.config', 'Code'),
  path.join(os.homedir(), '.config', 'Cursor'),
  path.join(os.homedir(), '.config', 'Antigravity IDE'),
  path.join(os.homedir(), '.config', 'VSCodium'),
  // macOS
  path.join(os.homedir(), 'Library', 'Application Support', 'Code'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Cursor'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity IDE'),
  path.join(os.homedir(), 'Library', 'Application Support', 'VSCodium'),
];

export interface MigratedSession {
  fileName: string;
  source: string;
  sessionId: string;
  title: string;
  migratedAt: string;
  originalTime: string;
}

export async function migrateClaude(projectPath?: string): Promise<void> {
  const targetPath = resolveProjectPath(projectPath);
  const slug = targetPath.replace(/\//g, '-');
  const projectDir = path.join(CLAUDE_PROJECTS_DIR, slug);
  const plansDir = path.join(targetPath, '.agent-bridge', 'plans');
  await fs.mkdir(plansDir, { recursive: true });

  console.log(`Scanning Claude project directory: ${projectDir}`);
  let entries: string[];
  try {
    entries = await fs.readdir(projectDir);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log('No Claude sessions found for this project.');
      return;
    }
    throw error;
  }

  const jsonlFiles = entries.filter(file => file.endsWith('.jsonl'));
  console.log(`Found ${jsonlFiles.length} potential Claude sessions to migrate.`);

  let migratedCount = 0;

  for (const file of jsonlFiles) {
    const filePath = path.join(projectDir, file);
    const stat = await fs.stat(filePath);
    const sessionId = path.basename(file, '.jsonl');

    const fileContent = await fs.readFile(filePath, 'utf-8');
    const lines = fileContent.split('\n');

    let customTitle = '';
    let firstUserPrompt = '';
    const assistantMessages: string[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const role = obj.message?.role || obj.type;
        const content = obj.message?.content || obj.content;

        if (obj.type === 'custom-title' && obj.customTitle) {
          customTitle = obj.customTitle;
        }
        if (role === 'user' && typeof content === 'string' && !firstUserPrompt && !content.includes('<local-command-caveat>')) {
          firstUserPrompt = content.split('\n')[0].substring(0, 80);
        }
        if (role === 'assistant' && content) {
          if (typeof content === 'string') {
            assistantMessages.push(content);
          } else if (Array.isArray(content)) {
            const textBlocks = content
              .filter(block => block && block.type === 'text' && typeof block.text === 'string')
              .map(block => block.text);
            if (textBlocks.length > 0) {
              assistantMessages.push(textBlocks.join('\n'));
            }
          }
        }
      } catch (e) {}
    }

    const title = customTitle || firstUserPrompt || `Session ${sessionId.substring(0, 8)}`;
    const plan = extractPlan(assistantMessages);
    const checklist = extractChecklist(assistantMessages);

    if (plan || checklist) {
      const formattedPlan = plan || '*(No plan found in session)*';
      const formattedChecklist = checklist || '*(No checklist found in session)*';

      const fileContent = `# Session: ${title}
- Source: Claude Code
- Session ID: ${sessionId}
- Migrated At: ${new Date().toLocaleString()}
- Original Log Time: ${stat.mtime.toLocaleString()}

## Plan
${formattedPlan}

## Tasks Checklist
${formattedChecklist}
`;

      const destFile = path.join(plansDir, `claude-${sessionId}.md`);
      await fs.writeFile(destFile, fileContent, 'utf-8');
      migratedCount++;
    }
  }

  console.log(`✓ Successfully migrated ${migratedCount} Claude sessions to .agent-bridge/plans/`);
}

export async function migrateAntigravity(projectPath?: string): Promise<void> {
  const targetPath = resolveProjectPath(projectPath);
  const plansDir = path.join(targetPath, '.agent-bridge', 'plans');
  await fs.mkdir(plansDir, { recursive: true });

  console.log(`Scanning Antigravity brain directory: ${ANTIGRAVITY_BRAIN_DIR}`);
  let brainDirs: string[];
  try {
    brainDirs = await fs.readdir(ANTIGRAVITY_BRAIN_DIR);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log('No Antigravity sessions found.');
      return;
    }
    throw error;
  }

  let migratedCount = 0;

  for (const dirName of brainDirs) {
    const dirPath = path.join(ANTIGRAVITY_BRAIN_DIR, dirName);
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) continue;

    const transcriptPath = path.join(dirPath, '.system_generated', 'logs', 'transcript.jsonl');
    try {
      const transcriptCheck = await fs.stat(transcriptPath);
      if (!transcriptCheck.isFile()) continue;

      const transcriptContent = await fs.readFile(transcriptPath, 'utf-8');
      
      if (!transcriptContent.includes(targetPath)) {
        continue;
      }

      const taskPath = path.join(dirPath, 'task.md');
      const planPath = path.join(dirPath, 'implementation_plan.md');

      let taskContent = '';
      let planContent = '';

      try {
        taskContent = await fs.readFile(taskPath, 'utf-8');
      } catch (e) {}

      try {
        planContent = await fs.readFile(planPath, 'utf-8');
      } catch (e) {}

      if (taskContent || planContent) {
        let summary = `Antigravity Session ${dirName.substring(0, 8)}`;
        try {
          const metaPath = path.join(dirPath, 'implementation_plan.md.metadata.json');
          const metaRaw = await fs.readFile(metaPath, 'utf-8');
          const meta = JSON.parse(metaRaw);
          if (meta.summary) {
            summary = meta.summary.substring(0, 80);
          }
        } catch (e) {}

        const fileContent = `# Session: ${summary}
- Source: Antigravity
- Session ID: ${dirName}
- Migrated At: ${new Date().toLocaleString()}
- Original Log Time: ${stat.mtime.toLocaleString()}

## Plan
${planContent || '*(No plan found in session)*'}

## Tasks Checklist
${taskContent || '*(No checklist found in session)*'}
`;

        const destFile = path.join(plansDir, `antigravity-${dirName}.md`);
        await fs.writeFile(destFile, fileContent, 'utf-8');
        migratedCount++;
      }

    } catch (e) {
      // Ignore directory read failures
    }
  }

  console.log(`✓ Successfully migrated ${migratedCount} Antigravity sessions to .agent-bridge/plans/`);
}

export async function migrateCodexOrCursor(sourceName: 'Cursor' | 'Codex', projectPath?: string): Promise<void> {
  const targetPath = resolveProjectPath(projectPath);
  const plansDir = path.join(targetPath, '.agent-bridge', 'plans');
  await fs.mkdir(plansDir, { recursive: true });

  console.log(`Scanning for ${sourceName} workspace databases matching project: ${targetPath}`);

  let migratedCount = 0;

  for (const configRoot of CONFIG_ROOTS) {
    const storageDir = path.join(configRoot, 'User', 'workspaceStorage');
    
    let subdirs: string[] = [];
    try {
      subdirs = await fs.readdir(storageDir);
    } catch (e) {
      continue;
    }

    const appName = path.basename(configRoot);

    for (const hash of subdirs) {
      const hashDir = path.join(storageDir, hash);
      const workspaceJsonPath = path.join(hashDir, 'workspace.json');
      const dbPath = path.join(hashDir, 'state.vscdb');

      try {
        const workspaceRaw = await fs.readFile(workspaceJsonPath, 'utf-8');
        const workspaceObj = JSON.parse(workspaceRaw);
        const folderUri = workspaceObj.folder || workspaceObj.workspace?.folders?.[0]?.uri || '';
        const decodedUri = decodeURIComponent(folderUri).replace(/^file:\/\//, '');

        if (decodedUri && path.resolve(decodedUri) === targetPath) {
          const dbStat = await fs.stat(dbPath);
          if (!dbStat.isFile()) continue;

          const records = await queryStateDb(dbPath);

          for (const rec of records) {
            const extractedStrings = findStrings(rec.value);
            const plan = extractPlan(extractedStrings);
            const checklist = extractChecklist(extractedStrings);

            if (plan || checklist) {
              const formattedPlan = plan || '*(No plan found in session)*';
              const formattedChecklist = checklist || '*(No checklist found in session)*';

              const fileContent = `# Session: Resumed from ${sourceName} (${appName})
- Source: ${sourceName}
- Workspace Hash: ${hash}
- Database Key: ${rec.key}
- Migrated At: ${new Date().toLocaleString()}
- Original Log Time: ${dbStat.mtime.toLocaleString()}

## Plan
${formattedPlan}

## Tasks Checklist
${formattedChecklist}
`;

              const cleanKey = rec.key.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30);
              const destFile = path.join(plansDir, `${sourceName.toLowerCase()}-${hash.substring(0, 8)}-${cleanKey}.md`);
              await fs.writeFile(destFile, fileContent, 'utf-8');
              migratedCount++;
            }
          }
        }
      } catch (e) {
        // Ignore single directory load failures
      }
    }
  }

  console.log(`✓ Successfully migrated ${migratedCount} ${sourceName} sessions to .agent-bridge/plans/`);
}

export async function listSessions(projectPath?: string): Promise<MigratedSession[]> {
  const targetPath = resolveProjectPath(projectPath);
  const plansDir = path.join(targetPath, '.agent-bridge', 'plans');
  
  try {
    const entries = await fs.readdir(plansDir);
    const mdFiles = entries.filter(file => file.endsWith('.md'));
    const sessions: MigratedSession[] = [];

    for (const file of mdFiles) {
      const filePath = path.join(plansDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      const titleMatch = content.match(/^# Session:\s*(.+)$/m);
      const sourceMatch = content.match(/^- Source:\s*(.+)$/m);
      const idMatch = content.match(/^- Session ID:\s*(.+)$/m) || content.match(/^- Workspace Hash:\s*(.+)$/m);
      const migratedMatch = content.match(/^- Migrated At:\s*(.+)$/m);
      const originalMatch = content.match(/^- Original Log Time:\s*(.+)$/m);

      sessions.push({
        fileName: file,
        source: sourceMatch ? sourceMatch[1].trim() : 'Unknown',
        sessionId: idMatch ? idMatch[1].trim() : '',
        title: titleMatch ? titleMatch[1].trim() : file,
        migratedAt: migratedMatch ? migratedMatch[1].trim() : '',
        originalTime: originalMatch ? originalMatch[1].trim() : '',
      });
    }

    return sessions.sort((a, b) => new Date(b.originalTime).getTime() - new Date(a.originalTime).getTime());
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function loadSession(fileName: string, projectPath?: string): Promise<void> {
  const targetPath = resolveProjectPath(projectPath);
  const plansDir = path.join(targetPath, '.agent-bridge', 'plans');
  const sourcePath = path.join(plansDir, fileName);

  const content = await fs.readFile(sourcePath, 'utf-8');
  
  const planIndex = content.indexOf('## Plan');
  const checklistIndex = content.indexOf('## Tasks Checklist');

  if (planIndex === -1 || checklistIndex === -1) {
    throw new Error('Invalid session file format. Missing Plan or Tasks Checklist sections.');
  }

  const planContent = content.substring(planIndex + 7, checklistIndex).trim();
  const checklistContent = content.substring(checklistIndex + 18).trim();

  const bridgeDir = path.join(targetPath, '.agent-bridge');
  await fs.mkdir(bridgeDir, { recursive: true });
  
  await fs.writeFile(path.join(bridgeDir, 'plan.md'), `# Active Plan\n\n${planContent}\n`, 'utf-8');
  await fs.writeFile(path.join(bridgeDir, 'tasks.md'), `# Tasks Checklist\n\n${checklistContent}\n`, 'utf-8');
}

async function queryStateDb(dbPath: string): Promise<{ key: string; value: any }[]> {
  const query = "SELECT key, value FROM ItemTable WHERE key LIKE '%chat%' OR key LIKE '%composer%' OR key LIKE 'interactive.%' OR key LIKE '%copilot%'";
  const cmd = `sqlite3 -json "${dbPath}" "${query}"`;
  
  try {
    const { stdout } = await execAsync(cmd);
    if (!stdout.trim()) return [];
    return JSON.parse(stdout);
  } catch (error) {
    const fallbackCmd = `sqlite3 "${dbPath}" "${query}"`;
    const { stdout } = await execAsync(fallbackCmd);
    if (!stdout.trim()) return [];
    
    const lines = stdout.split('\n');
    const records: { key: string; value: any }[] = [];
    for (const line of lines) {
      const idx = line.indexOf('|');
      if (idx === -1) continue;
      const key = line.substring(0, idx);
      const valStr = line.substring(idx + 1);
      try {
        records.push({ key, value: JSON.parse(valStr) });
      } catch (e) {
        records.push({ key, value: valStr });
      }
    }
    return records;
  }
}

function findStrings(val: any, results: string[] = []): string[] {
  if (typeof val === 'string') {
    results.push(val);
  } else if (Array.isArray(val)) {
    for (const item of val) {
      findStrings(item, results);
    }
  } else if (val && typeof val === 'object') {
    for (const key of Object.keys(val)) {
      try {
        findStrings(val[key], results);
      } catch (e) {}
    }
  }
  return results;
}

function extractChecklist(strings: string[]): string | null {
  const taskRegex = /^\s*[-*]\s*\[([ x/])\]\s+(.+)$/gm;
  
  let bestList = '';
  let maxCount = 0;

  for (const str of strings) {
    const matches = str.match(taskRegex);
    if (matches && matches.length > maxCount) {
      maxCount = matches.length;
      bestList = matches.join('\n');
    }
  }
  return maxCount > 0 ? bestList : null;
}

function extractPlan(strings: string[]): string | null {
  const planSectionRegex = /(?:^|\n)(#+\s+(?:Plan|Implementation Plan|Proposed Changes|Roadmap)[\s\S]+?)(?=\n#+|$)/i;

  for (const str of strings) {
    const match = str.match(planSectionRegex);
    if (match) {
      return match[1].trim();
    }
  }

  let longestAssistantText = '';
  for (const str of strings) {
    if (str.length > longestAssistantText.length && (str.includes('###') || str.includes('```'))) {
      longestAssistantText = str;
    }
  }

  if (longestAssistantText) {
    if (longestAssistantText.length > 3000) {
      return longestAssistantText.substring(0, 3000) + '\n\n*(Truncated fallback)*';
    }
    return longestAssistantText;
  }

  return null;
}
