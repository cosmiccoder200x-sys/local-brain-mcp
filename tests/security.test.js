import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getDb, insertMemory, closeDb } from '../dist/db.js';
import { recallMemories, traceFile } from '../dist/recall.js';
import { sanitizeFilePath } from '../dist/scoping.js';

let tempDir;
let db;

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'local-brain-security-test-'));
  const dbPath = path.join(tempDir, 'brain.db');
  db = getDb(dbPath);
});

after(async () => {
  closeDb();
  await rm(tempDir, { recursive: true, force: true });
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
