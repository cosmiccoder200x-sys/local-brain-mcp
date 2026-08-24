/**
 * cli.ts — `npx local-brain` setup wizard, diagnostics & CLI runner.
 *
 * Commands:
 *  local-brain init    — auto-detects editors & writes MCP configs
 *  local-brain ingest  — run git ingestion on current repo
 *  local-brain query   — test semantic recall directly from CLI
 *  local-brain doctor  — system diagnostics & configuration checker
 *  local-brain status  — show DB memory statistics
 *  local-brain prune   — remove stale/deprecated memories
 */
import { program } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import simpleGit from 'simple-git';
import { getDb, resolveDbPath, pruneByStatus } from './db.js';
import { ingestGitHistory } from './git-ingest.js';
import { runInvalidationPass } from './invalidation.js';
import { recallMemories, formatRecallMarkdown } from './recall.js';
// ─── Editor Config Paths ──────────────────────────────────────────────────────
const HOME = os.homedir();
const EDITOR_TARGETS = [
    {
        name: 'Claude Code',
        configPath: path.join(HOME, '.claude.json'),
        key: 'mcpServers',
    },
    {
        name: 'Cursor',
        configPath: path.join(HOME, '.cursor', 'mcp.json'),
        key: 'mcpServers',
    },
    {
        name: 'Windsurf',
        configPath: path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json'),
        key: 'mcpServers',
    },
    {
        name: 'VS Code Copilot',
        configPath: path.join(HOME, '.vscode', 'mcp.json'),
        key: 'servers',
    },
    {
        name: 'Zed',
        configPath: path.join(HOME, '.config', 'zed', 'settings.json'),
        key: 'context_servers',
    },
];
function buildMcpEntry(serverPath) {
    return {
        command: 'node',
        args: [serverPath],
        env: {},
    };
}
function writePostCommitHook(repoPath) {
    const hooksDir = path.join(repoPath, '.git', 'hooks');
    const hookPath = path.join(hooksDir, 'post-commit');
    const script = `#!/bin/sh
# local-brain post-commit hook
(node "$(npm root -g)/local-brain-mcp/dist/cli.js" ingest --commits 1 --quiet &) 2>/dev/null
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
    .action(async (opts) => {
    const serverEntrypoint = path.resolve(new URL(import.meta.url).pathname, '../../dist/mcp-server.js');
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
        let config = {};
        if (existsSync(editor.configPath)) {
            try {
                config = JSON.parse(readFileSync(editor.configPath, 'utf8'));
            }
            catch {
                config = {};
            }
        }
        const key = editor.key;
        if (!config[key])
            config[key] = {};
        config[key]['local-brain'] = entry;
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
    if (opts.hook !== false) {
        const repoPath = opts.repo;
        const gitDir = path.join(repoPath, '.git');
        if (existsSync(gitDir)) {
            writePostCommitHook(repoPath);
        }
        else {
            console.log('\n⚠️  No .git directory found — skipping post-commit hook.');
        }
    }
    console.log(`\n✨ Done! Restart your AI editor to activate local-brain.\n`);
});
// ── ingest ────────────────────────────────────────────────────────────────────
program
    .command('ingest')
    .description('Scan git history and build the local brain DB')
    .option('--repo <path>', 'Repo root (defaults to cwd)', process.cwd())
    .option('--since <date>', 'Only process commits since date', '12 months ago')
    .option('--commits <n>', 'Max commits to scan', '500')
    .option('--verbose', 'Show per-commit log')
    .option('--quiet', 'Suppress all output')
    .action(async (opts) => {
    const repoPath = path.resolve(opts.repo);
    const maxCommits = parseInt(opts.commits, 10);
    const since = opts.since;
    const verbose = !!opts.verbose && !opts.quiet;
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
    .action(async (text, opts) => {
    const repoPath = path.resolve(opts.repo);
    const db = getDb(resolveDbPath(repoPath));
    const start = performance.now();
    const result = await recallMemories(db, {
        query: text,
        file_path: opts.file,
    });
    const elapsed = (performance.now() - start).toFixed(2);
    console.log(`\n${formatRecallMarkdown(result, text)}`);
    console.log(`\n⚡ Recall latency: ${elapsed} ms | Tokens: ${result.total_tokens}/250\n`);
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
                const key = editor.key;
                const servers = config[key];
                const configured = Boolean(servers && servers['local-brain']);
                console.log(`    • ${editor.name.padEnd(16)}: ${configured ? '✅ CONFIGURED' : '⚠️ FILE EXISTS, MCP NOT LINKED'}`);
            }
            catch {
                console.log(`    • ${editor.name.padEnd(16)}: ⚠️ INVALID JSON`);
            }
        }
        else {
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
    .action((opts) => {
    const repoPath = path.resolve(opts.repo);
    const db = getDb(resolveDbPath(repoPath));
    const stats = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active'     THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'stale'      THEN 1 ELSE 0 END) AS stale,
        SUM(CASE WHEN status = 'deprecated' THEN 1 ELSE 0 END) AS deprecated,
        SUM(CASE WHEN source  = 'git-ingest' THEN 1 ELSE 0 END) AS from_git,
        SUM(CASE WHEN source  = 'manual'     THEN 1 ELSE 0 END) AS manual
      FROM memories
    `).get();
    const ingested = db.prepare('SELECT COUNT(*) AS c FROM ingested_commits').get();
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
    .option('--repo <path>', 'Repo root', process.cwd())
    .option('--status <status>', 'Which to remove', 'stale')
    .option('--invalidate', 'Run git invalidation pass first')
    .action(async (opts) => {
    const repoPath = path.resolve(opts.repo);
    const db = getDb(resolveDbPath(repoPath));
    if (opts.invalidate) {
        const git = simpleGit(repoPath);
        const inv = await runInvalidationPass(db, git);
        console.log(`\n🔍 Invalidation pass:`);
        console.log(`   Files checked:    ${inv.checkedFiles}`);
        console.log(`   Memories stalified: ${inv.stalifiedCount}`);
    }
    const removed = pruneByStatus(db, opts.status);
    console.log(`\n🧹 Pruned ${removed} ${opts.status} memories.\n`);
});
program.parse();
//# sourceMappingURL=cli.js.map