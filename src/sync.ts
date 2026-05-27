import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { resolveProjectPath } from './storage.js';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

async function findLatestSessionLog(projectSlug: string): Promise<string | null> {
  const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectSlug);
  
  try {
    const entries = await fs.readdir(projectDir);
    const jsonlFiles = entries.filter(file => file.endsWith('.jsonl'));
    
    if (jsonlFiles.length === 0) {
      return null;
    }

    let latestFile: string | null = null;
    let latestMtime = 0;

    for (const file of jsonlFiles) {
      const filePath = path.join(projectDir, file);
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latestFile = filePath;
      }
    }

    return latestFile;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function extractChecklist(messages: string[]): string | null {
  const taskRegex = /^\s*[-*]\s*\[([ x/])\]\s+(.+)$/gm;

  // Search backward from the latest message
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
  // Look for sections starting with plan headers
  const planSectionRegex = /(?:^|\n)(#+\s+(?:Plan|Implementation Plan|Proposed Changes|Roadmap)[\s\S]+?)(?=\n#+|$)/i;

  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i];
    const match = content.match(planSectionRegex);
    if (match) {
      return match[1].trim();
    }
  }

  // Fallback: take the last assistant message as a general plan/summary
  if (messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    // Limit size if it's huge
    if (lastMsg.length > 2000) {
      return lastMsg.substring(0, 2000) + '\n\n*(Truncated fallback)*';
    }
    return lastMsg;
  }

  return null;
}

export async function runSync() {
  const targetPath = resolveProjectPath();
  const slug = targetPath.replace(/\//g, '-');
  
  console.log(`Resolving project path: ${targetPath}`);
  console.log(`Looking for Claude session logs for: ${slug}`);

  const logFile = await findLatestSessionLog(slug);
  if (!logFile) {
    console.error(`No Claude session logs found for project slug: ${slug}`);
    console.error(`Make sure you have run Claude Code inside this project first.`);
    process.exit(1);
  }

  console.log(`Parsing latest session log: ${path.basename(logFile)}`);

  const fileContent = await fs.readFile(logFile, 'utf-8');
  const lines = fileContent.split('\n');
  const assistantMessages: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const role = obj.message?.role || obj.type;
      const content = obj.message?.content || obj.content;

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
    } catch (e) {
      // Ignore JSON parse errors on malformed lines
    }
  }

  console.log(`Found ${assistantMessages.length} assistant responses in log.`);

  const checklist = extractChecklist(assistantMessages);
  const plan = extractPlan(assistantMessages);

  const bridgeDir = path.join(targetPath, '.agent-bridge');
  await fs.mkdir(bridgeDir, { recursive: true });

  const timestamp = new Date().toLocaleString();

  if (checklist) {
    const finalChecklist = `# Tasks Checklist (Synced)\n\n*Sync Timestamp: ${timestamp}*\n\n${checklist}\n`;
    await fs.writeFile(path.join(bridgeDir, 'tasks.md'), finalChecklist, 'utf-8');
    console.log(`✓ Synchronized tasks checklist to .agent-bridge/tasks.md`);
  } else {
    console.log(`No checklist found in transcript. Skipped writing tasks.md.`);
  }

  if (plan) {
    const finalPlan = `# Active Plan (Synced)\n\n*Sync Timestamp: ${timestamp}*\n\n${plan}\n`;
    await fs.writeFile(path.join(bridgeDir, 'plan.md'), finalPlan, 'utf-8');
    console.log(`✓ Synchronized active plan to .agent-bridge/plan.md`);
  } else {
    console.log(`No plan/summary found in transcript. Skipped writing plan.md.`);
  }
  
  console.log('Zero-token sync completed successfully.');
}
