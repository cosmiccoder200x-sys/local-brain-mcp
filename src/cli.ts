#!/usr/bin/env node
/**
 * cli.ts — `local-brain` setup wizard, diagnostics & CLI runner.
 *
 * Commands:
 *  local-brain init    — auto-detects editors & writes MCP configs
 *  local-brain ingest  — run git ingestion on current repo
 *  local-brain query   — test semantic recall directly from CLI
 *  local-brain learn   — manually store a lesson or rule
 *  local-brain status  — show DB memory statistics
 *  local-brain doctor  — system diagnostics & configuration checker
 *  local-brain prune   — remove stale/deprecated memories
 *  local-brain forget  — delete a specific memory by ID
 */

import { program } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { simpleGit } from 'simple-git';

import {
  getDb,
  resolveDbPath,
  pruneByStatus,
  deleteMemory,
  insertMemory,
  insertEmbedding,
  getDatabaseStats,
  type MemoryCategory,
} from './db.js';
import { embed, estimateTokens } from './embeddings.js';
import { ingestGitHistory } from './git-ingest.js';
import { runInvalidationPass } from './invalidation.js';
import { recallMemories, formatRecallMarkdown } from './recall.js';
import { derivePackageScope, sanitizeFilePath } from './scoping.js';

// ─── Editor Config Paths ──────────────────────────────────────────────────────

const HOME = os.homedir();

interface EditorTarget {
  name:       string;
  configPath: string;
  key:        string;
}

const EDITOR_TARGETS: EditorTarget[] = [
  {
    name:       'Claude Code',
    configPath: path.join(HOME, '.claude.json'),
    key:        'mcpServers',
  },
  {
    name:       'Cursor',
    configPath: path.join(HOME, '.cursor', 'mcp.json'),
    key:        'mcpServers',
  },
  {
    name:       'Windsurf',
    configPath: path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json'),
    key:        'mcpServers',
  },
  {
    name:       'VS Code Copilot',
    configPath: path.join(HOME, '.vscode', 'mcp.json'),
    key:        'servers',
  },
  {
    name:       'Zed',
    configPath: path.join(HOME, '.config', 'zed', 'settings.json'),
    key:        'context_servers',
  },
];

function buildMcpEntry(serverPath: string) {
  return {
    command: 'node',
    args:    [serverPath],
    env:     {},
  };
}

function writePostCommitHook(repoPath: string) {
  const hooksDir = path.join(repoPath, '.git', 'hooks');
  const hookPath = path.join(hooksDir, 'post-commit');

  const script = `#!/bin/sh
# local-brain post-commit hook
(node "$(npm root -g 2>/dev/null || echo .)/local-brain-mcp/dist/cli.js" ingest --commits 1 --quiet &) 2>/dev/null
`;

  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(hookPath, script, { mode: 0o755 });
  console.log(`  ✅ post-commit hook installed at ${hookPath}`);
}

// ─── CLI Program ──────────────────────────────────────────────────────────────

program
  .name('local-brain')
  .description('Local-first, zero-latency AI memory MCP server')
  .version('1.1.0');

// ── init ──────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Auto-detect AI editors and write MCP config for each')
  .option('--repo <path>', 'Repo root (defaults to cwd)', process.cwd())
  .option('--no-hook', 'Skip post-commit hook installation')
  .action(async (opts: { repo: string; hook: boolean }) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const serverEntrypoint = path.resolve(__dirname, 'mcp-server.js');

    console.log('\n🧠 local-brain init\n');
    console.log('Detecting AI editors…\n');

    let detected = 0;
    const entry = buildMcpEntry(serverEntrypoint);

    for (const editor of EDITOR_TARGETS) {
      const dir = path.dirname(editor.configPath);

      if (!existsSync(dir) && !existsSync(editor.configPath)) {
        console.log(`  ⏭  ${editor.name} — not found`);
        continue;
      }

      let config: Record<string, unknown> = {};
      if (existsSync(editor.configPath)) {
        try {
          config = JSON.parse(readFileSync(editor.configPath, 'utf8'));
        } catch {
          config = {};
        }
      }

      const key = editor.key as keyof typeof config;
      if (!config[key] || typeof config[key] !== 'object') {
        config[key] = {};
      }
      (config[key] as Record<string, unknown>)['local-brain'] = entry;

      mkdirSync(dir, { recursive: true });
      writeFileSync(editor.configPath, JSON.stringify(config, null, 2));
      console.log(`  ✅ ${editor.name} — config updated at ${editor.configPath}`);
      detected++;
    }

    if (detected === 0) {
      console.log('\nℹ️  No AI editor config files found in standard locations.');
      console.log('   Add local-brain to your editor\'s MCP config:');
      console.log(JSON.stringify({ 'local-brain': entry }, null, 2));
    }

    if (opts.hook !== false) {
      const repoPath = path.resolve(opts.repo);
      const gitDir = path.join(repoPath, '.git');
      if (existsSync(gitDir)) {
        writePostCommitHook(repoPath);
      } else {
        console.log('\nℹ️  No .git directory found — skipping post-commit hook.');
      }
    }

    console.log(`\n✨ Done! Restart your AI editor to activate local-brain.\n`);
  });

// ── ingest ────────────────────────────────────────────────────────────────────
program
  .command('ingest')
  .description('Scan git history and build the local brain DB')
  .option('--repo <path>',     'Repo root (defaults to cwd)',     process.cwd())
  .option('--since <date>',    'Only process commits since date', '12 months ago')
  .option('--commits <n>',     'Max commits to scan',             '500')
  .option('--verbose',         'Show per-commit log')
  .option('--quiet',           'Suppress all output')
  .action(async (opts: { repo: string; since: string; commits: string; verbose?: boolean; quiet?: boolean }) => {
    const repoPath   = path.resolve(opts.repo);
    const maxCommits = parseInt(opts.commits, 10) || 500;
    const since      = opts.since;
    const verbose    = !!opts.verbose && !opts.quiet;

    if (!opts.quiet) {
      console.log(`\n🧠 local-brain ingest`);
      console.log(`   Repo:   ${repoPath}`);
      console.log(`   Since:  ${since}`);
      console.log(`   Max:    ${maxCommits} commits\n`);
    }

    const db = getDb(resolveDbPath(repoPath));
    const result = await ingestGitHistory(db, {
      repoPath,
      maxCommits,
      since,
      verbose,
    });

    if (!opts.quiet) {
      console.log(`\n✅ Ingest complete:`);
      console.log(`   Scanned:  ${result.scanned}`);
      console.log(`   Ingested: ${result.ingested}`);
      console.log(`   Skipped:  ${result.skipped}`);
      console.log(`   Errors:   ${result.errors}\n`);
    }
  });

// ── query ─────────────────────────────────────────────────────────────────────
program
  .command('query <text>')
  .description('Test semantic memory recall directly from CLI')
  .option('--repo <path>', 'Repo root', process.cwd())
  .option('--file <path>', 'File path filter')
  .action(async (text: string, opts: { repo: string; file?: string }) => {
    const repoPath = path.resolve(opts.repo);
    const db       = getDb(resolveDbPath(repoPath));

    const start = performance.now();
    const result = await recallMemories(db, {
      query: text,
      file_path: opts.file ? sanitizeFilePath(opts.file) ?? undefined : undefined,
    });
    const elapsed = (performance.now() - start).toFixed(2);

    console.log(`\n${formatRecallMarkdown(result, text)}`);
    console.log(`\n⚡ Recall latency: ${elapsed} ms | Tokens: ${result.total_tokens}/250\n`);
  });

// ── learn ─────────────────────────────────────────────────────────────────────
program
  .command('learn <lesson>')
  .description('Store a new lesson, architecture decision, or convention')
  .option('--repo <path>', 'Repo root', process.cwd())
  .option('--category <category>', 'Category (fix, architecture, convention, bug, manual)', 'manual')
  .option('--file <path>', 'Associated file path')
  .action(async (lesson: string, opts: { repo: string; category: string; file?: string }) => {
    const repoPath = path.resolve(opts.repo);
    const db = getDb(resolveDbPath(repoPath));
    const git = simpleGit(repoPath);

    let headHash: string | null = null;
    let headRef: string | null = null;
    try {
      headHash = (await git.revparse(['HEAD'])).trim();
      headRef  = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    } catch {
      // Non-git
    }

    const sanitizedPath = sanitizeFilePath(opts.file);
    const packageScope = derivePackageScope(sanitizedPath);
    const embedding = embed(lesson);

    const rowid = insertMemory(
      db,
      {
        category:      (opts.category as MemoryCategory) || 'manual',
        content:       lesson,
        summary:       lesson.slice(0, 400),
        file_path:     sanitizedPath,
        package_scope: packageScope,
        commit_hash:   headHash,
        git_ref:       headRef,
        status:        'active',
        source:        'manual',
        token_count:   estimateTokens(lesson),
        importance:    1.0,
        confidence:    1.0,
      },
      embedding
    );
    insertEmbedding(db, rowid, embedding);

    console.log(`\n✅ Memory stored (id: ${rowid})`);
    console.log(`   Category: ${opts.category}`);
    console.log(`   File:     ${sanitizedPath ?? 'general'}\n`);
  });

// ── doctor ────────────────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Run system diagnostics and verify MCP editor configurations')
  .action(() => {
    console.log('\n🩺 local-brain doctor\n');
    console.log(`  Node.js version:   ${process.version} (>=18.0.0 required)`);
    console.log(`  Platform:          ${process.platform} (${process.arch})`);

    const dbPath = resolveDbPath();
    console.log(`  Default DB path:   ${dbPath}`);
    console.log(`  DB file exists:    ${existsSync(dbPath) ? '✅ YES' : 'ℹ️ NO (will be created on first ingest)'}`);

    console.log('\n  Editor Configurations:');
    for (const editor of EDITOR_TARGETS) {
      if (existsSync(editor.configPath)) {
        try {
          const config = JSON.parse(readFileSync(editor.configPath, 'utf8'));
          const key = editor.key as keyof typeof config;
          const servers = config[key] as Record<string, unknown> | undefined;
          const configured = Boolean(servers && servers['local-brain']);
          console.log(`    • ${editor.name.padEnd(16)}: ${configured ? '✅ CONFIGURED' : '⚠️ FILE EXISTS, MCP NOT LINKED'}`);
        } catch {
          console.log(`    • ${editor.name.padEnd(16)}: ⚠️ INVALID JSON`);
        }
      } else {
        console.log(`    • ${editor.name.padEnd(16)}: ⏭ NOT INSTALLED`);
      }
    }
    console.log('\n  All checks complete.\n');
  });

// ── status ────────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show brain DB statistics')
  .option('--repo <path>', 'Repo root', process.cwd())
  .action((opts: { repo: string }) => {
    const repoPath = path.resolve(opts.repo);
    const dbPath   = resolveDbPath(repoPath);
    const db       = getDb(dbPath);
    const stats    = getDatabaseStats(db, dbPath);

    console.log('\n🧠 local-brain status\n');
    console.log(`   Database:         ${stats.dbPath}`);
    console.log(`   Size:             ${(stats.sizeBytes / 1024).toFixed(1)} KB`);
    console.log(`   Total memories:   ${stats.total}`);
    console.log(`   Active:           ${stats.active}`);
    console.log(`   Stale:            ${stats.stale}`);
    console.log(`   Deprecated:       ${stats.deprecated}`);
    console.log(`   From git:         ${stats.fromGit}`);
    console.log(`   Manual:           ${stats.manual}`);
    console.log(`   Commits ingested: ${stats.commitsIngested}\n`);
  });

// ── prune ─────────────────────────────────────────────────────────────────────
program
  .command('prune')
  .description('Remove stale or deprecated memories')
  .option('--repo <path>',      'Repo root',             process.cwd())
  .option('--status <status>',  'Which to remove (stale, deprecated, all)', 'stale')
  .option('--invalidate',       'Run git invalidation pass first')
  .action(async (opts: { repo: string; status: string; invalidate?: boolean }) => {
    const repoPath = path.resolve(opts.repo);
    const db       = getDb(resolveDbPath(repoPath));

    if (opts.invalidate) {
      const git = simpleGit(repoPath);
      const inv = await runInvalidationPass(db, git);
      console.log(`\n🔍 Invalidation pass:`);
      console.log(`   Files checked:      ${inv.checkedFiles}`);
      console.log(`   Memories stalified: ${inv.stalifiedCount}`);
      console.log(`   Snapshots updated:  ${inv.updatedSnapshots}`);
    }

    const removed = pruneByStatus(db, opts.status as 'stale' | 'deprecated' | 'all');
    console.log(`\n🧹 Pruned ${removed} ${opts.status} memories.\n`);
  });

// ── forget ────────────────────────────────────────────────────────────────────
program
  .command('forget <id>')
  .description('Delete a specific memory by ID')
  .option('--repo <path>', 'Repo root', process.cwd())
  .action((id: string, opts: { repo: string }) => {
    const numId = parseInt(id, 10);
    if (isNaN(numId) || numId <= 0) {
      console.error('\n❌ Please provide a valid positive integer memory ID.\n');
      process.exit(1);
    }

    const repoPath = path.resolve(opts.repo);
    const db       = getDb(resolveDbPath(repoPath));
    const deleted  = deleteMemory(db, numId);

    if (deleted) {
      console.log(`\n🗑️ Memory #${numId} deleted successfully.\n`);
    } else {
      console.log(`\n⚠️ Memory #${numId} was not found in the database.\n`);
    }
  });

program.parse();
