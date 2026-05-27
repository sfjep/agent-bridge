# Agent Bridge

**Agent Bridge** is an open-source local context plane that synchronizes implementation plans, task checklists, and developer memories across different AI coding agents (such as Claude Code, Cursor/Codex, and Antigravity).

Instead of agents dynamically updating task states during live coding sessions—which wastes expensive LLM API tokens—**Agent Bridge** uses an offline command-line utility to explicitly migrate session states, and a local Model Context Protocol (MCP) server to serve them automatically to the next agent on startup.

---

## How It Works

The bridge separates operations into two clean workflows:

1.  **The CLI (Explicit State Sync):** When you run out of tokens or decide to switch agents, you explicitly run a migration command. The CLI parses local log databases (e.g. `~/.claude/projects/` for Claude, or the Antigravity session brain), extracts plans and checklists, and saves them as distinct session files in `.agent-bridge/plans/`.
2.  **The MCP Server (Automatic State Load):** When you boot Cursor, Codex, or Antigravity, they connect to the MCP server. The server exposes tools to list available migrated sessions and load the chosen session's plan and checklist straight into the agent's context.

---

## Installation, Build, and CLI

1.  Clone/initialize this repository on your machine.
2.  Install dependencies:
    ```bash
    pnpm install
    ```
3.  Build the TypeScript files:
    ```bash
    pnpm run build
    ```
4.  Link the binary globally (optional, so you can use the `agent-bridge` command directly):
    ```bash
    npm link
    ```

---

## CLI Command Guide

Run these commands in your project's root directory:

### 1. Migrating Claude Code Sessions
```bash
npx agent-bridge migrate:claude
```
Parses your local Claude session logs for this project (under `~/.claude/projects/`) and exports plans/checklists into `.agent-bridge/plans/claude-[sessionId].md`.

### 2. Migrating Antigravity Sessions
```bash
npx agent-bridge migrate:antigravity
```
Scans your local Antigravity brain sessions, matches logs belonging to the current directory, and exports them into `.agent-bridge/plans/antigravity-[conversationId].md`.

### 3. Listing Available Sessions
```bash
npx agent-bridge list
```
Displays all migrated sessions inside `.agent-bridge/plans/` in chronological order with titles, sources, and log times.

### 4. Loading a Session
```bash
npx agent-bridge load <session-filename>
```
Loads the specified markdown session (e.g. `claude-3bf3112d.md`) as the active plan and checklist in `.agent-bridge/plan.md` and `.agent-bridge/tasks.md`.

---

## Configuring with Agents

Register `agent-bridge` in your agents to allow them to query and select migrated sessions.

### 1. Claude Code
Add the MCP server to your global settings (`~/.claude.json`):
```json
{
  "mcpServers": {
    "agent-bridge": {
      "command": "node",
      "args": ["/home/sfj/code/agent-bridge/build/index.js"]
    }
  }
}
```

### 2. Cursor / Codex
1.  Open Cursor Settings (`Ctrl+Shift+J` or Command Palette -> Cursor Settings).
2.  Navigate to **Features** -> **MCP**.
3.  Click **+ Add New MCP Server**.
4.  Enter the details:
    *   **Name:** `agent-bridge`
    *   **Type:** `command`
    *   **Command:** `node /home/sfj/code/agent-bridge/build/index.js`
5.  Click **Save**.

---

## Exposed MCP Tools

When connected as an MCP server, the following tools are available to the active agent:

*   **`get_session_status`**: Reads the active `.agent-bridge/plan.md` and `.agent-bridge/tasks.md` into the agent's context.
*   **`list_migrated_sessions`**: Lists all session files available inside `.agent-bridge/plans/`.
*   **`load_migrated_session`**: Takes a `fileName` parameter and sets it as the active plan/tasks.
*   **`update_task_ledger`**: Overwrites the active tasks list.
*   **`update_plan`**: Overwrites the active plan.
*   **`record_memory`**: Appends bullet points to project or global memory.
*   **`get_memories`**: Retrieves matching project/global memories.
