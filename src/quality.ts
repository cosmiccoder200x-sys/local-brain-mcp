/**
 * quality.ts — Memory Quality Assessment, Noise Filtering, and Provenance Extraction.
 *
 * Implements conservative quality filters to ensure Local Brain retains durable,
 * high-signal engineering knowledge while rejecting ephemeral shell commands,
 * raw debug logs, and trivial noise.
 */

import type { MemoryCategory, ImportanceLevel } from "./db.js";

export interface QualityAssessment {
  isQuality: boolean;
  score: number; // 0.0 to 2.0
  reason?: string;
}

// ─── Low-Value Noise Patterns ────────────────────────────────────────────────

const TRIVIAL_PATTERNS: RegExp[] = [
  /^(git\s+(status|add|commit|push|pull|checkout|switch|branch|stash|diff|log|fetch))\b/i,
  /^(npm\s+(install|i|run|start|build|test|ci))\b/i,
  /^(yarn|pnpm|bun)\s+(add|install|run|build)\b/i,
  /^(cd|ls|pwd|cat|mkdir|touch|rm|cp|mv|clear|echo)\s/i,
  /^(console\.log|print|fmt\.Println|debugger;?|System\.out\.println)\b/i,
  /^(test\d*|asdf|qwerty|foo|bar|baz|hello\s*world|wip|temp|tmp)$/i,
  /^update\s*$/i,
  /^fix\s*$/i,
  /^wip[:\s]/i,
  /^check\s*$/i,
  /^todo:?\s*$/i,
];

// ─── High-Value Signal Patterns ──────────────────────────────────────────────

const HIGH_VALUE_PATTERNS: RegExp[] = [
  /\b(because|caused by|root cause|fix|resolved|workaround)\b/i,
  /\b(race condition|deadlock|concurrency|memory leak|buffer overflow)\b/i,
  /\b(architecture|pattern|convention|standard|migration|deprecated)\b/i,
  /\b(security|vulnerability|injection|xss|csrf|auth|jwt|oauth|rbac)\b/i,
  /\b(performance|latency|throughput|cache|indexing|optimize|n\+1)\b/i,
  /\b(database|postgres|sqlite|mysql|redis|mongodb|schema|foreign key)\b/i,
  /\b(breaking change|backward compatibility|contract|api version)\b/i,
  /\b(always|never|must|do not|ensure|guideline)\b/i,
];

/**
 * Evaluates whether a candidate lesson has sufficient engineering quality to be preserved.
 * Conservative design: keeps anything potentially useful, rejecting only unambiguous noise.
 */
export function evaluateMemoryQuality(
  content: string,
  category: MemoryCategory = "manual"
): QualityAssessment {
  const trimmed = content.trim();

  // 1. Length check: extremely short strings are almost always noise
  if (trimmed.length < 8) {
    return {
      isQuality: false,
      score: 0.1,
      reason: "Memory content too short (< 8 characters) to convey meaningful engineering context.",
    };
  }

  // 2. Reject pure noise / trivial shell commands
  for (const pattern of TRIVIAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        isQuality: false,
        score: 0.2,
        reason: "Content matches ephemeral command or temporary debugging pattern.",
      };
    }
  }

  let score = 1.0;

  // 3. Category weighting
  if (category === "architecture" || category === "fix") {
    score += 0.3;
  } else if (category === "bug") {
    score += 0.2;
  }

  // 4. Boost for high-signal terminology
  let matchCount = 0;
  for (const pattern of HIGH_VALUE_PATTERNS) {
    if (pattern.test(trimmed)) {
      matchCount++;
    }
  }
  score += Math.min(0.5, matchCount * 0.15);

  // 5. Structure boost (contains code snippets, backticks, or multi-line reasoning)
  if (trimmed.includes("`") || trimmed.includes("\n")) {
    score += 0.2;
  }

  return {
    isQuality: true,
    score: Math.round(score * 100) / 100,
  };
}

/**
 * Extracts referenced file paths from memory text or markdown.
 */
export function extractReferencedFiles(text: string): string[] {
  const fileRegex = /([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9_]{1,6})/g;
  const matches = text.match(fileRegex) || [];
  const validFiles = new Set<string>();

  const knownExtensions = new Set([
    "ts",
    "tsx",
    "js",
    "jsx",
    "json",
    "sql",
    "py",
    "go",
    "rs",
    "java",
    "cpp",
    "c",
    "h",
    "hpp",
    "md",
    "yaml",
    "yml",
    "toml",
    "env",
    "sh",
  ]);

  for (const m of matches) {
    const ext = m.split(".").pop()?.toLowerCase();
    if (ext && knownExtensions.has(ext) && !m.startsWith("http://") && !m.startsWith("https://")) {
      validFiles.add(m);
    }
  }

  return Array.from(validFiles);
}

/**
 * Infers importance level ('low'|'medium'|'high'|'critical') based on content keywords.
 */
export function detectImportanceLevel(content: string): ImportanceLevel {
  const lower = content.toLowerCase();
  if (
    lower.includes("critical") ||
    lower.includes("vulnerability") ||
    lower.includes("security") ||
    lower.includes("data loss") ||
    lower.includes("breaking change") ||
    lower.includes("must not") ||
    lower.includes("never")
  ) {
    return "critical";
  }
  if (
    lower.includes("high") ||
    lower.includes("architecture") ||
    lower.includes("convention") ||
    lower.includes("always") ||
    lower.includes("important")
  ) {
    return "high";
  }
  if (
    lower.includes("low") ||
    lower.includes("minor") ||
    lower.includes("trivial") ||
    lower.includes("cosmetic")
  ) {
    return "low";
  }
  return "medium";
}
