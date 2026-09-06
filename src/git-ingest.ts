/**
 * git-ingest.ts — Smart commit filter + ingestion pipeline with provenance.
 *
 * Reads git history, filters high-signal commits, extracts rich provenance,
 * generates local embeddings, and stores them in the local SQLite brain DB.
 *
 * Solves the "git noise" problem:
 *  ✅ IGNORES: WIP, typo, temp, format, bump version, lint commits
 *  ✅ INCLUDES: fix:/feat:/refactor:, breaking changes (!), PR merges, bug/revert commits
 *  ✅ EXTRACTS: author, branch, changed files list, confidence & importance ratings
 *  ✅ DEDUPLICATES: detects duplicate knowledge and merges provenance cleanly
 */

import Database from 'better-sqlite3';
import simpleGit, { type DefaultLogFields, type SimpleGit } from 'simple-git';
import { embed } from './embeddings.js';
import {
  insertMemory,
  findDuplicateMemory,
  mergeMemory,
  isCommitIngested,
  markCommitIngested,
  upsertFileSnapshot,
  type MemoryCategory,
} from './db.js';
import { derivePackageScope } from './scoping.js';
import { evaluateMemoryQuality } from './quality.js';

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
  /^merge\s+branch\s+'main'/i,
];

/** Commits matching these patterns are INCLUDED (high-signal). */
const INCLUDE_PATTERNS: RegExp[] = [
  /^fix(\(.+\))?!?:\s/i,         // Conventional: fix: or fix!:
  /^feat(\(.+\))?!?:\s/i,        // Conventional: feat: or feat!:
  /^refactor(\(.+\))?!?:\s/i,    // Conventional: refactor:
  /^perf(\(.+\))?!?:\s/i,        // Conventional: perf:
  /^revert(\(.+\))?!?:\s/i,      // Revert commit
  /^Merge pull request #\d+/,    // GitHub PR merge
  /^Merge branch .+ into/,       // GitLab/manual branch merge
  /BREAKING CHANGE/i,            // Conventional breaking change footer
  /resolves?\s+#\d+/i,           // Issue reference
  /fixes?\s+#\d+/i,              // Issue fix reference
  /closes?\s+#\d+/i,             // Issue close reference
  /\bbug\b.*\bfix(ed)?\b/i,      // Natural language bug fix
  /\bregression\b/i,             // Regression fix
  /\bhotfix\b/i,                 // Hotfix commits
  /\bsecurity\b/i,               // Security fix
];

// ─── Category & Confidence Inference ─────────────────────────────────────────

function inferCategory(message: string): MemoryCategory {
  const m = message.toLowerCase();
  if (/BREAKING CHANGE|!:/i.test(m))                 return 'architecture';
  if (/^fix|fixes?|bug|regression|hotfix|security/.test(m)) return 'fix';
  if (/^feat/.test(m))                               return 'architecture';
  if (/^refactor/.test(m))                           return 'convention';
  if (/^perf/.test(m))                               return 'fix';
  if (/^revert/.test(m))                             return 'bug';
  return 'convention';
}

function inferConfidenceAndImportance(message: string, category: MemoryCategory): {
  confidence: number;
  importance: number;
} {
  let confidence = 0.90;
  let importance = 1.00;

  if (/BREAKING CHANGE|!:/i.test(message)) {
    confidence = 0.98;
    importance = 1.80;
  } else if (/fixes?\s+#\d+|resolves?\s+#\d+/i.test(message)) {
    confidence = 0.95;
    importance = 1.30;
  } else if (category === 'fix') {
    confidence = 0.92;
    importance = 1.20;
  } else if (category === 'architecture') {
    confidence = 0.90;
    importance = 1.40;
  }

  return { confidence, importance };
}

// ─── Commit Content Builder ───────────────────────────────────────────────────

interface CommitData {
  hash:     string;
  message:  string;
  diff:     string;
  files:    string[];
  author:   string;
  branch:   string;
}

function buildCommitSummary(commit: CommitData): string {
  const files = commit.files.slice(0, 5).join(', ');
  const extraFiles = commit.files.length > 5
    ? ` (+${commit.files.length - 5} more)`
    : '';

  const diffSnippet = commit.diff.slice(0, 500).trim();
  const isBreaking = /BREAKING CHANGE|!:/i.test(commit.message) ? '[BREAKING CHANGE] ' : '';

  return [
    `Commit: ${isBreaking}${commit.message.trim()}`,
    `Files: ${files}${extraFiles}`,
    diffSnippet ? `Diff snippet:\n${diffSnippet}` : '',
  ].filter(Boolean).join('\n');
}

// ─── Signal Filter ────────────────────────────────────────────────────────────

export function isHighSignalCommit(message: string): boolean {
  for (const pattern of IGNORE_PATTERNS) {
    if (pattern.test(message)) return false;
  }
  for (const pattern of INCLUDE_PATTERNS) {
    if (pattern.test(message)) return true;
  }
  return false;
}

// ─── Ingestion Pipeline ───────────────────────────────────────────────────────

export interface IngestOptions {
  repoPath:    string;
  maxCommits?: number;
  dbPath?:     string;
  since?:      string;
  verbose?:    boolean;
  project?:    string;
}

export interface IngestResult {
  scanned:   number;
  ingested:  number;
  skipped:   number;
  merged:    number;
  errors:    number;
}

export async function ingestGitHistory(
  db: Database.Database,
  options: IngestOptions
): Promise<IngestResult> {
  const {
    repoPath,
    maxCommits = 500,
    since = '12 months ago',
    verbose = false,
    project,
  } = options;

  const git: SimpleGit = simpleGit(repoPath);
  const result: IngestResult = { scanned: 0, ingested: 0, skipped: 0, merged: 0, errors: 0 };

  let currentRef = 'main';
  try {
    currentRef = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
  } catch {
    if (verbose) console.error('[ingest] Not a git repository or no commits found.');
    return result;
  }

  let commits: readonly DefaultLogFields[] = [];
  try {
    const log = await git.log({
      maxCount: maxCommits,
      '--since': since,
    });
    commits = log.all;
  } catch (err) {
    if (verbose) console.error('[ingest] Failed to read git log:', err);
    return result;
  }

  if (verbose) console.error(`[ingest] Found ${commits.length} commits to scan.`);

  for (const commit of commits) {
    result.scanned++;

    const hash    = commit.hash;
    const message = commit.message;
    const author  = commit.author_name || commit.author_email || 'unknown';

    if (isCommitIngested(db, hash)) {
      result.skipped++;
      continue;
    }

    if (!isHighSignalCommit(message)) {
      result.skipped++;
      if (verbose) console.error(`[ingest] SKIP  ${hash.slice(0, 7)} — ${message.slice(0, 60)}`);
      continue;
    }

    const category = inferCategory(message);
    const quality = evaluateMemoryQuality(message, category);

    if (!quality.isQuality) {
      result.skipped++;
      if (verbose) console.error(`[ingest] LOW QUALITY ${hash.slice(0, 7)} — ${quality.reason}`);
      continue;
    }

    try {
      const diff = await git.diff([`${hash}^`, hash]).catch(() => '');
      const showOut = await git.show(['--stat', '--format=', hash]).catch(() => '');
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
        author,
        branch: currentRef,
      };

      const summary  = buildCommitSummary(commitData);
      const embedding = embed(summary);
      const primaryFile  = changedFiles[0] ?? null;
      const packageScope = derivePackageScope(primaryFile);
      const { confidence, importance } = inferConfidenceAndImportance(message, category);

      // Check for duplicate knowledge in DB
      const dup = findDuplicateMemory(db, embedding, message, primaryFile, 0.90);
      if (dup) {
        mergeMemory(db, dup.match.id, {
          category,
          content: message,
          summary: summary.slice(0, 500),
          file_path: primaryFile,
          files: JSON.stringify(changedFiles),
          confidence,
          importance,
        });
        markCommitIngested(db, hash, 1);
        result.merged++;
        if (verbose) console.error(`[ingest] MERGE ${hash.slice(0, 7)} -> id ${dup.match.id}`);
        continue;
      }

      const lineCount = primaryFile
        ? (await git.show([`${hash}:${primaryFile}`]).catch(() => '')).split('\n').length
        : 0;

      insertMemory(
        db,
        {
          category,
          content:        message,
          summary:        summary.slice(0, 500),
          file_path:      primaryFile,
          files:          JSON.stringify(changedFiles),
          package_scope:  packageScope,
          commit_hash:    hash,
          git_ref:        currentRef,
          author,
          branch:         currentRef,
          project:        project ?? null,
          confidence,
          importance,
          quality_score:  quality.score,
          status:         'active',
          source:         'git-ingest',
          token_count:    Math.ceil(summary.length / 4),
        },
        embedding
      );

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

export async function ingestSingleCommit(
  db: Database.Database,
  repoPath: string,
  hash: string
): Promise<boolean> {
  const git: SimpleGit = simpleGit(repoPath);

  try {
    const log = await git.log({ maxCount: 1, from: hash, to: hash });
    if (!log.all.length) return false;

    const commit = log.all[0];
    if (!isHighSignalCommit(commit.message)) return false;

    const result = await ingestGitHistory(db, {
      repoPath,
      maxCommits: 1,
      since: '1 day ago',
    });

    return result.ingested > 0 || result.merged > 0;
  } catch {
    return false;
  }
}
