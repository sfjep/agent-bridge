import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { resolveProjectPath } from './storage.js';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const ANTIGRAVITY_BRAIN_DIR = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');

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
      
      // Verify if the conversation maps to this project path
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
      // Ignore directories that fail to load
    }
  }

  console.log(`✓ Successfully migrated ${migratedCount} Antigravity sessions to .agent-bridge/plans/`);
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
      const idMatch = content.match(/^- Session ID:\s*(.+)$/m);
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

function extractChecklist(messages: string[]): string | null {
  const taskRegex = /^\s*[-*]\s*\[([ x/])\]\s+(.+)$/gm;
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i];
    const matches = content.match(taskRegex);
    if (matches && matches.length > 0) {
      return matches.join('\n');
    }
  }
  return null;
}

function extractPlan(messages: string[]): string | null {
  const planSectionRegex = /(?:^|\n)(#+\s+(?:Plan|Implementation Plan|Proposed Changes|Roadmap)[\s\S]+?)(?=\n#+|$)/i;
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i];
    const match = content.match(planSectionRegex);
    if (match) {
      return match[1].trim();
    }
  }
  if (messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.length > 2000) {
      return lastMsg.substring(0, 2000) + '\n\n*(Truncated fallback)*';
    }
    return lastMsg;
  }
  return null;
}
