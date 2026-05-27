# Agent Bridge MCP Server

**Agent Bridge** is an open-source local context plane that synchronizes implementation plans, task checklists, and developer memories across different AI coding agents (such as Claude Code, Cursor/Codex, and Antigravity).

By running a shared Model Context Protocol (MCP) server, different agents can read and write to the same session state. If you run out of tokens in Claude, you can switch to Antigravity or Cursor, and they will pick up exactly where you left off.

---

## How It Works

The bridge organizes context into two main scopes:

1.  **Project Context (Local):** Stored inside the `.agent-bridge/` folder in your project's root:
    *   `plan.md` - The active architectural layout or implementation plan.
    *   `tasks.md` - The checklist of items to build, mark complete, or refine.
    *   `memory.md` - Key project facts, design decisions, and database schemas.
2.  **User Context (Global):** Stored inside `~/.config/agent-bridge/`:
    *   `memory.md` - User coding style preferences, guidelines, or cross-project rules.

---

## Installation & Build

1.  Clone/initialize this repository on your machine.
2.  Install dependencies:
    ```bash
    pnpm install
    ```
3.  Build the TypeScript files:
    ```bash
    pnpm run build
    ```

---

## Configuring with Agents

To connect your coding agents to this shared brain, register it in their respective configuration interfaces.

### 1. Claude Code
Add the MCP server configuration to your global Claude settings file (`~/.claude.json`):

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

*Tip:* You can instruct Claude in your project's `CLAUDE.md` or user system prompt to always call `get_session_status` at startup to fetch the shared state.

### 2. Cursor / Codex
1.  Open Cursor Settings (`Ctrl+Shift+J` or Command Palette -> Cursor Settings).
2.  Navigate to **Features** -> **MCP**.
3.  Click **+ Add New MCP Server**.
4.  Enter the details:
    *   **Name:** `agent-bridge`
    *   **Type:** `command`
    *   **Command:** `node /home/sfj/code/agent-bridge/build/index.js`
5.  Click **Save**. Cursor's composer/agent will now have access to the status and memory tools.

### 3. Antigravity
Configure the server command in your Antigravity MCP settings:

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

---

## Exposed MCP Tools

The server exposes the following tools:

*   **`get_session_status`**: Reads the active `plan.md`, `tasks.md`, and project/global memories. Use this on startup to understand the current task state.
*   **`update_task_ledger`**: Overwrites the workspace's `tasks.md` todo list. Use this to check off items or add subtasks.
*   **`update_plan`**: Overwrites the workspace's `plan.md`. Use this to set or update technical layouts.
*   **`record_memory`**: Appends a bullet point to project-level or global-level memory. Use this when learning project constraints, database details, or workflow preferences.
*   **`get_memories`**: Retrieves project/global memories matching an optional string query.
