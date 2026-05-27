# Agent Bridge

Switch between AI coding agents without losing your place. Agent Bridge reads
the session logs that Claude Code, Antigravity, Cursor, and Codex already write
to your disk, distills the current plan and task checklist for a project, and
writes them to one portable file: `.agent-bridge/CONTEXT.md`. The next agent
reads that file and picks up where the last one stopped.

One command, no daemon, no API keys, no LLM calls.

## The token story (read this, it's the whole point)

Agent Bridge does its extraction in plain Node, never an LLM. Asking an agent to
"read all my past sessions and tell me where we left off" would feed millions of
tokens of raw session JSON into a context window. Agent Bridge parses those logs
deterministically and emits a ~1 KB markdown snapshot for **zero LLM tokens**.

What it does *not* claim: that reading the result is free. Any agent that loads
`CONTEXT.md` pays tokens for those bytes, the same as reading any file. The win
is the distillation (huge logs to a tiny artifact) and the portability (one
agent's state, readable by another), not magic from storing things locally.

## Install

```bash
git clone https://github.com/sfjep/agent-bridge.git
cd agent-bridge
pnpm install
pnpm run build
npm link   # optional: puts `agent-bridge` on your PATH
```

## Usage

Run in your project directory (or pass a path):

```bash
agent-bridge pull          # write .agent-bridge/CONTEXT.md for this project
agent-bridge list          # show the sessions found, write nothing
agent-bridge pull ~/code/myapp
```

`pull` prints which session each part came from:

```
Scanned 7 session(s) for /home/sfj/code/myapp
  checklist: Claude Code (a1b2c3d4)
  plan:      Antigravity (8f27f6c7)
Wrote .agent-bridge/CONTEXT.md
```

## Having an agent consume it

There is no MCP server and no auto-magic. You point the agent at the file. Add a
line to your agent's project instructions (`CLAUDE.md`, `AGENT.md`, Cursor rules,
etc.):

> At the start of a session, read `.agent-bridge/CONTEXT.md` if it exists. It is
> a handoff snapshot of the plan and task checklist from the previous agent.

Typical flow: you hit a rate limit in Claude, run `agent-bridge pull` in your
terminal (zero tokens), open Cursor, and it reads the snapshot on startup.

## What it reads, and how it matches

| Agent | Source | Project match | Checklist | Plan |
| --- | --- | --- | --- | --- |
| Claude Code | `~/.claude/projects/<slug>/*.jsonl` | exact (path-derived slug) | reconstructed from `TaskCreate`/`TaskUpdate` (or legacy `TodoWrite`) | last `ExitPlanMode` plan |
| Antigravity | `~/.gemini/antigravity-*/brain/*/` | most-referenced project in transcript | `task.md` | `implementation_plan.md` |
| Cursor / Codex | VS Code-family `workspaceStorage/*/state.vscdb` | exact (`workspace.json` folder URI) | markdown in chat state | markdown in chat state |

Extraction prefers each agent's **authoritative tool state** over scraping prose.
For Claude that means replaying the task-tool event stream to its current state
(an `in_progress` then `completed` task shows as done) and lifting the plan the
user actually approved, not a checklist the model happened to print mid-message.
Where no structured state exists (Cursor/Codex), it falls back to the latest
markdown checklist and plan-style heading found in the session.

Antigravity transcripts carry no clean working-directory field and mention other
projects' paths freely, so attribution goes to the project a session references
*most*, not any project it merely mentions.

Selection is recency-biased: across all of a project's sessions, the checklist
and plan each come from the most recent session that actually has one.

## Limitations

- Cursor/Codex have no documented task schema, so they fall back to markdown
  scraping of chat state; quality depends on what the agent wrote inline.
- Cursor/Codex extraction shells out to `sqlite3`; install it if missing.
- This is a snapshot tool, not a sync engine. Re-run `pull` to refresh.

## Development

```bash
pnpm test          # vitest
pnpm run build     # tsc -> build/
```

## License

MIT
