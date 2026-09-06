/**
 * mcp-server.ts — MCP Server exposing persistent AI memory tools via stdio transport.
 *
 * Tools:
 *  - brain_recall : semantic memory search (multi-factor ranked, token-capped, scoped)
 *  - brain_status : brain health, statistics, and git repository state
 *  - brain_learn  : store durable knowledge, rules, decisions, bug fixes with quality guard
 *  - brain_trace  : full chronological memory & fix history for a file
 *  - brain_forget : remove or deprecate specific memories by ID, path, or query
 *  - brain_prune  : clean up stale or deprecated memories after refactors
 *
 * Compatible with: Claude Code, Cursor, GitHub Copilot, Windsurf, Zed.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import simpleGit from 'simple-git';

import {
  getDb,
  insertMemory,
  insertEmbedding,
  pruneByStatus,
  forgetMemory,
  getDbStats,
  findDuplicateMemory,
  mergeMemory,
  resolveDbPath,
  type MemoryCategory,
} from './db.js';
import { embed, warmupEmbeddings, estimateTokens } from './embeddings.js';
import { recallMemories, formatRecallMarkdown, traceFile } from './recall.js';
import { runInvalidationPass } from './invalidation.js';
import { derivePackageScope } from './scoping.js';
import { evaluateMemoryQuality, extractReferencedFiles } from './quality.js';

// ─── Server State ─────────────────────────────────────────────────────────────

const SERVER_NAME    = 'local-brain-mcp';
const SERVER_VERSION = '1.1.0';

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  'fix',
  'architecture',
  'convention',
  'bug',
  'manual',
]);

const VALID_PRUNE_STATUSES: ReadonlySet<string> = new Set([
  'stale',
  'deprecated',
  'all',
]);

const db  = getDb();
const git = simpleGit(process.cwd());

// ─── Tool Definitions with Precise MCP Annotations ───────────────────────────

export const MCP_TOOLS: Tool[] = [
  {
    name: 'brain_recall',
    description: [
      'Semantically search your local codebase memory.',
      'Returns the most relevant lessons, bug fixes, architecture decisions, and conventions',
      'from your git history and AI sessions — filtered to current file and package scope.',
      'Results are ranked deterministically and token-capped to stay within 250 tokens.',
    ].join(' '),
    annotations: {
      readOnlyHint:    true,
      destructiveHint: false,
      idempotentHint:  true,
      openWorldHint:   false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type:        'string',
          description: 'What to search for. Plain English, e.g. "JWT auth bug" or "database connection pooling".',
        },
        file_path: {
          type:        'string',
          description: 'Optional: current file path (repo-relative). Narrows search to relevant file and package scope.',
        },
        max_items: {
          type:        'number',
          description: 'Maximum memories to return (default: 5, max: 10).',
          default:     5,
        },
        category: {
          type:        'string',
          enum:        ['fix', 'architecture', 'convention', 'bug', 'manual'],
          description: 'Optional: filter by memory category.',
        },
        min_confidence: {
          type:        'number',
          description: 'Optional: minimum confidence threshold (0.0 to 1.0, default: 0.0).',
          default:     0.0,
        },
        include_deprecated: {
          type:        'boolean',
          description: 'Optional: include stale and deprecated memories (default: false).',
          default:     false,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'brain_status',
    description: [
      'Get system diagnostics and memory statistics for Local Brain.',
      'Returns memory count, breakdown by status (active/stale/deprecated),',
      'source breakdown (git vs manual), and database storage path.',
    ].join(' '),
    annotations: {
      readOnlyHint:    true,
      destructiveHint: false,
      idempotentHint:  true,
      openWorldHint:   false,
    },
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'brain_learn',
    description: [
      'Store a new durable lesson, architecture decision, bug root-cause, or team convention.',
      'Includes automatic quality evaluation, deduplication, provenance tracking, and supersession.',
      'Examples: "Never use RS256 in dev", "JWT refresh token expires in 7d; rotate on each use".',
    ].join(' '),
    annotations: {
      readOnlyHint:    false,
      destructiveHint: false,
      idempotentHint:  false,
      openWorldHint:   false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        lesson: {
          type:        'string',
          description: 'The lesson, rule, or decision to remember. Be specific and actionable.',
        },
        category: {
          type:        'string',
          enum:        ['fix', 'architecture', 'convention', 'bug', 'manual'],
          description: 'Category for this memory.',
          default:     'manual',
        },
        file_path: {
          type:        'string',
          description: 'Optional: the primary file this lesson applies to.',
        },
        files: {
          type:        'array',
          items:       { type: 'string' },
          description: 'Optional: array of related files.',
        },
        confidence: {
          type:        'number',
          description: 'Confidence rating from 0.0 to 1.0 (default: 1.0).',
          default:     1.0,
        },
        importance: {
          type:        'number',
          description: 'Importance multiplier from 0.1 to 2.0 (default: 1.0).',
          default:     1.0,
        },
        supersedes_id: {
          type:        'number',
          description: 'Optional: ID of an older memory that is superseded/replaced by this new lesson.',
        },
      },
      required: ['lesson'],
    },
  },
  {
    name: 'brain_trace',
    description: [
      'Show all memory entries associated with a specific file.',
      'Returns the full fix history, architecture decisions, and past bugs',
      'for that file in chronological order. Includes confidence and status flags.',
    ].join(' '),
    annotations: {
      readOnlyHint:    true,
      destructiveHint: false,
      idempotentHint:  true,
      openWorldHint:   false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type:        'string',
          description: 'Repo-relative file path to trace (e.g. "src/auth/jwt.ts").',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'brain_forget',
    description: [
      'Remove or deprecate specific memories from Local Brain.',
      'Can target a memory by ID, file path, or search query.',
      'By default deprecates the memory to maintain audit trail; pass hard_delete: true to purge.',
    ].join(' '),
    annotations: {
      readOnlyHint:    false,
      destructiveHint: true,
      idempotentHint:  true,
      openWorldHint:   false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type:        'number',
          description: 'Exact memory ID to forget.',
        },
        file_path: {
          type:        'string',
          description: 'Forget all memories associated with this file path.',
        },
        query: {
          type:        'string',
          description: 'Forget memories matching this text/topic.',
        },
        hard_delete: {
          type:        'boolean',
          description: 'If true, permanently deletes records from SQLite. Default is false (marks deprecated).',
          default:     false,
        },
      },
      annotations: {
        readOnlyHint:    false,
        destructiveHint: true,
        idempotentHint:  true,
        openWorldHint:   false,
      },
    },
    {
      name:        'brain_status',
      description: [
        'Get safe operational telemetry and diagnostics for the local brain.',
        'Returns total/active/stale memory counts, database size, Git HEAD info, and engine capabilities.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {},
      },
      annotations: {
        readOnlyHint:    true,
        destructiveHint: false,
        idempotentHint:  true,
        openWorldHint:   false,
      },
    },
    {
      name:        'brain_forget',
      description: [
        'Permanently delete a specific memory entry by its integer ID.',
        'Use brain_recall or brain_trace to find the ID of the memory you want to forget.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          memory_id: {
            type:        'number',
            description: 'The positive integer ID of the memory to remove.',
          },
        },
        required: ['memory_id'],
      },
      annotations: {
        readOnlyHint:    false,
        destructiveHint: true,
        idempotentHint:  true,
        openWorldHint:   false,
      },
    },
  },
  {
    name: 'brain_prune',
    description: [
      'Clean up stale or deprecated memories from the brain.',
      'Run this after major refactors to prevent outdated context from polluting recalls.',
      'Optionally runs the full git-diff invalidation pass to detect modified/deleted files.',
    ].join(' '),
    annotations: {
      readOnlyHint:    false,
      destructiveHint: true,
      idempotentHint:  false,
      openWorldHint:   false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type:        'string',
          enum:        ['stale', 'deprecated', 'all'],
          description: 'Which memories to remove.',
          default:     'stale',
        },
        run_invalidation: {
          type:        'boolean',
          description: 'If true, run the full git-based stale detection pass first.',
          default:     false,
        },
      },
    },
  },
];

// ─── MCP Server Instance ───────────────────────────────────────────────────────

export function createMcpServer(): Server {
  const server = new Server(
    {
      name:    'local-brain-mcp',
      version: '1.1.0',
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
    if (name === 'brain_recall') {
      const query              = String(args?.query ?? '').trim();
      const file_path          = args?.file_path ? String(args.file_path) : undefined;
      const max_items          = Math.min(Math.max(1, Number(args?.max_items ?? 5)), 10);
      const category           = args?.category as MemoryCategory | undefined;
      const min_confidence     = typeof args?.min_confidence === 'number' ? Number(args.min_confidence) : 0.0;
      const include_deprecated = Boolean(args?.include_deprecated ?? false);

      if (!query) {
        return { content: [{ type: 'text', text: 'Error: query is required.' }], isError: true };
      }

      try {
        const result = await recallMemories(db, {
          query,
          file_path,
          max_items,
          category,
          min_confidence,
          include_deprecated,
        });
        const markdown = formatRecallMarkdown(result, query);

        return {
          content: [{
            type: 'text',
            text: markdown,
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error during recall: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }

    // ── brain_status ──────────────────────────────────────────────────────────
    if (name === 'brain_status') {
      const stats = getDbStats(db);
      let headHash = 'unknown';
      let headBranch = 'unknown';
      try {
        headHash = (await git.revparse(['HEAD'])).trim().slice(0, 7);
        headBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
      } catch { /* not a git repo */ }

      const statusText = [
        '🧠 **Local Brain MCP Status**',
        `• **Database Path:** \`${resolveDbPath()}\``,
        `• **Git Head:** \`${headBranch}\` @ \`${headHash}\``,
        `• **Total Memories:** ${stats.total}`,
        `• **Active:** ${stats.active}`,
        `• **Stale:** ${stats.stale}`,
        `• **Deprecated / Superseded:** ${stats.deprecated} (${stats.superseded} superseded)`,
        `• **Source:** ${stats.from_git} from Git history, ${stats.manual} manual/AI lessons`,
        `• **Commits Ingested:** ${stats.commits_ingested}`,
        `• **Tracked File Snapshots:** ${stats.file_snapshots}`,
      ].join('\n');

      return {
        content: [{
          type: 'text',
          text: statusText,
        }],
      };
    }

    // ── brain_learn ───────────────────────────────────────────────────────────
    if (name === 'brain_learn') {
      const lesson        = String(args?.lesson ?? '').trim();
      const category      = (args?.category as MemoryCategory) ?? 'manual';
      let file_path       = args?.file_path ? String(args.file_path).trim() : null;
      const rawFiles      = args?.files;
      const confidence    = typeof args?.confidence === 'number' ? Number(args.confidence) : 1.0;
      const importance    = typeof args?.importance === 'number' ? Number(args.importance) : 1.0;
      const supersedes_id = typeof args?.supersedes_id === 'number' ? Number(args.supersedes_id) : undefined;

      if (!lesson) {
        return { content: [{ type: 'text', text: 'Error: lesson is required.' }], isError: true };
      }

      // Memory quality guard
      const quality = evaluateMemoryQuality(lesson, category);
      if (!quality.isQuality) {
        return {
          content: [{
            type: 'text',
            text: `⚠️ Memory rejected by quality filter: ${quality.reason ?? 'Low signal or ephemeral noise.'}\nPlease provide actionable engineering context.`,
          }],
          isError: true,
        };
      }

      // Automatically extract referenced files if none supplied
      let filesList: string[] = [];
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
      let headRef: string | null  = null;
      try {
        headHash = (await git.revparse(['HEAD'])).trim();
        headRef  = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
      } catch { /* not a git repo */ }

      const packageScope = derivePackageScope(file_path);
      const embedding = embed(lesson);

      // Duplicate check & smart merge
      const dup = findDuplicateMemory(db, embedding, lesson, file_path, 0.90);
      if (dup && !supersedes_id) {
        mergeMemory(db, dup.match.id, {
          category,
          content: lesson,
          summary: lesson.slice(0, 400),
          file_path,
          confidence,
          importance,
        });

        return {
          content: [{
            type: 'text',
            text: `🔄 Knowledge updated in existing memory (id: ${dup.match.id}, ${dup.isExact ? 'exact match' : `${Math.round(dup.similarity * 100)}% similarity`})\n• Category: ${category}\n• File: ${file_path ?? 'general'}\n• Confidence: ${Math.round(confidence * 100)}%`,
          }],
        };
      }

      const rowid = insertMemory(db, {
        category,
        content:        lesson,
        summary:        lesson.slice(0, 400),
        file_path,
        files:          JSON.stringify(filesList),
        package_scope:  packageScope,
        commit_hash:    headHash,
        git_ref:        headRef,
        branch:         headRef,
        confidence,
        importance,
        quality_score:  quality.score,
        status:         'active',
        source:         'manual',
        supersedes_id:  supersedes_id ?? null,
        token_count:    estimateTokens(lesson),
      }, embedding);

      insertEmbedding(db, rowid, embedding);

      const supersedesMsg = supersedes_id ? `\n• Supersedes memory id: ${supersedes_id}` : '';

      return {
        content: [{
          type: 'text',
          text: `✅ Memory stored (id: ${rowid})\n• Category: ${category}\n• File: ${file_path ?? 'general'}\n• Commit: ${headHash?.slice(0, 7) ?? 'n/a'}\n• Quality score: ${quality.score}\n• Confidence: ${Math.round(confidence * 100)}%${supersedesMsg}`,
        }],
      };
    }

    // ── brain_trace ───────────────────────────────────────────────────────────
    if (name === 'brain_trace') {
      const file_path = String(args?.file_path ?? '').trim();
      if (!file_path) {
        return { content: [{ type: 'text', text: 'Error: file_path is required.' }], isError: true };
      }

      const memories = traceFile(db, file_path);

      if (memories.length === 0) {
        return {
          content: [{ type: 'text', text: `No memories found for: ${file_path}` }],
        };
      }

      const lines = memories.map(m => {
        const status = m.status !== 'active' ? ` [${m.status.toUpperCase()}]` : '';
        const superseded = m.superseded_by ? ` [SUPERSEDED by #${m.superseded_by}]` : '';
        const commit = m.commit_hash ? ` @ ${m.commit_hash.slice(0, 7)}` : '';
        const conf = ` (${Math.round((m.confidence ?? 1.0) * 100)}% conf)`;
        return `• #${m.id} [${m.category}${status}${superseded}${commit}${conf}]: ${m.summary.slice(0, 200)}`;
      });

      return {
        content: [{
          type: 'text',
          text: [`## Trace: ${file_path}`, ...lines].join('\n'),
        }],
      };
    }

    // ── brain_forget ──────────────────────────────────────────────────────────
    if (name === 'brain_forget') {
      const id         = typeof args?.id === 'number' ? Number(args.id) : undefined;
      const file_path  = args?.file_path ? String(args.file_path).trim() : undefined;
      const query      = args?.query ? String(args.query).trim() : undefined;
      const hardDelete = Boolean(args?.hard_delete ?? false);

      if (id === undefined && !file_path && !query) {
        return {
          content: [{ type: 'text', text: 'Error: Must specify id, file_path, or query to forget.' }],
          isError: true,
        };
      }

      const result = forgetMemory(db, { id, filePath: file_path, query, hardDelete });

      if (result.count === 0) {
        return {
          content: [{ type: 'text', text: 'No matching memories found to forget.' }],
        };
      }

      const action = hardDelete ? 'Permanently deleted' : 'Deprecated';
      return {
        content: [{
          type: 'text',
          text: `🗑️ ${action} ${result.count} memory record(s) (IDs: ${result.affectedIds.join(', ')}).`,
        }],
      };
    }

    // ── brain_prune ───────────────────────────────────────────────────────────
    if (name === 'brain_prune') {
      const status          = (args?.status ?? 'stale') as 'stale' | 'deprecated' | 'all';
      const runInvalidation = Boolean(args?.run_invalidation ?? false);

      let invalidationReport = '';
      if (runInvalidation) {
        const inv = await runInvalidationPass(db, git);
        invalidationReport = [
          `\n**Invalidation pass:**`,
          `• Files checked:     ${inv.checkedFiles}`,
          `• Memories stalified: ${inv.stalifiedCount}`,
          `• Snapshots updated: ${inv.updatedSnapshots}`,
        ].join('\n');
      }

      const removed = pruneByStatus(db, status);

      return {
        content: [{
          type: 'text',
          text: [
            `🧹 Brain pruned.`,
            `• Removed ${removed} ${status === 'all' ? 'non-active' : status} memories.`,
            invalidationReport,
          ].filter(Boolean).join('\n'),
        }],
      };
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
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
  console.error(`[${SERVER_NAME}] Server v${SERVER_VERSION} running via stdio.`);
}

// Only execute main if this file is the entry point
if (process.argv[1] && (process.argv[1].endsWith('mcp-server.ts') || process.argv[1].endsWith('mcp-server.js'))) {
  main().catch(err => {
    console.error('[local-brain-mcp] Fatal error:', err);
    process.exit(1);
  });
}
