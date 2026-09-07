/**
 * mcp-server.ts — MCP Server exposing persistent AI memory tools via stdio transport.
 *
 * Tools:
 *  - brain_recall   : semantic memory search (multi-factor ranked, token-capped, scoped, multi-agent)
 *  - brain_status   : brain health, diagnostics, agent breakdown, validation stats
 *  - brain_learn    : store durable knowledge, rules, decisions with quality guard & contradiction check
 *  - brain_validate : validate & reinforce existing memory usefulness across agents
 *  - brain_trace    : full chronological memory & fix history for a file with agent provenance
 *  - brain_forget   : remove or deprecate specific memories by ID, path, or query
 *  - brain_prune    : clean up stale or deprecated memories after refactors
 *
 * Compatible with: Claude Code, Cursor, Antigravity, GitHub Copilot, Windsurf, Zed.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { simpleGit } from "simple-git";

import {
  getDb,
  insertMemory,
  insertEmbedding,
  pruneByStatus,
  forgetMemory,
  getDbStats,
  findDuplicateMemory,
  mergeMemory,
  validateMemory,
  detectContradictions,
  markContradiction,
  resolveDbPath,
  type MemoryCategory,
} from "./db.js";
import { embed, warmupEmbeddings, estimateTokens } from "./embeddings.js";
import { recallMemories, formatRecallMarkdown, traceFile } from "./recall.js";
import { runInvalidationPass } from "./invalidation.js";
import { derivePackageScope } from "./scoping.js";
import { evaluateMemoryQuality, extractReferencedFiles, detectImportanceLevel } from "./quality.js";
import {
  detectAgent,
  normalizeAgentId,
  getProjectId,
  type AgentId,
  type ImportanceLevel,
} from "./provenance.js";
import { VERSION } from "./version.js";
import {
  MAX_LESSON_LENGTH,
  DUPLICATE_SIMILARITY_THRESHOLD,
  MAX_RESPONSE_TOKENS,
} from "./config.js";
import { debugLog } from "./debug.js";

// ─── Server State ─────────────────────────────────────────────────────────────

const SERVER_NAME = "local-brain-mcp";

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  "fix",
  "architecture",
  "convention",
  "bug",
  "manual",
]);

const db = getDb();
const git = simpleGit(process.cwd());

// ─── Tool Definitions with Precise MCP Annotations ───────────────────────────

export const MCP_TOOLS: Tool[] = [
  {
    name: "brain_recall",
    description: [
      "Semantically search your local codebase memory across all agents.",
      "Returns the most relevant lessons, bug fixes, architecture decisions, and conventions",
      "from your git history and AI sessions — filtered to current file and package scope.",
      "Results are ranked deterministically with validation boost and contradiction penalties,",
      `token-capped to stay within ${MAX_RESPONSE_TOKENS} tokens.`,
    ].join(" "),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'What to search for. Plain English, e.g. "JWT auth bug" or "database connection pooling".',
        },
        file_path: {
          type: "string",
          description:
            "Optional: current file path (repo-relative). Narrows search to relevant file and package scope.",
        },
        max_items: {
          type: "number",
          description: "Maximum memories to return (default: 5, max: 10).",
          default: 5,
        },
        category: {
          type: "string",
          enum: ["fix", "architecture", "convention", "bug", "manual"],
          description: "Optional: filter by memory category.",
        },
        min_confidence: {
          type: "number",
          description: "Optional: minimum confidence threshold (0.0 to 1.0, default: 0.0).",
          default: 0.0,
        },
        include_deprecated: {
          type: "boolean",
          description: "Optional: include stale and deprecated memories (default: false).",
          default: false,
        },
        agent_filter: {
          type: "string",
          description:
            'Optional: filter memories created by a specific agent (e.g. "claude-code", "cursor", "antigravity").',
        },
      },
      required: ["query"],
    },
  },
  {
    name: "brain_status",
    description: [
      "Get system diagnostics, memory statistics, multi-agent breakdown, and validation health.",
      "Returns total memory count, breakdown by agent, validation counts, contradiction flags,",
      "and database storage path.",
    ].join(" "),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "brain_learn",
    description: [
      "Store a new durable lesson, architecture decision, bug root-cause, or team convention.",
      "Includes automatic multi-agent attribution, quality evaluation, deduplication,",
      "contradiction detection, and supersession tracking.",
      'Examples: "Never use RS256 in dev", "JWT refresh token expires in 7d; rotate on each use".',
    ].join(" "),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        lesson: {
          type: "string",
          description: "The lesson, rule, or decision to remember. Be specific and actionable.",
        },
        category: {
          type: "string",
          enum: ["fix", "architecture", "convention", "bug", "manual"],
          description: "Category for this memory.",
          default: "manual",
        },
        file_path: {
          type: "string",
          description: "Optional: the primary file this lesson applies to.",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Optional: array of related files.",
        },
        confidence: {
          type: "number",
          description: "Confidence rating from 0.0 to 1.0 (default: 1.0).",
          default: 1.0,
        },
        importance: {
          type: "number",
          description: "Importance multiplier from 0.1 to 2.0 (default: 1.0).",
          default: 1.0,
        },
        importance_level: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Optional: importance level (default: automatically detected from content).",
        },
        agent: {
          type: "string",
          description:
            'Optional: agent name creating this memory (e.g. "claude-code", "cursor", "antigravity"). Auto-detected if omitted.',
        },
        supersedes_id: {
          type: "number",
          description:
            "Optional: ID of an older memory that is superseded/replaced by this new lesson.",
        },
      },
      required: ["lesson"],
    },
  },
  {
    name: "brain_validate",
    description: [
      "Validate that an existing memory was helpful and correct in the current session.",
      "Increments the memory validation count, records the validating agent, and boosts confidence.",
    ].join(" "),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "The memory ID to validate.",
        },
        agent: {
          type: "string",
          description: "Optional: validating agent identifier. Auto-detected if omitted.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "brain_trace",
    description: [
      "Show all memory entries associated with a specific file across all agents.",
      "Returns the full fix history, architecture decisions, past bugs, and agent attribution",
      "for that file in chronological order. Includes confidence and status flags.",
    ].join(" "),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: 'Repo-relative file path to trace (e.g. "src/auth/jwt.ts").',
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "brain_forget",
    description: [
      "Remove or deprecate specific memories from Local Brain.",
      "Can target a memory by ID, file path, or search query.",
      "By default deprecates the memory to maintain audit trail; pass hard_delete: true to purge.",
    ].join(" "),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "Exact memory ID to forget.",
        },
        memory_id: {
          type: "number",
          description: "Alias for id.",
        },
        file_path: {
          type: "string",
          description: "Forget all memories associated with this file path.",
        },
        query: {
          type: "string",
          description: "Forget memories matching this text/topic.",
        },
        hard_delete: {
          type: "boolean",
          description:
            "If true, permanently deletes records from SQLite. Default is false (marks deprecated).",
          default: false,
        },
      },
    },
  },
  {
    name: "brain_prune",
    description: [
      "Clean up stale or deprecated memories from the brain.",
      "Run this after major refactors to prevent outdated context from polluting recalls.",
      "Optionally runs the full git-diff invalidation pass to detect modified/deleted files.",
    ].join(" "),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["stale", "deprecated", "all"],
          description: "Which memories to remove.",
          default: "stale",
        },
        run_invalidation: {
          type: "boolean",
          description: "If true, run the full git-based stale detection pass first.",
          default: false,
        },
      },
    },
  },
];

// ─── MCP Server Instance ───────────────────────────────────────────────────────

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: "local-brain-mcp",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MCP_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // ── brain_recall ──────────────────────────────────────────────────────────
    if (name === "brain_recall") {
      const rawQuery = args?.query;
      const query = typeof rawQuery === "string" ? rawQuery.trim() : "";

      if (!query) {
        return { content: [{ type: "text", text: "Error: query is required." }], isError: true };
      }

      if (args?.max_items !== undefined) {
        const mi = Number(args.max_items);
        if (typeof args.max_items !== "number" || isNaN(mi) || !Number.isFinite(mi) || mi <= 0) {
          return {
            content: [{ type: "text", text: "Error: max_items must be a valid integer > 0." }],
            isError: true,
          };
        }
      }

      if (args?.category && !VALID_CATEGORIES.has(String(args.category))) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Invalid category '${String(args.category)}'. Valid: ${Array.from(VALID_CATEGORIES).join(", ")}`,
            },
          ],
          isError: true,
        };
      }

      const file_path = args?.file_path ? String(args.file_path) : undefined;
      const max_items = Math.min(Math.max(1, Number(args?.max_items ?? 5)), 10);
      const category = args?.category as MemoryCategory | undefined;
      const min_confidence =
        typeof args?.min_confidence === "number" ? Number(args.min_confidence) : 0.0;
      const include_deprecated = Boolean(args?.include_deprecated ?? false);
      const agent_filter = args?.agent_filter ? String(args.agent_filter).trim() : undefined;

      try {
        const result = await recallMemories(db, {
          query,
          file_path,
          max_items,
          category,
          min_confidence,
          include_deprecated,
          agent_filter,
        });
        const markdown = formatRecallMarkdown(result, query);

        return {
          content: [
            {
              type: "text",
              text: markdown,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error during recall: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // ── brain_status ──────────────────────────────────────────────────────────
    if (name === "brain_status") {
      const stats = getDbStats(db);
      const projectId = getProjectId();
      let headHash = "unknown";
      let headBranch = "unknown";
      try {
        headHash = (await git.revparse(["HEAD"])).trim().slice(0, 7);
        headBranch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
      } catch (e) {
        debugLog("mcp", "Failed to get git info: %s", e instanceof Error ? e.message : String(e));
      }

      const agentList =
        Object.entries(stats.agent_breakdown)
          .map(([ag, count]) => `${ag}: ${count}`)
          .join(", ") || "none";

      const statusText = [
        "🧠 **Local Brain MCP Status**",
        `• Server Version: v${VERSION}`,
        `• **Database Path:** \`${resolveDbPath()}\``,
        `• **Project ID:** \`${projectId}\``,
        `• **Git Head:** \`${headBranch}\` @ \`${headHash}\``,
        `• **Total Memories:** ${stats.total}`,
        `• **Active:** ${stats.active}`,
        `• **Stale:** ${stats.stale}`,
        `• **Deprecated / Superseded:** ${stats.deprecated} (${stats.superseded} superseded)`,
        `• **Validated Memories:** ${stats.validated}`,
        `• **Contradictions Flagged:** ${stats.contradicted}`,
        `• **Agent Breakdown:** ${agentList}`,
        `• **Embedding Engine:** Local pure Float32Array cosine similarity (384-dim)`,
        `• **Ranking:** Multi-factor deterministic with recency decay`,
        `• **Source:** ${stats.from_git} from Git history, ${stats.manual} manual/AI lessons`,
        `• **Commits Ingested:** ${stats.commits_ingested}`,
        `• **Tracked File Snapshots:** ${stats.file_snapshots}`,
      ].join("\n");

      return {
        content: [
          {
            type: "text",
            text: statusText,
          },
        ],
      };
    }

    // ── brain_learn ───────────────────────────────────────────────────────────
    if (name === "brain_learn") {
      const lessonRaw = args?.lesson;
      const lesson = typeof lessonRaw === "string" ? lessonRaw.trim() : "";
      const category = (args?.category as MemoryCategory) ?? "manual";
      let file_path = args?.file_path ? String(args.file_path).trim() : null;
      const rawFiles = args?.files;
      const confidence = typeof args?.confidence === "number" ? Number(args.confidence) : 1.0;
      const importance = typeof args?.importance === "number" ? Number(args.importance) : 1.0;
      const rawAgent = args?.agent ? String(args.agent).trim() : undefined;
      const agent: AgentId = rawAgent ? normalizeAgentId(rawAgent) : detectAgent();
      const importance_level: ImportanceLevel =
        (args?.importance_level as ImportanceLevel) || detectImportanceLevel(lesson);
      const supersedes_id =
        typeof args?.supersedes_id === "number" ? Number(args.supersedes_id) : undefined;

      if (!lesson) {
        return { content: [{ type: "text", text: "Error: lesson is required." }], isError: true };
      }

      if (lesson.length > MAX_LESSON_LENGTH) {
        return {
          content: [
            {
              type: "text",
              text: `Error: lesson exceeds maximum length of ${MAX_LESSON_LENGTH} characters.`,
            },
          ],
          isError: true,
        };
      }

      // Memory quality guard
      const quality = evaluateMemoryQuality(lesson, category);
      if (!quality.isQuality) {
        return {
          content: [
            {
              type: "text",
              text: `⚠️ Memory rejected by quality filter: ${quality.reason ?? "Low signal or ephemeral noise."}\nPlease provide actionable engineering context.`,
            },
          ],
          isError: true,
        };
      }

      // Automatically extract referenced files if none supplied
      let filesList: string[];
      if (Array.isArray(rawFiles)) {
        filesList = rawFiles.map(String);
      } else if (file_path) {
        filesList = [file_path];
      } else {
        filesList = extractReferencedFiles(lesson);
        if (filesList.length > 0 && !file_path) {
          file_path = filesList[0];
        }
      }

      let headHash: string | null = null;
      let headRef: string | null = null;
      try {
        headHash = (await git.revparse(["HEAD"])).trim();
        headRef = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
      } catch (e) {
        debugLog(
          "mcp",
          "Failed to get git info for brain_learn: %s",
          e instanceof Error ? e.message : String(e)
        );
      }

      const projectId = getProjectId();
      const packageScope = derivePackageScope(file_path);
      const embedding = embed(lesson);

      // Duplicate check & smart merge
      const dup = findDuplicateMemory(
        db,
        embedding,
        lesson,
        file_path,
        DUPLICATE_SIMILARITY_THRESHOLD
      );
      if (dup && !supersedes_id) {
        mergeMemory(db, dup.match.id, {
          category,
          content: lesson,
          summary: lesson.slice(0, 400),
          file_path,
          confidence,
          importance,
          agent,
          project_id: projectId,
        });

        const dupDesc = dup.isExact
          ? "Exact matching memory already exists in local brain (merged)."
          : `Knowledge updated in existing memory (id: ${dup.match.id}, ${Math.round(dup.similarity * 100)}% similarity)`;

        return {
          content: [
            {
              type: "text",
              text: `🔄 ${dupDesc}\n• Agent: ${agent}\n• Category: ${category}\n• File: ${file_path ?? "general"}\n• Confidence: ${Math.round(confidence * 100)}%`,
            },
          ],
        };
      }

      // Contradiction detection
      const contradictionCheck = detectContradictions(db, embedding, lesson, projectId);
      const contradictionFlag = contradictionCheck.contradictedIds.length > 0 ? 1 : 0;
      const contradictionIdsJson =
        contradictionFlag === 1 ? JSON.stringify(contradictionCheck.contradictedIds) : null;

      const rowid = insertMemory(
        db,
        {
          category,
          content: lesson,
          summary: lesson.slice(0, 400),
          file_path,
          files: JSON.stringify(filesList),
          package_scope: packageScope,
          commit_hash: headHash,
          git_ref: headRef,
          branch: headRef,
          project_id: projectId,
          agent,
          importance_level,
          contradiction_flag: contradictionFlag,
          contradiction_ids: contradictionIdsJson,
          confidence,
          importance,
          quality_score: quality.score,
          status: "active",
          source: "manual",
          supersedes_id: supersedes_id ?? null,
          token_count: estimateTokens(lesson),
        },
        embedding
      );

      insertEmbedding(db, rowid, embedding);

      // Mark contradictions bilaterally
      if (contradictionCheck.contradictedIds.length > 0) {
        for (const cid of contradictionCheck.contradictedIds) {
          markContradiction(db, rowid, cid);
        }
      }

      const supersedesMsg = supersedes_id ? `\n• Supersedes memory id: ${supersedes_id}` : "";
      const contradictionMsg =
        contradictionFlag === 1
          ? `\n⚠️ Contradiction detected with active memories: ${contradictionCheck.contradictedIds.map((i) => `#${i}`).join(", ")}`
          : "";

      return {
        content: [
          {
            type: "text",
            text: `✅ Memory stored (id: ${rowid})\n• Agent: ${agent}\n• Category: ${category}\n• File: ${file_path ?? "general"}\n• Importance: ${importance_level}\n• Commit: ${headHash?.slice(0, 7) ?? "n/a"}\n• Quality score: ${quality.score}\n• Confidence: ${Math.round(confidence * 100)}%${supersedesMsg}${contradictionMsg}`,
          },
        ],
      };
    }

    // ── brain_validate ────────────────────────────────────────────────────────
    if (name === "brain_validate") {
      const id = typeof args?.id === "number" ? Number(args.id) : undefined;
      const rawAgent = args?.agent ? String(args.agent).trim() : undefined;
      const agent: AgentId = rawAgent ? normalizeAgentId(rawAgent) : detectAgent();

      if (id === undefined) {
        return { content: [{ type: "text", text: "Error: id is required." }], isError: true };
      }

      const ok = validateMemory(db, id, agent);
      if (!ok) {
        return {
          content: [{ type: "text", text: `Error: Memory #${id} not found.` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `✨ Memory #${id} validated by agent '${agent}'. Validation count and confidence incremented.`,
          },
        ],
      };
    }

    // ── brain_trace ───────────────────────────────────────────────────────────
    if (name === "brain_trace") {
      const file_path = String(args?.file_path ?? "").trim();
      if (!file_path) {
        return {
          content: [{ type: "text", text: "Error: file_path is required." }],
          isError: true,
        };
      }

      const memories = traceFile(db, file_path);

      if (memories.length === 0) {
        return {
          content: [{ type: "text", text: `No memories found for: ${file_path}` }],
        };
      }

      const lines = memories.map((m) => {
        const status = m.status !== "active" ? ` [${m.status.toUpperCase()}]` : "";
        const superseded = m.superseded_by ? ` [SUPERSEDED by #${m.superseded_by}]` : "";
        const commit = m.commit_hash ? ` @ ${m.commit_hash.slice(0, 7)}` : "";
        const agentTag = m.agent && m.agent !== "unknown" ? ` [agent: ${m.agent}]` : "";
        const valTag = (m.validation_count ?? 0) > 0 ? ` [validated: ${m.validation_count}×]` : "";
        const conf = ` (${Math.round((m.confidence ?? 1.0) * 100)}% conf)`;
        return `• #${m.id} [${m.category}${status}${superseded}${agentTag}${valTag}${commit}${conf}]: ${m.summary.slice(0, 200)}`;
      });

      return {
        content: [
          {
            type: "text",
            text: [`## Trace: ${file_path}`, ...lines].join("\n"),
          },
        ],
      };
    }

    // ── brain_forget ──────────────────────────────────────────────────────────
    if (name === "brain_forget") {
      const id =
        typeof args?.id === "number"
          ? Number(args.id)
          : typeof args?.memory_id === "number"
            ? Number(args.memory_id)
            : undefined;
      const file_path = args?.file_path ? String(args.file_path).trim() : undefined;
      const query = args?.query ? String(args.query).trim() : undefined;
      const hardDelete =
        typeof args?.hard_delete === "boolean"
          ? args.hard_delete
          : typeof args?.memory_id === "number"
            ? true
            : false;

      if (id === undefined && !file_path && !query) {
        return {
          content: [
            { type: "text", text: "Error: Must specify id, file_path, or query to forget." },
          ],
          isError: true,
        };
      }

      const result = forgetMemory(db, { id, filePath: file_path, query, hardDelete });

      if (result.count === 0) {
        const msg =
          id !== undefined
            ? `Memory #${id} was not found.`
            : "No matching memories found to forget.";
        return {
          content: [{ type: "text", text: msg }],
          isError: true,
        };
      }

      const action = hardDelete ? "permanently deleted" : "Deprecated";
      return {
        content: [
          {
            type: "text",
            text: `🗑️ Memory ${action} successfully (${result.count} record(s): ${result.affectedIds.join(", ")}).`,
          },
        ],
      };
    }

    // ── brain_prune ───────────────────────────────────────────────────────────
    if (name === "brain_prune") {
      const status = (args?.status ?? "stale") as "stale" | "deprecated" | "all";
      const runInvalidation = Boolean(args?.run_invalidation ?? false);

      let invalidationReport = "";
      if (runInvalidation) {
        const inv = await runInvalidationPass(db, git);
        invalidationReport = [
          `\n**Invalidation pass:**`,
          `• Files checked:     ${inv.checkedFiles}`,
          `• Memories stalified: ${inv.stalifiedCount}`,
          `• Snapshots updated: ${inv.updatedSnapshots}`,
        ].join("\n");
      }

      const removed = pruneByStatus(db, status);

      return {
        content: [
          {
            type: "text",
            text: [
              `🧹 Brain pruned.`,
              `• Removed ${removed} ${status === "all" ? "non-active" : status} memories.`,
              invalidationReport,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });

  return server;
}

// ─── Startup ──────────────────────────────────────────────────────────────────

async function main() {
  // Non-blocking warmup
  warmupEmbeddings().catch(() => {});

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${SERVER_NAME}] Server v${VERSION} running via stdio.`);
}

// Only execute main if this file is the entry point
if (
  process.argv[1] &&
  (process.argv[1].endsWith("mcp-server.ts") || process.argv[1].endsWith("mcp-server.js"))
) {
  main().catch((err) => {
    console.error("[local-brain-mcp] Fatal error:", err);
    process.exit(1);
  });
}
