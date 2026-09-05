/**
 * db.ts — Database initialization, connection management, and migrations.
 *
 * Uses better-sqlite3 for synchronous SQLite access. Vector embeddings are
 * stored directly as Float32Array BLOBs for fast zero-dependency local search.
 */

import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, statSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

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
  id:            number;
  category:      MemoryCategory;
  content:       string;
  summary:       string;
  file_path:     string | null;
  package_scope: string | null;
  commit_hash:   string | null;
  git_ref:       string | null;
  status:        MemoryStatus;
  source:        MemorySource;
  token_count:   number;
  importance?:   number;
  confidence?:   number;
  embedding:     Buffer | null;
  created_at:    string;
  updated_at:    string;
}

export interface FileSnapshot {
  id:          number;
  file_path:   string;
  commit_hash: string;
  line_count:  number;
  updated_at:  string;
}

export interface DatabaseStats {
  total:           number;
  active:          number;
  stale:           number;
  deprecated:      number;
  fromGit:         number;
  manual:          number;
  commitsIngested: number;
  sizeBytes:       number;
  dbPath:          string;
}

// ─── Connection ────────────────────────────────────────────────────────────────

let _db: Database.Database | null = null;
let _currentDbPath: string | null = null;

export function getDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? resolveDbPath();

  if (_db && _currentDbPath === resolvedPath) {
    return _db;
  }

  if (_db && _currentDbPath !== resolvedPath) {
    try {
      _db.close();
    } catch {
      // Ignore close error on switch
    }
    _db = null;
  }

  const dir = path.dirname(resolvedPath);
  mkdirSync(dir, { recursive: true });

  const db = new Database(resolvedPath);

  // Apply schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, 'utf8');
    db.exec(schema);
  }

  // Schema migration for existing databases
  try {
    const tableInfo = db.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string }>;
    const columnNames = new Set(tableInfo.map(c => c.name));
    if (!columnNames.has('importance')) {
      db.exec('ALTER TABLE memories ADD COLUMN importance REAL DEFAULT 1.0');
    }
    if (!columnNames.has('confidence')) {
      db.exec('ALTER TABLE memories ADD COLUMN confidence REAL DEFAULT 1.0');
    }
  } catch {
    // Table might not exist yet if schema was empty
  }

  // Pragmas for performance
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');

  _db = db;
  _currentDbPath = resolvedPath;
  return db;
}

export function closeDb(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      // Ignore close errors
    }
    _db = null;
    _currentDbPath = null;
  }
}

// ─── Memory CRUD ───────────────────────────────────────────────────────────────

export function insertMemory(
  db: Database.Database,
  fields: Omit<Memory, 'id' | 'created_at' | 'updated_at' | 'embedding'>,
  embedding?: Float32Array
): number {
  const embeddingBuffer = embedding
    ? Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)
    : null;

  const importance = fields.importance ?? 1.0;
  const confidence = fields.confidence ?? 1.0;

  const stmt = db.prepare(`
    INSERT INTO memories
      (category, content, summary, file_path, package_scope,
       commit_hash, git_ref, status, source, token_count, importance, confidence, embedding)
    VALUES
      (@category, @content, @summary, @file_path, @package_scope,
       @commit_hash, @git_ref, @status, @source, @token_count, @importance, @confidence, @embedding)
  `);
  const result = stmt.run({ ...fields, importance, confidence, embedding: embeddingBuffer });
  return result.lastInsertRowid as number;
}

export function insertEmbedding(
  db: Database.Database,
  id: number,
  embedding: Float32Array
): void {
  const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(buffer, id);
}

export function deleteMemory(db: Database.Database, id: number): boolean {
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  return result.changes > 0;
}

export function findExactDuplicate(
  db: Database.Database,
  content: string,
  filePath?: string | null
): Memory | null {
  const normalized = content.trim();
  if (filePath) {
    return (
      (db
        .prepare(
          `SELECT * FROM memories WHERE status = 'active' AND file_path = ? AND TRIM(content) = ? LIMIT 1`
        )
        .get(filePath, normalized) as Memory | undefined) ?? null
    );
  }
  return (
    (db
      .prepare(
        `SELECT * FROM memories WHERE status = 'active' AND (file_path IS NULL OR file_path = '') AND TRIM(content) = ? LIMIT 1`
      )
      .get(normalized) as Memory | undefined) ?? null
  );
}

export function markMemoryStale(db: Database.Database, id: number): void {
  db.prepare('UPDATE memories SET status = ? WHERE id = ?').run('stale', id);
}

export function markMemoryDeprecated(db: Database.Database, id: number): void {
  db.prepare('UPDATE memories SET status = ? WHERE id = ?').run('deprecated', id);
}

export function getActiveMemoriesByFile(
  db: Database.Database,
  filePath: string
): Memory[] {
  return db.prepare(`
    SELECT * FROM memories
    WHERE file_path = ? AND status = 'active'
    ORDER BY created_at DESC
  `).all(filePath) as Memory[];
}

export function pruneByStatus(
  db: Database.Database,
  status: MemoryStatus | 'all'
): number {
  let stmt: Database.Statement;
  if (status === 'all') {
    stmt = db.prepare(`DELETE FROM memories WHERE status != 'active'`);
  } else {
    stmt = db.prepare(`DELETE FROM memories WHERE status = ?`);
  }

  const result = status === 'all' ? stmt.run() : stmt.run(status);
  return result.changes;
}

export function getDatabaseStats(db: Database.Database, dbPath?: string): DatabaseStats {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'active'     THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'stale'      THEN 1 ELSE 0 END) AS stale,
      SUM(CASE WHEN status = 'deprecated' THEN 1 ELSE 0 END) AS deprecated,
      SUM(CASE WHEN source  = 'git-ingest' THEN 1 ELSE 0 END) AS from_git,
      SUM(CASE WHEN source  = 'manual'     THEN 1 ELSE 0 END) AS manual
    FROM memories
  `).get() as Record<string, number | null>;

  const ingested = db.prepare('SELECT COUNT(*) AS c FROM ingested_commits').get() as { c: number };

  const targetPath = dbPath ?? _currentDbPath ?? resolveDbPath();
  let sizeBytes = 0;
  try {
    if (existsSync(targetPath)) {
      sizeBytes = statSync(targetPath).size;
    }
  } catch {
    // Ignore file stat errors
  }

  return {
    total:           Number(stats.total ?? 0),
    active:          Number(stats.active ?? 0),
    stale:           Number(stats.stale ?? 0),
    deprecated:      Number(stats.deprecated ?? 0),
    fromGit:         Number(stats.from_git ?? 0),
    manual:          Number(stats.manual ?? 0),
    commitsIngested: Number(ingested?.c ?? 0),
    sizeBytes,
    dbPath:          targetPath,
  };
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
  return db.prepare('SELECT * FROM file_snapshots WHERE file_path = ?')
    .get(filePath) as FileSnapshot | null;
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
