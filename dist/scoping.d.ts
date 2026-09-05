/**
 * scoping.ts — Monorepo directory-scoped query filtering & path sanitization.
 *
 * When a developer works in `packages/auth/`, we only surface memories
 * from that sub-package — preventing noise from unrelated modules.
 */
/**
 * Sanitize a file path to prevent directory traversal and null byte injections.
 * Returns normalized repo-relative path (e.g. 'src/auth/jwt.ts') or null if invalid.
 */
export declare function sanitizeFilePath(filePath: string | null | undefined): string | null;
/**
 * Derive the monorepo package scope from a file path.
 *
 * Examples:
 *   packages/auth/src/jwt.ts       → 'packages/auth'
 *   apps/dashboard/pages/index.tsx → 'apps/dashboard'
 *   src/utils/helpers.ts           → null  (no monorepo scope)
 */
export declare function derivePackageScope(filePath: string | null | undefined): string | null;
/**
 * Build a parameterized SQLite filter for package scoped queries.
 *
 * Examples:
 *   scope: 'packages/auth'    → LIKE 'packages/auth/%' OR 'packages/auth'
 *   scope: null               → no filter (query all)
 */
export declare function buildScopeFilter(scope: string | null): {
    sql: string;
    params: string[];
};
/**
 * Detect the likely working package scope from the current working directory.
 * Used by the CLI and MCP server when no explicit file_path is provided.
 */
export declare function detectWorkingScope(cwd?: string): string | null;
/**
 * Normalize a raw file path to a repo-relative path, given the repo root.
 *
 * e.g.
 *   repoRoot: /home/user/projects/myapp
 *   filePath: /home/user/projects/myapp/packages/auth/jwt.ts
 *   → packages/auth/jwt.ts
 */
export declare function toRelativePath(filePath: string, repoRoot: string): string;
//# sourceMappingURL=scoping.d.ts.map