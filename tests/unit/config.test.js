import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RESPONSE_TOKENS,
  FRESHNESS_HALF_LIFE_DAYS,
  DUPLICATE_SIMILARITY_THRESHOLD,
  CONTRADICTION_SIMILARITY_THRESHOLD,
  MAX_LESSON_LENGTH,
  STALE_CHANGE_THRESHOLD,
  VALIDATION_CONFIDENCE_BOOST,
  MAX_CONFIDENCE,
  RANKING_WEIGHTS,
  STATUS_MULTIPLIERS,
  CONTRADICTION_PENALTY,
  CLI_MAX_MEMORIES,
  EMBEDDING_DIM,
} from '../../dist/config.js';

describe('Config constants', () => {
  it('MAX_RESPONSE_TOKENS is a positive number', () => {
    assert.equal(typeof MAX_RESPONSE_TOKENS, 'number');
    assert.ok(MAX_RESPONSE_TOKENS > 0);
  });

  it('FRESHNESS_HALF_LIFE_DAYS is a positive number', () => {
    assert.equal(typeof FRESHNESS_HALF_LIFE_DAYS, 'number');
    assert.ok(FRESHNESS_HALF_LIFE_DAYS > 0);
  });

  it('DUPLICATE_SIMILARITY_THRESHOLD is between 0 and 1', () => {
    assert.equal(typeof DUPLICATE_SIMILARITY_THRESHOLD, 'number');
    assert.ok(DUPLICATE_SIMILARITY_THRESHOLD > 0 && DUPLICATE_SIMILARITY_THRESHOLD <= 1);
  });

  it('CONTRADICTION_SIMILARITY_THRESHOLD is between 0 and 1', () => {
    assert.equal(typeof CONTRADICTION_SIMILARITY_THRESHOLD, 'number');
    assert.ok(CONTRADICTION_SIMILARITY_THRESHOLD > 0 && CONTRADICTION_SIMILARITY_THRESHOLD <= 1);
  });

  it('MAX_LESSON_LENGTH is a positive integer', () => {
    assert.equal(typeof MAX_LESSON_LENGTH, 'number');
    assert.ok(MAX_LESSON_LENGTH > 0);
    assert.equal(MAX_LESSON_LENGTH, Math.floor(MAX_LESSON_LENGTH));
  });

  it('STALE_CHANGE_THRESHOLD is between 0 and 1', () => {
    assert.equal(typeof STALE_CHANGE_THRESHOLD, 'number');
    assert.ok(STALE_CHANGE_THRESHOLD > 0 && STALE_CHANGE_THRESHOLD <= 1);
  });

  it('VALIDATION_CONFIDENCE_BOOST is a small positive number', () => {
    assert.equal(typeof VALIDATION_CONFIDENCE_BOOST, 'number');
    assert.ok(VALIDATION_CONFIDENCE_BOOST > 0 && VALIDATION_CONFIDENCE_BOOST < 1);
  });

  it('MAX_CONFIDENCE is close to 1', () => {
    assert.equal(typeof MAX_CONFIDENCE, 'number');
    assert.ok(MAX_CONFIDENCE > 0.9 && MAX_CONFIDENCE <= 1);
  });

  it('EMBEDDING_DIM is 384', () => {
    assert.equal(EMBEDDING_DIM, 384);
  });

  it('CLI_MAX_MEMORIES is 500', () => {
    assert.equal(CLI_MAX_MEMORIES, 500);
  });

  it('CONTRADICTION_PENALTY is between 0 and 1', () => {
    assert.equal(typeof CONTRADICTION_PENALTY, 'number');
    assert.ok(CONTRADICTION_PENALTY > 0 && CONTRADICTION_PENALTY <= 1);
  });

  it('RANKING_WEIGHTS has all required keys with numeric values summing to 1.0', () => {
    assert.equal(typeof RANKING_WEIGHTS, 'object');
    assert.ok(RANKING_WEIGHTS !== null);
    const expectedKeys = ['similarity', 'scope', 'recency', 'confidence', 'importance', 'validation', 'quality'];
    for (const key of expectedKeys) {
      assert.ok(key in RANKING_WEIGHTS, `RANKING_WEIGHTS should have key "${key}"`);
      assert.equal(typeof RANKING_WEIGHTS[key], 'number');
      assert.ok(RANKING_WEIGHTS[key] >= 0 && RANKING_WEIGHTS[key] <= 1);
    }
    const sum = Object.values(RANKING_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.001, `RANKING_WEIGHTS sum ${sum} should be ~1.0`);
  });

  it('STATUS_MULTIPLIERS has active, stale, deprecated with decreasing values', () => {
    assert.equal(typeof STATUS_MULTIPLIERS, 'object');
    assert.ok(STATUS_MULTIPLIERS !== null);
    assert.equal(STATUS_MULTIPLIERS.active, 1.0);
    assert.ok(STATUS_MULTIPLIERS.active > STATUS_MULTIPLIERS.stale);
    assert.ok(STATUS_MULTIPLIERS.stale > STATUS_MULTIPLIERS.deprecated);
  });
});

describe('Config default values', () => {
  it('MAX_RESPONSE_TOKENS defaults to 250', () => {
    assert.equal(MAX_RESPONSE_TOKENS, 250);
  });

  it('FRESHNESS_HALF_LIFE_DAYS defaults to 120', () => {
    assert.equal(FRESHNESS_HALF_LIFE_DAYS, 120);
  });

  it('DUPLICATE_SIMILARITY_THRESHOLD defaults to 0.90', () => {
    assert.equal(DUPLICATE_SIMILARITY_THRESHOLD, 0.90);
  });

  it('CONTRADICTION_SIMILARITY_THRESHOLD defaults to 0.35', () => {
    assert.equal(CONTRADICTION_SIMILARITY_THRESHOLD, 0.35);
  });

  it('MAX_LESSON_LENGTH defaults to 10000', () => {
    assert.equal(MAX_LESSON_LENGTH, 10000);
  });

  it('STALE_CHANGE_THRESHOLD defaults to 0.30', () => {
    assert.equal(STALE_CHANGE_THRESHOLD, 0.30);
  });

  it('VALIDATION_CONFIDENCE_BOOST defaults to 0.05', () => {
    assert.equal(VALIDATION_CONFIDENCE_BOOST, 0.05);
  });

  it('MAX_CONFIDENCE defaults to 0.99', () => {
    assert.equal(MAX_CONFIDENCE, 0.99);
  });

  it('CONTRADICTION_PENALTY defaults to 0.60', () => {
    assert.equal(CONTRADICTION_PENALTY, 0.60);
  });

  it('CLI_MAX_MEMORIES defaults to 500', () => {
    assert.equal(CLI_MAX_MEMORIES, 500);
  });

  it('EMBEDDING_DIM defaults to 384', () => {
    assert.equal(EMBEDDING_DIM, 384);
  });
});
