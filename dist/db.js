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
export function resolveDbPath(repoRoot) {
    if (repoRoot) {
        return path.join(repoRoot, '.git', 'brain.db');
    }
    const configDir = path.join(os.homedir(), '.config', 'local-brain');
    return path.join(configDir, 'brain.db');
}
// ─── Connection ────────────────────────────────────────────────────────────────
let _db = null;
export function getDb(dbPath) {
    if (_db)
        return _db;
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
export function insertMemory(db, fields, embedding) {
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
    return result.lastInsertRowid;
}
export function insertEmbedding(db, id, embedding) {
    const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(buffer, id);
}
export function markMemoryStale(db, id) {
    db.prepare('UPDATE memories SET status = ? WHERE id = ?').run('stale', id);
}
export function markMemoryDeprecated(db, id) {
    db.prepare('UPDATE memories SET status = ? WHERE id = ?').run('deprecated', id);
}
export function getActiveMemoriesByFile(db, filePath) {
    return db.prepare(`
    SELECT * FROM memories
    WHERE file_path = ? AND status = 'active'
    ORDER BY created_at DESC
  `).all(filePath);
}
export function pruneByStatus(db, status) {
    let stmt;
    if (status === 'all') {
        stmt = db.prepare(`DELETE FROM memories WHERE status != 'active'`);
    }
    else {
        stmt = db.prepare(`DELETE FROM memories WHERE status = ?`);
    }
    const result = status === 'all' ? stmt.run() : stmt.run(status);
    return result.changes;
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
        .get(filePath);
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