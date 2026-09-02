/**
 * mcp-server.ts — MCP Server exposing 4 brain tools via stdio transport.
 *
 * Tools:
 *  - brain_recall  : semantic memory search (token-capped, scoped)
 *  - brain_learn   : store a new manual lesson
 *  - brain_trace   : file history (all fixes + decisions for a path)
 *  - brain_prune   : remove stale/deprecated memories
 *
 * Compatible with: Claude Code, Cursor, GitHub Copilot, Windsurf (any MCP client).
 */

import { Server }                   from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport }     from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import simpleGit                    from 'simple-git';

import { getDb, insertMemory, insertEmbedding, pruneByStatus, type MemoryCategory } from './db.js';
import { embed, warmupEmbeddings, estimateTokens } from './embeddings.js';
import { recallMemories, formatRecallMarkdown, traceFile } from './recall.js';
import { runInvalidationPass } from './invalidation.js';
import { derivePackageScope, detectWorkingScope } from './scoping.js';

// ─── Init ─────────────────────────────────────────────────────────────────────

const db  = getDb();
const git = simpleGit(process.cwd());

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  {
    name:    'local-brain-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ─── Tool Definitions ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name:        'brain_recall',
      description: [
        'Semantically search your local codebase memory.',
        'Returns the most relevant lessons, bug fixes, and architecture decisions',
        'from your git history — filtered to the current file/package scope.',
        'Results are token-capped to stay within 250 tokens.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type:        'string',
            description: 'What to search for. Plain English, e.g. "JWT auth bug" or "database connection pooling".',
          },
          file_path: {
            type:        'string',
            description: 'Optional: current file path (repo-relative). Narrows search to the same package scope.',
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
        },
        required: ['query'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name:        'brain_learn',
      description: [
        'Manually store a new lesson, architecture decision, or team convention.',
        'Use this to save knowledge that did not come from a git commit.',
        'Examples: "Never use RS256 in dev", "Batch DB inserts > 50 items always".',
      ].join(' '),
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
            description: 'Optional: the file this lesson applies to.',
          },
        },
        required: ['lesson'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    {
      name:        'brain_trace',
      description: [
        'Show all memory entries associated with a specific file.',
        'Returns the full fix history, architecture decisions, and past bugs',
        'for that file in chronological order. Includes stale entries with labels.',
      ].join(' '),
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name:        'brain_prune',
      description: [
        'Clean up stale or deprecated memories from the brain.',
        'Run this after major refactors to prevent outdated context from polluting recalls.',
        'Optionally run the full invalidation pass to auto-detect stale memories from git.',
      ].join(' '),
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
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
    },
  ],
}));

// ─── Tool Handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ── brain_recall ──────────────────────────────────────────────────────────
  if (name === 'brain_recall') {
    const query     = String(args?.query ?? '');
    const file_path = args?.file_path ? String(args.file_path) : undefined;
    const max_items = Math.min(Number(args?.max_items ?? 5), 10);
    const category  = args?.category as MemoryCategory | undefined;

    if (!query.trim()) {
      return { content: [{ type: 'text', text: 'Error: query is required.' }], isError: true };
    }

    const result = await recallMemories(db, { query, file_path, max_items, category });
    const markdown = formatRecallMarkdown(result, query);

    return {
      content: [{
        type: 'text',
        text: markdown,
      }],
    };
  }

  // ── brain_learn ───────────────────────────────────────────────────────────
  if (name === 'brain_learn') {
    const lesson    = String(args?.lesson ?? '').trim();
    const category  = (args?.category as MemoryCategory) ?? 'manual';
    const file_path = args?.file_path ? String(args.file_path) : null;

    if (!lesson) {
      return { content: [{ type: 'text', text: 'Error: lesson is required.' }], isError: true };
    }

    let headHash: string | null = null;
    let headRef: string | null  = null;
    try {
      headHash = (await git.revparse(['HEAD'])).trim();
      headRef  = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    } catch { /* not a git repo */ }

    const packageScope = derivePackageScope(file_path);

    const embedding = await embed(lesson);
    const rowid = insertMemory(db, {
      category,
      content:       lesson,
      summary:       lesson.slice(0, 400),
      file_path,
      package_scope: packageScope,
      commit_hash:   headHash,
      git_ref:       headRef,
      status:        'active',
      source:        'manual',
      token_count:   estimateTokens(lesson),
    });
    insertEmbedding(db, rowid, embedding);

    return {
      content: [{
        type: 'text',
        text: `✅ Memory stored (id: ${rowid})\n• Category: ${category}\n• File: ${file_path ?? 'general'}\n• Commit: ${headHash?.slice(0, 7) ?? 'n/a'}`,
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
      const commit = m.commit_hash ? ` @ ${m.commit_hash.slice(0, 7)}` : '';
      return `• [${m.category}${status}${commit}]: ${m.summary.slice(0, 200)}`;
    });

    return {
      content: [{
        type: 'text',
        text: [`## Trace: ${file_path}`, ...lines].join('\n'),
      }],
    };
  }

  // ── brain_prune ───────────────────────────────────────────────────────────
  if (name === 'brain_prune') {
    const status           = (args?.status ?? 'stale') as 'stale' | 'deprecated' | 'all';
    const runInvalidation  = Boolean(args?.run_invalidation ?? false);

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

// ─── Startup ──────────────────────────────────────────────────────────────────

async function main() {
  // Warm up embedding model in background (non-blocking)
  warmupEmbeddings().catch(() => {});

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[local-brain-mcp] Server running via stdio. Ready for tool calls.');
}

main().catch(err => {
  console.error('[local-brain-mcp] Fatal error:', err);
  process.exit(1);
});
