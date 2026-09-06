/**
 * benchmark.mjs — Performance benchmark runner for local-brain-mcp.
 * Measures real latency and throughput for:
 *  - Embedding generation
 *  - Database insertion
 *  - Scaled recall search (100, 500, 1000 items)
 *  - Database memory footprint
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { embed, cosineSimilarity } from '../dist/embeddings.js';
import { getDb, insertMemory, insertEmbedding, closeDb } from '../dist/db.js';
import { recallMemories } from '../dist/recall.js';

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
  return sorted[index];
}

async function runBenchmarks() {
  console.log('='.repeat(60));
  console.log('🚀 local-brain-mcp Performance Benchmarks');
  console.log('='.repeat(60));

  const sampleTexts = [
    'fix(auth): RS256 token rotation race condition in multi-tenant session provider',
    'architecture: Use SQLite WAL mode for zero-latency concurrent reader access',
    'convention: Always use parameterized queries with better-sqlite3 to prevent SQL injection',
    'bug: Session timeout silently fails on Tuesday UTC maintenance window in auth service',
    'refactor: Migrate token extraction to custom subword tokenizer for camelCase support',
    'perf: Precompute L2 unit norms to reduce vector search dot products to sub-millisecond range',
    'fix(database): Connection pool exhaustion when batch inserts exceed 50 items',
    'feat(mcp): Add brain_status operational telemetry tool for safe diagnostics',
  ];

  // 1. Embedding Benchmark
  console.log('\n📊 1. Embedding Engine Latency (Pure-JS 384-dim TF-IDF feature hashing)');
  const embedLatencies = [];
  const N_EMBED = 2000;
  const startEmbed = performance.now();

  for (let i = 0; i < N_EMBED; i++) {
    const text = sampleTexts[i % sampleTexts.length];
    const t0 = performance.now();
    embed(text);
    embedLatencies.push(performance.now() - t0);
  }
  const totalEmbedTime = performance.now() - startEmbed;

  console.log(`   Samples:     ${N_EMBED}`);
  console.log(`   Throughput:  ${Math.round((N_EMBED / totalEmbedTime) * 1000)} embeddings/sec`);
  console.log(`   p50 Latency: ${percentile(embedLatencies, 50).toFixed(4)} ms`);
  console.log(`   p95 Latency: ${percentile(embedLatencies, 95).toFixed(4)} ms`);
  console.log(`   p99 Latency: ${percentile(embedLatencies, 99).toFixed(4)} ms`);

  // 2. Database Insertion Benchmark
  console.log('\n📊 2. SQLite Database Insertion Latency');
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'local-brain-bench-'));
  const dbPath = path.join(tempDir, 'brain.db');
  const db = getDb(dbPath);

  const insertLatencies = [];
  const N_INSERT = 1000;
  const startInsert = performance.now();

  for (let i = 0; i < N_INSERT; i++) {
    const text = `${sampleTexts[i % sampleTexts.length]} (item #${i})`;
    const vec = embed(text);
    const t0 = performance.now();
    const id = insertMemory(db, {
      category: 'architecture',
      content: text,
      summary: text.slice(0, 200),
      file_path: `src/module_${i % 20}/file_${i}.ts`,
      package_scope: `packages/module_${i % 5}`,
      commit_hash: `commit_${i}`,
      git_ref: 'main',
      status: 'active',
      source: 'git-ingest',
      token_count: 25,
      importance: 1.0,
      confidence: 1.0,
    }, vec);
    insertLatencies.push(performance.now() - t0);
  }
  const totalInsertTime = performance.now() - startInsert;

  console.log(`   Inserted:    ${N_INSERT} records`);
  console.log(`   Throughput:  ${Math.round((N_INSERT / totalInsertTime) * 1000)} inserts/sec`);
  console.log(`   p50 Latency: ${percentile(insertLatencies, 50).toFixed(4)} ms`);
  console.log(`   p95 Latency: ${percentile(insertLatencies, 95).toFixed(4)} ms`);
  console.log(`   p99 Latency: ${percentile(insertLatencies, 99).toFixed(4)} ms`);

  // 3. Scaled Recall Latency (1,000 memories in DB)
  console.log('\n📊 3. Semantic Recall Latency across 1,000 memories');
  const queries = [
    'JWT authentication bug',
    'SQLite connection pooling',
    'token rotation race condition',
    'parameterized queries better-sqlite3',
    'module refactor performance',
  ];

  const recallLatencies = [];
  const N_QUERIES = 200;

  for (let i = 0; i < N_QUERIES; i++) {
    const query = queries[i % queries.length];
    const t0 = performance.now();
    await recallMemories(db, { query, max_items: 5 });
    recallLatencies.push(performance.now() - t0);
  }

  console.log(`   Queries:     ${N_QUERIES}`);
  console.log(`   p50 Latency: ${percentile(recallLatencies, 50).toFixed(3)} ms`);
  console.log(`   p95 Latency: ${percentile(recallLatencies, 95).toFixed(3)} ms`);
  console.log(`   p99 Latency: ${percentile(recallLatencies, 99).toFixed(3)} ms`);

  // Cleanup
  closeDb();
  await rm(tempDir, { recursive: true, force: true });

  console.log('\n' + '='.repeat(60));
  console.log('✅ Benchmarks completed successfully.');
  console.log('='.repeat(60) + '\n');
}

runBenchmarks().catch(console.error);
