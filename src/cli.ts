/**
 * cli.ts — `npx local-brain` setup wizard & ingest CLI.
 *
 * Commands:
 *  local-brain init    — auto-detects editors & writes MCP configs
 *  local-brain ingest  — run git ingestion on current repo
 *  local-brain status  — show DB stats
 *  local-brain prune   — remove stale memories
 */

import { program } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import os   from 'os';
import path from 'path';
import simpleGit from 'simple-git';

import { getDb, resolveDbPath, pruneByStatus } from './db.js';
import { ingestGitHistory } from './git-ingest.js';
import { runInvalidationPass } from './invalidation.js';

// ─── Editor Config Paths ──────────────────────────────────────────────────────

const HOME = os.homedir();

interface EditorTarget {
  name:       string;
  configPath: string;
  key:        string;  // JSON key to write into
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

// ─── MCP Server Entry ─────────────────────────────────────────────────────────

function buildMcpEntry(serverPath: string) {
  return {
    command: 'node',
    args:    [serverPath],
    env:     {},
  };
}

// ─── Post-commit Hook ─────────────────────────────────────────────────────────

function writePostCommitHook(repoPath: string) {
  const hooksDir  = path.join(repoPath, '.git', 'hooks');
  const hookPath  = path.join(hooksDir, 'post-commit');

  const script = `#!/bin/sh
# local-brain post-commit hook
# Asynchronously ingests the latest commit into the local brain DB.
(node "$(npm root -g)/local-brain-mcp/dist/cli.js" ingest --commits 1 --quiet &) 2>/dev/null
`;

  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(hookPath, script, { mode: 0o755 });
  console.log(`  ✅ post-commit hook installed at ${hookPath}`);
}

// ─── Commands ─────────────────────────────────────────────────────────────────

program
  .name('local-brain')
  .description('Local-first, zero-latency AI memory MCP server')
  .version('1.0.0');

// ── init ──────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Auto-detect AI editors and write MCP config for each')
  .option('--repo <path>', 'Repo root (defaults to cwd)', process.cwd())
  .option('--no-hook', 'Skip post-commit hook installation')
  .action(async (opts) => {
    const serverEntrypoint = path.resolve(
      new URL(import.meta.url).pathname,
      '../../dist/mcp-server.js'
    );

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

      // Read existing config or start fresh
      let config: Record<string, unknown> = {};
      if (existsSync(editor.configPath)) {
        try {
          config = JSON.parse(readFileSync(editor.configPath, 'utf8'));
        } catch {
          config = {};
        }
      }

      // Inject MCP server entry
      const key = editor.key as keyof typeof config;
      if (!config[key]) config[key] = {};
      (config[key] as Record<string, unknown>)['local-brain'] = entry;

      mkdirSync(dir, { recursive: true });
      writeFileSync(editor.configPath, JSON.stringify(config, null, 2));
      console.log(`  ✅ ${editor.name} — config updated at ${editor.configPath}`);
      detected++;
    }

    if (detected === 0) {
      console.log('\n⚠️  No AI editors detected.');
      console.log('   You can manually add local-brain to your editor\'s MCP config:');
      console.log(JSON.stringify({ 'local-brain': entry }, null, 2));
    }

    // Install post-commit hook
    if (opts.hook !== false) {
      const repoPath = opts.repo as string;
      const gitDir   = path.join(repoPath, '.git');
      if (existsSync(gitDir)) {
        writePostCommitHook(repoPath);
      } else {
        console.log('\n⚠️  No .git directory found — skipping post-commit hook.');
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
  .action(async (opts) => {
    const repoPath   = path.resolve(opts.repo as string);
    const maxCommits = parseInt(opts.commits as string, 10);
    const since      = opts.since as string;
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

// ── status ────────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show brain DB statistics')
  .option('--repo <path>', 'Repo root', process.cwd())
  .action((opts) => {
    const repoPath = path.resolve(opts.repo as string);
    const db       = getDb(resolveDbPath(repoPath));

    const stats = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active'     THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'stale'      THEN 1 ELSE 0 END) AS stale,
        SUM(CASE WHEN status = 'deprecated' THEN 1 ELSE 0 END) AS deprecated,
        SUM(CASE WHEN source  = 'git-ingest' THEN 1 ELSE 0 END) AS from_git,
        SUM(CASE WHEN source  = 'manual'     THEN 1 ELSE 0 END) AS manual
      FROM memories
    `).get() as Record<string, number>;

    const ingested = db.prepare('SELECT COUNT(*) AS c FROM ingested_commits').get() as { c: number };

    console.log('\n🧠 local-brain status\n');
    console.log(`   Total memories:   ${stats.total}`);
    console.log(`   Active:           ${stats.active}`);
    console.log(`   Stale:            ${stats.stale}`);
    console.log(`   Deprecated:       ${stats.deprecated}`);
    console.log(`   From git:         ${stats.from_git}`);
    console.log(`   Manual:           ${stats.manual}`);
    console.log(`   Commits ingested: ${ingested.c}\n`);
  });

// ── prune ─────────────────────────────────────────────────────────────────────
program
  .command('prune')
  .description('Remove stale or deprecated memories')
  .option('--repo <path>',      'Repo root',             process.cwd())
  .option('--status <status>',  'Which to remove',        'stale')
  .option('--invalidate',       'Run git invalidation pass first')
  .action(async (opts) => {
    const repoPath = path.resolve(opts.repo as string);
    const db       = getDb(resolveDbPath(repoPath));

    if (opts.invalidate) {
      const git = simpleGit(repoPath);
      const inv = await runInvalidationPass(db, git);
      console.log(`\n🔍 Invalidation pass:`);
      console.log(`   Files checked:    ${inv.checkedFiles}`);
      console.log(`   Memories stalified: ${inv.stalifiedCount}`);
    }

    const removed = pruneByStatus(db, opts.status as 'stale' | 'deprecated' | 'all');
    console.log(`\n🧹 Pruned ${removed} ${opts.status} memories.\n`);
  });

// ─── Run ──────────────────────────────────────────────────────────────────────
program.parse();
