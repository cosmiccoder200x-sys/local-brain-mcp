import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isHighSignalCommit,
  inferCategory,
  inferImportance,
  buildCommitSummary,
} from '../dist/git-ingest.js';

test('isHighSignalCommit correctly classifies high-value vs noise commits', () => {
  // High-signal commits
  assert.equal(isHighSignalCommit('fix(auth): fix session expiration race condition'), true);
  assert.equal(isHighSignalCommit('feat(db): add SQLite WAL mode support'), true);
  assert.equal(isHighSignalCommit('refactor(recall): optimize cosine similarity'), true);
  assert.equal(isHighSignalCommit('perf: sub-millisecond feature hashing'), true);
  assert.equal(isHighSignalCommit('revert: revert broken transaction commit'), true);
  assert.equal(isHighSignalCommit('fix: resolves #1042 memory leak'), true);

  // Noise commits (ignored)
  assert.equal(isHighSignalCommit('wip: saving work before lunch'), false);
  assert.equal(isHighSignalCommit('temp commit'), false);
  assert.equal(isHighSignalCommit('typo in readme'), false);
  assert.equal(isHighSignalCommit('format code with prettier'), false);
  assert.equal(isHighSignalCommit('lint: fix eslint warnings'), false);
  assert.equal(isHighSignalCommit('bump version to 1.0.1'), false);
  assert.equal(isHighSignalCommit('chore: bump dependencies'), false);
});

test('inferCategory accurately categorizes commit intent', () => {
  assert.equal(inferCategory('fix(auth): jwt expiration'), 'fix');
  assert.equal(inferCategory('feat!: breaking architectural migration'), 'architecture');
  assert.equal(inferCategory('refactor: simplify database connection pool'), 'convention');
  assert.equal(inferCategory('revert: bad commit'), 'bug');
});

test('inferImportance boosts critical and breaking changes', () => {
  assert.equal(inferImportance('feat!: BREAKING CHANGE in auth token schema'), 1.5);
  assert.equal(inferImportance('fix: critical security vulnerability in sanitizePath'), 1.4);
  assert.equal(inferImportance('hotfix: production outage fix'), 1.3);
  assert.equal(inferImportance('fix: simple bug fix'), 1.2);
  assert.equal(inferImportance('feat: new query option'), 1.1);
  assert.equal(inferImportance('refactor: code cleanup'), 1.0);
});

test('buildCommitSummary generates clean formatted representation', () => {
  const summary = buildCommitSummary({
    hash: 'a1b2c3d4e5f6',
    message: 'fix(auth): prevent token expiration desync',
    diff: '+ if (now > exp) refresh();',
    files: ['src/auth/jwt.ts', 'src/auth/session.ts'],
    ref: 'main',
  });

  assert.ok(summary.includes('Commit: fix(auth): prevent token expiration desync'));
  assert.ok(summary.includes('Files: src/auth/jwt.ts, src/auth/session.ts'));
  assert.ok(summary.includes('Diff snippet:'));
});
