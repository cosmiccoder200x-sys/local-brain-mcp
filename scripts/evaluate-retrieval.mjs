/**
 * evaluate-retrieval.mjs — Information Retrieval (IR) quality evaluation for local-brain.
 *
 * Measures:
 *  - Precision@1, Precision@3, Precision@5
 *  - Recall@5
 *  - Mean Reciprocal Rank (MRR)
 *  - Normalized Discounted Cumulative Gain (NDCG@5)
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getDb, insertMemory, insertEmbedding, closeDb } from '../dist/db.js';
import { embed } from '../dist/embeddings.js';
import { recallMemories } from '../dist/recall.js';

// Ground truth memory corpus
const CORPUS = [
  {
    id: 1,
    category: 'fix',
    summary: 'Fix JWT RS256 token rotation desynchronization by caching certificates with 1-hour TTL',
    file_path: 'src/auth/jwt.ts',
    package_scope: 'packages/auth',
  },
  {
    id: 2,
    category: 'architecture',
    summary: 'Use SQLite WAL mode and synchronous=NORMAL for concurrent fast reads without locks',
    file_path: 'src/db/connection.ts',
    package_scope: 'packages/db',
  },
  {
    id: 3,
    category: 'convention',
    summary: 'Always use parameterized prepared statements in better-sqlite3 to prevent SQL injection',
    file_path: 'src/db/queries.ts',
    package_scope: 'packages/db',
  },
  {
    id: 4,
    category: 'bug',
    summary: 'Session expiration silently fails on Tuesday UTC maintenance window due to redis socket timeout',
    file_path: 'src/auth/session.ts',
    package_scope: 'packages/auth',
  },
  {
    id: 5,
    category: 'fix',
    summary: 'Fix memory leak in feature hashing vectorizer by caching subword regex splits',
    file_path: 'src/embeddings.ts',
    package_scope: 'packages/core',
  },
  {
    id: 6,
    category: 'architecture',
    summary: 'Monorepo path scoping isolates package memories to packages/auth and packages/ui',
    file_path: 'src/scoping.ts',
    package_scope: 'packages/core',
  },
  {
    id: 7,
    category: 'convention',
    summary: 'Use Zod schema validation for all MCP tool input parameters before business logic',
    file_path: 'src/mcp-server.ts',
    package_scope: 'packages/core',
  },
  {
    id: 8,
    category: 'fix',
    summary: 'Fix Docker container crash on Windows paths by normalizing backward slashes to POSIX',
    file_path: 'src/cli.ts',
    package_scope: 'packages/cli',
  },
  {
    id: 9,
    category: 'fix',
    summary: 'Rate limiter connection leak when Redis pool is not properly drained on SIGTERM',
    file_path: 'src/middleware/rate-limit.ts',
    package_scope: 'packages/auth',
  },
  {
    id: 10,
    category: 'architecture',
    summary: 'Composite ranking algorithm weights semantic similarity 60%, importance 15%, freshness 15%',
    file_path: 'src/recall.ts',
    package_scope: 'packages/core',
  },
];

// Evaluation test cases (query -> relevant memory IDs with graded relevance)
const EVAL_QUERIES = [
  {
    query: 'JWT RS256 token rotation bug',
    relevantIds: [1, 4],
    file_path: 'src/auth/jwt.ts',
  },
  {
    query: 'SQLite WAL mode database concurrency',
    relevantIds: [2, 3],
    file_path: 'src/db/connection.ts',
  },
  {
    query: 'prevent SQL injection in sqlite prepared statements',
    relevantIds: [3, 2],
    file_path: 'src/db/queries.ts',
  },
  {
    query: 'session timeout failure bug',
    relevantIds: [4, 1],
    file_path: 'src/auth/session.ts',
  },
  {
    query: 'feature hashing embeddings memory leak',
    relevantIds: [5, 10],
    file_path: 'src/embeddings.ts',
  },
  {
    query: 'monorepo package scoping path filtering',
    relevantIds: [6, 10],
    file_path: 'src/scoping.ts',
  },
  {
    query: 'MCP input schema validation Zod',
    relevantIds: [7],
    file_path: 'src/mcp-server.ts',
  },
  {
    query: 'Windows backslash path normalization in Docker',
    relevantIds: [8],
    file_path: 'src/cli.ts',
  },
  {
    query: 'composite ranking multi-factor score algorithm',
    relevantIds: [10, 5],
    file_path: 'src/recall.ts',
  },
];

function dcg(retrievedIds, relevantIds, k = 5) {
  let score = 0;
  const topK = retrievedIds.slice(0, k);
  for (let i = 0; i < topK.length; i++) {
    const isRel = relevantIds.includes(topK[i]) ? 1 : 0;
    score += isRel / Math.log2(i + 2); // i is 0-indexed, so log2(rank + 1) -> log2(i + 2)
  }
  return score;
}

function idcg(relevantIds, k = 5) {
  let score = 0;
  const idealCount = Math.min(relevantIds.length, k);
  for (let i = 0; i < idealCount; i++) {
    score += 1 / Math.log2(i + 2);
  }
  return score > 0 ? score : 1;
}

async function runEvaluation() {
  console.log('='.repeat(60));
  console.log('📈 local-brain Retrieval Quality Evaluation');
  console.log('='.repeat(60));

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'local-brain-eval-'));
  const dbPath = path.join(tempDir, 'brain.db');
  const db = getDb(dbPath);

  // Ingest corpus
  for (const item of CORPUS) {
    const vec = embed(item.summary);
    const rowId = insertMemory(db, {
      category: item.category,
      content: item.summary,
      summary: item.summary,
      file_path: item.file_path,
      package_scope: item.package_scope,
      commit_hash: 'eval_hash',
      git_ref: 'main',
      status: 'active',
      source: 'manual',
      token_count: 20,
      importance: 1.0,
      confidence: 1.0,
    }, vec);
  }

  let totalP1 = 0;
  let totalP3 = 0;
  let totalP5 = 0;
  let totalRecall5 = 0;
  let totalRR = 0;
  let totalNDCG5 = 0;

  console.log(`\nEvaluating ${EVAL_QUERIES.length} benchmark queries…\n`);

  for (const tc of EVAL_QUERIES) {
    const result = await recallMemories(db, {
      query: tc.query,
      file_path: tc.file_path,
      max_items: 5,
    });

    const retrievedIds = result.memories.map(m => m.id);
    const relSet = new Set(tc.relevantIds);

    // P@1
    const p1 = (retrievedIds.length > 0 && relSet.has(retrievedIds[0])) ? 1 : 0;
    totalP1 += p1;

    // P@3
    const top3 = retrievedIds.slice(0, 3);
    const hits3 = top3.filter(id => relSet.has(id)).length;
    const p3 = top3.length > 0 ? hits3 / 3 : 0;
    totalP3 += p3;

    // P@5
    const hits5 = retrievedIds.slice(0, 5).filter(id => relSet.has(id)).length;
    const p5 = retrievedIds.length > 0 ? hits5 / Math.min(5, retrievedIds.length) : 0;
    totalP5 += p5;

    // Recall@5
    const r5 = tc.relevantIds.length > 0 ? hits5 / tc.relevantIds.length : 1;
    totalRecall5 += r5;

    // Reciprocal Rank (RR)
    let rank = 0;
    for (let i = 0; i < retrievedIds.length; i++) {
      if (relSet.has(retrievedIds[i])) {
        rank = i + 1;
        break;
      }
    }
    const rr = rank > 0 ? 1 / rank : 0;
    totalRR += rr;

    // NDCG@5
    const currentDcg = dcg(retrievedIds, tc.relevantIds, 5);
    const idealDcg = idcg(tc.relevantIds, 5);
    const ndcg5 = currentDcg / idealDcg;
    totalNDCG5 += ndcg5;

    const rankStr = rank > 0 ? `#${rank}` : 'MISS';
    console.log(`  Query: "${tc.query}"`);
    console.log(`    Rank of 1st relevant: ${rankStr} | P@1: ${p1} | Recall@5: ${(r5 * 100).toFixed(0)}% | NDCG@5: ${ndcg5.toFixed(2)}`);
  }

  const N = EVAL_QUERIES.length;
  console.log('\n' + '-'.repeat(60));
  console.log('📊 OVERALL RETRIEVAL METRICS:');
  console.log('-'.repeat(60));
  console.log(`  • Precision@1:  ${((totalP1 / N) * 100).toFixed(1)}%`);
  console.log(`  • Precision@3:  ${((totalP3 / N) * 100).toFixed(1)}%`);
  console.log(`  • Precision@5:  ${((totalP5 / N) * 100).toFixed(1)}%`);
  console.log(`  • Recall@5:     ${((totalRecall5 / N) * 100).toFixed(1)}%`);
  console.log(`  • MRR:          ${(totalRR / N).toFixed(3)}`);
  console.log(`  • NDCG@5:       ${(totalNDCG5 / N).toFixed(3)}`);
  console.log('='.repeat(60) + '\n');

  closeDb();
  await rm(tempDir, { recursive: true, force: true });
}

runEvaluation().catch(console.error);
