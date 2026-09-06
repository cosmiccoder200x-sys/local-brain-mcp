import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getProjectId,
  detectAgent,
  normalizeAgentId,
  buildProvenanceNote,
  AGENT_IDS,
} from '../dist/provenance.js';

describe('Provenance & Agent Detection Tests', () => {
  test('AGENT_IDS contains standard AI agents', () => {
    assert.ok(AGENT_IDS.includes('claude-code'));
    assert.ok(AGENT_IDS.includes('cursor'));
    assert.ok(AGENT_IDS.includes('antigravity'));
    assert.ok(AGENT_IDS.includes('copilot'));
    assert.ok(AGENT_IDS.includes('windsurf'));
    assert.ok(AGENT_IDS.includes('unknown'));
  });

  test('detectAgent accurately checks environment variables', () => {
    const originalEnv = { ...process.env };

    try {
      delete process.env.CLAUDE_CODE_VERSION;
      delete process.env.CURSOR_TRACE_ID;
      delete process.env.ANTIGRAVITY_SESSION;
      delete process.env.LOCAL_BRAIN_AGENT;

      process.env.CLAUDE_CODE_VERSION = '1.0.0';
      assert.strictEqual(detectAgent(), 'claude-code');

      delete process.env.CLAUDE_CODE_VERSION;
      process.env.CURSOR_TRACE_ID = 'trace-123';
      assert.strictEqual(detectAgent(), 'cursor');

      delete process.env.CURSOR_TRACE_ID;
      process.env.ANTIGRAVITY_SESSION = 'ag-sess-456';
      assert.strictEqual(detectAgent(), 'antigravity');

      delete process.env.ANTIGRAVITY_SESSION;
      process.env.LOCAL_BRAIN_AGENT = 'custom-agent';
      assert.strictEqual(detectAgent(), 'custom-agent');
    } finally {
      process.env = originalEnv;
    }
  });

  test('normalizeAgentId sanitizes strings safely', () => {
    assert.strictEqual(normalizeAgentId('  Claude-Code  '), 'claude-code');
    assert.strictEqual(normalizeAgentId('CURSOR'), 'cursor');
    assert.strictEqual(normalizeAgentId(null), 'unknown');
    assert.strictEqual(normalizeAgentId(''), 'unknown');
  });

  test('getProjectId produces deterministic 8-char hex string', () => {
    const id1 = getProjectId(process.cwd());
    const id2 = getProjectId(process.cwd());
    assert.strictEqual(id1, id2);
    assert.strictEqual(typeof id1, 'string');
    assert.strictEqual(id1.length, 8);
    assert.match(id1, /^[0-9a-f]{8}$/);
  });

  test('buildProvenanceNote generates comprehensive human-readable summary', () => {
    const note = buildProvenanceNote({
      agent: 'claude-code',
      source: 'manual',
      project_id: 'a1b2c3d4',
      branch: 'main',
      commit: 'abcdef123456',
      files: ['src/db.ts', 'src/recall.ts'],
      created_at: '2026-09-06T12:00:00Z',
      last_validated: '2026-09-06T14:00:00Z',
      validation_count: 3,
      confidence: 0.95,
      status: 'active',
    });

    assert.ok(note.includes('Agent: claude-code'));
    assert.ok(note.includes('Project: a1b2c3d4'));
    assert.ok(note.includes('Branch: main'));
    assert.ok(note.includes('Commit: abcdef1'));
    assert.ok(note.includes('Validated: 3×'));
    assert.ok(note.includes('Confidence: 95%'));
  });
});
