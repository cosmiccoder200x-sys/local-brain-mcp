import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  embed,
  embedBatch,
  tokenize,
  cosineSimilarity,
  hashToBucket,
  hashSign,
  estimateTokens,
  EMBEDDING_DIM,
} from '../dist/embeddings.js';

test('tokenize splits camelCase, snake_case, and file paths', () => {
  const tokens = tokenize('verifyJwtToken in auth/jwt_service.ts');
  assert.ok(tokens.includes('verify'));
  assert.ok(tokens.includes('jwt'));
  assert.ok(tokens.includes('token'));
  assert.ok(tokens.includes('auth'));
  assert.ok(tokens.includes('service'));
});

test('tokenize filters common stopwords', () => {
  const tokens = tokenize('this is a test of the emergency broadcast system and it is active');
  assert.ok(!tokens.includes('this'));
  assert.ok(!tokens.includes('is'));
  assert.ok(!tokens.includes('the'));
  assert.ok(!tokens.includes('and'));
  assert.ok(tokens.includes('test'));
  assert.ok(tokens.includes('emergency'));
  assert.ok(tokens.includes('broadcast'));
  assert.ok(tokens.includes('system'));
});

test('embed returns 384-dimensional Float32Array with unit norm', () => {
  const vec = embed('Fix JWT token expiration on Tuesday auth window');
  assert.equal(vec.length, EMBEDDING_DIM);
  assert.ok(vec instanceof Float32Array);

  // Check L2 unit norm
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  assert.ok(Math.abs(Math.sqrt(sumSq) - 1.0) < 1e-4);
});

test('embed handles empty or whitespace input safely without NaN', () => {
  const empty = embed('');
  assert.equal(empty.length, EMBEDDING_DIM);
  assert.ok(empty.every(val => val === 0));

  const whitespace = embed('   \n\t  ');
  assert.equal(whitespace.length, EMBEDDING_DIM);
  assert.ok(whitespace.every(val => val === 0));
});

test('embed is strictly deterministic', () => {
  const text = 'Deterministic hashing algorithm test with SQLite WAL mode';
  const vec1 = embed(text);
  const vec2 = embed(text);
  assert.deepEqual(Array.from(vec1), Array.from(vec2));
});

test('cosineSimilarity computes expected geometric similarities', () => {
  const text1 = 'JWT authentication with RSA private key';
  const text2 = 'JWT auth with RSA public key verification';
  const text3 = 'Docker container deployment on Kubernetes cluster';

  const v1 = embed(text1);
  const v2 = embed(text2);
  const v3 = embed(text3);

  const simRelated = cosineSimilarity(v1, v2);
  const simUnrelated = cosineSimilarity(v1, v3);

  assert.ok(simRelated > simUnrelated, `Expected related similarity (${simRelated}) > unrelated (${simUnrelated})`);
  assert.ok(simRelated > 0.4, `Expected strong similarity for related texts, got ${simRelated}`);
});

test('estimateTokens gives reasonable 4-chars/token estimate', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('1234'), 1);
  assert.equal(estimateTokens('12345678'), 2);
  assert.equal(estimateTokens('123456789'), 3);
});
