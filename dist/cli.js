#!/usr/bin/env node
/**
 * cli.ts — `local-brain` setup wizard, diagnostics & CLI runner.
 *
 * Commands:
 *  local-brain init     — auto-detects editors & writes MCP configs
 *  local-brain ingest   — run git ingestion on current repo
 *  local-brain query    — test semantic recall directly from CLI
 *  local-brain learn    — store a manual lesson directly from CLI
 *  local-brain validate — validate and reinforce a memory ID
 *  local-brain memories — list memories with agent/status filters
 *  local-brain trace    — trace memories for a specific file
 *  local-brain forget   — remove or deprecate specific memories
 *  local-brain doctor   — system diagnostics & configuration checker
 *  local-brain status   — show DB memory statistics and agent breakdown
 *  local-brain prune    — remove stale/deprecated memories
 */
import { program } from "commander";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { simpleGit } from "simple-git";
import { getDb, resolveDbPath, pruneByStatus, insertMemory, insertEmbedding, forgetMemory, getDbStats, validateMemory, } from "./db.js";
import { embed, estimateTokens } from "./embeddings.js";
import { ingestGitHistory } from "./git-ingest.js";
import { runInvalidationPass } from "./invalidation.js";
import { recallMemories, formatRecallMarkdown, traceFile } from "./recall.js";
import { derivePackageScope } from "./scoping.js";
import { evaluateMemoryQuality, detectImportanceLevel } from "./quality.js";
import { detectAgent, normalizeAgentId, getProjectId, } from "./provenance.js";
import { headerBanner, compactMark, success, warning, error, muted, highlight, heading, label, keyVal, statusDot, badge, setColorEnabled, isColorSupported, } from "./theme.js";
import { ENGINES_NODE, VERSION } from "./version.js";
import { debugLog } from "./debug.js";
// ─── Time Ago Utility ─────────────────────────────────────────────────────────
function timeAgo(dateStr) {
    try {
        const d = new Date(dateStr);
        const diffMs = Date.now() - d.getTime();
        if (isNaN(diffMs) || diffMs < 0)
            return dateStr;
        const mins = Math.floor(diffMs / 60000);
        if (mins < 1)
            return "just now";
        if (mins < 60)
            return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24)
            return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }
    catch {
        return dateStr;
    }
}
// ─── Editor Config Paths ──────────────────────────────────────────────────────
const HOME = os.homedir();
const EDITOR_TARGETS = [
    {
        name: "Claude Code",
        configPath: path.join(HOME, ".claude.json"),
        key: "mcpServers",
    },
    {
        name: "Cursor",
        configPath: path.join(HOME, ".cursor", "mcp.json"),
        key: "mcpServers",
    },
    {
        name: "Windsurf",
        configPath: path.join(HOME, ".codeium", "windsurf", "mcp_config.json"),
        key: "mcpServers",
    },
    {
        name: "VS Code Copilot",
        configPath: path.join(HOME, ".vscode", "mcp.json"),
        key: "servers",
    },
    {
        name: "Zed",
        configPath: path.join(HOME, ".config", "zed", "settings.json"),
        key: "context_servers",
    },
    {
        name: "Antigravity",
        configPath: path.join(HOME, ".config", "Antigravity", "settings.json"),
        key: "mcpServers",
    },
];
function buildMcpEntry(serverPath) {
    return {
        command: "node",
        args: [serverPath],
        env: {},
    };
}
function writePostCommitHook(repoPath) {
    const hooksDir = path.join(repoPath, ".git", "hooks");
    const hookPath = path.join(hooksDir, "post-commit");
    const script = `#!/bin/sh
# local-brain post-commit hook
# Resolve the local-brain CLI path: try global install, then walk from .git/hooks
LB_BIN="$(command -v local-brain 2>/dev/null)"
if [ -z "$LB_BIN" ]; then
  # Walk from .git/hooks/ to find node_modules/.bin/local-brain
  LB_BIN="$(cd "$(dirname "$0")/../.." && pwd)/node_modules/.bin/local-brain"
fi
if [ -x "$LB_BIN" ]; then
  ("$LB_BIN" ingest --commits 1 --quiet &) 2>/dev/null
fi
`;
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(hookPath, script, { mode: 0o755 });
    console.log(`  ${success("✓")} post-commit hook installed at ${muted(hookPath)}`);
}
// ─── CLI Program ──────────────────────────────────────────────────────────────
program
    .name("local-brain")
    .description("Local-first, multi-agent shared memory layer for AI coding agents")
    .version(VERSION, "-v, --version", "Output the current version")
    .option("--no-color", "Disable color output")
    .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.color === false || process.argv.includes("--no-color")) {
        setColorEnabled(false);
    }
});
// ── init ──────────────────────────────────────────────────────────────────────
program
    .command("init")
    .description("Auto-detect AI editors and write MCP config for each")
    .option("--repo <path>", "Repo root (defaults to cwd)", process.cwd())
    .option("--no-hook", "Skip post-commit hook installation")
    .action(async (opts) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const serverEntrypoint = path.resolve(__dirname, "mcp-server.js");
    const repoPath = path.resolve(opts.repo);
    const dbPath = resolveDbPath(repoPath);
    const db = getDb(dbPath);
    const stats = getDbStats(db);
    const projectId = getProjectId(repoPath);
    console.log("\n" + headerBanner() + "\n");
    console.log(`  ${success("✓")} ${highlight("Local Brain initialized successfully")}\n`);
    const relDbPath = path.relative(repoPath, dbPath) || dbPath;
    console.log(`  ${keyVal("PROJECT", projectId)}`);
    console.log(`  ${keyVal("MEMORY STORE", relDbPath)}`);
    console.log(`  ${label("STATUS")} ${statusDot("active")}`);
    console.log(`  ${keyVal("VERSION", VERSION)}\n`);
    console.log(`  ${keyVal("MEMORIES", stats.total)}`);
    console.log(`  ${keyVal("LESSONS", stats.manual)}`);
    console.log(`  ${keyVal("AGENTS", Object.keys(stats.agent_breakdown).length)}\n`);
    console.log(`  ${heading("AI Editors & Configs:")}`);
    let detected = 0;
    const entry = buildMcpEntry(serverEntrypoint);
    for (const editor of EDITOR_TARGETS) {
        const dir = path.dirname(editor.configPath);
        if (!existsSync(dir) && !existsSync(editor.configPath)) {
            console.log(`  ${muted("⏭")}  ${muted(editor.name)} — not found`);
            continue;
        }
        let config = {};
        if (existsSync(editor.configPath)) {
            try {
                config = JSON.parse(readFileSync(editor.configPath, "utf8"));
            }
            catch (e) {
                debugLog("cli", "Failed to parse editor config %s: %s", editor.configPath, e instanceof Error ? e.message : String(e));
                config = {};
            }
        }
        const key = editor.key;
        if (!config[key] || typeof config[key] !== "object") {
            config[key] = {};
        }
        config[key]["local-brain"] = entry;
        mkdirSync(dir, { recursive: true });
        writeFileSync(editor.configPath, JSON.stringify(config, null, 2));
        console.log(`  ${success("✓")} ${highlight(editor.name)} — config updated at ${muted(editor.configPath)}`);
        detected++;
    }
    if (detected === 0) {
        console.log(`\n  ${muted("ℹ No standard AI editor config paths found.")}`);
        console.log(`    Add local-brain to your editor's MCP config:`);
        console.log(JSON.stringify({ "local-brain": entry }, null, 2));
    }
    if (opts.hook !== false) {
        const gitDir = path.join(repoPath, ".git");
        if (existsSync(gitDir)) {
            writePostCommitHook(repoPath);
        }
        else {
            console.log(`  ${muted("ℹ No .git directory found — skipped post-commit hook.")}`);
        }
    }
    console.log(`\n  ${highlight("Ready for AI memory.")}\n`);
});
// ── ingest ────────────────────────────────────────────────────────────────────
program
    .command("ingest")
    .description("Scan git history and build the local brain DB")
    .option("--repo <path>", "Repo root (defaults to cwd)", process.cwd())
    .option("--since <date>", "Only process commits since date", "12 months ago")
    .option("--commits <n>", "Max commits to scan", "500")
    .option("--verbose", "Show per-commit log")
    .option("--quiet", "Suppress all output")
    .action(async (opts) => {
    const repoPath = path.resolve(opts.repo);
    const maxCommits = parseInt(opts.commits, 10) || 500;
    const since = opts.since;
    const verbose = !opts.quiet && Boolean(opts.verbose);
    if (!opts.quiet) {
        console.log(`\n${compactMark()} ${highlight("Local Brain MCP — Git Ingestion")}`);
        console.log(`   ${keyVal("Repo", repoPath, 8)}`);
        console.log(`   ${keyVal("Since", since, 8)}`);
        console.log(`   ${keyVal("Max", `${maxCommits} commits`, 8)}\n`);
    }
    const db = getDb(resolveDbPath(repoPath));
    const result = await ingestGitHistory(db, {
        repoPath,
        maxCommits,
        since,
        verbose,
    });
    if (!opts.quiet) {
        console.log(`  ${success("✓")} ${highlight("Ingest complete")}:`);
        console.log(`     ${label("Scanned", 12)} ${highlight(result.scanned)}`);
        console.log(`     ${label("Ingested", 12)} ${highlight(result.ingested)}`);
        console.log(`     ${label("Merged", 12)} ${highlight(result.merged)}`);
        console.log(`     ${label("Skipped", 12)} ${muted(result.skipped)}`);
        console.log(`     ${label("Errors", 12)} ${result.errors > 0 ? error(result.errors) : muted(result.errors)}\n`);
    }
});
// ── query ─────────────────────────────────────────────────────────────────────
program
    .command("query <text>")
    .description("Test semantic memory recall directly from CLI")
    .option("--repo <path>", "Repo root", process.cwd())
    .option("--file <path>", "File path filter")
    .option("--max <n>", "Max results", "5")
    .option("--agent <name>", "Filter by agent")
    .action(async (text, opts) => {
    const repoPath = path.resolve(opts.repo);
    const db = getDb(resolveDbPath(repoPath));
    const start = performance.now();
    const result = await recallMemories(db, {
        query: text,
        file_path: opts.file,
        max_items: parseInt(opts.max, 10),
        agent_filter: opts.agent,
    });
    const elapsed = (performance.now() - start).toFixed(2);
    console.log(`\n${compactMark()} ${highlight("Local Brain Recall")}\n`);
    console.log(formatRecallMarkdown(result, text));
    console.log(`\n  ${muted("⚡")} ${label("Latency", 8)} ${highlight(`${elapsed} ms`)} | ${label("Tokens", 7)} ${highlight(`${result.total_tokens}/250`)}\n`);
});
// ── learn ─────────────────────────────────────────────────────────────────────
program
    .command("learn <lesson>")
    .description("Store a durable engineering lesson into Local Brain")
    .option("--repo <path>", "Repo root", process.cwd())
    .option("--category <cat>", "Category (fix|architecture|convention|bug|manual)", "manual")
    .option("--file <path>", "Associated file path")
    .option("--agent <name>", "Agent identity (claude-code, cursor, antigravity, etc.)")
    .option("--importance-level <level>", "Importance level (low|medium|high|critical)")
    .option("--confidence <float>", "Confidence 0.0 to 1.0", "1.0")
    .option("--importance <float>", "Importance 0.1 to 2.0", "1.0")
    .action(async (lesson, opts) => {
    const repoPath = path.resolve(opts.repo);
    const db = getDb(resolveDbPath(repoPath));
    const category = opts.category;
    const filePath = opts.file ?? null;
    const agent = opts.agent ? normalizeAgentId(opts.agent) : detectAgent();
    const importance_level = opts.importanceLevel || detectImportanceLevel(lesson);
    const quality = evaluateMemoryQuality(lesson, category);
    if (!quality.isQuality) {
        console.error(`\n  ${warning("▲")} ${error("Memory rejected")}: ${muted(quality.reason ?? "Quality threshold not met")}\n`);
        process.exit(1);
    }
    const embedding = embed(lesson);
    const packageScope = derivePackageScope(filePath);
    const projectId = getProjectId(repoPath);
    const id = insertMemory(db, {
        category,
        content: lesson,
        summary: lesson.slice(0, 400),
        file_path: filePath,
        package_scope: packageScope,
        project_id: projectId,
        agent,
        importance_level,
        confidence: parseFloat(opts.confidence),
        importance: parseFloat(opts.importance),
        quality_score: quality.score,
        status: "active",
        source: "manual",
        token_count: estimateTokens(lesson),
    }, embedding);
    insertEmbedding(db, id, embedding);
    console.log(`\n  ${success("✓")} ${highlight(`Stored memory #${id}`)} ${muted(`[agent: ${agent}, importance: ${importance_level}, quality: ${quality.score}]`)}\n`);
});
// ── validate ──────────────────────────────────────────────────────────────────
program
    .command("validate <id>")
    .description("Validate that a memory was helpful and correct")
    .option("--repo <path>", "Repo root", process.cwd())
    .option("--agent <name>", "Validating agent identifier", "cli")
    .action((idStr, opts) => {
    const numId = parseInt(idStr, 10);
    if (isNaN(numId) || numId <= 0) {
        console.error(`\n  ${error("✖")} ${error("Please provide a valid positive integer memory ID.")}\n`);
        process.exit(1);
    }
    const repoPath = path.resolve(opts.repo);
    const db = getDb(resolveDbPath(repoPath));
    const agent = normalizeAgentId(opts.agent);
    const ok = validateMemory(db, numId, agent);
    if (ok) {
        console.log(`\n  ${success("✓")} ${highlight(`Memory #${numId}`)} validated by '${agent}'. Confidence boosted.\n`);
    }
    else {
        console.error(`\n  ${error("✖")} Memory #${numId} not found.\n`);
        process.exit(1);
    }
});
// ── memories ──────────────────────────────────────────────────────────────────
program
    .command("memories")
    .description("List stored memories with filtering")
    .option("--repo <path>", "Repo root", process.cwd())
    .option("--agent <name>", "Filter by agent")
    .option("--category <cat>", "Filter by category")
    .option("--status <status>", "Filter by status (active|stale|deprecated)", "active")
    .option("--limit <n>", "Max records to display", "20")
    .action((opts) => {
    const repoPath = path.resolve(opts.repo);
    const db = getDb(resolveDbPath(repoPath));
    const limit = parseInt(opts.limit, 10) || 20;
    const ALLOWED_STATUSES = new Set(["active", "stale", "deprecated", "all"]);
    const status = ALLOWED_STATUSES.has(opts.status) ? opts.status : "active";
    const boundedLimit = Math.min(Math.max(1, limit), 500);
    const conditions = status === "all" ? [] : ["status = ?"];
    const params = status === "all" ? [] : [status];
    if (opts.agent) {
        conditions.push("agent = ?");
        params.push(opts.agent);
    }
    if (opts.category) {
        conditions.push("category = ?");
        params.push(opts.category);
    }
    params.push(boundedLimit);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT * FROM memories ${whereClause} ORDER BY created_at DESC LIMIT ?`;
    const rows = db.prepare(sql).all(...params);
    console.log(`\n${compactMark()} ${highlight(`Stored Memories (${rows.length} records)`)}:\n`);
    if (rows.length === 0) {
        console.log(`  ${muted("No memories found matching the specified filters.")}\n`);
        return;
    }
    for (const r of rows) {
        const file = r.file_path ?? "general";
        const val = (r.validation_count ?? 0) > 0 ? ` ${success(`[val: ${r.validation_count}×]`)}` : "";
        const cFlag = r.contradiction_flag === 1 ? ` ${warning("[⚠️ CONTRADICTION]")}` : "";
        const agTag = muted(`[${r.agent ?? "unknown"}]`);
        const catTag = muted(`(${r.category} | ${file})`);
        console.log(`  • ${highlight(`#${r.id}`)} ${agTag} ${catTag}${val}${cFlag}: ${r.summary.slice(0, 120)}`);
    }
    console.log("");
});
// ── trace ─────────────────────────────────────────────────────────────────────
program
    .command("trace <filePath>")
    .description("Show full chronological memory history for a file")
    .option("--repo <path>", "Repo root", process.cwd())
    .action((filePath, opts) => {
    const repoPath = path.resolve(opts.repo);
    const db = getDb(resolveDbPath(repoPath));
    const memories = traceFile(db, filePath);
    if (memories.length === 0) {
        console.log(`\n  ${muted(`No memories recorded for ${filePath}`)}\n`);
        return;
    }
    console.log(`\n${compactMark()} ${heading(`Memory Trace: ${filePath}`)}\n`);
    for (const m of memories) {
        const statusTag = m.status !== "active" ? ` ${badge(m.status.toUpperCase(), "warning")}` : "";
        const supersededTag = m.superseded_by
            ? ` ${badge(`SUPERSEDED by #${m.superseded_by}`, "muted")}`
            : "";
        const agentTag = m.agent && m.agent !== "unknown" ? ` ${muted(`[agent: ${m.agent}]`)}` : "";
        const valTag = (m.validation_count ?? 0) > 0 ? ` ${success(`[validated: ${m.validation_count}×]`)}` : "";
        const commitTag = m.commit_hash ? ` ${muted(`@ ${m.commit_hash.slice(0, 7)}`)}` : "";
        console.log(`  • ${highlight(`#${m.id}`)} ${muted(`[${m.category}]`)}${statusTag}${supersededTag}${agentTag}${valTag}${commitTag}: ${m.summary.slice(0, 180)}`);
    }
    console.log("");
});
// ── forget ────────────────────────────────────────────────────────────────────
program
    .command("forget")
    .description("Remove or deprecate memories")
    .option("--repo <path>", "Repo root", process.cwd())
    .option("--id <n>", "Specific memory ID")
    .option("--file <path>", "File path")
    .option("--query <text>", "Text search pattern")
    .option("--hard", "Permanently delete instead of marking deprecated")
    .action((opts) => {
    const repoPath = path.resolve(opts.repo);
    const db = getDb(resolveDbPath(repoPath));
    const id = opts.id ? parseInt(opts.id, 10) : undefined;
    const res = forgetMemory(db, {
        id,
        filePath: opts.file,
        query: opts.query,
        hardDelete: Boolean(opts.hard),
    });
    const verb = opts.hard ? "Deleted" : "Deprecated";
    console.log(`\n  ${success("✓")} ${highlight(`${verb} ${res.count} memory record(s).`)}\n`);
});
// ── doctor ────────────────────────────────────────────────────────────────────
program
    .command("doctor")
    .description("Run system diagnostics and verify MCP editor configurations")
    .action(() => {
    console.log(`\n${compactMark()} ${highlight("Local Brain Doctor")}\n`);
    console.log(`  ${label("Node.js", 18)} ${process.version} (${ENGINES_NODE} required)`);
    console.log(`  ${label("Platform", 18)} ${process.platform} (${process.arch})`);
    console.log(`  ${label("Detected Agent", 18)} ${detectAgent()}`);
    console.log(`  ${label("Project ID", 18)} ${getProjectId()}`);
    const dbPath = resolveDbPath();
    console.log(`  ${label("Default DB path", 18)} ${muted(dbPath)}`);
    console.log(`  ${label("DB file exists", 18)} ${existsSync(dbPath) ? success("✓ YES") : muted("ℹ NO (will be created on first ingest)")}`);
    console.log(`\n  ${heading("Editor Configurations:")}`);
    for (const editor of EDITOR_TARGETS) {
        if (existsSync(editor.configPath)) {
            try {
                const config = JSON.parse(readFileSync(editor.configPath, "utf8"));
                const key = editor.key;
                const servers = config[key];
                const configured = Boolean(servers && servers["local-brain"]);
                console.log(`    • ${editor.name.padEnd(18)}: ${configured ? success("✓ CONFIGURED") : warning("▲ FILE EXISTS, MCP NOT LINKED")}`);
            }
            catch (e) {
                debugLog("cli", "Failed to parse editor config %s: %s", editor.configPath, e instanceof Error ? e.message : String(e));
                console.log(`    • ${editor.name.padEnd(18)}: ${error("✖ INVALID JSON")}`);
            }
        }
        else {
            console.log(`    • ${editor.name.padEnd(18)}: ${muted("⏭ NOT INSTALLED")}`);
        }
    }
    console.log(`\n  ${success("✓")} All diagnostics complete.\n`);
});
// ── status ────────────────────────────────────────────────────────────────────
program
    .command("status")
    .description("Show brain DB statistics and agent breakdown")
    .option("--repo <path>", "Repo root", process.cwd())
    .action(async (opts) => {
    const repoPath = path.resolve(opts.repo);
    const dbPath = resolveDbPath(repoPath);
    const db = getDb(dbPath);
    const stats = getDbStats(db);
    const projectId = getProjectId(repoPath);
    let sizeKb = "0.0";
    try {
        sizeKb = (statSync(dbPath).size / 1024).toFixed(1);
    }
    catch (e) {
        debugLog("cli", "DB file stat failed: %s", e instanceof Error ? e.message : String(e));
    }
    console.log(`\n${compactMark()} ${highlight("Local Brain MCP")}\n`);
    console.log(`${heading("PROJECT")}`);
    console.log(`  ${highlight(projectId)}\n`);
    console.log(`${heading("MEMORY")}`);
    console.log(`  ${label("Store", 12)} ${muted(dbPath)}`);
    console.log(`  ${label("Size", 12)} ${sizeKb} KB`);
    console.log(`  ${label("Memories", 12)} ${highlight(stats.total.toLocaleString())}`);
    console.log(`  ${label("Lessons", 12)} ${highlight(stats.manual.toLocaleString())}`);
    console.log(`  ${label("From Git", 12)} ${highlight(stats.from_git.toLocaleString())}`);
    console.log(`  ${label("Validated", 12)} ${highlight(stats.validated.toLocaleString())}`);
    console.log(`  ${label("Active", 12)} ${statusDot("active")} (${stats.active})`);
    if (stats.stale > 0) {
        console.log(`  ${label("Stale", 12)} ${statusDot("stale")} (${stats.stale})`);
    }
    if (stats.deprecated > 0) {
        console.log(`  ${label("Deprecated", 12)} ${statusDot("deprecated")} (${stats.deprecated})`);
    }
    if (stats.superseded > 0) {
        console.log(`  ${label("Superseded", 12)} ${muted(`${stats.superseded}`)}`);
    }
    if (stats.contradicted > 0) {
        console.log(`  ${label("Contradicted", 12)} ${warning(`${stats.contradicted}`)}`);
    }
    console.log("");
    console.log(`${heading("AGENTS")}`);
    const agentEntries = Object.entries(stats.agent_breakdown);
    if (agentEntries.length === 0) {
        console.log(`  ${muted("No agent activity recorded yet")}`);
    }
    else {
        for (const [ag, count] of agentEntries) {
            const displayAg = ag === "unknown" ? "Unknown" : ag;
            console.log(`  ${displayAg.padEnd(20)} ${statusDot("active")} (${count})`);
        }
    }
    console.log("");
    // Recent knowledge from database (never fabricated)
    try {
        const recentRows = db
            .prepare(`SELECT summary, agent, created_at FROM memories WHERE status = 'active' ORDER BY created_at DESC LIMIT 3`)
            .all();
        if (recentRows.length > 0) {
            console.log(`${heading("RECENT KNOWLEDGE")}`);
            for (const item of recentRows) {
                console.log(`  ${highlight(item.summary.slice(0, 100))}`);
                const ag = item.agent && item.agent !== "unknown" ? item.agent : "Local Brain";
                const time = timeAgo(item.created_at);
                console.log(`    ${muted(`Learned by ${ag} · ${time}`)}\n`);
            }
        }
    }
    catch (e) {
        debugLog("cli", "Failed to fetch recent knowledge: %s", e instanceof Error ? e.message : String(e));
    }
});
// ── prune ─────────────────────────────────────────────────────────────────────
program
    .command("prune")
    .description("Remove stale or deprecated memories")
    .option("--repo <path>", "Repo root", process.cwd())
    .option("--status <status>", "Which to remove (stale, deprecated, all)", "stale")
    .option("--invalidate", "Run git invalidation pass first")
    .action(async (opts) => {
    const repoPath = path.resolve(opts.repo);
    const db = getDb(resolveDbPath(repoPath));
    if (opts.invalidate) {
        const git = simpleGit(repoPath);
        const inv = await runInvalidationPass(db, git);
        console.log(`\n${compactMark()} ${highlight("Git Invalidation Pass")}:`);
        console.log(`     ${label("Files checked", 20)} ${highlight(inv.checkedFiles)}`);
        console.log(`     ${label("Memories stalified", 20)} ${inv.stalifiedCount > 0 ? warning(inv.stalifiedCount) : muted(inv.stalifiedCount)}`);
        console.log(`     ${label("Snapshots updated", 20)} ${highlight(inv.updatedSnapshots)}`);
    }
    const removed = pruneByStatus(db, opts.status);
    console.log(`\n  ${success("✓")} ${highlight(`Pruned ${removed} ${opts.status} memories.`)}\n`);
});
// Custom help formatting
program.configureHelp({
    formatHelp: (cmd, helper) => {
        const title = isColorSupported() ? highlight("Local Brain MCP") : "Local Brain MCP";
        const desc = isColorSupported()
            ? muted("Shared memory for AI coding agents")
            : "Shared memory for AI coding agents";
        const useHeading = isColorSupported() ? heading("Usage:") : "Usage:";
        const cmdHeading = isColorSupported() ? heading("Commands:") : "Commands:";
        const optHeading = isColorSupported() ? heading("Options:") : "Options:";
        const commands = [
            ["init [options]", "Auto-detect AI editors and write MCP config"],
            ["ingest [options]", "Scan git history and build the local brain DB"],
            ["query <text>", "Test semantic recall directly from CLI"],
            ["learn <lesson>", "Store a durable engineering lesson"],
            ["validate <id>", "Validate that a memory was helpful and correct"],
            ["memories [options]", "List stored memories with filtering"],
            ["trace <filePath>", "Show full chronological memory history for a file"],
            ["forget [options]", "Remove or deprecate specific memories"],
            ["status [options]", "Show memory status and agent breakdown"],
            ["prune [options]", "Remove stale or deprecated memories"],
            ["doctor", "Run system diagnostics and verify MCP editor configurations"],
        ];
        const options = [
            ["--no-color", "Disable color output"],
            ["-v, --version", "Output the current version"],
            ["-h, --help", "Display help for command"],
        ];
        const maxCmdLen = Math.max(...commands.map((c) => c[0].length));
        const maxOptLen = Math.max(...options.map((o) => o[0].length));
        const cmdLines = commands
            .map(([name, d]) => `  ${highlight(name.padEnd(maxCmdLen + 2))} ${muted(d)}`)
            .join("\n");
        const optLines = options
            .map(([name, d]) => `  ${highlight(name.padEnd(maxOptLen + 2))} ${muted(d)}`)
            .join("\n");
        return `
${title}
${desc}

${useHeading}
  local-brain <command> [options]

${cmdHeading}
${cmdLines}

${optHeading}
${optLines}
`;
    },
});
program.parse();
//# sourceMappingURL=cli.js.map