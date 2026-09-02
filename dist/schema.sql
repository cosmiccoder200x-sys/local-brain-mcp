-- ============================================================
-- local-brain-mcp: Pure SQLite schema with BLOB vector storage
-- ============================================================

-- Enable WAL mode for fast concurrent reads
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- Core memories table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category      TEXT NOT NULL CHECK(category IN ('fix', 'architecture', 'convention', 'bug', 'manual')),
  content       TEXT NOT NULL,          -- full lesson / explanation
  summary       TEXT NOT NULL,          -- compact 1-2 sentence summary
  file_path     TEXT,                   -- relative file path (e.g. src/auth/jwt.ts)
  package_scope TEXT,                   -- monorepo package prefix (e.g. packages/auth)
  commit_hash   TEXT,                   -- git commit hash when memory was stored
  git_ref       TEXT,                   -- git branch / tag at storage time
  status        TEXT NOT NULL DEFAULT 'active'
                     CHECK(status IN ('active', 'stale', 'deprecated')),
  source        TEXT DEFAULT 'git-ingest'
                     CHECK(source IN ('git-ingest', 'manual', 'session')),
  token_count   INTEGER DEFAULT 0,      -- pre-computed token count of summary
  embedding     BLOB,                   -- Float32Array stored as raw binary BLOB (384 floats)
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for fast queries
CREATE INDEX IF NOT EXISTS idx_memories_status       ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_file_path    ON memories(file_path);
CREATE INDEX IF NOT EXISTS idx_memories_package      ON memories(package_scope);
CREATE INDEX IF NOT EXISTS idx_memories_category     ON memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_commit       ON memories(commit_hash);

-- Trigger to auto-update updated_at
CREATE TRIGGER IF NOT EXISTS memories_updated_at
  AFTER UPDATE ON memories
  BEGIN
    UPDATE memories SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;

-- ------------------------------------------------------------
-- Stale file tracking
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS file_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path     TEXT NOT NULL UNIQUE,
  commit_hash   TEXT NOT NULL,
  line_count    INTEGER DEFAULT 0,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_snapshots_file ON file_snapshots(file_path);

-- ------------------------------------------------------------
-- Ingestion log
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingested_commits (
  commit_hash   TEXT PRIMARY KEY,
  ingested_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  memory_count  INTEGER DEFAULT 0
);
