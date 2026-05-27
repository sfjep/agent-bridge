import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import * as storage from "./storage.js";

const server = new Server(
  {
    name: "agent-bridge-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_session_status",
        description: "Retrieve the active session details (implementation plan, tasks checklist, project and global memories). Call this when starting a session or checking context.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Optional absolute path of the target project directory. Defaults to the current working directory of the process.",
            },
          },
        },
      },
      {
        name: "update_task_ledger",
        description: "Overwrite the active tasks list (tasks.md) for the project. Call this whenever tasks are checked off, added, or updated in detail.",
        inputSchema: {
          type: "object",
          properties: {
            tasksMarkdown: {
              type: "string",
              description: "The complete, updated markdown content of the task checklist.",
            },
            projectPath: {
              type: "string",
              description: "Optional absolute path of the target project directory. Defaults to the current working directory of the process.",
            },
          },
          required: ["tasksMarkdown"],
        },
      },
      {
        name: "update_plan",
        description: "Overwrite the active implementation plan (plan.md) for the project. Call this when introducing a new plan or changing architecture/objectives.",
        inputSchema: {
          type: "object",
          properties: {
            planMarkdown: {
              type: "string",
              description: "The complete, updated markdown content of the implementation plan.",
            },
            projectPath: {
              type: "string",
              description: "Optional absolute path of the target project directory. Defaults to the current working directory of the process.",
            },
          },
          required: ["planMarkdown"],
        },
      },
      {
        name: "record_memory",
        description: "Append a new memory or fact (e.g. user preferences, tech stack constraints, developer workflow notes) to either project-level memory or global memory.",
        inputSchema: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The memory bullet point text to save.",
            },
            scope: {
              type: "string",
              enum: ["project", "global"],
              description: "Scope of the memory. 'project' binds it to this codebase; 'global' makes it available across all your projects.",
            },
            projectPath: {
              type: "string",
              description: "Optional absolute path of the target project directory (ignored for global scope).",
            },
          },
          required: ["content", "scope"],
        },
      },
      {
        name: "get_memories",
        description: "Search/retrieve memories recorded for the project or globally.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Optional absolute path of the target project directory.",
            },
            query: {
              type: "string",
              description: "Optional substring filter to match memory bullet points case-insensitively.",
            },
          },
        },
      },
    ],
  };
});

// Handle tool execution requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_session_status": {
        const projectPath = args?.projectPath as string | undefined;
        const status = await storage.getSessionStatus(projectPath);
        return {
          content: [
            {
              type: "text",
              text: `## ACTIVE PLAN\n\n${status.plan}\n\n## ACTIVE TASKS\n\n${status.tasks}\n\n## PROJECT MEMORIES\n\n${status.projectMemory}\n\n## GLOBAL MEMORIES\n\n${status.globalMemory}`,
            },
          ],
        };
      }

      case "update_task_ledger": {
        const tasksMarkdown = args?.tasksMarkdown as string;
        const projectPath = args?.projectPath as string | undefined;
        
        if (!tasksMarkdown) {
          throw new McpError(ErrorCode.InvalidParams, "Missing tasksMarkdown parameter");
        }

        await storage.updateTasks(tasksMarkdown, projectPath);
        return {
          content: [
            {
              type: "text",
              text: "Successfully updated task ledger.",
            },
          ],
        };
      }

      case "update_plan": {
        const planMarkdown = args?.planMarkdown as string;
        const projectPath = args?.projectPath as string | undefined;

        if (!planMarkdown) {
          throw new McpError(ErrorCode.InvalidParams, "Missing planMarkdown parameter");
        }

        await storage.updatePlan(planMarkdown, projectPath);
        return {
          content: [
            {
              type: "text",
              text: "Successfully updated active plan.",
            },
          ],
        };
      }

      case "record_memory": {
        const content = args?.content as string;
        const scope = args?.scope as 'project' | 'global';
        const projectPath = args?.projectPath as string | undefined;

        if (!content || !scope) {
          throw new McpError(ErrorCode.InvalidParams, "Missing content or scope parameter");
        }
        if (scope !== "project" && scope !== "global") {
          throw new McpError(ErrorCode.InvalidParams, "Invalid scope. Must be 'project' or 'global'");
        }

        await storage.recordMemory(content, scope, projectPath);
        return {
          content: [
            {
              type: "text",
              text: `Successfully recorded ${scope} memory.`,
            },
          ],
        };
      }

      case "get_memories": {
        const projectPath = args?.projectPath as string | undefined;
        const query = args?.query as string | undefined;

        const results = await storage.getMemories(projectPath, query);
        const projectText = results.project.length > 0 
          ? results.project.join('\n') 
          : "*(No matching project memories)*";
        const globalText = results.global.length > 0 
          ? results.global.join('\n') 
          : "*(No matching global memories)*";

        return {
          content: [
            {
              type: "text",
              text: `### Project Memories:\n${projectText}\n\n### Global Memories:\n${globalText}`,
            },
          ],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error: any) {
    if (error instanceof McpError) {
      throw error;
    }
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error executing tool '${name}': ${error.message || error}`,
        },
      ],
    };
  }
});

// Run the server using stdio transport
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Agent Bridge MCP server running on stdio");
}

run().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
