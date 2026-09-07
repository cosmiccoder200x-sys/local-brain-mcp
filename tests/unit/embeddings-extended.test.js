import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { embedBatch, embed, EMBEDDING_DIM } from '../../dist/embeddings.js';

describe('embedBatch', () => {
  it('returns correct number of vectors with correct dimensions', () => {
    const texts = ['hello world', 'foo bar baz', 'test embedding'];
    const results = embedBatch(texts);

    assert.equal(results.length, 3);
    for (const vec of results) {
      assert.ok(vec instanceof Float32Array, 'each result should be a Float32Array');
      assert.equal(vec.length, EMBEDDING_DIM, `vector length should be ${EMBEDDING_DIM}`);
    }
  });

  it('returns empty array when given an empty array', () => {
    const results = embedBatch([]);
    assert.deepEqual([...results], []);
    assert.equal(results.length, 0);
  });

  it('returns a single vector for a single text input', () => {
    const results = embedBatch(['single text input']);
    assert.equal(results.length, 1);
    assert.equal(results[0].length, EMBEDDING_DIM);
  });

  it('each vector is L2-normalized (magnitude <= 1.001)', () => {
    const results = embedBatch(['normalize me', 'another vector test']);
    for (const vec of results) {
      let sumSquares = 0;
      for (let i = 0; i < vec.length; i++) {
        sumSquares += vec[i] * vec[i];
      }
      const magnitude = Math.sqrt(sumSquares);
      assert.ok(magnitude <= 1.001, `magnitude ${magnitude} should be <= 1.001`);
    }
  });

  it('produces deterministic output for the same inputs', () => {
    const texts = ['deterministic test', 'same input same output'];
    const first = embedBatch(texts);
    const second = embedBatch(texts);

    assert.equal(first.length, second.length);
    for (let i = 0; i < first.length; i++) {
      for (let j = 0; j < first[i].length; j++) {
        assert.equal(first[i][j], second[i][j], `vector[${i}][${j}] should match`);
      }
    }
  });

  it('empty strings produce zero vectors', () => {
    const results = embedBatch(['', '']);
    for (const vec of results) {
      let sumSquares = 0;
      for (let i = 0; i < vec.length; i++) {
        sumSquares += vec[i] * vec[i];
      }
      assert.equal(sumSquares, 0, 'zero vector expected for empty string');
    }
  });

  it('different texts produce different vectors', () => {
    const results = embedBatch(['PostgreSQL connection pool leak fix', 'Redis cache invalidation strategy']);
    assert.notDeepEqual([...results[0]], [...results[1]]);
  });
});
