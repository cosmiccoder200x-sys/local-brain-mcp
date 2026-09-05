/**
 * mcp-server.ts — Production-grade Model Context Protocol server for local-brain.
 *
 * Tools exposed:
 *  - brain_recall : semantic memory search (multi-factor ranked, token-capped, scoped)
 *  - brain_learn  : store a new manual lesson / rule / architecture decision
 *  - brain_trace  : file history (all past fixes & decisions for a path)
 *  - brain_prune  : clean up stale / deprecated memories
 *  - brain_status : read-only operational telemetry, git state, and database metrics
 *  - brain_forget : remove a specific memory entry by ID
 *
 * Fully compliant with the Model Context Protocol specification.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { simpleGit } from 'simple-git';
import { getDb, insertMemory, insertEmbedding, pruneByStatus, deleteMemory, findExactDuplicate, getDatabaseStats, } from './db.js';
import { embed, warmupEmbeddings, estimateTokens } from './embeddings.js';
import { recallMemories, formatRecallMarkdown, traceFile } from './recall.js';
import { runInvalidationPass } from './invalidation.js';
import { derivePackageScope, sanitizeFilePath } from './scoping.js';
// ─── Server State ─────────────────────────────────────────────────────────────
const SERVER_NAME = 'local-brain-mcp';
const SERVER_VERSION = '1.1.0';
const VALID_CATEGORIES = new Set([
    'fix',
    'architecture',
    'convention',
    'bug',
    'manual',
]);
const VALID_PRUNE_STATUSES = new Set([
    'stale',
    'deprecated',
    'all',
]);
const db = getDb();
const git = simpleGit(process.cwd());
// ─── Error Helpers ────────────────────────────────────────────────────────────
function makeErrorResponse(message, hint) {
    const text = hint ? `Error: ${message}\nHint: ${hint}` : `Error: ${message}`;
    return {
        content: [{ type: 'text', text }],
        isError: true,
    };
}
// ─── MCP Server Instance ──────────────────────────────────────────────────────
const server = new Server({
    name: SERVER_NAME,
    version: SERVER_VERSION,
}, {
    capabilities: {
        tools: {},
    },
});
// ─── Tool Definitions ─────────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'brain_recall',
            description: [
                'Semantically search your local codebase memory.',
                'Returns the most relevant lessons, bug fixes, and architecture decisions',
                'from your git history and manual entries — filtered to the current file/package scope.',
                'Ranked by semantic similarity (60%), importance (15%), freshness (15%), and confidence (10%).',
                'Results are token-capped to stay within 250 tokens.',
            ].join(' '),
            inputSchema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'What to search for. Plain English or code terms, e.g. "JWT auth bug" or "database pooling". Max 1000 chars.',
                    },
                    file_path: {
                        type: 'string',
                        description: 'Optional: current file path (repo-relative). Narrows search to the same package scope.',
                    },
                    max_items: {
                        type: 'number',
                        description: 'Maximum memories to return (default: 5, integer between 1 and 20).',
                        default: 5,
                    },
                    category: {
                        type: 'string',
                        enum: ['fix', 'architecture', 'convention', 'bug', 'manual'],
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
            name: 'brain_learn',
            description: [
                'Store a new lesson, rule, architecture decision, or team convention.',
                'Use this to save knowledge that did not come from a git commit.',
                'Examples: "Never use RS256 in dev environment", "Batch DB inserts > 50 items always".',
            ].join(' '),
            inputSchema: {
                type: 'object',
                properties: {
                    lesson: {
                        type: 'string',
                        description: 'The lesson, rule, or decision to remember. Be specific and actionable (max 10000 characters).',
                    },
                    category: {
                        type: 'string',
                        enum: ['fix', 'architecture', 'convention', 'bug', 'manual'],
                        description: 'Category for this memory.',
                        default: 'manual',
                    },
                    file_path: {
                        type: 'string',
                        description: 'Optional: the file this lesson applies to (e.g. "src/auth/jwt.ts").',
                    },
                    importance: {
                        type: 'number',
                        description: 'Optional importance multiplier between 0.5 (low) and 2.0 (critical). Default: 1.0.',
                        default: 1.0,
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
            name: 'brain_trace',
            description: [
                'Show all memory entries associated with a specific file.',
                'Returns the full fix history, architecture decisions, and past bugs',
                'for that file in chronological order. Includes stale entries with labels.',
            ].join(' '),
            inputSchema: {
                type: 'object',
                properties: {
                    file_path: {
                        type: 'string',
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
            name: 'brain_prune',
            description: [
                'Clean up stale or deprecated memories from the brain database.',
                'Run this after major refactors to prevent outdated context from polluting recalls.',
                'Optionally run the full invalidation pass to auto-detect stale memories from git history.',
            ].join(' '),
            inputSchema: {
                type: 'object',
                properties: {
                    status: {
                        type: 'string',
                        enum: ['stale', 'deprecated', 'all'],
                        description: 'Which memories to remove. "all" removes both stale and deprecated.',
                        default: 'stale',
                    },
                    run_invalidation: {
                        type: 'boolean',
                        description: 'If true, run the full git-based stale detection pass first.',
                        default: false,
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
        {
            name: 'brain_status',
            description: [
                'Get safe operational telemetry and diagnostics for the local brain.',
                'Returns total/active/stale memory counts, database size, Git HEAD info, and engine capabilities.',
            ].join(' '),
            inputSchema: {
                type: 'object',
                properties: {},
            },
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        {
            name: 'brain_forget',
            description: [
                'Permanently delete a specific memory entry by its integer ID.',
                'Use brain_recall or brain_trace to find the ID of the memory you want to forget.',
            ].join(' '),
            inputSchema: {
                type: 'object',
                properties: {
                    memory_id: {
                        type: 'number',
                        description: 'The positive integer ID of the memory to remove.',
                    },
                },
                required: ['memory_id'],
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
    try {
        // ── 1. brain_recall ───────────────────────────────────────────────────────
        if (name === 'brain_recall') {
            const rawQuery = args?.query;
            if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
                return makeErrorResponse('query is required and must be a non-empty string.', 'Provide a search query like "JWT expiration" or "database pooling".');
            }
            const query = rawQuery.trim();
            if (query.length > 1000) {
                return makeErrorResponse('query is too long (maximum 1000 characters).', 'Please summarize or shorten the search terms.');
            }
            let maxItems = 5;
            if (args?.max_items !== undefined) {
                const num = Number(args.max_items);
                if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1 || num > 50) {
                    return makeErrorResponse('max_items must be a valid integer between 1 and 50.', 'Set max_items to an integer such as 5 or 10.');
                }
                maxItems = Math.min(num, 20);
            }
            let category;
            if (args?.category !== undefined) {
                const cat = String(args.category).toLowerCase();
                if (!VALID_CATEGORIES.has(cat)) {
                    return makeErrorResponse(`Invalid category "${args.category}".`, `Supported categories are: ${Array.from(VALID_CATEGORIES).join(', ')}.`);
                }
                category = cat;
            }
            const rawFilePath = args?.file_path ? String(args.file_path) : undefined;
            const sanitizedFilePath = rawFilePath ? sanitizeFilePath(rawFilePath) ?? undefined : undefined;
            const result = await recallMemories(db, {
                query,
                file_path: sanitizedFilePath,
                max_items: maxItems,
                category,
            });
            const markdown = formatRecallMarkdown(result, query);
            return {
                content: [{ type: 'text', text: markdown }],
            };
        }
        // ── 2. brain_learn ────────────────────────────────────────────────────────
        if (name === 'brain_learn') {
            const rawLesson = args?.lesson;
            if (typeof rawLesson !== 'string' || !rawLesson.trim()) {
                return makeErrorResponse('lesson is required and must be a non-empty string.', 'Provide a concrete rule or lesson to store.');
            }
            const lesson = rawLesson.trim();
            if (lesson.length > 10000) {
                return makeErrorResponse('lesson exceeds maximum length of 10,000 characters.', 'Please condense the lesson into key actionable takeaways.');
            }
            let category = 'manual';
            if (args?.category !== undefined) {
                const cat = String(args.category).toLowerCase();
                if (!VALID_CATEGORIES.has(cat)) {
                    return makeErrorResponse(`Invalid category "${args.category}".`, `Supported categories are: ${Array.from(VALID_CATEGORIES).join(', ')}.`);
                }
                category = cat;
            }
            let importance = 1.0;
            if (args?.importance !== undefined) {
                const imp = Number(args.importance);
                if (!Number.isFinite(imp) || imp < 0.1 || imp > 5.0) {
                    return makeErrorResponse('importance must be a number between 0.1 and 5.0.', 'Use 1.0 for standard importance or 1.5 for high importance.');
                }
                importance = Math.min(2.0, Math.max(0.5, imp));
            }
            const rawFilePath = args?.file_path ? String(args.file_path) : null;
            const sanitizedFilePath = rawFilePath ? sanitizeFilePath(rawFilePath) : null;
            // Duplicate detection
            const existing = findExactDuplicate(db, lesson, sanitizedFilePath);
            if (existing) {
                return {
                    content: [{
                            type: 'text',
                            text: `ℹ️ Exact matching memory already exists (id: ${existing.id}).\n• Category: ${existing.category}\n• File: ${existing.file_path ?? 'general'}\n• Status: ${existing.status}`,
                        }],
                };
            }
            let headHash = null;
            let headRef = null;
            try {
                headHash = (await git.revparse(['HEAD'])).trim();
                headRef = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
            }
            catch {
                // Not in a git repo or no commits yet
            }
            const packageScope = derivePackageScope(sanitizedFilePath);
            const embedding = embed(lesson);
            const rowid = insertMemory(db, {
                category,
                content: lesson,
                summary: lesson.slice(0, 400),
                file_path: sanitizedFilePath,
                package_scope: packageScope,
                commit_hash: headHash,
                git_ref: headRef,
                status: 'active',
                source: 'manual',
                token_count: estimateTokens(lesson),
                importance,
                confidence: 1.0,
            }, embedding);
            insertEmbedding(db, rowid, embedding);
            return {
                content: [{
                        type: 'text',
                        text: `✅ Memory stored (id: ${rowid})\n• Category: ${category}\n• File: ${sanitizedFilePath ?? 'general'}\n• Scope: ${packageScope ?? 'root'}\n• Commit: ${headHash?.slice(0, 7) ?? 'n/a'}`,
                    }],
            };
        }
        // ── 3. brain_trace ────────────────────────────────────────────────────────
        if (name === 'brain_trace') {
            const rawFilePath = args?.file_path;
            if (typeof rawFilePath !== 'string' || !rawFilePath.trim()) {
                return makeErrorResponse('file_path is required and must be a non-empty string.', 'Provide a repo-relative path, e.g. "src/db.ts".');
            }
            const sanitizedFilePath = sanitizeFilePath(rawFilePath);
            if (!sanitizedFilePath) {
                return makeErrorResponse('Invalid file path provided.', 'Provide a clean relative path.');
            }
            const memories = traceFile(db, sanitizedFilePath);
            if (memories.length === 0) {
                return {
                    content: [{ type: 'text', text: `No memories found for: ${sanitizedFilePath}` }],
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
                        text: [`## Trace: ${sanitizedFilePath}`, ...lines].join('\n'),
                    }],
            };
        }
        // ── 4. brain_prune ────────────────────────────────────────────────────────
        if (name === 'brain_prune') {
            let status = 'stale';
            if (args?.status !== undefined) {
                const s = String(args.status).toLowerCase();
                if (!VALID_PRUNE_STATUSES.has(s)) {
                    return makeErrorResponse(`Invalid status "${args.status}".`, `Supported values are: ${Array.from(VALID_PRUNE_STATUSES).join(', ')}.`);
                }
                status = s;
            }
            const runInvalidation = Boolean(args?.run_invalidation ?? false);
            let invalidationReport = '';
            if (runInvalidation) {
                const inv = await runInvalidationPass(db, git);
                invalidationReport = [
                    `\n**Invalidation pass:**`,
                    `• Files checked:      ${inv.checkedFiles}`,
                    `• Memories stalified:  ${inv.stalifiedCount}`,
                    `• Snapshots updated:  ${inv.updatedSnapshots}`,
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
        // ── 5. brain_status ───────────────────────────────────────────────────────
        if (name === 'brain_status') {
            const stats = getDatabaseStats(db);
            let currentBranch = 'unknown';
            let headHash = 'none';
            try {
                currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
                headHash = (await git.revparse(['HEAD'])).trim().slice(0, 7);
            }
            catch {
                // Not a git repository
            }
            const sizeKb = (stats.sizeBytes / 1024).toFixed(1);
            const report = [
                `## 🧠 Local Brain Status`,
                `• Server Version:    v${SERVER_VERSION}`,
                `• Total Memories:    ${stats.total}`,
                `  - Active:          ${stats.active}`,
                `  - Stale:           ${stats.stale}`,
                `  - Deprecated:      ${stats.deprecated}`,
                `  - Git Ingested:    ${stats.fromGit}`,
                `  - Manual Lessons:  ${stats.manual}`,
                `• Commits Ingested:  ${stats.commitsIngested}`,
                `• Database Size:     ${sizeKb} KB`,
                `• Git Branch:        ${currentBranch} (@ ${headHash})`,
                `• Embedding Engine:  384-dim code-aware TF-IDF feature hashing (100% offline)`,
                `• Ranking:           Multi-factor (Similarity 60%, Importance 15%, Freshness 15%, Confidence 10%)`,
            ].join('\n');
            return {
                content: [{ type: 'text', text: report }],
            };
        }
        // ── 6. brain_forget ───────────────────────────────────────────────────────
        if (name === 'brain_forget') {
            const rawId = args?.memory_id;
            const numId = Number(rawId);
            if (!Number.isFinite(numId) || !Number.isInteger(numId) || numId <= 0) {
                return makeErrorResponse('memory_id must be a positive integer.', 'Provide a valid memory ID like 42.');
            }
            const deleted = deleteMemory(db, numId);
            if (!deleted) {
                return makeErrorResponse(`Memory with ID ${numId} was not found.`, 'Use brain_recall or brain_trace to look up existing memory IDs.');
            }
            return {
                content: [{
                        type: 'text',
                        text: `🗑️ Memory #${numId} permanently deleted from local brain.`,
                    }],
            };
        }
        return makeErrorResponse(`Unknown tool: ${name}`, 'Call tools/list to see available tools.');
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return makeErrorResponse(`Internal tool error: ${errorMsg}`);
    }
});
// ─── Startup ──────────────────────────────────────────────────────────────────
async function main() {
    // Non-blocking warmup
    warmupEmbeddings().catch(() => { });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[${SERVER_NAME}] Server v${SERVER_VERSION} running via stdio.`);
}
main().catch(err => {
    console.error(`[${SERVER_NAME}] Fatal initialization error:`, err);
    process.exit(1);
});
//# sourceMappingURL=mcp-server.js.map