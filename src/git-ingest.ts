/**
 * git-ingest.ts — Smart commit filter + ingestion pipeline.
 *
 * Reads git history, filters high-signal commits, generates local
 * embeddings, and stores them in the local SQLite brain DB.
 *
 * Solves the "git noise" problem:
 *  ✅ IGNORES: WIP, typo, temp, format, bump version, lint commits
 *  ✅ INCLUDES: fix:/feat:/refactor:, PR merges, bug/revert commits
 */

import Database from 'better-sqlite3';
import simpleGit, { type DefaultLogFields, type SimpleGit } from 'simple-git';
import { embed } from './embeddings.js';
import {
  insertMemory,
  insertEmbedding,
  isCommitIngested,
  markCommitIngested,
  upsertFileSnapshot,
  type MemoryCategory,
} from './db.js';
import { derivePackageScope } from './scoping.js';

// ─── Filter Patterns ──────────────────────────────────────────────────────────

/** Commits matching these patterns are SKIPPED (noise). */
const IGNORE_PATTERNS: RegExp[] = [
  /^wip\b/i,
  /^temp\b/i,
  /^tmp\b/i,
  /\btypo\b/i,
  /^format[:\s]/i,
  /^style[:\s]/i,
  /^lint[:\s]/i,
  /^bump\b/i,
  /^chore:\s+bump/i,
  /^update\s+(lock|changelog|version)/i,
  /^\[skip ci\]/i,
  /^whitespace/i,
];

/** Commits matching these patterns are INCLUDED (high-signal). */
const INCLUDE_PATTERNS: RegExp[] = [
  /^fix(\(.+\))?:\s/i,           // Conventional: fix:
  /^feat(\(.+\))?:\s/i,          // Conventional: feat:
  /^refactor(\(.+\))?:\s/i,      // Conventional: refactor:
  /^perf(\(.+\))?:\s/i,          // Conventional: perf:
  /^revert(\(.+\))?:\s/i,        // Revert commit
  /^Merge pull request #\d+/,    // GitHub PR merge
  /^Merge branch .+ into/,       // GitLab/manual branch merge
  /resolves?\s+#\d+/i,           // Issue reference
  /fixes?\s+#\d+/i,              // Issue fix reference
  /closes?\s+#\d+/i,             // Issue close reference
  /\bbug\b.*\bfix(ed)?\b/i,      // Natural language bug fix
  /\bregression\b/i,             // Regression fix
  /\bhotfix\b/i,                 // Hotfix commits
];

// ─── Category Inference ───────────────────────────────────────────────────────

function inferCategory(message: string): MemoryCategory {
  const m = message.toLowerCase();
  if (/^fix|fixes?|bug|regression|hotfix/.test(m)) return 'fix';
  if (/^feat/.test(m))                               return 'architecture';
  if (/^refactor/.test(m))                           return 'convention';
  if (/^perf/.test(m))                               return 'fix';
  if (/^revert/.test(m))                             return 'bug';
  return 'convention';
}

// ─── Commit Content Builder ───────────────────────────────────────────────────

interface CommitData {
  hash:     string;
  message:  string;
  diff:     string;
  files:    string[];
  ref:      string;
}

/**
 * Build a compact plain-English summary of a commit suitable for embedding.
 * Kept under ~200 words to stay within embedding model token limits.
 */
function buildCommitSummary(commit: CommitData): string {
  const files = commit.files.slice(0, 5).join(', ');
  const extraFiles = commit.files.length > 5
    ? ` (+${commit.files.length - 5} more)`
    : '';

  // Truncate diff to first 500 chars to keep context compact
  const diffSnippet = commit.diff.slice(0, 500).trim();

  return [
    `Commit: ${commit.message.trim()}`,
    `Files: ${files}${extraFiles}`,
    diffSnippet ? `Diff snippet:\n${diffSnippet}` : '',
  ].filter(Boolean).join('\n');
}

// ─── Signal Filter ────────────────────────────────────────────────────────────

export function isHighSignalCommit(message: string): boolean {
  // Reject if matches any ignore pattern
  for (const pattern of IGNORE_PATTERNS) {
    if (pattern.test(message)) return false;
  }

  // Accept if matches any include pattern
  for (const pattern of INCLUDE_PATTERNS) {
    if (pattern.test(message)) return true;
  }

  return false;
}

// ─── Ingestion Pipeline ───────────────────────────────────────────────────────

export interface IngestOptions {
  repoPath:  string;
  maxCommits: number;
  dbPath?:   string;
  since?:    string;   // e.g. '6 months ago'
  verbose?:  boolean;
}

export interface IngestResult {
  scanned:   number;
  ingested:  number;
  skipped:   number;
  errors:    number;
}

/**
 * Scan git history, filter high-signal commits, embed, and store in brain DB.
 */
export async function ingestGitHistory(
  db: Database.Database,
  options: IngestOptions
): Promise<IngestResult> {
  const { repoPath, maxCommits = 500, since = '12 months ago', verbose = false } = options;

  const git: SimpleGit = simpleGit(repoPath);
  const result: IngestResult = { scanned: 0, ingested: 0, skipped: 0, errors: 0 };

  let currentRef: string;
  try {
    currentRef = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
  } catch {
    console.error('[ingest] Not a git repository or no commits found.');
    return result;
  }

  // Fetch commit log
  const logArgs = ['--oneline', '--no-merges', `--since="${since}"`];
  const log = await git.log({
    maxCount: maxCommits,
    '--since': since,
  });

  const commits: readonly DefaultLogFields[] = log.all;

  if (verbose) console.error(`[ingest] Found ${commits.length} commits to scan.`);

  for (const commit of commits) {
    result.scanned++;

    const hash    = commit.hash;
    const message = commit.message;

    // Skip already-ingested commits
    if (isCommitIngested(db, hash)) {
      result.skipped++;
      continue;
    }

    // Apply signal filter
    if (!isHighSignalCommit(message)) {
      result.skipped++;
      if (verbose) console.error(`[ingest] SKIP  ${hash.slice(0, 7)} — ${message.slice(0, 60)}`);
      continue;
    }

    try {
      // Get diff for this commit
      const diff = await git.diff([`${hash}^`, hash]).catch(() => '');
      const showOut = await git.show(['--stat', '--format=', hash]);
      const changedFiles = showOut
        .split('\n')
        .filter(l => l.includes('|'))
        .map(l => l.split('|')[0].trim())
        .filter(Boolean);

      const commitData: CommitData = {
        hash,
        message,
        diff,
        files: changedFiles,
        ref: currentRef,
      };

      const summary  = buildCommitSummary(commitData);
      const category = inferCategory(message);

      // Generate embedding
      const embedding = await embed(summary);

      // Store in DB — use first changed file as primary scope
      const primaryFile  = changedFiles[0] ?? null;
      const packageScope = derivePackageScope(primaryFile);

      const lineCount = primaryFile
        ? (await git.show([`${hash}:${primaryFile}`]).catch(() => '')).split('\n').length
        : 0;

      const rowid = insertMemory(db, {
        category,
        content:      message,
        summary:      summary.slice(0, 500),
        file_path:    primaryFile,
        package_scope: packageScope,
        commit_hash:  hash,
        git_ref:      currentRef,
        status:       'active',
        source:       'git-ingest',
        token_count:  Math.ceil(summary.length / 4),
      });

      insertEmbedding(db, rowid, embedding);

      if (primaryFile) {
        upsertFileSnapshot(db, primaryFile, hash, lineCount);
      }

      markCommitIngested(db, hash, 1);

      result.ingested++;
      if (verbose) console.error(`[ingest] OK    ${hash.slice(0, 7)} — ${message.slice(0, 60)}`);
    } catch (err) {
      result.errors++;
      if (verbose) console.error(`[ingest] ERROR ${hash.slice(0, 7)} —`, err);
    }
  }

  return result;
}

/**
 * Process a single commit (called from the post-commit git hook).
 */
export async function ingestSingleCommit(
  db: Database.Database,
  repoPath: string,
  hash: string
): Promise<boolean> {
  const git: SimpleGit = simpleGit(repoPath);

  const log = await git.log({ maxCount: 1, from: hash, to: hash });
  if (!log.all.length) return false;

  const commit = log.all[0];
  if (!isHighSignalCommit(commit.message)) return false;

  const result = await ingestGitHistory(db, {
    repoPath,
    maxCommits: 1,
    since: '1 day ago',
  });

  return result.ingested > 0;
}
