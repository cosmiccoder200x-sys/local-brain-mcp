/**
 * db.ts — Database initialization, connection management, migrations, and CRUD operations.
 *
 * Uses better-sqlite3 for synchronous SQLite access. Vector embeddings are
 * stored directly as Float32Array BLOBs for fast zero-dependency local search.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { cosineSimilarity } from "./embeddings.js";
import { VALIDATION_CONFIDENCE_BOOST, MAX_CONFIDENCE, DUPLICATE_SIMILARITY_THRESHOLD, CONTRADICTION_SIMILARITY_THRESHOLD, } from "./config.js";
import { debugLog } from "./debug.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ─── DB Path Resolution ────────────────────────────────────────────────────────
export function resolveDbPath(repoRoot) {
    if (process.env.LOCAL_BRAIN_DB_PATH) {
        return path.resolve(process.env.LOCAL_BRAIN_DB_PATH);
    }
    if (repoRoot) {
        return path.join(repoRoot, ".git", "brain.db");
    }
    const configDir = path.join(os.homedir(), ".config", "local-brain");
    return path.join(configDir, "brain.db");
}
// ─── Schema Migration ──────────────────────────────────────────────────────────
/**
 * Idempotent migration to ensure older databases receive Phase 2/3 schema columns
 * without data loss or table recreation.
 */
export function migrateDb(db) {
    const tableCheck = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'")
        .get();
    if (!tableCheck)
        return;
    const existingColumns = new Set(db.prepare("PRAGMA table_info('memories')").all().map((c) => c.name));
    const migrations = [
        { name: "files", ddl: "ALTER TABLE memories ADD COLUMN files TEXT" },
        { name: "author", ddl: "ALTER TABLE memories ADD COLUMN author TEXT" },
        { name: "branch", ddl: "ALTER TABLE memories ADD COLUMN branch TEXT" },
        { name: "project", ddl: "ALTER TABLE memories ADD COLUMN project TEXT" },
        {
            name: "confidence",
            ddl: "ALTER TABLE memories ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0",
        },
        {
            name: "importance",
            ddl: "ALTER TABLE memories ADD COLUMN importance REAL NOT NULL DEFAULT 1.0",
        },
        {
            name: "quality_score",
            ddl: "ALTER TABLE memories ADD COLUMN quality_score REAL NOT NULL DEFAULT 1.0",
        },
        {
            name: "superseded_by",
            ddl: "ALTER TABLE memories ADD COLUMN superseded_by INTEGER REFERENCES memories(id) ON DELETE SET NULL",
        },
        {
            name: "supersedes_id",
            ddl: "ALTER TABLE memories ADD COLUMN supersedes_id INTEGER REFERENCES memories(id) ON DELETE SET NULL",
        },
        {
            name: "last_validated",
            ddl: "ALTER TABLE memories ADD COLUMN last_validated DATETIME DEFAULT CURRENT_TIMESTAMP",
        },
        // Phase 3 — multi-agent provenance
        { name: "project_id", ddl: "ALTER TABLE memories ADD COLUMN project_id TEXT" },
        { name: "agent", ddl: "ALTER TABLE memories ADD COLUMN agent TEXT NOT NULL DEFAULT 'unknown'" },
        { name: "validated_by", ddl: "ALTER TABLE memories ADD COLUMN validated_by TEXT" },
        {
            name: "validation_count",
            ddl: "ALTER TABLE memories ADD COLUMN validation_count INTEGER NOT NULL DEFAULT 0",
        },
        {
            name: "contradiction_flag",
            ddl: "ALTER TABLE memories ADD COLUMN contradiction_flag INTEGER NOT NULL DEFAULT 0",
        },
        { name: "contradiction_ids", ddl: "ALTER TABLE memories ADD COLUMN contradiction_ids TEXT" },
        {
            name: "importance_level",
            ddl: "ALTER TABLE memories ADD COLUMN importance_level TEXT NOT NULL DEFAULT 'medium'",
        },
    ];
    for (const { name, ddl } of migrations) {
        if (!existingColumns.has(name)) {
            try {
                db.exec(ddl);
            }
            catch (e) {
                debugLog("db", "Migration column %s skipped (may already exist): %s", name, e instanceof Error ? e.message : String(e));
            }
        }
    }
    // Ensure supplementary indexes exist
    try {
        db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_status          ON memories(status);
      CREATE INDEX IF NOT EXISTS idx_memories_file_path       ON memories(file_path);
      CREATE INDEX IF NOT EXISTS idx_memories_package         ON memories(package_scope);
      CREATE INDEX IF NOT EXISTS idx_memories_category        ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_memories_commit          ON memories(commit_hash);
      CREATE INDEX IF NOT EXISTS idx_memories_superseded_by   ON memories(superseded_by);
      CREATE INDEX IF NOT EXISTS idx_memories_branch          ON memories(branch);
      CREATE INDEX IF NOT EXISTS idx_memories_project         ON memories(project);
      CREATE INDEX IF NOT EXISTS idx_memories_project_id      ON memories(project_id);
      CREATE INDEX IF NOT EXISTS idx_memories_agent           ON memories(agent);
      CREATE INDEX IF NOT EXISTS idx_memories_contradiction   ON memories(contradiction_flag);
    `);
    }
    catch (e) {
        debugLog("db", "Index creation race (safe to ignore): %s", e instanceof Error ? e.message : String(e));
    }
}
export const BASE_SCHEMA_SQL = `
-- ============================================================
-- local-brain-mcp: Pure SQLite schema with BLOB vector storage
-- Phase 3: multi-agent provenance, validation, contradiction
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS memories (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  category           TEXT NOT NULL CHECK(category IN ('fix', 'architecture', 'convention', 'bug', 'manual')),
  content            TEXT NOT NULL,
  summary            TEXT NOT NULL,
  file_path          TEXT,
  files              TEXT,
  package_scope      TEXT,
  commit_hash        TEXT,
  git_ref            TEXT,
  author             TEXT,
  branch             TEXT,
  project            TEXT,
  project_id         TEXT,
  agent              TEXT NOT NULL DEFAULT 'unknown',
  validated_by       TEXT,
  validation_count   INTEGER NOT NULL DEFAULT 0,
  contradiction_flag INTEGER NOT NULL DEFAULT 0,
  contradiction_ids  TEXT,
  importance_level   TEXT NOT NULL DEFAULT 'medium'
                         CHECK(importance_level IN ('low', 'medium', 'high', 'critical')),
  confidence         REAL NOT NULL DEFAULT 1.0,
  importance         REAL NOT NULL DEFAULT 1.0,
  quality_score      REAL NOT NULL DEFAULT 1.0,
  status             TEXT NOT NULL DEFAULT 'active'
                         CHECK(status IN ('active', 'stale', 'deprecated')),
  source             TEXT DEFAULT 'git-ingest'
                         CHECK(source IN ('git-ingest', 'manual', 'session')),
  superseded_by      INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  supersedes_id      INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  last_validated     DATETIME DEFAULT CURRENT_TIMESTAMP,
  token_count        INTEGER DEFAULT 0,
  embedding          BLOB,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS memories_updated_at
  AFTER UPDATE ON memories
  BEGIN
    UPDATE memories SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;

CREATE TABLE IF NOT EXISTS file_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path     TEXT NOT NULL UNIQUE,
  commit_hash   TEXT NOT NULL,
  line_count    INTEGER DEFAULT 0,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_snapshots_file ON file_snapshots(file_path);

CREATE TABLE IF NOT EXISTS ingested_commits (
  commit_hash   TEXT PRIMARY KEY,
  ingested_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  memory_count  INTEGER DEFAULT 0
);
`;
// ─── Connection Management ────────────────────────────────────────────────────
let _defaultDb = null;
const _openDbs = new Set();
export function getDb(dbPath) {
    if (!dbPath) {
        if (_defaultDb && _defaultDb.open)
            return _defaultDb;
        const resolvedPath = resolveDbPath();
        const dir = path.dirname(resolvedPath);
        mkdirSync(dir, { recursive: true });
        const db = new Database(resolvedPath);
        db.exec(BASE_SCHEMA_SQL);
        migrateDb(db);
        db.pragma("journal_mode = WAL");
        db.pragma("synchronous = NORMAL");
        db.pragma("temp_store = MEMORY");
        _defaultDb = db;
        _openDbs.add(db);
        return db;
    }
    const resolvedPath = path.resolve(dbPath);
    const dir = path.dirname(resolvedPath);
    mkdirSync(dir, { recursive: true });
    const db = new Database(resolvedPath);
    db.exec(BASE_SCHEMA_SQL);
    migrateDb(db);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("temp_store = MEMORY");
    _openDbs.add(db);
    return db;
}
export function closeDb(targetDb) {
    if (targetDb) {
        try {
            targetDb.close();
        }
        catch (e) {
            debugLog("db", "Failed to close target DB: %s", e instanceof Error ? e.message : String(e));
        }
        _openDbs.delete(targetDb);
        if (_defaultDb === targetDb)
            _defaultDb = null;
    }
    else {
        for (const d of _openDbs) {
            try {
                d.close();
            }
            catch (e) {
                debugLog("db", "Failed to close DB connection: %s", e instanceof Error ? e.message : String(e));
            }
        }
        _openDbs.clear();
        _defaultDb = null;
    }
}
export function insertMemory(db, fields, embedding) {
    const embeddingBuffer = embedding
        ? Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)
        : null;
    const filesJson = Array.isArray(fields.files)
        ? JSON.stringify(fields.files)
        : (fields.files ?? (fields.file_path ? JSON.stringify([fields.file_path]) : null));
    const stmt = db.prepare(`
    INSERT INTO memories
      (category, content, summary, file_path, files, package_scope,
       commit_hash, git_ref, author, branch, project, project_id,
       agent, validated_by, validation_count,
       contradiction_flag, contradiction_ids, importance_level,
       confidence, importance, quality_score, status, source,
       superseded_by, supersedes_id, last_validated, token_count, embedding)
    VALUES
      (@category, @content, @summary, @file_path, @files, @package_scope,
       @commit_hash, @git_ref, @author, @branch, @project, @project_id,
       @agent, @validated_by, @validation_count,
       @contradiction_flag, @contradiction_ids, @importance_level,
       @confidence, @importance, @quality_score, @status, @source,
       @superseded_by, @supersedes_id, @last_validated, @token_count, @embedding)
  `);
    const params = {
        category: fields.category,
        content: fields.content,
        summary: fields.summary,
        file_path: fields.file_path ?? null,
        files: filesJson,
        package_scope: fields.package_scope ?? null,
        commit_hash: fields.commit_hash ?? null,
        git_ref: fields.git_ref ?? null,
        author: fields.author ?? null,
        branch: fields.branch ?? null,
        project: fields.project ?? null,
        project_id: fields.project_id ?? null,
        agent: fields.agent ?? "unknown",
        validated_by: fields.validated_by ?? null,
        validation_count: fields.validation_count ?? 0,
        contradiction_flag: fields.contradiction_flag ?? 0,
        contradiction_ids: fields.contradiction_ids ?? null,
        importance_level: fields.importance_level ?? "medium",
        confidence: typeof fields.confidence === "number" ? Math.max(0, Math.min(1, fields.confidence)) : 1.0,
        importance: typeof fields.importance === "number" ? Math.max(0.1, Math.min(2.0, fields.importance)) : 1.0,
        quality_score: typeof fields.quality_score === "number" ? fields.quality_score : 1.0,
        status: fields.status ?? "active",
        source: fields.source ?? "git-ingest",
        superseded_by: fields.superseded_by ?? null,
        supersedes_id: fields.supersedes_id ?? null,
        last_validated: fields.last_validated ?? new Date().toISOString(),
        token_count: fields.token_count ?? Math.ceil(fields.summary.length / 4),
        embedding: embeddingBuffer,
    };
    const result = stmt.run(params);
    const newId = result.lastInsertRowid;
    if (fields.supersedes_id) {
        supersedeMemory(db, fields.supersedes_id, newId);
    }
    return newId;
}
export function insertEmbedding(db, id, embedding) {
    const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    db.prepare("UPDATE memories SET embedding = ? WHERE id = ?").run(buffer, id);
}
export function getMemoryById(db, id) {
    return db.prepare("SELECT * FROM memories WHERE id = ?").get(id) ?? null;
}
export function updateMemory(db, id, fields) {
    const updates = [];
    const params = { id };
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) {
            updates.push(`${key} = @${key}`);
            params[key] = value;
        }
    }
    if (updates.length === 0)
        return false;
    const sql = `UPDATE memories SET ${updates.join(", ")} WHERE id = @id`;
    const result = db.prepare(sql).run(params);
    return result.changes > 0;
}
export function supersedeMemory(db, oldId, newId) {
    db.prepare(`
    UPDATE memories
    SET superseded_by = ?, status = 'deprecated', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(newId, oldId);
    db.prepare(`
    UPDATE memories
    SET supersedes_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(oldId, newId);
}
export function markMemoryStale(db, id) {
    db.prepare("UPDATE memories SET status = 'stale' WHERE id = ?").run(id);
}
export function markMemoryDeprecated(db, id) {
    db.prepare("UPDATE memories SET status = 'deprecated' WHERE id = ?").run(id);
}
export function getActiveMemoriesByFile(db, filePath) {
    return db
        .prepare(`
    SELECT * FROM memories
    WHERE (file_path = ? OR files LIKE ?) AND status = 'active'
    ORDER BY created_at DESC
  `)
        .all(filePath, `%"${filePath}"%`);
}
export function pruneByStatus(db, status) {
    let stmt;
    if (status === "all") {
        stmt = db.prepare("DELETE FROM memories WHERE status != 'active'");
    }
    else {
        stmt = db.prepare("DELETE FROM memories WHERE status = ?");
    }
    const result = status === "all" ? stmt.run() : stmt.run(status);
    return result.changes;
}
export function forgetMemory(db, options) {
    const { id, filePath, query, hardDelete = false } = options;
    let targetIds = [];
    if (typeof id === "number") {
        const row = getMemoryById(db, id);
        if (row)
            targetIds.push(row.id);
    }
    else if (filePath) {
        const rows = db
            .prepare("SELECT id FROM memories WHERE file_path = ? OR files LIKE ?")
            .all(filePath, `%"${filePath}"%`);
        targetIds = rows.map((r) => r.id);
    }
    else if (query) {
        const pattern = `%${query.trim()}%`;
        const rows = db
            .prepare("SELECT id FROM memories WHERE content LIKE ? OR summary LIKE ?")
            .all(pattern, pattern);
        targetIds = rows.map((r) => r.id);
    }
    if (targetIds.length === 0) {
        return { count: 0, affectedIds: [] };
    }
    if (hardDelete) {
        const placeholders = targetIds.map(() => "?").join(",");
        db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...targetIds);
    }
    else {
        const placeholders = targetIds.map(() => "?").join(",");
        db.prepare(`UPDATE memories SET status = 'deprecated', updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...targetIds);
    }
    return { count: targetIds.length, affectedIds: targetIds };
}
export function findDuplicateMemory(db, embedding, content, filePath, similarityThreshold = DUPLICATE_SIMILARITY_THRESHOLD) {
    const cleanedContent = content.trim().toLowerCase();
    // 1. Exact match check
    const exactRow = db
        .prepare(`
    SELECT * FROM memories
    WHERE status = 'active'
      AND LOWER(TRIM(content)) = ?
      ${filePath ? "AND (file_path = ? OR file_path IS NULL)" : ""}
    LIMIT 1
  `)
        .get(...(filePath ? [cleanedContent, filePath] : [cleanedContent]));
    if (exactRow) {
        return { match: exactRow, similarity: 1.0, isExact: true };
    }
    // 2. Vector-based near duplicate check
    if (!embedding)
        return null;
    const candidateRows = db
        .prepare(`
    SELECT * FROM memories
    WHERE status = 'active'
      ${filePath ? "AND (file_path = ? OR file_path IS NULL)" : ""}
  `)
        .all(...(filePath ? [filePath] : []));
    let bestMatch = null;
    let maxSim = -1;
    for (const row of candidateRows) {
        if (!row.embedding)
            continue;
        const memVec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT);
        const sim = cosineSimilarity(embedding, memVec);
        if (sim > maxSim) {
            maxSim = sim;
            bestMatch = row;
        }
    }
    if (bestMatch && maxSim >= similarityThreshold) {
        return { match: bestMatch, similarity: maxSim, isExact: false };
    }
    return null;
}
export function mergeMemory(db, existingId, newFields) {
    const existing = getMemoryById(db, existingId);
    if (!existing)
        return;
    const mergedConfidence = Math.max(existing.confidence, newFields.confidence ?? 1.0);
    const mergedImportance = Math.max(existing.importance, newFields.importance ?? 1.0);
    const mergedSummary = newFields.summary.length > existing.summary.length ? newFields.summary : existing.summary;
    let existingFiles = [];
    try {
        if (existing.files)
            existingFiles = JSON.parse(existing.files);
    }
    catch (e) {
        debugLog("db", "Failed to parse existing files JSON for memory %d: %s", existingId, e instanceof Error ? e.message : String(e));
    }
    if (newFields.file_path && !existingFiles.includes(newFields.file_path)) {
        existingFiles.push(newFields.file_path);
    }
    db.prepare(`
    UPDATE memories
    SET summary = ?,
        confidence = ?,
        importance = ?,
        files = ?,
        last_validated = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(mergedSummary, mergedConfidence, mergedImportance, JSON.stringify(existingFiles), existingId);
}
// ─── Stats & Ingestion ─────────────────────────────────────────────────────────
export function getDbStats(db) {
    const stats = db
        .prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'active'                 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'stale'                  THEN 1 ELSE 0 END) AS stale,
      SUM(CASE WHEN status = 'deprecated'             THEN 1 ELSE 0 END) AS deprecated,
      SUM(CASE WHEN source = 'git-ingest'             THEN 1 ELSE 0 END) AS from_git,
      SUM(CASE WHEN source = 'manual'                 THEN 1 ELSE 0 END) AS manual,
      SUM(CASE WHEN superseded_by IS NOT NULL         THEN 1 ELSE 0 END) AS superseded,
      SUM(CASE WHEN validation_count > 0              THEN 1 ELSE 0 END) AS validated,
      SUM(CASE WHEN contradiction_flag = 1            THEN 1 ELSE 0 END) AS contradicted
    FROM memories
  `)
        .get();
    const commits = db.prepare("SELECT COUNT(*) AS c FROM ingested_commits").get();
    const snapshots = db.prepare("SELECT COUNT(*) AS c FROM file_snapshots").get();
    const agentRows = db
        .prepare(`SELECT agent, COUNT(*) AS cnt FROM memories GROUP BY agent`)
        .all();
    const agent_breakdown = {};
    for (const row of agentRows) {
        agent_breakdown[row.agent ?? "unknown"] = row.cnt;
    }
    return {
        total: stats.total ?? 0,
        active: stats.active ?? 0,
        stale: stats.stale ?? 0,
        deprecated: stats.deprecated ?? 0,
        from_git: stats.from_git ?? 0,
        manual: stats.manual ?? 0,
        superseded: stats.superseded ?? 0,
        commits_ingested: commits?.c ?? 0,
        file_snapshots: snapshots?.c ?? 0,
        validated: stats.validated ?? 0,
        contradicted: stats.contradicted ?? 0,
        agent_breakdown,
    };
}
// ─── Validation ────────────────────────────────────────────────────────────────
export function validateMemory(db, id, agentId = "unknown") {
    const existing = getMemoryById(db, id);
    if (!existing)
        return false;
    const newCount = (existing.validation_count ?? 0) + 1;
    const newConfidence = Math.min(MAX_CONFIDENCE, (existing.confidence ?? 0.7) + VALIDATION_CONFIDENCE_BOOST);
    db.prepare(`
    UPDATE memories
    SET validation_count = ?,
        validated_by     = ?,
        confidence       = ?,
        last_validated   = CURRENT_TIMESTAMP,
        updated_at       = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(newCount, agentId, newConfidence, id);
    return true;
}
// ─── Contradiction Detection ───────────────────────────────────────────────────
const CONTRADICTION_PHRASES = [
    /\bno longer\b/i,
    /\breplaced (by|with)\b/i,
    /\bmigrated (to|from)\b/i,
    /\bdo not use\b/i,
    /\bdon't use\b/i,
    /\bswitch(ed)? to\b/i,
    /\binstead (of|use)\b/i,
    /\bremoved\b/i,
    /\bdeprecated\b/i,
    /\bstopped using\b/i,
    /\bwe (now|moved|switched)\b/i,
];
export function detectContradictions(db, embedding, newContent, projectId) {
    const hasNegation = CONTRADICTION_PHRASES.some((p) => p.test(newContent));
    if (!hasNegation) {
        return { contradictedIds: [] };
    }
    const query = projectId
        ? `SELECT * FROM memories WHERE status = 'active' AND (project_id = ? OR project_id IS NULL)`
        : `SELECT * FROM memories WHERE status = 'active'`;
    const rows = (projectId ? db.prepare(query).all(projectId) : db.prepare(query).all());
    const contradictedIds = [];
    for (const row of rows) {
        if (!row.embedding)
            continue;
        const memVec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT);
        const sim = cosineSimilarity(embedding, memVec);
        if (sim >= CONTRADICTION_SIMILARITY_THRESHOLD) {
            contradictedIds.push(row.id);
        }
    }
    return { contradictedIds };
}
export function markContradiction(db, idA, idB) {
    const update = (id, otherId) => {
        const row = getMemoryById(db, id);
        if (!row)
            return;
        let existingIds = [];
        try {
            if (row.contradiction_ids)
                existingIds = JSON.parse(row.contradiction_ids);
        }
        catch (e) {
            debugLog("db", "Failed to parse contradiction_ids for memory %d: %s", id, e instanceof Error ? e.message : String(e));
        }
        if (!existingIds.includes(otherId))
            existingIds.push(otherId);
        db.prepare(`
      UPDATE memories
      SET contradiction_flag = 1, contradiction_ids = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify(existingIds), id);
    };
    update(idA, idB);
    update(idB, idA);
}
export function getMemoriesByAgent(db, agentId) {
    return db
        .prepare(`SELECT * FROM memories WHERE agent = ? ORDER BY created_at DESC`)
        .all(agentId);
}
// ─── File Snapshots ────────────────────────────────────────────────────────────
export function upsertFileSnapshot(db, filePath, commitHash, lineCount) {
    db.prepare(`
    INSERT INTO file_snapshots (file_path, commit_hash, line_count)
    VALUES (?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      commit_hash = excluded.commit_hash,
      line_count  = excluded.line_count,
      updated_at  = CURRENT_TIMESTAMP
  `).run(filePath, commitHash, lineCount);
}
export function getFileSnapshot(db, filePath) {
    return (db
        .prepare("SELECT * FROM file_snapshots WHERE file_path = ?")
        .get(filePath) ?? null);
}
// ─── Ingestion Log ─────────────────────────────────────────────────────────────
export function isCommitIngested(db, hash) {
    const row = db.prepare("SELECT 1 FROM ingested_commits WHERE commit_hash = ?").get(hash);
    return row !== undefined;
}
export function markCommitIngested(db, hash, count) {
    db.prepare(`
    INSERT OR IGNORE INTO ingested_commits (commit_hash, memory_count)
    VALUES (?, ?)
  `).run(hash, count);
}
//# sourceMappingURL=db.js.map