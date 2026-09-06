/**
 * db.ts — Database initialization, connection management, migrations, and CRUD operations.
 *
 * Uses better-sqlite3 for synchronous SQLite access. Vector embeddings are
 * stored directly as Float32Array BLOBs for fast zero-dependency local search.
 */
import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { cosineSimilarity } from './embeddings.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ─── DB Path Resolution ────────────────────────────────────────────────────────
export function resolveDbPath(repoRoot) {
    if (process.env.LOCAL_BRAIN_DB_PATH) {
        return path.resolve(process.env.LOCAL_BRAIN_DB_PATH);
    }
    if (repoRoot) {
        return path.join(repoRoot, '.git', 'brain.db');
    }
    const configDir = path.join(os.homedir(), '.config', 'local-brain');
    return path.join(configDir, 'brain.db');
}
// ─── Schema Migration ──────────────────────────────────────────────────────────
/**
 * Idempotent migration to ensure older databases receive Phase 2/3 schema columns
 * without data loss or table recreation.
 */
export function migrateDb(db) {
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'").get();
    if (!tableCheck)
        return;
    const existingColumns = new Set(db.prepare("PRAGMA table_info('memories')").all().map(c => c.name));
    const migrations = [
        { name: 'files', ddl: 'ALTER TABLE memories ADD COLUMN files TEXT' },
        { name: 'author', ddl: 'ALTER TABLE memories ADD COLUMN author TEXT' },
        { name: 'branch', ddl: 'ALTER TABLE memories ADD COLUMN branch TEXT' },
        { name: 'project', ddl: 'ALTER TABLE memories ADD COLUMN project TEXT' },
        { name: 'confidence', ddl: 'ALTER TABLE memories ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0' },
        { name: 'importance', ddl: 'ALTER TABLE memories ADD COLUMN importance REAL NOT NULL DEFAULT 1.0' },
        { name: 'quality_score', ddl: 'ALTER TABLE memories ADD COLUMN quality_score REAL NOT NULL DEFAULT 1.0' },
        { name: 'superseded_by', ddl: 'ALTER TABLE memories ADD COLUMN superseded_by INTEGER REFERENCES memories(id) ON DELETE SET NULL' },
        { name: 'supersedes_id', ddl: 'ALTER TABLE memories ADD COLUMN supersedes_id INTEGER REFERENCES memories(id) ON DELETE SET NULL' },
        { name: 'last_validated', ddl: 'ALTER TABLE memories ADD COLUMN last_validated DATETIME DEFAULT CURRENT_TIMESTAMP' },
    ];
    for (const { name, ddl } of migrations) {
        if (!existingColumns.has(name)) {
            try {
                db.exec(ddl);
            }
            catch (err) {
                // column may have already been added concurrently
            }
        }
    }
    // Ensure supplementary indexes exist
    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_superseded_by ON memories(superseded_by);
    CREATE INDEX IF NOT EXISTS idx_memories_branch        ON memories(branch);
    CREATE INDEX IF NOT EXISTS idx_memories_project       ON memories(project);
  `);
}
export const BASE_SCHEMA_SQL = `
-- ============================================================
-- local-brain-mcp: Pure SQLite schema with BLOB vector storage
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS memories (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  category       TEXT NOT NULL CHECK(category IN ('fix', 'architecture', 'convention', 'bug', 'manual')),
  content        TEXT NOT NULL,
  summary        TEXT NOT NULL,
  file_path      TEXT,
  files          TEXT,
  package_scope  TEXT,
  commit_hash    TEXT,
  git_ref        TEXT,
  author         TEXT,
  branch         TEXT,
  project        TEXT,
  confidence     REAL NOT NULL DEFAULT 1.0,
  importance     REAL NOT NULL DEFAULT 1.0,
  quality_score  REAL NOT NULL DEFAULT 1.0,
  status         TEXT NOT NULL DEFAULT 'active'
                      CHECK(status IN ('active', 'stale', 'deprecated')),
  source         TEXT DEFAULT 'git-ingest'
                      CHECK(source IN ('git-ingest', 'manual', 'session')),
  superseded_by  INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  supersedes_id  INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  last_validated DATETIME DEFAULT CURRENT_TIMESTAMP,
  token_count    INTEGER DEFAULT 0,
  embedding      BLOB,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memories_status        ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_file_path     ON memories(file_path);
CREATE INDEX IF NOT EXISTS idx_memories_package       ON memories(package_scope);
CREATE INDEX IF NOT EXISTS idx_memories_category      ON memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_commit        ON memories(commit_hash);
CREATE INDEX IF NOT EXISTS idx_memories_superseded_by ON memories(superseded_by);
CREATE INDEX IF NOT EXISTS idx_memories_branch        ON memories(branch);
CREATE INDEX IF NOT EXISTS idx_memories_project       ON memories(project);

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
// ─── Connection ────────────────────────────────────────────────────────────────
let _db = null;
let _currentDbPath = null;
export function getDb(dbPath) {
    if (_db && !dbPath)
        return _db;
    const resolvedPath = dbPath ?? resolveDbPath();
    if (_db && _currentDbPath === resolvedPath) {
        return _db;
    }
    if (_db && _currentDbPath !== resolvedPath) {
        try {
            _db.close();
        }
        catch {
            // Ignore close error on switch
        }
        _db = null;
    }
    const dir = path.dirname(resolvedPath);
    mkdirSync(dir, { recursive: true });
    const db = new Database(resolvedPath);
    // Apply base schema safely
    let schema = BASE_SCHEMA_SQL;
    try {
        const fileContent = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        if (fileContent.trim())
            schema = fileContent;
    }
    catch {
        schema = BASE_SCHEMA_SQL;
    }
    db.exec(schema);
    // Apply migrations for backward compatibility
    migrateDb(db);
    // Pragmas for high-throughput performance
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    if (!dbPath) {
        _db = db;
    }
    return db;
}
export function closeDb() {
    if (_db) {
        try {
            _db.close();
        }
        catch { /* ignore */ }
        _db = null;
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
       commit_hash, git_ref, author, branch, project,
       confidence, importance, quality_score, status, source,
       superseded_by, supersedes_id, last_validated, token_count, embedding)
    VALUES
      (@category, @content, @summary, @file_path, @files, @package_scope,
       @commit_hash, @git_ref, @author, @branch, @project,
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
        confidence: typeof fields.confidence === 'number' ? Math.max(0, Math.min(1, fields.confidence)) : 1.0,
        importance: typeof fields.importance === 'number' ? Math.max(0.1, Math.min(2.0, fields.importance)) : 1.0,
        quality_score: typeof fields.quality_score === 'number' ? fields.quality_score : 1.0,
        status: fields.status ?? 'active',
        source: fields.source ?? 'git-ingest',
        superseded_by: fields.superseded_by ?? null,
        supersedes_id: fields.supersedes_id ?? null,
        last_validated: fields.last_validated ?? new Date().toISOString(),
        token_count: fields.token_count ?? Math.ceil(fields.summary.length / 4),
        embedding: embeddingBuffer,
    };
    const result = stmt.run(params);
    const newId = result.lastInsertRowid;
    // If this memory supersedes an older one, mark the older memory
    if (fields.supersedes_id) {
        supersedeMemory(db, fields.supersedes_id, newId);
    }
    return newId;
}
export function insertEmbedding(db, id, embedding) {
    const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(buffer, id);
}
export function getMemoryById(db, id) {
    return db.prepare('SELECT * FROM memories WHERE id = ?').get(id) ?? null;
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
    const sql = `UPDATE memories SET ${updates.join(', ')} WHERE id = @id`;
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
    return db.prepare(`
    SELECT * FROM memories
    WHERE (file_path = ? OR files LIKE ?) AND status = 'active'
    ORDER BY created_at DESC
  `).all(filePath, `%"${filePath}"%`);
}
export function pruneByStatus(db, status) {
    let stmt;
    if (status === 'all') {
        stmt = db.prepare("DELETE FROM memories WHERE status != 'active'");
    }
    else {
        stmt = db.prepare('DELETE FROM memories WHERE status = ?');
    }
    const result = status === 'all' ? stmt.run() : stmt.run(status);
    return result.changes;
}
export function forgetMemory(db, options) {
    const { id, filePath, query, hardDelete = false } = options;
    let targetIds = [];
    if (typeof id === 'number') {
        const row = getMemoryById(db, id);
        if (row)
            targetIds.push(row.id);
    }
    else if (filePath) {
        const rows = db.prepare("SELECT id FROM memories WHERE file_path = ? OR files LIKE ?").all(filePath, `%"${filePath}"%`);
        targetIds = rows.map(r => r.id);
    }
    else if (query) {
        const pattern = `%${query.trim()}%`;
        const rows = db.prepare("SELECT id FROM memories WHERE content LIKE ? OR summary LIKE ?").all(pattern, pattern);
        targetIds = rows.map(r => r.id);
    }
    if (targetIds.length === 0) {
        return { count: 0, affectedIds: [] };
    }
    if (hardDelete) {
        const placeholders = targetIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...targetIds);
    }
    else {
        const placeholders = targetIds.map(() => '?').join(',');
        db.prepare(`UPDATE memories SET status = 'deprecated', updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...targetIds);
    }
    return { count: targetIds.length, affectedIds: targetIds };
}
/**
 * Searches for exact or near-duplicate memories in the database.
 * Returns the highest matching memory if similarity threshold is met.
 */
export function findDuplicateMemory(db, embedding, content, filePath, similarityThreshold = 0.88) {
    const cleanedContent = content.trim().toLowerCase();
    // 1. Exact match check
    const exactRow = db.prepare(`
    SELECT * FROM memories
    WHERE status = 'active'
      AND LOWER(TRIM(content)) = ?
      ${filePath ? 'AND (file_path = ? OR file_path IS NULL)' : ''}
    LIMIT 1
  `).get(...(filePath ? [cleanedContent, filePath] : [cleanedContent]));
    if (exactRow) {
        return { match: exactRow, similarity: 1.0, isExact: true };
    }
    // 2. Vector-based near duplicate check
    if (!embedding)
        return null;
    const candidateRows = db.prepare(`
    SELECT * FROM memories
    WHERE status = 'active'
      ${filePath ? 'AND (file_path = ? OR file_path IS NULL)' : ''}
  `).all(...(filePath ? [filePath] : []));
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
/**
 * Merges new knowledge into an existing memory record, preserving the richest context.
 */
export function mergeMemory(db, existingId, newFields) {
    const existing = getMemoryById(db, existingId);
    if (!existing)
        return;
    const mergedConfidence = Math.max(existing.confidence, newFields.confidence ?? 1.0);
    const mergedImportance = Math.max(existing.importance, newFields.importance ?? 1.0);
    const mergedSummary = newFields.summary.length > existing.summary.length
        ? newFields.summary
        : existing.summary;
    let existingFiles = [];
    try {
        if (existing.files)
            existingFiles = JSON.parse(existing.files);
    }
    catch { /* ignore */ }
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
    const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'active'     THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'stale'      THEN 1 ELSE 0 END) AS stale,
      SUM(CASE WHEN status = 'deprecated' THEN 1 ELSE 0 END) AS deprecated,
      SUM(CASE WHEN source = 'git-ingest' THEN 1 ELSE 0 END) AS from_git,
      SUM(CASE WHEN source = 'manual'     THEN 1 ELSE 0 END) AS manual,
      SUM(CASE WHEN superseded_by IS NOT NULL THEN 1 ELSE 0 END) AS superseded
    FROM memories
  `).get();
    const commits = db.prepare('SELECT COUNT(*) AS c FROM ingested_commits').get();
    const snapshots = db.prepare('SELECT COUNT(*) AS c FROM file_snapshots').get();
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
    };
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
    return db.prepare('SELECT * FROM file_snapshots WHERE file_path = ?')
        .get(filePath) ?? null;
}
// ─── Ingestion Log ─────────────────────────────────────────────────────────────
export function isCommitIngested(db, hash) {
    const row = db.prepare('SELECT 1 FROM ingested_commits WHERE commit_hash = ?').get(hash);
    return row !== undefined;
}
export function markCommitIngested(db, hash, count) {
    db.prepare(`
    INSERT OR IGNORE INTO ingested_commits (commit_hash, memory_count)
    VALUES (?, ?)
  `).run(hash, count);
}
//# sourceMappingURL=db.js.map