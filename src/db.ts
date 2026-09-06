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
import type { AgentId, ImportanceLevel } from './provenance.js';
export type { AgentId, ImportanceLevel } from './provenance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── DB Path Resolution ────────────────────────────────────────────────────────

export function resolveDbPath(repoRoot?: string): string {
  if (process.env.LOCAL_BRAIN_DB_PATH) {
    return path.resolve(process.env.LOCAL_BRAIN_DB_PATH);
  }
  if (repoRoot) {
    return path.join(repoRoot, '.git', 'brain.db');
  }
  const configDir = path.join(os.homedir(), '.config', 'local-brain');
  return path.join(configDir, 'brain.db');
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export type MemoryCategory = 'fix' | 'architecture' | 'convention' | 'bug' | 'manual';
export type MemoryStatus   = 'active' | 'stale' | 'deprecated';
export type MemorySource   = 'git-ingest' | 'manual' | 'session';

export interface Memory {
  id:                 number;
  category:           MemoryCategory;
  content:            string;
  summary:            string;
  file_path:          string | null;
  files:              string | null;
  package_scope:      string | null;
  commit_hash:        string | null;
  git_ref:            string | null;
  author:             string | null;
  branch:             string | null;
  project:            string | null;
  project_id:         string | null;   // normalized 8-char hash of git remote / path
  agent:              AgentId;          // which AI agent created this memory
  validated_by:       string | null;    // agent that last validated
  validation_count:   number;           // how many times validated/reused
  contradiction_flag: number;           // 1 = contradicts another active memory
  contradiction_ids:  string | null;    // JSON array of conflicting memory IDs
  importance_level:   ImportanceLevel;  // 'low'|'medium'|'high'|'critical'
  confidence:         number;
  importance:         number;
  quality_score:      number;
  status:             MemoryStatus;
  source:             MemorySource;
  superseded_by:      number | null;
  supersedes_id:      number | null;
  last_validated:     string | null;
  token_count:        number;
  embedding:          Buffer | null;
  created_at:         string;
  updated_at:         string;
}

export interface FileSnapshot {
  id:          number;
  file_path:   string;
  commit_hash: string;
  line_count:  number;
  updated_at:  string;
}

export interface DbStats {
  total:              number;
  active:             number;
  stale:              number;
  deprecated:         number;
  from_git:           number;
  manual:             number;
  superseded:         number;
  commits_ingested:   number;
  file_snapshots:     number;
  validated:          number;   // memories with validation_count > 0
  contradicted:       number;   // memories with contradiction_flag = 1
  agent_breakdown:    Record<string, number>; // agent → count
}

// ─── Schema Migration ──────────────────────────────────────────────────────────

/**
 * Idempotent migration to ensure older databases receive Phase 2/3 schema columns
 * without data loss or table recreation.
 */
export function migrateDb(db: Database.Database): void {
  const tableCheck = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='memories'"
  ).get();

  if (!tableCheck) return;

  const existingColumns = new Set(
    (db.prepare("PRAGMA table_info('memories')").all() as Array<{ name: string }>).map(c => c.name)
  );

  const migrations: Array<{ name: string; ddl: string }> = [
    { name: 'files',              ddl: 'ALTER TABLE memories ADD COLUMN files TEXT' },
    { name: 'author',             ddl: 'ALTER TABLE memories ADD COLUMN author TEXT' },
    { name: 'branch',             ddl: 'ALTER TABLE memories ADD COLUMN branch TEXT' },
    { name: 'project',            ddl: 'ALTER TABLE memories ADD COLUMN project TEXT' },
    { name: 'confidence',         ddl: 'ALTER TABLE memories ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0' },
    { name: 'importance',         ddl: 'ALTER TABLE memories ADD COLUMN importance REAL NOT NULL DEFAULT 1.0' },
    { name: 'quality_score',      ddl: 'ALTER TABLE memories ADD COLUMN quality_score REAL NOT NULL DEFAULT 1.0' },
    { name: 'superseded_by',      ddl: 'ALTER TABLE memories ADD COLUMN superseded_by INTEGER REFERENCES memories(id) ON DELETE SET NULL' },
    { name: 'supersedes_id',      ddl: 'ALTER TABLE memories ADD COLUMN supersedes_id INTEGER REFERENCES memories(id) ON DELETE SET NULL' },
    { name: 'last_validated',     ddl: 'ALTER TABLE memories ADD COLUMN last_validated DATETIME DEFAULT CURRENT_TIMESTAMP' },
    // Phase 3 — multi-agent provenance
    { name: 'project_id',         ddl: "ALTER TABLE memories ADD COLUMN project_id TEXT" },
    { name: 'agent',              ddl: "ALTER TABLE memories ADD COLUMN agent TEXT NOT NULL DEFAULT 'unknown'" },
    { name: 'validated_by',       ddl: 'ALTER TABLE memories ADD COLUMN validated_by TEXT' },
    { name: 'validation_count',   ddl: 'ALTER TABLE memories ADD COLUMN validation_count INTEGER NOT NULL DEFAULT 0' },
    { name: 'contradiction_flag', ddl: 'ALTER TABLE memories ADD COLUMN contradiction_flag INTEGER NOT NULL DEFAULT 0' },
    { name: 'contradiction_ids',  ddl: 'ALTER TABLE memories ADD COLUMN contradiction_ids TEXT' },
    { name: 'importance_level',   ddl: "ALTER TABLE memories ADD COLUMN importance_level TEXT NOT NULL DEFAULT 'medium'" },
  ];

  for (const { name, ddl } of migrations) {
    if (!existingColumns.has(name)) {
      try {
        db.exec(ddl);
      } catch {
        // column may have already been added concurrently
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
  } catch {
    // ignore index creation race
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

let _defaultDb: Database.Database | null = null;
const _openDbs = new Set<Database.Database>();

export function getDb(dbPath?: string): Database.Database {
  if (!dbPath) {
    if (_defaultDb && _defaultDb.open) return _defaultDb;
    const resolvedPath = resolveDbPath();
    const dir = path.dirname(resolvedPath);
    mkdirSync(dir, { recursive: true });

    const db = new Database(resolvedPath);
    db.exec(BASE_SCHEMA_SQL);
    migrateDb(db);

    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');

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

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');

  _openDbs.add(db);
  return db;
}

export function closeDb(targetDb?: Database.Database): void {
  if (targetDb) {
    try { targetDb.close(); } catch { /* ignore */ }
    _openDbs.delete(targetDb);
    if (_defaultDb === targetDb) _defaultDb = null;
  } else {
    for (const d of _openDbs) {
      try { d.close(); } catch { /* ignore */ }
    }
    _openDbs.clear();
    _defaultDb = null;
  }
}

// ─── Memory Insertion ─────────────────────────────────────────────────────────

export type InsertMemoryInput = {
  category:            MemoryCategory;
  content:             string;
  summary:             string;
  file_path?:          string | null;
  files?:              string | string[] | null;
  package_scope?:      string | null;
  commit_hash?:        string | null;
  git_ref?:            string | null;
  author?:             string | null;
  branch?:             string | null;
  project?:            string | null;
  project_id?:         string | null;
  agent?:              AgentId;
  validated_by?:       string | null;
  validation_count?:   number;
  contradiction_flag?: number;
  contradiction_ids?:  string | null;
  importance_level?:   ImportanceLevel;
  confidence?:         number;
  importance?:         number;
  quality_score?:      number;
  status?:             MemoryStatus;
  source?:             MemorySource;
  superseded_by?:      number | null;
  supersedes_id?:      number | null;
  last_validated?:     string | null;
  token_count?:        number;
};

export type InsertResult = {
  id:       number;
  category: MemoryCategory;
  content:  string;
  summary:  string;
};

export function insertMemory(
  db: Database.Database,
  fields: InsertMemoryInput,
  embedding?: Float32Array
): number {
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
    category:           fields.category,
    content:            fields.content,
    summary:            fields.summary,
    file_path:          fields.file_path ?? null,
    files:              filesJson,
    package_scope:      fields.package_scope ?? null,
    commit_hash:        fields.commit_hash ?? null,
    git_ref:            fields.git_ref ?? null,
    author:             fields.author ?? null,
    branch:             fields.branch ?? null,
    project:            fields.project ?? null,
    project_id:         fields.project_id ?? null,
    agent:              fields.agent ?? 'unknown',
    validated_by:       fields.validated_by ?? null,
    validation_count:   fields.validation_count ?? 0,
    contradiction_flag: fields.contradiction_flag ?? 0,
    contradiction_ids:  fields.contradiction_ids ?? null,
    importance_level:   fields.importance_level ?? 'medium',
    confidence:         typeof fields.confidence === 'number' ? Math.max(0, Math.min(1, fields.confidence)) : 1.0,
    importance:         typeof fields.importance === 'number' ? Math.max(0.1, Math.min(2.0, fields.importance)) : 1.0,
    quality_score:      typeof fields.quality_score === 'number' ? fields.quality_score : 1.0,
    status:             fields.status ?? 'active',
    source:             fields.source ?? 'git-ingest',
    superseded_by:      fields.superseded_by ?? null,
    supersedes_id:      fields.supersedes_id ?? null,
    last_validated:     fields.last_validated ?? new Date().toISOString(),
    token_count:        fields.token_count ?? Math.ceil(fields.summary.length / 4),
    embedding:          embeddingBuffer,
  };

  const result = stmt.run(params);
  const newId = result.lastInsertRowid as number;

  if (fields.supersedes_id) {
    supersedeMemory(db, fields.supersedes_id, newId);
  }

  return newId;
}

export function insertEmbedding(
  db: Database.Database,
  id: number,
  embedding: Float32Array
): void {
  const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(buffer, id);
}

export function getMemoryById(db: Database.Database, id: number): Memory | null {
  return (db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Memory) ?? null;
}

export function updateMemory(
  db: Database.Database,
  id: number,
  fields: Partial<Omit<Memory, 'id' | 'created_at' | 'updated_at' | 'embedding'>>
): boolean {
  const updates: string[] = [];
  const params: Record<string, unknown> = { id };

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      updates.push(`${key} = @${key}`);
      params[key] = value;
    }
  }

  if (updates.length === 0) return false;

  const sql = `UPDATE memories SET ${updates.join(', ')} WHERE id = @id`;
  const result = db.prepare(sql).run(params);
  return result.changes > 0;
}

export function supersedeMemory(db: Database.Database, oldId: number, newId: number): void {
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

export function markMemoryStale(db: Database.Database, id: number): void {
  db.prepare("UPDATE memories SET status = 'stale' WHERE id = ?").run(id);
}

export function markMemoryDeprecated(db: Database.Database, id: number): void {
  db.prepare("UPDATE memories SET status = 'deprecated' WHERE id = ?").run(id);
}

export function getActiveMemoriesByFile(
  db: Database.Database,
  filePath: string
): Memory[] {
  return db.prepare(`
    SELECT * FROM memories
    WHERE (file_path = ? OR files LIKE ?) AND status = 'active'
    ORDER BY created_at DESC
  `).all(filePath, `%"${filePath}"%`) as Memory[];
}

export function pruneByStatus(
  db: Database.Database,
  status: MemoryStatus | 'all'
): number {
  let stmt: Database.Statement;
  if (status === 'all') {
    stmt = db.prepare("DELETE FROM memories WHERE status != 'active'");
  } else {
    stmt = db.prepare('DELETE FROM memories WHERE status = ?');
  }

  const result = status === 'all' ? stmt.run() : stmt.run(status);
  return result.changes;
}

export interface ForgetOptions {
  id?:         number;
  filePath?:   string;
  query?:      string;
  hardDelete?: boolean;
}

export function forgetMemory(
  db: Database.Database,
  options: ForgetOptions
): { count: number; affectedIds: number[] } {
  const { id, filePath, query, hardDelete = false } = options;

  let targetIds: number[] = [];

  if (typeof id === 'number') {
    const row = getMemoryById(db, id);
    if (row) targetIds.push(row.id);
  } else if (filePath) {
    const rows = db.prepare(
      "SELECT id FROM memories WHERE file_path = ? OR files LIKE ?"
    ).all(filePath, `%"${filePath}"%`) as Array<{ id: number }>;
    targetIds = rows.map(r => r.id);
  } else if (query) {
    const pattern = `%${query.trim()}%`;
    const rows = db.prepare(
      "SELECT id FROM memories WHERE content LIKE ? OR summary LIKE ?"
    ).all(pattern, pattern) as Array<{ id: number }>;
    targetIds = rows.map(r => r.id);
  }

  if (targetIds.length === 0) {
    return { count: 0, affectedIds: [] };
  }

  if (hardDelete) {
    const placeholders = targetIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...targetIds);
  } else {
    const placeholders = targetIds.map(() => '?').join(',');
    db.prepare(`UPDATE memories SET status = 'deprecated', updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...targetIds);
  }

  return { count: targetIds.length, affectedIds: targetIds };
}

// ─── Duplicate Detection & Smart Merge ─────────────────────────────────────────

export interface DuplicateMatch {
  match:      Memory;
  similarity: number;
  isExact:    boolean;
}

export function findDuplicateMemory(
  db: Database.Database,
  embedding: Float32Array | null,
  content: string,
  filePath?: string | null,
  similarityThreshold = 0.88
): DuplicateMatch | null {
  const cleanedContent = content.trim().toLowerCase();

  // 1. Exact match check
  const exactRow = db.prepare(`
    SELECT * FROM memories
    WHERE status = 'active'
      AND LOWER(TRIM(content)) = ?
      ${filePath ? 'AND (file_path = ? OR file_path IS NULL)' : ''}
    LIMIT 1
  `).get(...(filePath ? [cleanedContent, filePath] : [cleanedContent])) as Memory | undefined;

  if (exactRow) {
    return { match: exactRow, similarity: 1.0, isExact: true };
  }

  // 2. Vector-based near duplicate check
  if (!embedding) return null;

  const candidateRows = db.prepare(`
    SELECT * FROM memories
    WHERE status = 'active'
      ${filePath ? 'AND (file_path = ? OR file_path IS NULL)' : ''}
  `).all(...(filePath ? [filePath] : [])) as Memory[];

  let bestMatch: Memory | null = null;
  let maxSim = -1;

  for (const row of candidateRows) {
    if (!row.embedding) continue;
    const memVec = new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
    );
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

export function mergeMemory(
  db: Database.Database,
  existingId: number,
  newFields: InsertMemoryInput
): void {
  const existing = getMemoryById(db, existingId);
  if (!existing) return;

  const mergedConfidence = Math.max(existing.confidence, newFields.confidence ?? 1.0);
  const mergedImportance = Math.max(existing.importance, newFields.importance ?? 1.0);
  const mergedSummary = newFields.summary.length > existing.summary.length
    ? newFields.summary
    : existing.summary;

  let existingFiles: string[] = [];
  try {
    if (existing.files) existingFiles = JSON.parse(existing.files);
  } catch { /* ignore */ }

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
  `).run(
    mergedSummary,
    mergedConfidence,
    mergedImportance,
    JSON.stringify(existingFiles),
    existingId
  );
}

// ─── Stats & Ingestion ─────────────────────────────────────────────────────────

export function getDbStats(db: Database.Database): DbStats {
  const stats = db.prepare(`
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
  `).get() as Record<string, number | null>;

  const commits   = db.prepare('SELECT COUNT(*) AS c FROM ingested_commits').get() as { c: number };
  const snapshots = db.prepare('SELECT COUNT(*) AS c FROM file_snapshots').get() as { c: number };

  const agentRows = db.prepare(
    `SELECT agent, COUNT(*) AS cnt FROM memories GROUP BY agent`
  ).all() as Array<{ agent: string; cnt: number }>;
  const agent_breakdown: Record<string, number> = {};
  for (const row of agentRows) {
    agent_breakdown[row.agent ?? 'unknown'] = row.cnt;
  }

  return {
    total:            stats.total ?? 0,
    active:           stats.active ?? 0,
    stale:            stats.stale ?? 0,
    deprecated:       stats.deprecated ?? 0,
    from_git:         stats.from_git ?? 0,
    manual:           stats.manual ?? 0,
    superseded:       stats.superseded ?? 0,
    commits_ingested: commits?.c ?? 0,
    file_snapshots:   snapshots?.c ?? 0,
    validated:        stats.validated ?? 0,
    contradicted:     stats.contradicted ?? 0,
    agent_breakdown,
  };
}

// ─── Validation ────────────────────────────────────────────────────────────────

export function validateMemory(
  db: Database.Database,
  id: number,
  agentId: AgentId = 'unknown'
): boolean {
  const existing = getMemoryById(db, id);
  if (!existing) return false;

  const newCount      = (existing.validation_count ?? 0) + 1;
  const newConfidence = Math.min(0.99, (existing.confidence ?? 0.7) + 0.05);

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

const CONTRADICTION_PHRASES: RegExp[] = [
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

export interface ContradictionResult {
  contradictedIds: number[];
}

export function detectContradictions(
  db: Database.Database,
  embedding: Float32Array,
  newContent: string,
  projectId?: string | null
): ContradictionResult {
  const hasNegation = CONTRADICTION_PHRASES.some(p => p.test(newContent));
  if (!hasNegation) {
    return { contradictedIds: [] };
  }

  const query = projectId
    ? `SELECT * FROM memories WHERE status = 'active' AND (project_id = ? OR project_id IS NULL)`
    : `SELECT * FROM memories WHERE status = 'active'`;
  const rows = (projectId
    ? db.prepare(query).all(projectId)
    : db.prepare(query).all()) as Memory[];

  const SIMILARITY_THRESHOLD = 0.35;
  const contradictedIds: number[] = [];

  for (const row of rows) {
    if (!row.embedding) continue;
    const memVec = new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
    );
    const sim = cosineSimilarity(embedding, memVec);
    if (sim >= SIMILARITY_THRESHOLD) {
      contradictedIds.push(row.id);
    }
  }

  return { contradictedIds };
}

export function markContradiction(
  db: Database.Database,
  idA: number,
  idB: number
): void {
  const update = (id: number, otherId: number) => {
    const row = getMemoryById(db, id);
    if (!row) return;
    let existingIds: number[] = [];
    try {
      if (row.contradiction_ids) existingIds = JSON.parse(row.contradiction_ids);
    } catch { /* ignore */ }
    if (!existingIds.includes(otherId)) existingIds.push(otherId);
    db.prepare(`
      UPDATE memories
      SET contradiction_flag = 1, contradiction_ids = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify(existingIds), id);
  };

  update(idA, idB);
  update(idB, idA);
}

export function getMemoriesByAgent(
  db: Database.Database,
  agentId: AgentId
): Memory[] {
  return db.prepare(
    `SELECT * FROM memories WHERE agent = ? ORDER BY created_at DESC`
  ).all(agentId) as Memory[];
}

// ─── File Snapshots ────────────────────────────────────────────────────────────

export function upsertFileSnapshot(
  db: Database.Database,
  filePath: string,
  commitHash: string,
  lineCount: number
): void {
  db.prepare(`
    INSERT INTO file_snapshots (file_path, commit_hash, line_count)
    VALUES (?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      commit_hash = excluded.commit_hash,
      line_count  = excluded.line_count,
      updated_at  = CURRENT_TIMESTAMP
  `).run(filePath, commitHash, lineCount);
}

export function getFileSnapshot(
  db: Database.Database,
  filePath: string
): FileSnapshot | null {
  return (db.prepare('SELECT * FROM file_snapshots WHERE file_path = ?')
    .get(filePath) as FileSnapshot) ?? null;
}

// ─── Ingestion Log ─────────────────────────────────────────────────────────────

export function isCommitIngested(db: Database.Database, hash: string): boolean {
  const row = db.prepare('SELECT 1 FROM ingested_commits WHERE commit_hash = ?').get(hash);
  return row !== undefined;
}

export function markCommitIngested(
  db: Database.Database,
  hash: string,
  count: number
): void {
  db.prepare(`
    INSERT OR IGNORE INTO ingested_commits (commit_hash, memory_count)
    VALUES (?, ?)
  `).run(hash, count);
}
