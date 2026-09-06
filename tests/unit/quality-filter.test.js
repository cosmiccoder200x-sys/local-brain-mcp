import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMemoryQuality, extractReferencedFiles } from '../../dist/quality.js';

describe('Memory Quality Assessment & Noise Filtering', () => {
  it('rejects trivial shell commands and ephemeral noise', () => {
    const lowValueSamples = [
      'git status',
      'npm install',
      'yarn add lodash',
      'cd ..',
      'ls -la',
      'console.log("hello")',
      'debugger;',
      'wip',
      'todo',
      'asdf',
      'test1',
    ];

    for (const sample of lowValueSamples) {
      const assessment = evaluateMemoryQuality(sample);
      assert.equal(assessment.isQuality, false, `Sample "${sample}" should be rejected as noise`);
      assert.ok(assessment.score < 0.5);
    }
  });

  it('accepts high-signal engineering memories and boosts quality score', () => {
    const highValueSamples = [
      {
        text: 'Fix PostgreSQL connection leak by ensuring pool.release() is called in finally block.',
        category: 'fix',
      },
      {
        text: 'Always use RS256 with JWT tokens in production; rotating keys every 24 hours.',
        category: 'architecture',
      },
      {
        text: 'Prevent race condition in inventory checkout by acquiring distributed Redis lock.',
        category: 'fix',
      },
      {
        text: 'Standardize API error responses according to RFC 7807 problem details convention.',
        category: 'convention',
      },
    ];

    for (const sample of highValueSamples) {
      const assessment = evaluateMemoryQuality(sample.text, sample.category);
      assert.equal(assessment.isQuality, true, `Sample "${sample.text}" must be accepted`);
      assert.ok(assessment.score >= 1.0, `Score (${assessment.score}) should be >= 1.0`);
    }
  });

  it('extracts referenced code file paths from text correctly', () => {
    const text = 'Modified src/auth/jwt.ts and tests/auth.test.ts to fix token expiration handling.';
    const files = extractReferencedFiles(text);
    assert.ok(files.includes('src/auth/jwt.ts'));
    assert.ok(files.includes('tests/auth.test.ts'));
  });
});
