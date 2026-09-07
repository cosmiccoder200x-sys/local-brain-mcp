import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb, closeDb, insertMemory, pruneByStatus, forgetMemory, updateMemory, getDbStats } from '../../dist/db.js';

// ─── timeAgo (reimplemented for test, mirrors cli.ts logic) ──────────────────
function timeAgo(dateStr) {
  try {
    const d = new Date(dateStr);
    const diffMs = Date.now() - d.getTime();
    if (isNaN(diffMs) || diffMs < 0) return dateStr;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return dateStr;
  }
}

let db;
let tmpDir;

function makeMem(fields = {}) {
  const defaults = {
    category: 'manual',
    content: 'Test memory content for unit test',
    summary: 'Test summary',
    status: 'active',
    source: 'manual',
    agent: 'test-agent',
  };
  return { ...defaults, ...fields };
}

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `lb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  db = getDb(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  closeDb(db);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe('timeAgo', () => {
  it('returns "just now" for times less than 1 minute ago', () => {
    const now = new Date().toISOString();
    assert.equal(timeAgo(now), 'just now');
  });

  it('returns minutes ago for times 1-59 minutes ago', () => {
    const d = new Date(Date.now() - 5 * 60000);
    assert.equal(timeAgo(d.toISOString()), '5m ago');
  });

  it('returns hours ago for times 1-23 hours ago', () => {
    const d = new Date(Date.now() - 3 * 3600000);
    assert.equal(timeAgo(d.toISOString()), '3h ago');
  });

  it('returns days ago for times >= 24 hours ago', () => {
    const d = new Date(Date.now() - 2 * 86400000);
    assert.equal(timeAgo(d.toISOString()), '2d ago');
  });

  it('returns the original string for future dates', () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    assert.equal(timeAgo(future), future);
  });

  it('returns the original string for invalid date strings', () => {
    assert.equal(timeAgo('not-a-date'), 'not-a-date');
  });

  it('returns "just now" for exactly 30 seconds ago', () => {
    const d = new Date(Date.now() - 30000);
    assert.equal(timeAgo(d.toISOString()), 'just now');
  });

  it('returns "1m ago" for exactly 60 seconds ago', () => {
    const d = new Date(Date.now() - 60000);
    assert.equal(timeAgo(d.toISOString()), '1m ago');
  });

  it('returns "59m ago" for 59 minutes ago', () => {
    const d = new Date(Date.now() - 59 * 60000);
    assert.equal(timeAgo(d.toISOString()), '59m ago');
  });

  it('returns "1h ago" for 60 minutes ago', () => {
    const d = new Date(Date.now() - 60 * 60000);
    assert.equal(timeAgo(d.toISOString()), '1h ago');
  });

  it('returns "1d ago" for 24 hours ago', () => {
    const d = new Date(Date.now() - 24 * 3600000);
    assert.equal(timeAgo(d.toISOString()), '1d ago');
  });
});

describe('pruneByStatus', () => {
  it('deletes all non-active memories when status is "all"', () => {
    insertMemory(db, makeMem({ content: 'active memory', summary: 'active', status: 'active' }));
    insertMemory(db, makeMem({ content: 'stale memory', summary: 'stale', status: 'stale' }));
    insertMemory(db, makeMem({ content: 'deprecated memory', summary: 'deprecated', status: 'deprecated' }));

    const removed = pruneByStatus(db, 'all');
    assert.equal(removed, 2);

    const stats = getDbStats(db);
    assert.equal(stats.active, 1);
    assert.equal(stats.stale, 0);
    assert.equal(stats.deprecated, 0);
  });

  it('returns 0 when there are no non-active memories', () => {
    insertMemory(db, makeMem({ content: 'only active', summary: 'active only', status: 'active' }));
    const removed = pruneByStatus(db, 'all');
    assert.equal(removed, 0);
  });

  it('only removes stale memories when status is "stale"', () => {
    insertMemory(db, makeMem({ content: 'active', summary: 'a', status: 'active' }));
    insertMemory(db, makeMem({ content: 'stale1', summary: 's1', status: 'stale' }));
    insertMemory(db, makeMem({ content: 'stale2', summary: 's2', status: 'stale' }));
    insertMemory(db, makeMem({ content: 'deprecated', summary: 'd', status: 'deprecated' }));

    const removed = pruneByStatus(db, 'stale');
    assert.equal(removed, 2);

    const stats = getDbStats(db);
    assert.equal(stats.active, 1);
    assert.equal(stats.stale, 0);
    assert.equal(stats.deprecated, 1);
  });
});

describe('forgetMemory', () => {
  it('deprecates memories matching a query text pattern', () => {
    insertMemory(db, makeMem({ content: 'JWT authentication is critical', summary: 'JWT auth critical', status: 'active' }));
    insertMemory(db, makeMem({ content: 'Database pooling improves performance', summary: 'DB pooling perf', status: 'active' }));

    const result = forgetMemory(db, { query: 'JWT' });
    assert.equal(result.count, 1);
    assert.equal(result.affectedIds.length, 1);

    const stats = getDbStats(db);
    assert.equal(stats.deprecated, 1);
    assert.equal(stats.active, 1);
  });

  it('returns count 0 when no memories match the query', () => {
    insertMemory(db, makeMem({ content: 'Redis caching layer', summary: 'Redis cache', status: 'active' }));
    const result = forgetMemory(db, { query: 'nonexistent-pattern' });
    assert.equal(result.count, 0);
    assert.deepEqual(result.affectedIds, []);
  });

  it('hard-deletes memories when hardDelete is true', () => {
    insertMemory(db, makeMem({ content: 'Temp file cleanup routine', summary: 'temp cleanup', status: 'active' }));
    const result = forgetMemory(db, { query: 'Temp file', hardDelete: true });
    assert.equal(result.count, 1);

    const stats = getDbStats(db);
    assert.equal(stats.total, 0);
  });
});

describe('updateMemory', () => {
  it('returns false when no fields are provided (no changes)', () => {
    const id = insertMemory(db, makeMem({ content: 'Original content', summary: 'Original summary' }));
    const changed = updateMemory(db, id, {});
    assert.equal(changed, false);
  });

  it('returns true and updates fields when valid fields are provided', () => {
    const id = insertMemory(db, makeMem({ content: 'Original', summary: 'Original summary' }));
    const changed = updateMemory(db, id, { summary: 'Updated summary' });
    assert.equal(changed, true);

    const mem = db.prepare('SELECT summary FROM memories WHERE id = ?').get(id);
    assert.equal(mem.summary, 'Updated summary');
  });
});

describe('getDbStats', () => {
  it('returns all required fields with correct types', () => {
    const stats = getDbStats(db);
    assert.equal(typeof stats.total, 'number');
    assert.equal(typeof stats.active, 'number');
    assert.equal(typeof stats.stale, 'number');
    assert.equal(typeof stats.deprecated, 'number');
    assert.equal(typeof stats.from_git, 'number');
    assert.equal(typeof stats.manual, 'number');
    assert.equal(typeof stats.superseded, 'number');
    assert.equal(typeof stats.commits_ingested, 'number');
    assert.equal(typeof stats.file_snapshots, 'number');
    assert.equal(typeof stats.validated, 'number');
    assert.equal(typeof stats.contradicted, 'number');
    assert.equal(typeof stats.agent_breakdown, 'object');
  });

  it('returns accurate counts after inserting memories', () => {
    insertMemory(db, makeMem({ content: 'Active git', summary: 'ag', status: 'active', source: 'git-ingest', agent: 'claude' }));
    insertMemory(db, makeMem({ content: 'Active manual', summary: 'am', status: 'active', source: 'manual', agent: 'cursor' }));
    insertMemory(db, makeMem({ content: 'Stale', summary: 'st', status: 'stale', source: 'git-ingest', agent: 'claude' }));

    const stats = getDbStats(db);
    assert.equal(stats.total, 3);
    assert.equal(stats.active, 2);
    assert.equal(stats.stale, 1);
    assert.equal(stats.deprecated, 0);
    assert.equal(stats.from_git, 2);
    assert.equal(stats.manual, 1);
    assert.equal(stats.agent_breakdown['claude'], 2);
    assert.equal(stats.agent_breakdown['cursor'], 1);
  });

  it('returns zero counts for empty database', () => {
    const stats = getDbStats(db);
    assert.equal(stats.total, 0);
    assert.equal(stats.active, 0);
    assert.equal(stats.stale, 0);
    assert.equal(stats.deprecated, 0);
    assert.equal(stats.from_git, 0);
    assert.equal(stats.manual, 0);
    assert.equal(stats.superseded, 0);
    assert.equal(stats.validated, 0);
    assert.equal(stats.contradicted, 0);
    assert.deepEqual(stats.agent_breakdown, {});
  });
});
