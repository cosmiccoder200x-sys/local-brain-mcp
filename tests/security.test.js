import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getDb, insertMemory, closeDb } from '../dist/db.js';
import { recallMemories, traceFile } from '../dist/recall.js';
import { sanitizeFilePath } from '../dist/scoping.js';

let tempDir;
let dbPath;
let db;

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'local-brain-security-test-'));
  dbPath = path.join(tempDir, 'brain.db');
  db = getDb(dbPath);
});

after(async () => {
  closeDb();
  await rm(tempDir, { recursive: true, force: true });
});

test('database and existing WAL sidecars are owner-only on POSIX', () => {
  if (process.platform === 'win32') return;

  for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (!existsSync(filePath)) continue;
    const mode = statSync(filePath).mode & 0o777;
    assert.equal(mode, 0o600, `${path.basename(filePath)} must be readable/writable only by its owner`);
  }
});

test('SQL injection in search queries is safely parameterized', async () => {
  const injectionPayloads = [
    "' OR '1'='1",
    "'; DROP TABLE memories; --",
    "admin' --",
    "1 UNION SELECT null, null, null, null, null, null, null, null, null, null, null, null, null, null, null",
  ];

  for (const payload of injectionPayloads) {
    const result = await recallMemories(db, { query: payload });
    assert.ok(Array.isArray(result.memories));
  }

  // Ensure table still exists and is healthy
  const countRow = db.prepare('SELECT count(*) as count FROM memories').get();
  assert.ok(typeof countRow.count === 'number');
});

test('Path traversal in file_path is safely contained', () => {
  const dangerousPaths = [
    '../../../../../../etc/shadow',
    '..\\..\\..\\windows\\system32\\cmd.exe',
    '/root/.ssh/id_rsa',
    '\x00/evil/path',
  ];

  for (const dangerous of dangerousPaths) {
    const sanitized = sanitizeFilePath(dangerous);
    assert.ok(!sanitized?.includes('..'), `Path ${dangerous} must not contain '..' after sanitization`);
    assert.ok(!sanitized?.startsWith('/'), `Path ${dangerous} must not start with '/'`);
  }
});

test('traceFile safely handles arbitrary or invalid file input', () => {
  const result = traceFile(db, '../../invalid/path/traversal');
  assert.ok(Array.isArray(result));
});
