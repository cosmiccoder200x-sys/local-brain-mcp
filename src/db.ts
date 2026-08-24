/**
 * db.ts — Database initialization, connection management, and migrations.
 *
 * Uses better-sqlite3 for synchronous SQLite access. Vector embeddings are
 * stored directly as Float32Array BLOBs for fast zero-dependency local search.
 */

import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── DB Path Resolution ────────────────────────────────────────────────────────

export function resolveDbPath(repoRoot?: string): string {
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
  id:           number;
  category:     MemoryCategory;
  content:      string;
  summary:      string;
  file_path:    string | null;
  package_scope:string | null;
  commit_hash:  string | null;
  git_ref:      string | null;
  status:       MemoryStatus;
  source:       MemorySource;
  token_count:  number;
  embedding:    Buffer | null;
  created_at:   string;
  updated_at:   string;
}

export interface FileSnapshot {
  id:          number;
  file_path:   string;
  commit_hash: string;
  line_count:  number;
  updated_at:  string;
}

// ─── Connection ────────────────────────────────────────────────────────────────

let _db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (_db) return _db;

  const resolvedPath = dbPath ?? resolveDbPath();
  const dir = path.dirname(resolvedPath);
  mkdirSync(dir, { recursive: true });

  const db = new Database(resolvedPath);

  // Apply schema
  const schema = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  // Pragmas for performance
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');

  _db = db;
  return db;
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

  const stmt = db.prepare(`
    INSERT INTO memories
      (category, content, summary, file_path, package_scope,
       commit_hash, git_ref, status, source, token_count, embedding)
    VALUES
      (@category, @content, @summary, @file_path, @package_scope,
       @commit_hash, @git_ref, @status, @source, @token_count, @embedding)
  `);
  const result = stmt.run({ ...fields, embedding: embeddingBuffer });
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
